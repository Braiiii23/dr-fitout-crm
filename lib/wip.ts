import "server-only";
import { prisma } from "./db";
import { brisbaneToday } from "./time";
import type { Job, JobClaim, JobCostLine, JobBill, JobLabour, JobMaterial, JobTask } from "@prisma/client";
import { claimPlan } from "./claim-timing";

// All WIP maths for one job, from that job's own records only (no overhead, no other jobs).
// Conventions: amounts ex GST unless the name ends in Inc. A cost line's paid = null means Pending, never $0.

export type FullJob = Job & { claims: JobClaim[]; costLines: (JobCostLine & { bills: JobBill[]; labour: JobLabour[]; materials: JobMaterial[] })[]; bills: JobBill[]; labour: JobLabour[]; materials: JobMaterial[]; tasks: JobTask[] };

export const fullJobInclude = {
  claims: { orderBy: { seq: "asc" as const } },
  costLines: { orderBy: [{ sort: "asc" as const }, { trade: "asc" as const }], include: { bills: true, labour: true, materials: true } },
  bills: { orderBy: { dueDate: "asc" as const } },
  labour: { orderBy: { date: "asc" as const } },
  materials: { orderBy: { date: "asc" as const } },
  tasks: { orderBy: { start: "asc" as const } },
};

const CLAIMED = ["Authorised", "Paid"];
const r2 = (n: number) => Math.round(n * 100) / 100;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dm = (iso?: string | null) => (iso ? `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}` : "");
export const mondayOf = (iso: string) => { const d = new Date(iso + "T00:00:00Z"); const wd = (d.getUTCDay() + 6) % 7; return addDays(iso, -wd); };

/** A cost line's paid: entered figure, else what's linked (paid bills + labour + materials), else Pending (null). */
export function linePaid(l: FullJob["costLines"][number]): { paid: number | null; from: "entered" | "linked" | "pending" } {
  if (l.paid != null) return { paid: l.paid, from: "entered" };
  const linked = l.bills.filter((b) => b.status === "Paid").reduce((t, b) => t + b.amount, 0)
    + l.labour.reduce((t, x) => t + x.hours * x.rate, 0) + l.materials.reduce((t, m) => t + m.amount, 0);
  const hasLinks = l.bills.some((b) => b.status === "Paid") || l.labour.length > 0 || l.materials.length > 0;
  return hasLinks ? { paid: r2(linked), from: "linked" } : { paid: null, from: "pending" };
}

export type Flag = { level: "red" | "amber"; text: string; tab: string };

