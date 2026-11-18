"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/automations";
import { claimNamesFor } from "@/lib/claim-names";

// ---------- form helpers ----------
const s = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? "").trim(); return v || null; };
const n = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? "").replace(/[$,\s]/g, ""); if (v === "") return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
const d = (fd: FormData, k: string) => { const v = s(fd, k); return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; };
const i = (fd: FormData, k: string) => { const x = n(fd, k); return x == null ? null : Math.round(x); };
const done = (jobId: string, tab?: string) => { revalidatePath(`/jobs/${jobId}`); revalidatePath("/jobs"); revalidatePath("/wip"); return tab; };
async function admin() { return requireUser(["ADMIN"]); }
/** Braiden or the accounts login: the money side of a job (claims, bills, costs, labour, materials, Xero). */
async function money() { return requireUser(["ADMIN", "ACCOUNTS"]); }
/** Costs, bills, labour, materials and Xero refresh: Braiden, accounts and project managers. */
async function costs() { return requireUser(["ADMIN", "ACCOUNTS", "PM"]); }
/** The build program and job dates: Braiden and project managers. */
async function site() { return requireUser(["ADMIN", "PM"]); }

// ---------- job ----------
export async function saveJob(fd: FormData) {
  const u = await site();
  const id = s(fd, "id");
  if (u.role === "PM" && !id) return; // new jobs come from signed leads or Braiden
  const data = {
    brand: "DR", name: s(fd, "name") ?? "Untitled job", jobNumber: s(fd, "jobNumber"), xeroTracking: s(fd, "xeroTracking"),
    client: s(fd, "client"), contractValue: n(fd, "contractValue") ?? 0, status: ["Live", "On hold", "Complete"].includes(s(fd, "status") ?? "") ? s(fd, "status")! : "Live",
    startDate: d(fd, "startDate"), finishDate: d(fd, "finishDate"), pm: s(fd, "pm"), notes: s(fd, "notes"),
    ...(fd.has("btJobName") ? { btJobName: s(fd, "btJobName") } : {}),
  };
  if (u.role === "PM" && id) { const cur = await prisma.job.findUnique({ where: { id } }); if (cur) { data.contractValue = cur.contractValue; data.brand = cur.brand; } } // contract and brand stay with Braiden
  const job = id ? await prisma.job.update({ where: { id }, data }) : await prisma.job.create({ data });
  if (id && job.contractValue > 0 && (await prisma.jobClaim.count({ where: { jobId: id } })) === 0) await setClaimSchedule(id, job.contractValue, claimNamesFor([30, 30, 35, 5]));
  // A new job gets the usual claim pattern to start from (30 / 30 / 35 / 5); edit it to match the signed agreement.
  if (!id && fd.get("defaultClaims") === "on") await setClaimSchedule(job.id, job.contractValue, [[30, "Deposit", "Before start"], [30, "Sheeting complete", "Once sheeting is finished"], [35, "Joinery and finishes", "Near joinery and finishes"], [5, "Handover", "Last week before handover"]]);
  await audit(u.email, id ? "update job" : "create job", "Job", job.id, job.name);
  done(job.id);
  if (!id) redirect(`/jobs/${job.id}`);
}

export async function deleteJob(fd: FormData) {
  const u = await admin();
  const id = s(fd, "id"); if (!id) return;
  if (s(fd, "confirm") !== "DELETE") return;
  await prisma.job.delete({ where: { id } });
  await audit(u.email, "delete job", "Job", id);
  revalidatePath("/jobs"); redirect("/jobs");
}

async function setClaimSchedule(jobId: string, contract: number, rows: [number, string, string | null][]) {
  let allocated = 0;
  for (let k = 0; k < rows.length; k++) {
    const [pct, name, hook] = rows[k];
    const amount = k === rows.length - 1 ? Math.round((contract - allocated) * 100) / 100 : Math.round(contract * pct) / 100;
    allocated += amount;
    await prisma.jobClaim.create({ data: { jobId, seq: k + 1, name, pct, amount, hook } });
  }
}

