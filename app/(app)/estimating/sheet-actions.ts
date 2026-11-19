"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/automations";
import { BANDS } from "@/lib/estimating";
import { SOURCES, summarise, type SheetLine, type ProposalInfo } from "@/lib/estimate-sheet";
import { syncTradePack } from "@/lib/estimate-sync";

const EDITORS = ["ADMIN", "ESTIMATOR", "ACCOUNTS"] as const;
const n = (v: unknown, max = 1e9) => { const x = Number(v); return Number.isFinite(x) ? Math.min(max, Math.max(0, Math.round(x * 10000) / 10000)) : 0; };
const t = (v: unknown, max: number) => { const x = String(v ?? "").trim(); return x ? x.slice(0, max) : null; };

/** Save the whole sheet (rows replace the old ones), the job's margin, then update the trade pack. */
export async function saveSheet(leadId: string, rows: SheetLine[], marginPct: number | null, setQuote: boolean): Promise<{ ok?: true; error?: string; sell?: number; savedAt?: string }> {
  const u = await requireUser([...EDITORS]);
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { brand: true } });
  if (!lead || (lead.brand !== "DR" && lead.brand !== "ENP")) return { error: "Job not found." };
  if (!Array.isArray(rows) || rows.length > 1500) return { error: "Too many rows." };
  const clean = rows.map((r, i) => ({
    leadId, band: BANDS.includes(String(r.band)) ? String(r.band) : "Miscellaneous", item: t(r.item, 300) ?? "", clientText: t(r.clientText, 500),
    qty: n(r.qty), unit: t(r.unit, 20), supplyRate: n(r.supplyRate), installRate: n(r.installRate),
    source: (SOURCES as readonly string[]).includes(String(r.source)) ? String(r.source) : "ESTIMATE", sourceNote: t(r.sourceNote, 500), provisional: !!r.provisional, sortOrder: i,
  })).filter((r) => r.item);
  const m = marginPct == null || !Number.isFinite(Number(marginPct)) ? null : Math.min(200, Math.max(0, Number(marginPct)));
  const settings = await prisma.accountsSettings.findUnique({ where: { id: "settings" }, select: { estMarginPct: true } });
  const s = summarise(clean as SheetLine[], m ?? settings?.estMarginPct ?? 35);
  await prisma.$transaction([
    prisma.estimateLine.deleteMany({ where: { leadId } }),
    prisma.estimateLine.createMany({ data: clean }),
    prisma.lead.update({ where: { id: leadId }, data: { estMarginPct: m, ...(setQuote ? { quoteValue: s.sell } : {}) } }),
  ]);
  await syncTradePack(leadId);
  await audit(u.email, "estimate sheet saved", "Lead", leadId, `${clean.length} lines · cost ${Math.round(s.cost)} · sell ${s.sell}`);
  revalidatePath(`/estimating/${leadId}`); revalidatePath(`/estimating/${leadId}/sheet`); revalidatePath("/estimating");
  return { ok: true, sell: s.sell, savedAt: new Date().toISOString() };
}

export async function saveProposalInfo(leadId: string, info: ProposalInfo): Promise<{ ok?: true; error?: string }> {
  const u = await requireUser([...EDITORS]);
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { estProposal: true } });
  if (!lead) return { error: "Job not found." };
  const s = (v: unknown, max = 300) => t(v, max) ?? undefined;
  const list = (v: unknown) => (Array.isArray(v) ? v : String(v ?? "").split(/\r?\n/)).map((x) => String(x).trim()).filter(Boolean).slice(0, 60).map((x) => x.slice(0, 400));
  const next: ProposalInfo = {
    title: s(info.title), businessName: s(info.businessName), contact: s(info.contact), email: s(info.email), abn: s(info.abn, 30), businessAddress: s(info.businessAddress), projectAddress: s(info.projectAddress),
    salesContact: s(info.salesContact), dateIssued: s(info.dateIssued, 20), expiry: s(info.expiry, 20), exclusions: list(info.exclusions), assumptions: list(info.assumptions), notes: s(info.notes, 3000),
  };
  await prisma.lead.update({ where: { id: leadId }, data: { estProposal: JSON.stringify(next) } });
  await audit(u.email, "proposal details saved", "Lead", leadId);
  revalidatePath(`/estimating/${leadId}/proposal`);
  return { ok: true };
}

/** Form version for the proposal page's "Proposal details" box. */
export async function saveProposalForm(fd: FormData) {
  const id = String(fd.get("id") ?? "");
  const g = (k: string) => String(fd.get(k) ?? "");
  const r = await saveProposalInfo(id, { title: g("title"), businessName: g("businessName"), contact: g("contact"), email: g("email"), abn: g("abn"), businessAddress: g("businessAddress"), projectAddress: g("projectAddress"), salesContact: g("salesContact"), dateIssued: g("dateIssued"), expiry: g("expiry"), exclusions: g("exclusions").split(/\r?\n/), assumptions: g("assumptions").split(/\r?\n/), notes: g("notes") });
  const { redirect } = await import("next/navigation");
  redirect(`/estimating/${id}/proposal?${r.error ? `err=${encodeURIComponent(r.error)}` : "msg=Saved."}`);
}

/** ENP rule: a trade quote HIGHER than the estimate goes into the estimate. Adds (or replaces) one "Quote adjustment" line on that band,
 *  so the band totals the quote while our own lines and rates stay as they were. */
export async function quoteToSheet(fd: FormData) {
  const u = await requireUser([...EDITORS]);
  const quoteId = String(fd.get("quoteId") ?? "");
  const q = await prisma.tradeQuote.findUnique({ where: { id: quoteId } });
  const { redirect } = await import("next/navigation");
  if (!q || q.price == null) redirect("/estimating");
  const leadId = q!.leadId; const band = q!.trade;
  const lines = await prisma.estimateLine.findMany({ where: { leadId, band } });
  const ADJ = "Quote adjustment";
  const own = lines.filter((l) => !l.item.startsWith(ADJ)).reduce((s, l) => s + l.qty * (l.supplyRate + l.installRate), 0);
  const diff = Math.round(((q!.price ?? 0) - own) * 100) / 100;
  if (diff <= 0) redirect(`/estimating/${leadId}?err=${encodeURIComponent("That quote isn't higher than the sheet's price for this band.")}`);
  const last = await prisma.estimateLine.findFirst({ where: { leadId, band }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  await prisma.$transaction([
    prisma.estimateLine.deleteMany({ where: { leadId, band, item: { startsWith: ADJ } } }),
    prisma.estimateLine.create({ data: { leadId, band, item: `${ADJ}: ${q!.company ?? "trade"} quote $${q!.price}`, qty: 1, unit: "item", supplyRate: 0, installRate: diff, source: "QUOTE", sourceNote: `Quote ${q!.company ?? ""} ${q!.receivedDate ?? ""} $${q!.price} ex GST vs our estimate $${Math.round(own * 100) / 100}. Priced by: Quote – ${band} (${q!.company ?? "trade"})`, sortOrder: (last?.sortOrder ?? 0) + 1 } }),
  ]);
  await syncTradePack(leadId);
  await audit(u.email, "quote put on estimate sheet", "Lead", leadId, `${band} ${q!.company ?? ""} $${q!.price}`);
  revalidatePath(`/estimating/${leadId}`); revalidatePath(`/estimating/${leadId}/sheet`);
  redirect(`/estimating/${leadId}?msg=${encodeURIComponent(`${band} now priced at the ${q!.company ?? "trade"} quote ($${q!.price}) on the estimate sheet. Check the quote amount on the sheet.`)}`);
}
