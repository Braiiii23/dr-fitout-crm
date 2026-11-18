import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { timingSafeEqual, createHash } from "crypto";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/automations";
import { claimNamesFor } from "@/lib/claim-names";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Drop-off point for BuilderTrend data gathered by Grok (or any other tool).
// Auth: Authorization: Bearer <BUILDERTREND_SYNC_KEY>. This key works here and nowhere else.
// Safe to send the same data again: everything is matched on BuilderTrend's ids, so re-runs update instead of duplicating.
// Add ?dryRun=1 to see what would change without saving anything.

function authed(req: NextRequest) {
  const key = process.env.BUILDERTREND_SYNC_KEY ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (key.length < 24 || !got) return false;
  return timingSafeEqual(createHash("sha256").update(got).digest(), createHash("sha256").update(key).digest());
}
const json = (d: unknown, status = 200) => NextResponse.json(d, { status, headers: { "Cache-Control": "no-store" } });
const str = (v: unknown, n = 300) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : typeof v === "number" ? String(v) : null);
const date = (v: unknown) => { const s = str(v, 40); if (!s) return null; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return `${m[1]}-${m[2]}-${m[3]}`; const a = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s); return a ? `${a[3]}-${a[2].padStart(2, "0")}-${a[1].padStart(2, "0")}` : null; };
const num = (v: unknown) => { if (v == null || (typeof v === "string" && v.trim() === "")) return null; const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : null; };
const norm = (s?: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** GET: the CRM's live jobs, with the BuilderTrend name/id each is linked to, so Grok can check the mapping. */
export async function GET(req: NextRequest) {
  if (!authed(req)) return json({ ok: false, error: "Unauthorised" }, 401);
  const jobs = await prisma.job.findMany({ where: { status: { not: "Complete" } }, select: { id: true, name: true, jobNumber: true, brand: true, btJobId: true, btJobName: true, startDate: true, finishDate: true, _count: { select: { tasks: true, labour: true } } } });
  return json({ ok: true, jobs });
}

type InJob = {
  btJobId?: unknown; name?: unknown; jobNumber?: unknown; status?: unknown; startDate?: unknown; finishDate?: unknown; projectManager?: unknown; client?: unknown; brand?: unknown;
  contractValue?: unknown; contractIncludesGst?: unknown; claimSplit?: unknown; xeroTracking?: unknown; address?: unknown;
  notes?: unknown; documents?: unknown; // from Gmail etc.: notes are added to the job's notes; documents = [{ url, filename }]
};
/** Notes and document links to add to a job's notes (never replacing what's there). */
function extraNotes(j: InJob): string | null {
  const parts: string[] = [];
  const n = str(j.notes, 2000); if (n) parts.push(n);
  if (Array.isArray(j.documents)) for (const d of j.documents.slice(0, 20) as { url?: unknown; filename?: unknown }[]) {
    const url = str(d?.url, 1000); if (url && /^https:\/\//i.test(url)) parts.push(`Document: ${str(d?.filename, 150) ?? "file"} ${url}`);
  }
  return parts.length ? parts.join("\n") : null;
}
const DEFAULT_SPLIT: [number, string, string][] = [[30, "Deposit", "Before start"], [30, "Sheeting complete", "Once sheeting is finished"], [35, "Joinery and finishes", "Near joinery and finishes"], [5, "Handover", "Last week before handover"]];
/** "30/30/20/15/5" → claim rows (first = Deposit, last = Handover). Must add to 100. */
function splitRows(v: unknown): [number, string, string | null][] | null {
  const parts = (typeof v === "string" ? v.split(/[\/,\s]+/) : Array.isArray(v) ? v : []).map(Number).filter((x) => x > 0);
  if (!parts.length || Math.abs(parts.reduce((a, b) => a + b, 0) - 100) > 0.01) return null;
  return claimNamesFor(parts);
}
async function createClaims(jobId: string, contract: number, rows: [number, string, string | null][]) {
  let allocated = 0;
  for (let k = 0; k < rows.length; k++) {
    const [pct, name, hook] = rows[k];
    const amount = k === rows.length - 1 ? Math.round((contract - allocated) * 100) / 100 : Math.round(contract * pct) / 100;
    allocated += amount;
    await prisma.jobClaim.create({ data: { jobId, seq: k + 1, name, pct, amount, hook, source: "buildertrend" } });
  }
}
type InTask = { btId?: unknown; btJobId?: unknown; jobName?: unknown; name?: unknown; start?: unknown; finish?: unknown; done?: unknown };
type InTime = { btId?: unknown; btJobId?: unknown; jobName?: unknown; date?: unknown; person?: unknown; hours?: unknown; approved?: unknown; rate?: unknown; notes?: unknown };

/** POST { jobs: [...], tasks: [...], timeClock: [...], replaceTasks?: boolean } */
export async function POST(req: NextRequest) {
  if (!authed(req)) return json({ ok: false, error: "Unauthorised" }, 401);
  const dry = new URL(req.url).searchParams.get("dryRun") === "1";
  const body = (await req.json().catch(() => null)) as { jobs?: InJob[]; tasks?: InTask[]; timeClock?: InTime[]; replaceTasks?: boolean } | null;
  if (!body || typeof body !== "object") return json({ ok: false, error: "Send JSON: { jobs, tasks, timeClock }" }, 400);
  const jobsIn = Array.isArray(body.jobs) ? body.jobs.slice(0, 500) : [], tasksIn = Array.isArray(body.tasks) ? body.tasks.slice(0, 5000) : [], timeIn = Array.isArray(body.timeClock) ? body.timeClock.slice(0, 10000) : [];
  const report = { jobs: { created: 0, updated: 0, skipped: [] as string[], needsReview: [] as string[], linkedToLead: [] as string[] }, tasks: { created: 0, updated: 0, removed: 0, unmatched: [] as string[] }, timeClock: { created: 0, updated: 0, noRate: [] as string[], unmatched: [] as string[] }, errors: [] as string[] };

  const crmJobs = await prisma.job.findMany({ where: { status: { not: "Complete" } }, select: { id: true, name: true, jobNumber: true, btJobId: true, btJobName: true } });
  const findJob = (btJobId: string | null, name: string | null, jobNumber?: string | null) =>
    (btJobId && crmJobs.find((j) => j.btJobId === btJobId))
    || (name && crmJobs.find((j) => j.btJobName && norm(j.btJobName) === norm(name)))
    || (jobNumber && crmJobs.find((j) => j.jobNumber && j.jobNumber === jobNumber))
    || (name && crmJobs.find((j) => norm(j.name) === norm(name) || (norm(j.name).length >= 6 && norm(name).includes(norm(j.name)))))
    || null;

  // ---- jobs: link to existing CRM jobs; brand-new BuilderTrend jobs are created as Live with no contract (flagged for review) ----
  for (const [k, j] of jobsIn.entries()) {
    const btJobId = str(j.btJobId, 80), name = str(j.name, 200);
    if (!btJobId || !name) { report.errors.push(`jobs[${k}]: needs btJobId and name`); continue; }
    const jobNumber = str(j.jobNumber, 40);
    const match = findJob(btJobId, name, jobNumber);
    // Contract ex GST (BuilderTrend often shows inc GST; say so with contractIncludesGst: true).
    const rawContract = num(j.contractValue);
    const contract = rawContract == null ? null : Math.round((j.contractIncludesGst === true ? rawContract / 1.1 : rawContract) * 100) / 100;
    const base = { btJobId, btJobName: name, ...(date(j.startDate) ? { startDate: date(j.startDate)! } : {}), ...(date(j.finishDate) ? { finishDate: date(j.finishDate)! } : {}), ...(str(j.projectManager, 80) ? { pm: str(j.projectManager, 80)! } : {}) };
    if (match) {
      report.jobs.updated++;
      if (!dry) {
        const cur = await prisma.job.findUnique({ where: { id: match.id }, select: { contractValue: true, jobNumber: true, client: true, xeroTracking: true, notes: true, _count: { select: { claims: true } } } });
        const extra = extraNotes(j);
        // Only fill gaps on existing jobs: never overwrite a contract, client or job number already in the CRM.
        await prisma.job.update({ where: { id: match.id }, data: {
          ...base,
          ...(cur && !cur.contractValue && contract ? { contractValue: contract } : {}),
          ...(cur && !cur.jobNumber && jobNumber ? { jobNumber } : {}),
          ...(cur && !cur.client && str(j.client, 200) ? { client: str(j.client, 200) } : {}),
          ...(cur && !cur.xeroTracking && str(j.xeroTracking, 40) ? { xeroTracking: str(j.xeroTracking, 40) } : {}),
          // Added to the end only if not already there, so re-runs don't repeat it.
          ...(extra && cur && !(cur.notes ?? "").includes(extra) ? { notes: [cur.notes?.trimEnd(), `Grok ${new Date().toISOString().slice(0, 10)}:`, extra].filter(Boolean).join("\n") } : {}),
        } });
        if (cur && cur._count.claims === 0 && contract) await createClaims(match.id, contract, splitRows(j.claimSplit) ?? DEFAULT_SPLIT);
      }
      Object.assign(match, { btJobId, btJobName: name });
      continue;
    }
    if (/closed|complete|presale|cancel|warranty/i.test(str(j.status, 40) ?? "")) { report.jobs.skipped.push(`${name} (${str(j.status, 40)})`); continue; }
    report.jobs.created++;
    // A signed CRM lead for the same job (same job number, or same client) gets linked, so sales and WIP line up.
    const client = str(j.client, 200);
    const candidates = jobNumber || client ? await prisma.lead.findMany({ where: { stage: "Signed", cancelled: false, brand: "DR", OR: [...(jobNumber ? [{ jobNumber }] : []), ...(client ? [{ company: client }] : [])] }, select: { id: true, company: true, brand: true, contractValue: true } }) : [];
    const taken = new Set((await prisma.job.findMany({ where: { leadId: { in: candidates.map((c) => c.id) } }, select: { leadId: true } })).map((x) => x.leadId));
    const lead = candidates.find((c) => !taken.has(c.id)) ?? null;
    const contractFinal = contract ?? lead?.contractValue ?? null;
    const missing = [!contractFinal && "contract value", !splitRows(j.claimSplit) && "signed claim split (usual 30/30/35/5 used)"].filter(Boolean);
    if (missing.length) report.jobs.needsReview.push(`${name}: check ${missing.join(" and ")}`);
    if (lead) report.jobs.linkedToLead.push(`${name} → ${lead.company ?? "signed lead"}`);
    if (!dry) {
      const created = await prisma.job.create({ data: {
        ...base, name, jobNumber, client: str(j.client, 200) ?? lead?.company ?? null, xeroTracking: str(j.xeroTracking, 40),
        brand: "DR", status: "Live", source: "buildertrend", leadId: lead?.id ?? null,
        contractValue: contractFinal ?? 0,
        notes: [[`Created from BuilderTrend via Grok.`, str(j.address, 200) && `Site: ${str(j.address, 200)}`, missing.length ? `To check: ${missing.join(", ")}.` : null].filter(Boolean).join(" "), extraNotes(j)].filter(Boolean).join("\n"),
      } });
      if (contractFinal) await createClaims(created.id, contractFinal, splitRows(j.claimSplit) ?? DEFAULT_SPLIT);
      crmJobs.push({ id: created.id, name, jobNumber, btJobId, btJobName: name });
    } else crmJobs.push({ id: `dry-${k}`, name, jobNumber, btJobId, btJobName: name });
  }

  // ---- schedule tasks ----
  const seen = new Map<string, Set<string>>();
  const sentIds = new Set(tasksIn.map((t) => str(t.btId, 120)).filter(Boolean) as string[]);
  for (const [k, t] of tasksIn.entries()) {
    const btId = str(t.btId, 120), name = str(t.name, 200), start = date(t.start);
    if (!btId || !name || !start) { report.errors.push(`tasks[${k}]: needs btId, name and start`); continue; }
    const job = findJob(str(t.btJobId, 80), str(t.jobName, 200));
    if (!job) { report.tasks.unmatched.push(`${str(t.jobName, 200) ?? str(t.btJobId, 80)}: ${name}`); continue; }
    if (job.id.startsWith("dry-")) { report.tasks.created++; continue; }
    (seen.get(job.id) ?? seen.set(job.id, new Set()).get(job.id)!).add(btId);
    const finish = date(t.finish) ?? start;
    const data = { name, start, finish: finish < start ? start : finish, ...(typeof t.done === "boolean" ? { done: t.done } : {}) };
    let existing = await prisma.jobTask.findFirst({ where: { externalId: btId } });
    // A task already on the job with the same name is taken over (keeps its claim link).
    // (including one that came in earlier under a different id, e.g. from the calendar link).
    if (!existing) existing = (await prisma.jobTask.findMany({ where: { jobId: job.id } })).find((x) => norm(x.name) === norm(name) && (!x.externalId || !sentIds.has(x.externalId))) ?? null;
    if (existing) { report.tasks.updated++; if (!dry) await prisma.jobTask.update({ where: { id: existing.id }, data: { ...data, jobId: job.id, externalId: btId, source: "buildertrend" } }); }
    else { report.tasks.created++; if (!dry) await prisma.jobTask.create({ data: { ...data, jobId: job.id, externalId: btId, source: "buildertrend" } }); }
  }
  // With replaceTasks, BuilderTrend items no longer in the job's list are removed (only ones that came from BuilderTrend).
  if (body.replaceTasks === true) for (const [jobId, ids] of seen) {
    const gone = await prisma.jobTask.count({ where: { jobId, source: "buildertrend", externalId: { notIn: [...ids] } } });
    report.tasks.removed += gone;
    if (!dry && gone) await prisma.jobTask.deleteMany({ where: { jobId, source: "buildertrend", externalId: { notIn: [...ids] } } });
  }

  // ---- time clock (our labour). Pay rate: the one sent, else the person's last known rate. ----
  const rates = new Map<string, number>();
  for (const l of await prisma.jobLabour.findMany({ where: { rate: { gt: 0 } }, orderBy: { date: "asc" }, select: { person: true, rate: true } })) rates.set(norm(l.person), l.rate);
  for (const [k, e] of timeIn.entries()) {
    const btId = str(e.btId, 120), person = str(e.person, 120), d = date(e.date), hours = num(e.hours);
    if (!btId || !person || !d || hours == null) { report.errors.push(`timeClock[${k}]: needs btId, person, date and hours`); continue; }
    const job = findJob(str(e.btJobId, 80), str(e.jobName, 200));
    if (!job) { report.timeClock.unmatched.push(`${str(e.jobName, 200) ?? str(e.btJobId, 80)}: ${person} ${d}`); continue; }
    if (job.id.startsWith("dry-")) { report.timeClock.created++; continue; }
    const rate = num(e.rate) ?? rates.get(norm(person)) ?? 0;
    if (!rate && !report.timeClock.noRate.includes(person)) report.timeClock.noRate.push(person);
    const nc = await prisma.jobCostLine.findFirst({ where: { jobId: job.id, trade: { contains: "construction" } }, select: { id: true } });
    const data = { jobId: job.id, date: d, person, hours, rate, approved: e.approved === true || /^(yes|approved|true)$/i.test(String(e.approved ?? "")), notes: str(e.notes, 300), costLineId: nc?.id ?? null };
    const existing = await prisma.jobLabour.findFirst({ where: { externalId: btId } });
    if (existing) { report.timeClock.updated++; if (!dry) await prisma.jobLabour.update({ where: { id: existing.id }, data: { ...data, rate: num(e.rate) ?? (existing.rate || rate) } }); }
    else { report.timeClock.created++; if (!dry) await prisma.jobLabour.create({ data: { ...data, externalId: btId, source: "buildertrend" } }); }
  }

  // Fill what Grok couldn't (tracking code, client, contract from Xero / CRM leads), then pull each job's Xero invoices and bills.
  let filled: unknown[] = [];
  if (!dry) {
    try { filled = await (await import("@/lib/job-fill")).fillJobsMissingInfo(); await (await import("@/lib/xero-jobs")).syncJobsFromXero(); } catch { /* the import itself still stands */ }
  }
  if (!dry) await audit("grok-buildertrend", "buildertrend import", "Integration", undefined, `jobs +${report.jobs.created}/~${report.jobs.updated}, tasks +${report.tasks.created}/~${report.tasks.updated}/-${report.tasks.removed}, time +${report.timeClock.created}/~${report.timeClock.updated}`);
  return json({ ok: true, dryRun: dry, ...report, filledFromXeroAndCrm: filled });
}