/** Replace the claim schedule with a split like "30/30/20/15/5" (only while no claim has been invoiced). */
export async function applySplit(fd: FormData) {
  const u = await money();
  const jobId = s(fd, "jobId")!; const split = (s(fd, "split") ?? "").split(/[\/,\s]+/).map(Number).filter((x) => x > 0);
  if (!split.length || Math.abs(split.reduce((a, b) => a + b, 0) - 100) > 0.01) return;
  const job = await prisma.job.findUnique({ where: { id: jobId }, include: { claims: true } });
  if (!job || job.claims.some((c) => c.status !== "Not due" && c.status !== "Draft")) return;
  await prisma.jobClaim.deleteMany({ where: { jobId } });
  await setClaimSchedule(jobId, job.contractValue, claimNamesFor(split));
  await audit(u.email, "claim split", "Job", jobId, split.join("/"));
  done(jobId);
}

// ---------- claims ----------
export async function saveClaim(fd: FormData) {
  const u = await money();
  const jobId = s(fd, "jobId")!; const id = s(fd, "id");
  const job = await prisma.job.findUnique({ where: { id: jobId } }); if (!job) return;
  const pct = n(fd, "pct") ?? 0;
  const amount = n(fd, "amount") ?? Math.round(job.contractValue * pct) / 100;
  const data = {
    seq: i(fd, "seq") ?? 1, name: s(fd, "name") ?? "Claim", pct, amount, hook: s(fd, "hook"), invoiceNumber: s(fd, "invoiceNumber"),
    status: ["Not due", "Draft", "Authorised", "Paid"].includes(s(fd, "status") ?? "") ? s(fd, "status")! : "Not due",
    invoicedDate: d(fd, "invoicedDate"), dueDate: d(fd, "dueDate"), receivedInc: n(fd, "receivedInc") ?? 0, notes: s(fd, "notes"),
    ...(fd.has("issueOn") ? { issueOn: d(fd, "issueOn") } : {}),
  };
  if (id) await prisma.jobClaim.update({ where: { id }, data }); else await prisma.jobClaim.create({ data: { ...data, jobId } });
  await audit(u.email, id ? "update claim" : "add claim", "Job", jobId, `${data.seq} ${data.name}`);
  done(jobId);
}

// ---------- cost lines ----------
export async function saveCostLine(fd: FormData) {
  const u = await costs();
  const jobId = s(fd, "jobId")!; const id = s(fd, "id");
  const paidRaw = String(fd.get("paid") ?? "").trim();
  const data = {
    trade: s(fd, "trade") ?? "Trade", supplier: s(fd, "supplier"), cost: n(fd, "cost") ?? 0,
    costStatus: ["Quoted", "Provisional", "Locked"].includes(s(fd, "costStatus") ?? "") ? s(fd, "costStatus")! : "Quoted",
    // Blank or "Pending" = unknown (Pending). Never store it as $0.
    paid: paidRaw === "" || /^pending$/i.test(paidRaw) ? null : n(fd, "paid"), claimSeq: i(fd, "claimSeq"), notes: s(fd, "notes"),
  };
  if (id) await prisma.jobCostLine.update({ where: { id }, data }); else await prisma.jobCostLine.create({ data: { ...data, jobId, sort: await prisma.jobCostLine.count({ where: { jobId } }) } });
  await audit(u.email, id ? "update trade" : "add trade", "Job", jobId, data.trade);
  done(jobId);
}

// ---------- supplier bills ----------
export async function saveBill(fd: FormData) {
  const u = await costs();
  const jobId = s(fd, "jobId")!; const id = s(fd, "id");
  const data = {
    supplier: s(fd, "supplier") ?? "Supplier", invoiceNumber: s(fd, "invoiceNumber"), amount: n(fd, "amount") ?? 0,
    status: ["Draft", "Authorised", "Paid"].includes(s(fd, "status") ?? "") ? s(fd, "status")! : "Authorised",
    dueDate: d(fd, "dueDate"), paidDate: d(fd, "paidDate"), claimSeq: i(fd, "claimSeq"), costLineId: s(fd, "costLineId"), notes: s(fd, "notes"),
  };
  if (id) await prisma.jobBill.update({ where: { id }, data }); else await prisma.jobBill.create({ data: { ...data, jobId } });
  await audit(u.email, id ? "update bill" : "add bill", "Job", jobId, `${data.supplier} ${data.invoiceNumber ?? ""}`);
  done(jobId);
}

