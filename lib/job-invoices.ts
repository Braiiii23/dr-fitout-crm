import "server-only";
import type { XInvoice } from "./xero";

// Matches a signed job to its real Xero sales invoices, so "invoiced", "paid" and "left to invoice"
// come from Xero rather than assumptions. Match order: job number in the invoice number/reference,
// then the Xero contact set on the job, then the client's company or name.
const norm = (s?: string | null) => (s ?? "").toLowerCase().replace(/\b(pty|ltd|limited|the|trust|t\/a|trading as)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export type JobInvoiceMatch = { matched: boolean; by: "job number" | "Xero contact" | "client name" | "none"; contact: string | null; invoiced: number; paid: number; owed: number; count: number; ids: string[] };

export function matchJobInvoices(
  job: { jobNumber?: string | null; xeroContact?: string | null; company?: string | null; leadName?: string | null; signedDate?: string | null },
  invoices: XInvoice[],
): JobInvoiceMatch {
  // Only invoices from two weeks before signing onwards (deposits are sometimes raised just before).
  const from = job.signedDate ? new Date(Date.parse(job.signedDate + "T00:00:00Z") - 14 * 86400000).toISOString().slice(0, 10) : "";
  const pool = invoices.filter((i) => i.Type === "ACCREC" && (i.Status === "AUTHORISED" || i.Status === "PAID") && (!from || (i.DateString ?? "").slice(0, 10) >= from));
  let hits: XInvoice[] = [], by: JobInvoiceMatch["by"] = "none";
  const jn = (job.jobNumber ?? "").trim().toLowerCase();
  if (jn.length >= 3) { hits = pool.filter((i) => `${i.InvoiceNumber ?? ""} ${i.Reference ?? ""}`.toLowerCase().includes(jn)); if (hits.length) by = "job number"; }
  if (!hits.length && job.xeroContact) { const c = norm(job.xeroContact); hits = pool.filter((i) => norm(i.Contact?.Name) === c); if (hits.length) by = "Xero contact"; }
  if (!hits.length) {
    const names = [norm(job.company), norm(job.leadName)].filter((n) => n.length >= 4);
    hits = pool.filter((i) => { const c = norm(i.Contact?.Name); return c.length >= 4 && names.some((n) => c.includes(n) || n.includes(c)); });
    if (hits.length) by = "client name";
  }
  const invoiced = hits.reduce((t, i) => t + num(i.SubTotal), 0);
  // Paid share, ex GST: (total - amount due) scaled from GST-inclusive to ex GST.
  const paid = hits.reduce((t, i) => { const tot = num(i.Total) || num(i.SubTotal); const due = num(i.AmountDue); return t + (tot ? (tot - due) * num(i.SubTotal) / tot : 0); }, 0);
  return { matched: hits.length > 0, by, contact: hits[0]?.Contact?.Name ?? job.xeroContact ?? null, invoiced, paid, owed: invoiced - paid, count: hits.length, ids: hits.map((i) => i.InvoiceID) };
}
