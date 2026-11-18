import "server-only";
import { prisma } from "./db";
import { audit } from "./automations";
import { claimNamesFor } from "./claim-names";

// Fills BLANK details on live jobs (e.g. ones Grok created from BuilderTrend) from what the CRM already knows:
//  1. a matching lead in the CRM (signed or quoting) → link, contract value, job number, client
//  2. Xero tracking code → found from invoices/bills whose client matches the job
//  3. client name → the contact on that job's Xero sales invoices
//  4. contract value → the client's accepted quote in Xero, else (flagged as an estimate) deposit invoice ÷ deposit %
// Never overwrites a value already on the job. Only acts on a clear match; anything unclear is listed to check.

type Line = { Tracking?: { Option?: string }[] };
type Doc = { InvoiceID: string; Type: string; Status: string; InvoiceNumber?: string; Contact?: { Name?: string }; DateString?: string; SubTotal?: number; LineItems?: Line[] };
type Quote = { QuoteID: string; QuoteNumber?: string; Reference?: string; Title?: string; Contact?: { Name?: string }; DateString?: string; SubTotal?: number };
export type FillResult = { jobId: string; job: string; filled: string[]; toCheck: string[]; at?: string };

const STOP = new Set(["pty", "ltd", "limited", "the", "and", "group", "trust", "fitout", "fit", "out", "shop", "store", "new", "job"]);
const words = (s?: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length >= 3 && !STOP.has(w));
/** How many distinctive words two names share (e.g. "Momo Seafood - Fortitude Valley" vs "Momo Seafood Pty Ltd" = 2). */
const overlap = (a: string[], b: string[]) => a.filter((w) => b.includes(w)).length;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

async function snap<T>(key: string): Promise<T[]> {
  const s = await prisma.xeroSnapshot.findUnique({ where: { key } });
  if (!s?.ok) return [];
  try { return (JSON.parse(s.json) as T[]) ?? []; } catch { return []; }
}
/** The single best match, only if it's clearly better than the next one. */
function best<T>(items: { item: T; score: number }[], min = 1): T | null {
  const sorted = items.filter((x) => x.score >= min).sort((a, b) => b.score - a.score);
  if (!sorted.length) return null;
  if (sorted[1] && sorted[1].score === sorted[0].score) return null; // a tie is not a clear match
  return sorted[0].item;
}