export function wipFor(job: FullJob, today = brisbaneToday()) {
  // ----- claims -----
  const claims = job.claims.map((c) => {
    const inc = r2(c.amount * 1.1);
    const claimed = CLAIMED.includes(c.status);
    const outstandingInc = claimed ? r2(Math.max(0, inc - c.receivedInc)) : 0;
    const overdueDays = claimed && outstandingInc > 0.5 && c.dueDate && c.dueDate < today ? daysBetween(c.dueDate, today) : 0;
    return { ...c, inc, claimed, outstandingInc, overdueDays };
  });
  const claimedEx = claims.filter((c) => c.claimed).reduce((t, c) => t + c.amount, 0);
  const claimedPct = claims.filter((c) => c.claimed).reduce((t, c) => t + c.pct, 0);
  const receivedInc = claims.reduce((t, c) => t + c.receivedInc, 0);
  const receivedEx = receivedInc / 1.1;
  const owedInc = claims.reduce((t, c) => t + c.outstandingInc, 0);
  const scheduledPct = claims.reduce((t, c) => t + c.pct, 0);
  const toClaimEx = Math.max(0, job.contractValue - claimedEx);

  // ----- costs -----
  const lines = job.costLines.map((l) => {
    const p = linePaid(l);
    const owing = p.paid == null ? null : r2(l.cost - p.paid);
    const authorisedBills = l.bills.filter((b) => b.status === "Authorised").reduce((t, b) => t + b.amount, 0);
    return { ...l, paidNow: p.paid, paidFrom: p.from, owing, over: p.paid != null && p.paid > l.cost + 0.5, authorisedBills };
  });
  const costTotal = lines.reduce((t, l) => t + l.cost, 0);
  const paidTotal = lines.reduce((t, l) => t + (l.paidNow ?? 0), 0);
  const owingKnown = lines.reduce((t, l) => t + (l.owing ?? 0), 0);
  const pendingLines = lines.filter((l) => l.paidNow == null);
  const pendingCost = pendingLines.reduce((t, l) => t + l.cost, 0);
  const lockedCost = lines.filter((l) => l.costStatus === "Locked" || l.paidNow != null).reduce((t, l) => t + l.cost, 0);
  // Forecast cost: the larger of quote and what's actually been paid, per line.
  const forecastCost = lines.reduce((t, l) => t + Math.max(l.cost, l.paidNow ?? 0), 0);
  const forecastGp = job.contractValue - forecastCost;
  const forecastGpPct = job.contractValue ? forecastGp / job.contractValue * 100 : 0;

  // ----- labour & materials -----
  const hours = job.labour.reduce((t, x) => t + x.hours, 0);
  const labourCost = job.labour.reduce((t, x) => t + x.hours * x.rate, 0);
  const unapproved = job.labour.filter((x) => !x.approved);
  const unapprovedHours = unapproved.reduce((t, x) => t + x.hours, 0);
  const materialsTotal = job.materials.reduce((t, m) => t + m.amount, 0);
  const unlinkedLabour = job.labour.filter((x) => !x.costLineId).reduce((t, x) => t + x.hours * x.rate, 0);
  const unlinkedMaterials = job.materials.filter((m) => !m.costLineId).reduce((t, m) => t + m.amount, 0);
  const paidOutEx = paidTotal + unlinkedLabour + unlinkedMaterials;
  const cashPositionEx = receivedEx - paidOutEx;

  // ----- bills -----
  const unmappedBills = job.bills.filter((b) => b.status !== "Paid" && b.claimSeq == null);
  const billsOwing = job.bills.filter((b) => b.status === "Authorised").reduce((t, b) => t + b.amount, 0);

  // ----- actual profit and loss (ex GST) -----
  // Income = claims invoiced (authorised or paid). Costs = what's actually been spent or billed:
  // each trade's paid figure plus its approved bills not yet paid, plus bills, labour and receipts not tied to a trade.
  // Pending trades with nothing paid or billed count as $0 here (that's what "actual" means); the forecast covers the rest.
  const unlinkedBills = job.bills.filter((b) => !b.costLineId && b.status !== "Draft");
  const tradeActual = lines.map((l) => ({ id: l.id, trade: l.trade, budget: l.cost, actual: r2((l.paidNow ?? 0) + l.authorisedBills), pending: l.paidNow == null && !l.authorisedBills }));
  const actualTrades = tradeActual.reduce((t, x) => t + x.actual, 0);
  const actualOtherBills = unlinkedBills.reduce((t, b) => t + b.amount, 0);
  const actualCosts = actualTrades + actualOtherBills + unlinkedLabour + unlinkedMaterials;
  const actualIncome = claimedEx;
  const actualProfit = actualIncome - actualCosts;
  const actual = {
    income: actualIncome, receivedEx, trades: actualTrades, otherBills: actualOtherBills, labour: unlinkedLabour, materials: unlinkedMaterials,
    costs: actualCosts, profit: actualProfit, pct: actualIncome ? actualProfit / actualIncome * 100 : 0,
    tradeRows: tradeActual, pendingTrades: tradeActual.filter((x) => x.pending).length,
    // Share of the contract invoiced so far: profit is "to date" until it reaches 100%.
    invoicedPct: job.contractValue ? actualIncome / job.contractValue * 100 : 0,
  };

  // ----- progress & dates -----
  const tasks = job.tasks;
  const taskProgress = tasks.length ? tasks.filter((t) => t.done || t.finish < today).length / tasks.length : null;
  const timeProgress = job.startDate && job.finishDate && job.finishDate > job.startDate
    ? Math.min(1, Math.max(0, daysBetween(job.startDate, today) / daysBetween(job.startDate, job.finishDate))) : null;
  const progress = taskProgress ?? (scheduledPct ? claimedPct / scheduledPct : timeProgress ?? 0);
  const progressFrom = taskProgress != null ? "program" : scheduledPct ? "claims" : "dates";
  const lastTask = tasks.length ? tasks.reduce((a, b) => (b.finish > a.finish ? b : a)).finish : null;
  const forecastFinish = lastTask && (!job.finishDate || lastTask > job.finishDate) ? lastTask : job.finishDate;
  const daysLate = job.status === "Live" && job.finishDate ? Math.max(daysBetween(job.finishDate, forecastFinish ?? job.finishDate), job.finishDate < today ? daysBetween(job.finishDate, today) : 0) : 0;
  const nextClaim = claims.find((c) => !c.claimed) ?? null;
  const nextTask = tasks.find((t) => !t.done && t.finish >= today) ?? null;

  // Paid in full: the whole contract claimed, and every dollar of it received.
  const paidInFull = job.contractValue > 0 && claimedEx >= job.contractValue - 1 && owedInc <= 1;

  // ----- flags (what needs action) -----
  const flags: Flag[] = [];
  for (const c of claims) {
    if (c.overdueDays > 0) flags.push({ level: "red", text: `Claim ${c.seq} (${c.invoiceNumber ?? c.name}) overdue ${c.overdueDays} days: $${Math.round(c.outstandingInc).toLocaleString("en-AU")} inc GST owing`, tab: "claims" });
    else if (c.status === "Authorised" && c.outstandingInc > 0.5) flags.push({ level: "amber", text: `Claim ${c.seq} (${c.invoiceNumber ?? c.name}) authorised, not paid${c.dueDate ? `, due ${dm(c.dueDate)}` : ""}`, tab: "claims" });
  }
  // A claim whose milestone tasks are all finished but which hasn't been invoiced yet.
  for (const p of claimPlan(job, today)) {
    if (p.state === "ready") flags.push({ level: "red", text: `Claim ${p.seq} (${p.name}) ready to invoice: ${dm(p.issueOn)} · ${p.basis}`, tab: "claims" });
    else if (p.state === "soon") flags.push({ level: "amber", text: `Claim ${p.seq} (${p.name}) due to invoice ${dm(p.issueOn)}`, tab: "claims" });
  }
  for (const b of unmappedBills) flags.push({ level: "amber", text: `${b.supplier} ${b.invoiceNumber ?? ""} $${Math.round(b.amount).toLocaleString("en-AU")} ex GST ${b.status.toLowerCase()}${b.dueDate ? `, due ${dm(b.dueDate)}` : ""}: not mapped to a claim`, tab: "costs" });
  for (const l of lines.filter((x) => x.over)) flags.push({ level: "red", text: `${l.trade} over its allowance: paid $${Math.round(l.paidNow ?? 0).toLocaleString("en-AU")} vs $${Math.round(l.cost).toLocaleString("en-AU")}`, tab: "costs" });
  if (unapprovedHours > 0) flags.push({ level: "amber", text: `${unapprovedHours.toFixed(2)} labour hours not approved`, tab: "labour" });
  if (daysLate > 0) flags.push({ level: "red", text: `Running ${daysLate} day${daysLate === 1 ? "" : "s"} late (handover ${dm(job.finishDate)}${forecastFinish && forecastFinish !== job.finishDate ? `, program says ${dm(forecastFinish)}` : ""})`, tab: "program" });
  if (job.contractValue && Math.abs(scheduledPct - 100) > 0.5 && claims.length) flags.push({ level: "amber", text: `Claim schedule adds up to ${scheduledPct}%, not 100%`, tab: "claims" });
  if (job.status === "Complete" && !paidInFull) flags.push({ level: "red", text: owedInc > 1 ? `Completed but $${Math.round(owedInc).toLocaleString("en-AU")} inc GST still owed` : `Completed but only ${claimedPct}% of the contract has been claimed`, tab: "claims" });
  if (job.status !== "Complete" && paidInFull) flags.push({ level: "amber", text: "Paid in full: mark the job Complete on the Job details tab", tab: "details" });
  if (!lines.length) flags.push({ level: "amber", text: "No trades or costs entered yet, so forecast GP is the whole contract", tab: "costs" });
  if (!job.finishDate && job.status === "Live") flags.push({ level: "amber", text: "No expected handover date set", tab: "details" });
  if (pendingLines.length) flags.push({ level: "amber", text: `${pendingLines.length} trade${pendingLines.length === 1 ? "" : "s"} with payments pending ($${Math.round(pendingCost).toLocaleString("en-AU")} of costs)`, tab: "costs" });

  return {
    claims, claimedEx, claimedPct, receivedInc, receivedEx, owedInc, toClaimEx, scheduledPct,
    lines, costTotal, paidTotal, owingKnown, pendingCount: pendingLines.length, pendingCost, lockedCost, forecastCost, forecastGp, forecastGpPct,
    hours, labourCost, unapprovedHours, materialsTotal, paidOutEx, cashPositionEx,
    unmappedBills, billsOwing, actual,
    progress, progressFrom, forecastFinish, daysLate, nextClaim, nextTask, paidInFull,
    flags: flags.sort((a, b) => (a.level === b.level ? 0 : a.level === "red" ? -1 : 1)),
  };
}
export type Wip = ReturnType<typeof wipFor>;