// ---------- labour ----------
export async function saveLabour(fd: FormData) {
  const u = await costs();
  const jobId = s(fd, "jobId")!; const id = s(fd, "id");
  const data = { date: d(fd, "date") ?? new Date().toISOString().slice(0, 10), person: s(fd, "person") ?? "Worker", hours: n(fd, "hours") ?? 0, rate: n(fd, "rate") ?? 0, approved: fd.get("approved") === "on", costLineId: s(fd, "costLineId"), notes: s(fd, "notes") };
  if (id) await prisma.jobLabour.update({ where: { id }, data }); else await prisma.jobLabour.create({ data: { ...data, jobId } });
  await audit(u.email, id ? "update labour" : "add labour", "Job", jobId, `${data.person} ${data.hours}h`);
  done(jobId);
}
export async function approveAllLabour(fd: FormData) {
  const u = await costs();
  const jobId = s(fd, "jobId")!;
  const r = await prisma.jobLabour.updateMany({ where: { jobId, approved: false }, data: { approved: true } });
  await audit(u.email, "approve labour", "Job", jobId, `${r.count} rows`);
  done(jobId);
}

// ---------- materials ----------
export async function saveMaterial(fd: FormData) {
  const u = await costs();
  const jobId = s(fd, "jobId")!; const id = s(fd, "id");
  const data = { date: d(fd, "date") ?? new Date().toISOString().slice(0, 10), supplier: s(fd, "supplier") ?? "Supplier", description: s(fd, "description"), amount: n(fd, "amount") ?? 0, costLineId: s(fd, "costLineId") };
  if (id) await prisma.jobMaterial.update({ where: { id }, data }); else await prisma.jobMaterial.create({ data: { ...data, jobId } });
  await audit(u.email, id ? "update material" : "add material", "Job", jobId, `${data.supplier} ${data.amount}`);
  done(jobId);
}

// ---------- program ----------
export async function saveTask(fd: FormData) {
  const u = await site();
  const jobId = s(fd, "jobId")!; const id = s(fd, "id");
  const start = d(fd, "start") ?? new Date().toISOString().slice(0, 10);
  const data = { name: s(fd, "name") ?? "Task", start, finish: d(fd, "finish") ?? start, claimSeq: i(fd, "claimSeq"), done: fd.get("done") === "on" };
  const before = id ? await prisma.jobTask.findUnique({ where: { id }, select: { done: true } }) : null;
  if (id) await prisma.jobTask.update({ where: { id }, data }); else await prisma.jobTask.create({ data: { ...data, jobId } });
  if (data.done && !before?.done) await audit(u.email, "task done", "JobTask", id ?? undefined, data.name);
  await audit(u.email, id ? "update task" : "add task", "Job", jobId, data.name);
  done(jobId);
}

// ---------- delete any row ----------
const MODELS = { claim: "jobClaim", cost: "jobCostLine", bill: "jobBill", labour: "jobLabour", material: "jobMaterial", task: "jobTask" } as const;
export async function deleteRow(fd: FormData) {
  const u = await costs();
  const kind = s(fd, "kind") as keyof typeof MODELS; const id = s(fd, "id"); const jobId = s(fd, "jobId");
  if (!MODELS[kind] || !id || !jobId) return;
  if (kind === "task" && u.role === "ACCOUNTS") return; // the build program is Braiden's and the PMs'
  if (kind === "claim" && u.role === "PM") return; // claims are Braiden's and accounts' 
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma as any)[MODELS[kind]].deleteMany({ where: { id, jobId } });
  await audit(u.email, `delete ${kind}`, "Job", jobId, id);
  done(jobId);
}