export async function fillJobsMissingInfo(): Promise<FillResult[]> {
  const jobs = await prisma.job.findMany({ where: { status: { not: "Complete" } }, include: { claims: true } });
  const needs = jobs.filter((j) => !j.contractValue || !j.client || !j.xeroTracking || !j.jobNumber || !j.leadId);
  if (!needs.length) return [];

  const docs = new Map<string, Doc>();
  for (const k of ["salesHistory", "salesRecent", "receivables", "billsHistory", "billsRecent", "payables"]) for (const d of await snap<Doc>(k)) docs.set(d.InvoiceID, d);
  const sales = [...docs.values()].filter((d) => d.Type === "ACCREC" && d.Status !== "VOIDED" && d.Status !== "DELETED");
  // Tracking code → the clients on its sales invoices.
  const codes = new Map<string, { clients: Map<string, number>; firstSale: Doc | null }>();
  for (const d of [...docs.values()]) for (const l of d.LineItems ?? []) for (const t of l.Tracking ?? []) {
    if (!t.Option) continue;
    const c = codes.get(t.Option) ?? { clients: new Map(), firstSale: null };
    if (d.Type === "ACCREC" && d.Contact?.Name) {
      c.clients.set(d.Contact.Name, (c.clients.get(d.Contact.Name) ?? 0) + 1);
      if (!c.firstSale || (d.DateString ?? "") < (c.firstSale.DateString ?? "")) c.firstSale = d;
    }
    codes.set(t.Option, c);
  }
  const usedCodes = new Set(jobs.map((j) => j.xeroTracking).filter(Boolean) as string[]);
  const quotes = await snap<Quote>("quotes");
  const takenLeads = new Set(jobs.map((j) => j.leadId).filter(Boolean) as string[]);
  const leads = await prisma.lead.findMany({ where: { brand: { in: ["ENP", "DR"] }, cancelled: false, stage: { in: ["Signed", "Quoting"] } }, select: { id: true, company: true, leadName: true, stage: true, contractValue: true, quoteValue: true, jobNumber: true } });

  const out: FillResult[] = [];
  for (const job of needs) {
    const r: FillResult = { jobId: job.id, job: job.name, filled: [], toCheck: [] };
    const data: Record<string, unknown> = {};
    const jw = [...new Set([...words(job.name), ...words(job.client), ...words(job.btJobName)])];

    // 1. A matching lead in the CRM.
    let lead = job.leadId ? leads.find((l) => l.id === job.leadId) ?? null : null;
    if (!job.leadId) {
      lead = best(leads.filter((l) => !takenLeads.has(l.id)).map((l) => ({ item: l, score: overlap(jw, words(`${l.company ?? ""} ${l.leadName ?? ""}`)) + (l.stage === "Signed" ? 0.5 : 0) + (job.jobNumber && l.jobNumber === job.jobNumber ? 3 : 0) })), 1.5);
      if (lead) { data.leadId = lead.id; takenLeads.add(lead.id); r.filled.push(`linked to the ${(lead.stage ?? "").toLowerCase()} lead "${lead.company ?? lead.leadName}"`); }
    }
    if (lead && !job.jobNumber && lead.jobNumber) { data.jobNumber = lead.jobNumber; r.filled.push(`job number ${lead.jobNumber} (from the lead)`); }
    if (lead && !job.client && lead.company) { data.client = lead.company; r.filled.push(`client "${lead.company}" (from the lead)`); }

    // 2. Xero tracking code: the code whose sales invoices go to a client matching this job.
    let code = job.xeroTracking;
    if (!code) {
      const clientWords = [...jw, ...words(data.client as string | undefined)];
      code = best([...codes.entries()].filter(([c]) => !usedCodes.has(c)).map(([c, v]) => ({
        item: c, score: Math.max(0, ...[...v.clients.keys()].map((n) => overlap(clientWords, words(n)))) + (jw.some((w) => c.toLowerCase().includes(w.slice(0, 4))) ? 0.5 : 0),
      })), 1);
      if (code) { data.xeroTracking = code; usedCodes.add(code); r.filled.push(`Xero tracking code ${code}`); }
      else r.toCheck.push("Xero tracking code (no clear match in Xero; add it on the Job details tab)");
    }
    const clientFromXero = code ? [...(codes.get(code)?.clients.entries() ?? [])].sort((a, b) => b[1] - a[1])[0]?.[0] : null;
    if (!job.client && !data.client && clientFromXero) { data.client = clientFromXero; r.filled.push(`client "${clientFromXero}" (from Xero)`); }

    // 3. Contract value: the lead's signed value, else the client's accepted quote in Xero, else deposit ÷ deposit %.
    if (!job.contractValue) {
      const client = (data.client as string) ?? job.client ?? clientFromXero ?? "";
      if (lead?.stage === "Signed" && lead.contractValue) { data.contractValue = lead.contractValue; r.filled.push(`contract ${fmt(lead.contractValue)} (from the signed lead)`); }
      else if (lead && (lead.contractValue || lead.quoteValue)) {
        const v = (lead.contractValue || lead.quoteValue)!;
        data.contractValue = v; r.filled.push(`contract ${fmt(v)} (the quoted amount on the lead)`);
        r.toCheck.push(`the lead is still marked ${lead.stage}: mark it Signed with the final contract value`);
      }
      else {
        const q = best(quotes.map((x) => ({ item: x, score: overlap([...jw, ...words(client)], words(x.Contact?.Name)) + overlap(jw, words(`${x.Title ?? ""} ${x.Reference ?? ""}`)) * 0.5 })), 1);
        if (q && num(q.SubTotal) > 0) { data.contractValue = num(q.SubTotal); r.filled.push(`contract ${fmt(num(q.SubTotal))} ex GST (Xero quote ${q.QuoteNumber ?? ""})`); }
        else {
          const dep = code ? codes.get(code)?.firstSale : null;
          const depPct = job.claims.find((c) => c.seq === 1)?.pct ?? 30;
          if (dep && num(dep.SubTotal) > 0) {
            const est = Math.round(num(dep.SubTotal) / (depPct / 100) * 100) / 100;
            data.contractValue = est;
            r.filled.push(`contract about ${fmt(est)} (estimated: ${dep.InvoiceNumber ?? "first invoice"} ${fmt(num(dep.SubTotal))} is the ${depPct}% deposit)`);
            r.toCheck.push("contract value is an estimate from the deposit invoice; confirm it against the signed agreement");
          } else r.toCheck.push("contract value (not found in the CRM or Xero)");
        }
      }
    }
    if (!job.claims.length && !data.contractValue && !job.contractValue) r.toCheck.push("claim schedule (needs the contract value first)");

    if (Object.keys(data).length) {
      const note = `Filled automatically ${new Date().toISOString().slice(0, 10)}: ${r.filled.join("; ")}.${r.toCheck.length ? ` Still to check: ${r.toCheck.join("; ")}.` : ""}`;
      await prisma.job.update({ where: { id: job.id }, data: { ...data, notes: [job.notes?.trimEnd(), note].filter(Boolean).join("\n") } });
      // A job that now has a contract but no claims gets the usual split to start from.
      const contract = (data.contractValue as number | undefined) ?? job.contractValue;
      if (contract > 0 && !job.claims.length) {
        const rows = claimNamesFor([30, 30, 35, 5]); let allocated = 0;
        for (let k = 0; k < rows.length; k++) { const [pct, name, hook] = rows[k]; const amount = k === rows.length - 1 ? Math.round((contract - allocated) * 100) / 100 : Math.round(contract * pct) / 100; allocated += amount; await prisma.jobClaim.create({ data: { jobId: job.id, seq: k + 1, name, pct, amount, hook, source: "auto" } }); }
        r.filled.push("usual 30/30/35/5 claims (check against the signed agreement)");
      }
      await audit("auto-fill", "job details filled", "Job", job.id, r.filled.join("; "));
    }
    if (r.filled.length || r.toCheck.length) out.push(r);
  }
  // Keep what was filled (and the "please confirm" notes) from the last 7 days, merged with this run, so a later run doesn't hide them.
  const prev = await lastFill();
  const weekAgo = Date.now() - 7 * 86400000;
  const now = new Date().toISOString();
  const byJob = new Map<string, FillResult>();
  for (const x of prev?.jobs ?? []) if (Date.parse(x.at ?? prev!.at) > weekAgo && (x.filled.length || x.toCheck.some((t) => /estimate|still marked/.test(t)))) byJob.set(x.jobId, { ...x, toCheck: x.toCheck.filter((t) => /estimate|still marked/.test(t)) });
  for (const x of out) {
    const old = byJob.get(x.jobId);
    byJob.set(x.jobId, { ...x, filled: [...new Set([...(old?.filled ?? []), ...x.filled])], toCheck: [...new Set([...(old?.toCheck ?? []), ...x.toCheck])], at: x.filled.length ? now : old?.at ?? now });
  }
  const merged = [...byJob.values()];
  await prisma.integrationSetting.upsert({ where: { key: "jobs:fill" }, create: { key: "jobs:fill", value: JSON.stringify({ at: now, jobs: merged }) }, update: { value: JSON.stringify({ at: now, jobs: merged }) } });
  return out;
}
const fmt = (n: number) => `$${n.toLocaleString("en-AU", { maximumFractionDigits: 2 })}`;

export async function lastFill(): Promise<{ at: string; jobs: FillResult[] } | null> {
  const r = await prisma.integrationSetting.findUnique({ where: { key: "jobs:fill" } });
  return r ? JSON.parse(r.value) : null;
}
