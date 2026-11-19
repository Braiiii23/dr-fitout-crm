import "server-only";
import { prisma } from "./db";
import { summariseTrades, scopeCoverage } from "./estimating";
import { audit } from "./automations";

type EstInput = {
  quoteValue: number | null; contractValue?: number | null; estOtherCosts: number | null; estContingencyPct: number | null;
  tradeQuotes: { trade: string; price: number | null; status: string; company?: string | null }[];
  scopeItems?: { trade: string; byClient: boolean }[];
};

/** The estimator's job cost and gross profit: trade quotes (accepted, else lowest received) + other costs + contingency. */
export function jobEstimate(l: EstInput, sellOverride?: number | null) {
  const trades = summariseTrades(l.tradeQuotes);
  const other = l.estOtherCosts ?? 0;
  const contPct = l.estContingencyPct ?? 0;
  const base = trades.total + other;
  const contingency = base * contPct / 100;
  const cost = base + contingency;
  const sell = sellOverride ?? l.quoteValue ?? 0;
  const gp = sell - cost;
  const scope = l.scopeItems ? scopeCoverage(l.scopeItems, l.tradeQuotes) : null;
  return {
    tradeTotal: trades.total, tradesPriced: trades.tradesCovered, aiEstimated: trades.aiEstimated, tradesWaiting: trades.requested, other, contPct, contingency, cost, sell, gp,
    gpPct: sell > 0 ? gp / sell * 100 : 0,
    hasEstimate: base > 0,
    notQuoted: scope?.missing ?? 0, waitingScope: scope?.waiting ?? 0,
  };
}

/** When a job becomes Signed with no Gross Profit yet, fill it from the estimator's estimate (against the contract value). */
export async function fillGpOnSign(leadId: string, who: string | null) {
  const l = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { stage: true, grossProfit: true, quoteValue: true, contractValue: true, estOtherCosts: true, estContingencyPct: true, tradeQuotes: { select: { trade: true, price: true, status: true } } },
  });
  if (!l || l.stage !== "Signed" || l.grossProfit != null) return;
  const e = jobEstimate(l, l.contractValue ?? l.quoteValue);
  if (!e.hasEstimate || e.sell <= 0) return;
  await prisma.lead.update({ where: { id: leadId }, data: { grossProfit: Math.round(e.gp) } });
  await audit(who, "gross profit filled from estimate", "Lead", leadId, `${Math.round(e.gp)} (${e.gpPct.toFixed(1)}%)`);
}

/**
 * The one set of money figures for a job, used by both the estimating board and Accounts so they always agree.
 * Signed jobs use the contract value; others the quote amount. GP comes from, in order: GP entered on the job,
 * the estimator's cost estimate, then (Accounts only) the average Xero margin.
 */
export type JobMoneyInput = EstInput & { stage: string | null; grossProfit: number | null };
export function jobMoney(l: JobMoneyInput, averageMargin?: number) {
  const signed = l.stage === "Signed" && (l.contractValue ?? 0) > 0;
  const sell = signed ? (l.contractValue ?? 0) : (l.quoteValue ?? 0);
  const e = jobEstimate(l, sell);
  let cost: number | null = null, gp: number | null = null;
  let from: "entered on job" | "at cost" | "estimate" | "average margin" | "none" = "none";
  if (signed && l.grossProfit != null) { gp = l.grossProfit; cost = sell - gp; from = gp <= 0 ? "at cost" : "entered on job"; }
  else if (e.hasEstimate) { cost = e.cost; gp = sell > 0 ? sell - e.cost : null; from = "estimate"; }
  else if (averageMargin != null && sell > 0) { gp = sell * averageMargin; cost = sell - gp; from = "average margin"; }
  return {
    signed, sell, cost, gp, gpPct: gp != null && sell > 0 ? gp / sell * 100 : null, from,
    final: e.hasEstimate ? e.notQuoted === 0 && e.tradesWaiting === 0 : false,
    estimate: e,
  };
}
