"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/automations";
import { brisbaneToday } from "@/lib/time";
import { isEstStep, EST_STEPS } from "@/lib/estimating";

/** Tick or untick one estimating step. Ticking "Quote sent" also marks the lead's quote as issued. */
export async function toggleStep(fd: FormData) {
  const u = await requireUser(["ADMIN", "ESTIMATOR", "ACCOUNTS"]);
  const id = String(fd.get("id") ?? "");
  const step = String(fd.get("step") ?? "");
  if (!id || !isEstStep(step)) return;
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead || (lead.brand !== "ENP" && lead.brand !== "DR")) return;
  const today = brisbaneToday();
  const turningOn = !lead[step];
  const data: Record<string, unknown> = { [step]: turningOn ? today : null };
  if (step === "estSentAt" && turningOn) {
    data.quoteIssued = true;
    if (!lead.quoteIssuedDate) data.quoteIssuedDate = today;
  }
  await prisma.lead.update({ where: { id }, data });
  const label = EST_STEPS.find((s) => s.key === step)!.label;
  await audit(u.email, turningOn ? "estimate step done" : "estimate step undone", "Lead", id, label);
  revalidatePath("/estimating");
}

/** Save the quote amount and estimator notes. */
export async function saveEstimate(fd: FormData) {
  const u = await requireUser(["ADMIN", "ESTIMATOR", "ACCOUNTS"]);
  const id = String(fd.get("id") ?? "");
  const lead = id ? await prisma.lead.findUnique({ where: { id } }) : null;
  if (!lead || (lead.brand !== "ENP" && lead.brand !== "DR")) return;
  const raw = String(fd.get("quoteValue") ?? "").replace(/[$,\s]/g, "");
  const quoteValue = raw === "" ? null : Number(raw);
  const notes = String(fd.get("estimatorNotes") ?? "").trim();
  const date = (k: string) => { const v = String(fd.get(k) ?? ""); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; };
  const pr = String(fd.get("estPriority") ?? "");
  await prisma.lead.update({
    where: { id },
    data: {
      quoteValue: quoteValue !== null && Number.isFinite(quoteValue) && quoteValue >= 0 ? quoteValue : lead.quoteValue, estimatorNotes: notes || null,
      ...(fd.has("estPriority") ? { estPriority: ["High", "Normal", "Low"].includes(pr) ? pr : "Normal" } : {}),
      ...(fd.has("estPrelimDue") ? { estPrelimDue: date("estPrelimDue") } : {}),
      ...(fd.has("estFinalDue") ? { estFinalDue: date("estFinalDue") } : {}),
      ...(fd.has("estPlansRequestedAt") ? { estPlansRequestedAt: date("estPlansRequestedAt") } : {}),
    },
  });
  await audit(u.email, "estimate saved", "Lead", id);
  revalidatePath("/estimating");
}

/** Save the job cost estimate on the trade pack: other costs, contingency and the quote amount. */
export async function saveJobEstimate(fd: FormData) {
  const u = await requireUser(["ADMIN", "ESTIMATOR", "ACCOUNTS"]);
  const id = String(fd.get("id") ?? "");
  const lead = id ? await prisma.lead.findUnique({ where: { id } }) : null;
  if (!lead || (lead.brand !== "ENP" && lead.brand !== "DR")) return;
  const money = (k: string) => { const raw = String(fd.get(k) ?? "").replace(/[$,%\s]/g, ""); if (raw === "") return null; const n = Number(raw); return Number.isFinite(n) && n >= 0 ? n : undefined; };
  const other = money("estOtherCosts"), cont = money("estContingencyPct"), quote = money("quoteValue");
  await prisma.lead.update({
    where: { id },
    data: {
      ...(other !== undefined ? { estOtherCosts: other } : {}),
      ...(cont !== undefined ? { estContingencyPct: cont === null ? null : Math.min(100, cont) } : {}),
      ...(quote !== undefined ? { quoteValue: quote } : {}),
    },
  });
  await audit(u.email, "job estimate saved", "Lead", id);
  revalidatePath(`/estimating/${id}`); revalidatePath("/estimating");
}

// ---------- Justin (and Braiden) add and edit quote jobs ----------
const FIELDS = ["company", "leadName", "phone", "email", "location", "projectType", "budget", "timeframe", "lookingFor", "sourceLink"] as const;
const txt = (fd: FormData, k: string, max = 2000) => { const v = String(fd.get(k) ?? "").trim(); return v ? v.slice(0, max) : null; };
const stampNow = () => new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", day: "numeric", month: "short", year: "numeric" }).format(new Date());