/** Re-read the latest Xero data into all live jobs (uses what the Xero sync already holds). */
export async function jobXeroUpdate(fd: FormData) {
  await costs();
  const { syncIfStale } = await import("@/lib/xero");
  await syncIfStale().catch(() => null);
  await (await import("@/lib/xero-jobs")).syncJobsFromXero();
  const id = s(fd, "jobId"); if (id) done(id);
}

/** Link a job to its lead in the CRM (sales + estimating), and copy the contract / job number if the job lacks them. */
export async function linkJobLead(fd: FormData) {
  const u = await admin();
  const jobId = s(fd, "jobId")!; const leadId = s(fd, "leadId");
  const lead = leadId ? await prisma.lead.findUnique({ where: { id: leadId } }) : null;
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return;
  if (lead && (await prisma.job.findFirst({ where: { leadId: lead.id, id: { not: jobId } } }))) return;
  await prisma.job.update({ where: { id: jobId }, data: { leadId: lead?.id ?? null, ...(lead && !job.contractValue && lead.contractValue ? { contractValue: lead.contractValue } : {}), ...(lead && !job.jobNumber && lead.jobNumber ? { jobNumber: lead.jobNumber } : {}), ...(lead && !job.client && lead.company ? { client: lead.company } : {}) } });
  await audit(u.email, "job linked to lead", "Job", jobId, lead?.company ?? "unlinked");
  done(jobId);
}

/** Bring Justin's trade pack across as cost lines (trades not already on the job). */
export async function pullTradePack(fd: FormData) {
  const u = await costs();
  const jobId = s(fd, "jobId")!;
  const job = await prisma.job.findUnique({ where: { id: jobId }, include: { costLines: true } });
  if (!job?.leadId) return;
  const lead = await prisma.lead.findUnique({ where: { id: job.leadId }, include: { tradeQuotes: true } });
  if (!lead) return;
  const { summariseTrades } = await import("@/lib/estimating");
  const have = new Set(job.costLines.map((l) => l.trade.toLowerCase()));
  let sort = job.costLines.length, added = 0;
  for (const r of summariseTrades(lead.tradeQuotes).rows) {
    if (have.has(r.trade.toLowerCase())) continue;
    await prisma.jobCostLine.create({ data: { jobId, trade: r.trade, supplier: r.counts?.company ?? null, cost: r.counts?.price ?? 0, costStatus: r.counts ? "Quoted" : "Provisional", sort: sort++, source: "estimating" } });
    added++;
  }
  if (lead.estOtherCosts && !have.has("other costs (materials, labour, site)")) { await prisma.jobCostLine.create({ data: { jobId, trade: "Other costs (materials, labour, site)", cost: lead.estOtherCosts, costStatus: "Provisional", sort: sort++, source: "estimating" } }); added++; }
  await audit(u.email, "trade pack pulled", "Job", jobId, `${added} lines`);
  done(jobId);
}

/** Fill blank job details from Xero and CRM leads now (normally runs after every Xero sync and Grok import). */
export async function fillMissingNow() {
  await costs();
  await (await import("@/lib/job-fill")).fillJobsMissingInfo();
  await (await import("@/lib/xero-jobs")).syncJobsFromXero().catch(() => null);
  revalidatePath("/jobs"); revalidatePath("/wip");
}

/** Accounts: a job's Xero tracking code and client name (what links it to its Xero invoices and bills). */
export async function saveJobXero(fd: FormData) {
  const u = await costs();
  const id = s(fd, "id"); if (!id) return;
  const data = { xeroTracking: s(fd, "xeroTracking"), client: s(fd, "client") };
  await prisma.job.update({ where: { id }, data });
  await audit(u.email, "job Xero details", "Job", id, `${data.xeroTracking ?? ""} / ${data.client ?? ""}`);
  await (await import("@/lib/xero-jobs")).syncJobsFromXero().catch(() => null);
  done(id);
}