/** Numbers kept each week so the WIP view can show what changed. */
export const snapshotOf = (w: Wip) => ({ claimedEx: w.claimedEx, receivedInc: w.receivedInc, costTotal: w.costTotal, paidTotal: w.paidTotal, forecastGp: w.forecastGp, progress: w.progress });

export async function liveJobs(brand: "ENP" | "DR" | "ALL", includeComplete = false) {
  return prisma.job.findMany({
    where: { ...(brand === "ALL" ? {} : { brand }), ...(includeComplete ? {} : { status: { not: "Complete" } }) },
    include: fullJobInclude, orderBy: [{ finishDate: "asc" }],
  });
}

/** Save this week's snapshot for each job once (on the first WIP view of the week), and return last week's. */
export async function weeklySnapshots(jobs: { id: string; w: Wip }[], today = brisbaneToday()) {
  const week = mondayOf(today);
  for (const j of jobs) {
    await prisma.jobSnapshot.upsert({ where: { jobId_weekOf: { jobId: j.id, weekOf: week } }, create: { jobId: j.id, weekOf: week, json: JSON.stringify(snapshotOf(j.w)) }, update: {} });
  }
  const prev = await prisma.jobSnapshot.findMany({ where: { jobId: { in: jobs.map((j) => j.id) }, weekOf: { lt: week } }, orderBy: { weekOf: "desc" } });
  const byJob = new Map<string, ReturnType<typeof snapshotOf> & { weekOf: string }>();
  for (const s of prev) if (!byJob.has(s.jobId)) byJob.set(s.jobId, { ...JSON.parse(s.json), weekOf: s.weekOf });
  return byJob;
}