/** Same company in the last 12 months (any brand). */
async function sameCompany(company: string | null, exceptId?: string) {
  if (!company) return [];
  const norm = (s?: string | null) => (s ?? "").toLowerCase().replace(/\b(pty|ltd|limited|the)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  const since = new Date(Date.now() - 365 * 86400000);
  const rows = await prisma.lead.findMany({ where: { createdAt: { gte: since }, cancelled: false, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true, company: true, brand: true, stage: true } });
  return rows.filter((r) => norm(r.company) && norm(r.company) === norm(company));
}

/** A new job to quote: goes straight onto the estimating board (stage Quoting) and into Braiden's leads. */
export async function createQuoteJob(fd: FormData) {
  const u = await requireUser(["ADMIN", "ESTIMATOR"]);
  const brand = "DR";
  const company = txt(fd, "company", 200), leadName = txt(fd, "leadName", 200);
  if (!company && !leadName) redirect(`/estimating?error=${encodeURIComponent("Add a company or a contact name.")}`);
  const dups = await sameCompany(company);
  if (dups.length && fd.get("allowDuplicate") !== "on") {
    redirect(`/estimating?new=1&error=${encodeURIComponent(`${company} is already in the CRM (${dups.map((d) => `${d.brand} ${d.stage ?? ""}`.trim()).join(", ")}). Tick "add anyway" if this is a separate job.`)}`);
  }
  const size = Number(String(fd.get("sizeSqm") ?? "").replace(/[^0-9.]/g, ""));
  const data: Record<string, unknown> = Object.fromEntries(FIELDS.map((k) => [k, txt(fd, k, k === "lookingFor" ? 4000 : 300)]));
  const lead = await prisma.lead.create({
    data: {
      ...data, brand, stage: "Quoting", quotedDate: new Date().toISOString().slice(0, 10), dateReceived: new Date().toISOString().slice(0, 10),
      leadSource: txt(fd, "leadSource", 60) ?? "Direct enquiry", sizeSqm: Number.isFinite(size) && size > 0 ? size : null, newClient: dups.length === 0,
      estPlansAt: fd.get("plansReceived") === "on" ? new Date().toISOString().slice(0, 10) : null,
      estPriority: ["High", "Normal", "Low"].includes(String(fd.get("estPriority"))) ? String(fd.get("estPriority")) : "Normal",
      estPrelimDue: /^\d{4}-\d{2}-\d{2}$/.test(String(fd.get("estPrelimDue") ?? "")) ? String(fd.get("estPrelimDue")) : null,
      estFinalDue: /^\d{4}-\d{2}-\d{2}$/.test(String(fd.get("estFinalDue") ?? "")) ? String(fd.get("estFinalDue")) : null,
      notes: `${stampNow()}: Added by ${u.name} on the estimating board.`,
    } as never,
  });
  await audit(u.email, "create quote job", "Lead", lead.id, `${brand} ${company ?? leadName}`);
  revalidatePath("/estimating");
  redirect(`/estimating/${lead.id}?added=1`);
}

/** Edit a quote job's details. Sales fields (stage, contract, setter, fees, Braiden's notes) stay with Braiden. */
export async function updateQuoteDetails(fd: FormData) {
  const u = await requireUser(["ADMIN", "ESTIMATOR"]);
  const id = String(fd.get("id") ?? "");
  const lead = await prisma.lead.findUnique({ where: { id } });
  if (!lead || (lead.brand !== "ENP" && lead.brand !== "DR")) return;
  const size = String(fd.get("sizeSqm") ?? "").trim() === "" ? null : Number(String(fd.get("sizeSqm")).replace(/[^0-9.]/g, ""));
  const data: Record<string, unknown> = Object.fromEntries(FIELDS.map((k) => [k, txt(fd, k, k === "lookingFor" ? 4000 : 300)]));
  if (!data.company && !data.leadName) return;
  const brand = "DR";
  const changed = [...FIELDS, "sizeSqm", "brand"].filter((k) => {
    const before = (lead as Record<string, unknown>)[k];
    const after = k === "sizeSqm" ? (size && Number.isFinite(size) ? size : null) : k === "brand" ? brand : data[k];
    return (before ?? null) !== (after ?? null);
  });
  await prisma.lead.update({ where: { id }, data: { ...data, brand, sizeSqm: size && Number.isFinite(size) ? size : null } as never });
  await audit(u.email, "edit quote details", "Lead", id, changed.join(", "));
  revalidatePath(`/estimating/${id}`); revalidatePath("/estimating");
}
