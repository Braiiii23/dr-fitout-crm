// Justin's estimating checklist. The progress bar on each quote = steps done / steps.
export const EST_STEPS = [
  { key: "estPlansAt", short: "Plans", label: "Plans received" },
  { key: "estScopeAt", short: "Scope", label: "Scope reference" },
  { key: "estExcelAt", short: "Excel", label: "Excel estimate" },
  { key: "estRfqAt", short: "RFQs", label: "RFQs" },
  { key: "estPrelimAt", short: "Prelim", label: "Prelim" },
  { key: "estRfqRecAt", short: "RFQs received", label: "RFQs received" },
  { key: "estProposalAt", short: "Proposal", label: "Proposal" },
  { key: "estSentAt", short: "Sent", label: "Sent" },
] as const;
export type EstStepKey = (typeof EST_STEPS)[number]["key"];
export type EstFields = Record<EstStepKey, string | null>;

export const isEstStep = (k: string): k is EstStepKey => EST_STEPS.some((s) => s.key === k);
export const stepsDone = (l: EstFields) => EST_STEPS.filter((s) => !!l[s.key]).length;
export const estPercent = (l: EstFields) => Math.round((stepsDone(l) / EST_STEPS.length) * 100);
/** First step not yet ticked, in order (null when everything is done). */
export const nextStep = (l: EstFields) => EST_STEPS.find((s) => !l[s.key]) ?? null;

// ----- Trade pack: trade quotes per job -----
export const TRADES = [
  "Demolition", "Carpentry", "Joinery", "Plasterboard & ceilings", "Electrical", "Plumbing", "Mechanical / HVAC",
  "Fire services", "Flooring", "Painting", "Glazing", "Data & comms", "Signage", "Cleaning", "Other",
];
export const TRADE_STATUSES = ["Requested", "Received", "Accepted", "Declined"] as const;

type TQ = { trade: string; price: number | null; status: string };
/** Per trade: the quote that counts (Accepted, otherwise the cheapest Received). Total = sum of those. */
export function summariseTrades<T extends TQ>(quotes: T[]) {
  const byTrade = new Map<string, T[]>();
  for (const q of quotes) byTrade.set(q.trade, [...(byTrade.get(q.trade) ?? []), q]);
  const rows = [...byTrade.entries()].map(([trade, qs]) => {
    const priced = qs.filter((q) => q.price != null && (q.status === "Received" || q.status === "Accepted"));
    const accepted = qs.find((q) => q.status === "Accepted" && q.price != null) ?? null;
    const cheapest = priced.length ? priced.reduce((a, b) => ((a.price ?? 0) <= (b.price ?? 0) ? a : b)) : null;
    const counts = accepted ?? cheapest;
    return { trade, quotes: qs, counts, basis: accepted ? "Accepted" : cheapest ? "Lowest received" : "Waiting", waiting: qs.filter((q) => q.status === "Requested").length };
  }).sort((a, b) => a.trade.localeCompare(b.trade));
  const total = rows.reduce((n, r) => n + (r.counts?.price ?? 0), 0);
  return {
    rows, total,
    received: quotes.filter((q) => q.status === "Received" || q.status === "Accepted").length,
    requested: quotes.filter((q) => q.status === "Requested").length,
    tradesCovered: rows.filter((r) => r.counts).length,
  };
}

// ----- Scope of works: master list per job, checked against the trade quotes -----
export type Coverage = "covered" | "waiting" | "missing" | "client";
export const COVERAGE_LABEL: Record<Coverage, string> = { covered: "Covered", waiting: "Waiting on quote", missing: "Not quoted", client: "By client / others" };

type SI = { trade: string; byClient: boolean };
/** Coverage for each scope item from the trade summary: priced trade = covered, only requested = waiting, none = missing. */
export function scopeCoverage<S extends SI, T extends TQ & { company?: string | null }>(items: S[], quotes: T[]) {
  const sum = summariseTrades(quotes);
  const key = (t: string) => t.trim().toLowerCase();
  const byTrade = new Map(sum.rows.map((r) => [key(r.trade), r]));
  const rows = items.map((it) => {
    const r = byTrade.get(key(it.trade));
    const cov: Coverage = it.byClient ? "client" : r?.counts ? "covered" : r && r.waiting ? "waiting" : "missing";
    return { item: it, coverage: cov, by: cov === "covered" ? r!.counts : null };
  });
  const count = (c: Coverage) => rows.filter((r) => r.coverage === c).length;
  return { rows, total: rows.length, covered: count("covered"), waiting: count("waiting"), missing: count("missing"), client: count("client") };
}
