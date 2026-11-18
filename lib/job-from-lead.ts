import "server-only";
import { prisma } from "./db";
import { summariseTrades } from "./estimating";
import { brisbaneToday } from "./time";

/** When a lead is Signed, create its WIP job once: contract, job number, client, the usual claim split,
 *  and the estimator's trade quotes as the starting cost lines (so the estimate becomes the budget). */
export async function ensureJobForLead(leadId: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { tradeQuotes: true } });
  if (!lead || lead.stage !== "Signed" || (lead.brand !== "ENP" && lead.brand !== "DR")) return null;
  const existing = await prisma.job.findUnique({ where: { leadId } });
  if (existing) return existing;
  const contract = lead.contractValue ?? lead.quoteValue ?? 0;
  const job = await prisma.job.create({
    data: {
      leadId, brand: lead.brand, name: lead.company || lead.leadName || "New job", jobNumber: lead.jobNumber, client: lead.company || lead.leadName,
      contractValue: contract, status: "Live", startDate: lead.signedDate ?? brisbaneToday(), source: "lead",
      notes: "Created when the lead was signed. Check the claim split against the signed agreement.",
    },
  });
  const split: [number, string, string][] = [[30, "Deposit", "Before start"], [30, "Sheeting complete", "Once sheeting is finished"], [35, "Joinery and finishes", "Near joinery and finishes"], [5, "Handover", "Last week before handover"]];
  let allocated = 0;
  for (let k = 0; k < split.length; k++) {
    const [pct, name, hook] = split[k];
    const amount = k === split.length - 1 ? Math.round((contract - allocated) * 100) / 100 : Math.round(contract * pct) / 100;
    allocated += amount;
    await prisma.jobClaim.create({ data: { jobId: job.id, seq: k + 1, name, pct, amount, hook, source: "lead" } });
  }
  const trades = summariseTrades(lead.tradeQuotes);
  let sort = 0;
  for (const r of trades.rows) {
    await prisma.jobCostLine.create({ data: { jobId: job.id, trade: r.trade, supplier: r.counts?.company ?? null, cost: r.counts?.price ?? 0, costStatus: r.counts ? "Quoted" : "Provisional", paid: null, sort: sort++, source: "lead", notes: r.counts ? null : "No trade quote received at signing" } });
  }
  if (lead.estOtherCosts) await prisma.jobCostLine.create({ data: { jobId: job.id, trade: "Other costs (materials, labour, site)", cost: lead.estOtherCosts, costStatus: "Provisional", paid: null, sort: sort++, source: "lead" } });
  return job;
}
