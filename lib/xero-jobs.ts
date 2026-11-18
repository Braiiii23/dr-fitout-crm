import "server-only";
import { prisma } from "./db";
import { audit } from "./automations";

// Fills each live job from Xero (read-only), using the data the Xero sync already holds:
//  - claim invoices (ACCREC): matched by invoice number, then by amount among the job's invoices → status, dates, cash received
//  - supplier bills (ACCPAY) tagged to the job → Supplier invoices, linked to the matching trade
//  - spend money tagged to the job → Materials
// "Tagged to the job" = a line's Xero tracking option equals the job's Xero tracking code (e.g. HECH002), or the reference contains it.
// Nothing typed by hand is overwritten: manual rows with the same invoice / amount are adopted instead of duplicated.

type Line = { Description?: string; LineAmount?: number; TaxAmount?: number; Tracking?: { Name?: string; Option?: string }[] };
type Inv = { InvoiceID: string; InvoiceNumber?: string; Reference?: string; Type: string; Status: string; Contact?: { Name?: string }; DateString?: string; DueDateString?: string; SubTotal?: number; Total?: number; AmountDue?: number; FullyPaidOnDate?: string; LineAmountTypes?: string; LineItems?: Line[] };
type Spend = { BankTransactionID: string; DateString?: string; Contact?: { Name?: string }; Reference?: string; LineAmountTypes?: string; LineItems?: Line[] };

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const day = (s?: string) => (s ?? "").slice(0, 10) || null;
const norm = (s?: string | null) => (s ?? "").toLowerCase().replace(/\b(pty|ltd|limited|the)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const r2 = (n: number) => Math.round(n * 100) / 100;

async function snap<T>(key: string): Promise<T[]> {
  const s = await prisma.xeroSnapshot.findUnique({ where: { key } });
  if (!s?.ok) return [];
  try { return (JSON.parse(s.json) as T[]) ?? []; } catch { return []; }
}
/** Ex-GST amount on the lines tagged with this code (whole document if no line is tagged but the reference matches). */
function taggedEx(doc: { LineItems?: Line[]; LineAmountTypes?: string; SubTotal?: number; Reference?: string }, code: string) {
  const c = code.toLowerCase();
  const lines = (doc.LineItems ?? []).filter((l) => (l.Tracking ?? []).some((t) => (t.Option ?? "").toLowerCase() === c));
  if (lines.length) return r2(lines.reduce((t, l) => t + num(l.LineAmount) - (doc.LineAmountTypes === "Inclusive" ? num(l.TaxAmount) : 0), 0));
  if ((doc.Reference ?? "").toLowerCase().includes(c)) return r2(num(doc.SubTotal));
  return 0;
}
const STATUS: Record<string, string> = { DRAFT: "Draft", SUBMITTED: "Draft", AUTHORISED: "Authorised", PAID: "Paid" };

export type XeroJobReport = { jobId: string; job: string; claimsUpdated: number; billsAdded: number; billsUpdated: number; materialsAdded: number; unmatchedSales: { number: string; amount: number; date: string | null }[] };

export async function syncJobsFromXero(): Promise<XeroJobReport[]> {
  // Newest copy of each document wins (recent / open lists are refreshed more often than history).
  const merge = (lists: Inv[][]) => { const m = new Map<string, Inv>(); for (const l of lists) for (const d of l) m.set(d.InvoiceID, d); return [...m.values()].filter((d) => d.Status !== "DELETED" && d.Status !== "VOIDED"); };
  const sales = merge([await snap<Inv>("salesHistory"), await snap<Inv>("salesRecent"), await snap<Inv>("receivables")]).filter((d) => d.Type === "ACCREC");
  const bills = merge([await snap<Inv>("billsHistory"), await snap<Inv>("billsRecent"), await snap<Inv>("payables")]).filter((d) => d.Type === "ACCPAY");
  const spend = await snap<Spend>("jobSpend");
  if (!sales.length && !bills.length) return [];

  const jobs = await prisma.job.findMany({ where: { status: { not: "Complete" } }, include: { claims: true, costLines: true, bills: true, materials: true } });
  const out: XeroJobReport[] = [];
  for (const job of jobs) {
    const code = job.xeroTracking?.trim() || null;
    const rep: XeroJobReport = { jobId: job.id, job: job.name, claimsUpdated: 0, billsAdded: 0, billsUpdated: 0, materialsAdded: 0, unmatchedSales: [] };

    // ----- claim invoices -----
    const claimNumbers = new Set(job.claims.map((c) => (c.invoiceNumber ?? "").toLowerCase()).filter(Boolean));
    const jobSales = sales.filter((d) => (code && taggedEx(d, code) > 0) || claimNumbers.has((d.InvoiceNumber ?? "").toLowerCase()) || (!code && job.client && norm(d.Contact?.Name) === norm(job.client)));
    const used = new Set<string>();
    for (const c of [...job.claims].sort((a, b) => a.seq - b.seq)) {
      let inv = c.invoiceNumber ? jobSales.find((d) => (d.InvoiceNumber ?? "").toLowerCase() === c.invoiceNumber!.toLowerCase()) : undefined;
      // No number yet: an unused invoice on this job for the claim's amount (within $2).
      if (!inv && !c.invoiceNumber) inv = jobSales.find((d) => !used.has(d.InvoiceID) && Math.abs(num(d.SubTotal) - c.amount) <= 2);
      if (!inv) continue;
      used.add(inv.InvoiceID);
      const data = {
        invoiceNumber: inv.InvoiceNumber ?? c.invoiceNumber, status: STATUS[inv.Status] ?? c.status,
        invoicedDate: day(inv.DateString) ?? c.invoicedDate, dueDate: day(inv.DueDateString) ?? c.dueDate,
        receivedInc: r2(Math.max(0, num(inv.Total) - num(inv.AmountDue))),
      };
      if (data.status !== c.status || data.receivedInc !== c.receivedInc || data.invoiceNumber !== c.invoiceNumber || data.dueDate !== c.dueDate || data.invoicedDate !== c.invoicedDate) {
        await prisma.jobClaim.update({ where: { id: c.id }, data });
        rep.claimsUpdated++;
      }
    }
    rep.unmatchedSales = jobSales.filter((d) => !used.has(d.InvoiceID)).map((d) => ({ number: d.InvoiceNumber ?? "(no number)", amount: r2(num(d.SubTotal)), date: day(d.DateString) }));

    // ----- supplier bills tagged to the job -----
    if (code) {
      for (const b of bills) {
        const amount = taggedEx(b, code);
        if (!amount) continue;
        const supplier = b.Contact?.Name ?? "Supplier";
        const status = STATUS[b.Status] ?? "Authorised";
        const line = job.costLines.find((l) => l.supplier && norm(l.supplier) === norm(supplier))
          ?? job.costLines.find((l) => { const first = norm(supplier).split(" ")[0]; return first.length >= 3 && norm(`${l.trade} ${l.supplier ?? ""}`).includes(first); });
        const data = { supplier, invoiceNumber: b.InvoiceNumber ?? null, amount, status, dueDate: day(b.DueDateString), paidDate: day(b.FullyPaidOnDate) };
        const existing = job.bills.find((x) => x.externalId === b.InvoiceID)
          ?? job.bills.find((x) => !x.externalId && x.invoiceNumber && b.InvoiceNumber && x.invoiceNumber.toLowerCase() === b.InvoiceNumber.toLowerCase());
        if (existing) {
          if (existing.status !== status || existing.amount !== amount || existing.dueDate !== data.dueDate || !existing.externalId) {
            await prisma.jobBill.update({ where: { id: existing.id }, data: { ...data, externalId: b.InvoiceID, source: "xero", costLineId: existing.costLineId ?? line?.id ?? null } });
            rep.billsUpdated++;
          }
        } else {
          await prisma.jobBill.create({ data: { ...data, jobId: job.id, externalId: b.InvoiceID, source: "xero", costLineId: line?.id ?? null } });
          rep.billsAdded++;
        }
      }

      // ----- spend money tagged to the job (materials) -----
      for (const t of spend) {
        const amount = taggedEx(t, code);
        if (!amount) continue;
        const ext = `xero-spend:${t.BankTransactionID}`;
        if (job.materials.some((m) => m.externalId === ext)) continue;
        const d = day(t.DateString) ?? "";
        const supplier = t.Contact?.Name ?? "Supplier";
        // Adopt a matching receipt typed in by hand (same supplier, amount and date) instead of adding it twice.
        const manual = job.materials.find((m) => !m.externalId && m.date === d && Math.abs(m.amount - amount) < 0.01 && norm(m.supplier) === norm(supplier));
        if (manual) { await prisma.jobMaterial.update({ where: { id: manual.id }, data: { externalId: ext } }); continue; }
        await prisma.jobMaterial.create({ data: { jobId: job.id, date: d, supplier, description: (t.LineItems ?? [])[0]?.Description?.slice(0, 200) ?? t.Reference ?? null, amount, externalId: ext, source: "xero" } });
        rep.materialsAdded++;
      }
    }
    if (rep.claimsUpdated || rep.billsAdded || rep.billsUpdated || rep.materialsAdded) await audit("xero", "job sync", "Job", job.id, `claims ${rep.claimsUpdated}, bills +${rep.billsAdded}/~${rep.billsUpdated}, materials +${rep.materialsAdded}`);
    out.push(rep);
  }
  await prisma.integrationSetting.upsert({ where: { key: "xero:jobs" }, create: { key: "xero:jobs", value: JSON.stringify({ at: new Date().toISOString(), jobs: out }) }, update: { value: JSON.stringify({ at: new Date().toISOString(), jobs: out }) } });
  return out;
}

export async function lastXeroJobSync(): Promise<{ at: string; jobs: XeroJobReport[] } | null> {
  const r = await prisma.integrationSetting.findUnique({ where: { key: "xero:jobs" } });
  return r ? JSON.parse(r.value) : null;
}
