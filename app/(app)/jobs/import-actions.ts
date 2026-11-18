"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/automations";
import { parseCsv, pick, toIsoDate, money, addWorkdays } from "@/lib/csv";

export type ImportKind = "costs" | "claims" | "bills" | "labour" | "materials" | "program";
type Row = Record<string, string | number | boolean | null>;

// Turns CSV rows into records for one table. Column names are flexible so BuilderTrend / Xero exports work as they are.
async function mapRows(kind: ImportKind, jobId: string, text: string) {
  const { rows } = parseCsv(text);
  const lines = await prisma.jobCostLine.findMany({ where: { jobId }, select: { id: true, trade: true } });
  const lineId = (t: string) => { const x = t.toLowerCase(); return x ? lines.find((l) => l.trade.toLowerCase() === x)?.id ?? lines.find((l) => l.trade.toLowerCase().includes(x) || x.includes(l.trade.toLowerCase()))?.id ?? null : null; };
  const job = await prisma.job.findUnique({ where: { id: jobId }, include: { labour: { select: { person: true, rate: true } } } });
  const lastRate = (p: string) => job?.labour.filter((l) => l.person.toLowerCase() === p.toLowerCase()).at(-1)?.rate ?? 0;
  const out: Row[] = []; const errors: string[] = [];
  rows.forEach((r, k) => {
    const line = k + 2;
    if (kind === "costs") {
      const trade = pick(r, "trade", "cost line", "item", "description");
      if (!trade) return errors.push(`Row ${line}: no trade name`);
      const paidRaw = pick(r, "paid", "paid ex gst", "paid (ex gst)");
      out.push({ trade, supplier: pick(r, "supplier", "subcontractor", "contact") || null, cost: money(pick(r, "cost", "costs", "costs (ex gst)", "quote", "allowance")) ?? 0,
        costStatus: ["Quoted", "Provisional", "Locked"].find((s) => s.toLowerCase() === pick(r, "status", "cost status").toLowerCase()) ?? "Quoted",
        paid: paidRaw === "" || /pending/i.test(paidRaw) ? null : money(paidRaw), claimSeq: Number(pick(r, "claim", "cycle", "claim cycle")) || null, notes: pick(r, "notes") || null });
    } else if (kind === "claims") {
      const pct = Number(pick(r, "pct", "%", "percent", "percentage").replace("%", ""));
      if (!pct && !money(pick(r, "amount", "claim", "claim ex gst"))) return errors.push(`Row ${line}: needs a % or an amount`);
      out.push({ seq: Number(pick(r, "seq", "cycle", "claim", "#")) || k + 1, name: pick(r, "name", "stage", "milestone") || `Claim ${k + 1}`, pct: pct || 0,
        amount: money(pick(r, "amount", "claim ex gst", "amount ex gst")) ?? (job ? Math.round(job.contractValue * pct) / 100 : 0), hook: pick(r, "hook", "trigger") || null,
        invoiceNumber: pick(r, "invoice", "invoice number", "invoice no") || null, status: ["Not due", "Draft", "Authorised", "Paid"].find((s) => s.toLowerCase() === pick(r, "status").toLowerCase()) ?? "Not due",
        invoicedDate: toIsoDate(pick(r, "invoiced", "invoice date", "date")), dueDate: toIsoDate(pick(r, "due", "due date")), receivedInc: money(pick(r, "received", "received inc", "paid inc", "amount paid")) ?? 0, notes: pick(r, "notes") || null });
    } else if (kind === "bills") {
      const amount = money(pick(r, "amount", "subtotal", "amount ex gst", "total ex gst"));
      if (amount == null) return errors.push(`Row ${line}: no amount`);
      const status = pick(r, "status").toLowerCase();
      out.push({ supplier: pick(r, "supplier", "contact", "from") || "Supplier", invoiceNumber: pick(r, "invoice", "invoice number", "reference", "invoiceno") || null, amount,
        status: status.includes("paid") ? "Paid" : status.includes("draft") ? "Draft" : "Authorised", dueDate: toIsoDate(pick(r, "due", "due date")), paidDate: toIsoDate(pick(r, "paid date", "date paid")),
        claimSeq: Number(pick(r, "claim", "cycle")) || null, costLineId: lineId(pick(r, "trade", "cost line")), notes: pick(r, "notes", "description") || null });
    } else if (kind === "labour") {
      const person = pick(r, "person", "user", "employee", "name", "worker");
      const hours = Number(pick(r, "hours", "total hours", "regular hours", "total time", "duration").replace(/[^0-9.]/g, ""));
      if (!person || !hours) return errors.push(`Row ${line}: needs a person and hours`);
      const rate = money(pick(r, "rate", "ordinary rate", "pay rate")) ?? lastRate(person);
      const ap = pick(r, "approved", "approval", "status").toLowerCase();
      out.push({ date: toIsoDate(pick(r, "date", "clock in date", "shift date", "clock in")) ?? new Date().toISOString().slice(0, 10), person, hours, rate,
        approved: /^(yes|y|true|1|approved)$/.test(ap), costLineId: lineId(pick(r, "trade", "cost line")) ?? lineId("new construction"), notes: pick(r, "notes") || null });
    } else if (kind === "materials") {
      const amount = money(pick(r, "amount", "amount ex gst", "subtotal", "total ex gst"));
      if (amount == null) return errors.push(`Row ${line}: no amount`);
      out.push({ date: toIsoDate(pick(r, "date")) ?? new Date().toISOString().slice(0, 10), supplier: pick(r, "supplier", "store", "vendor") || "Supplier", description: pick(r, "description", "item", "notes") || null, amount, costLineId: lineId(pick(r, "trade", "cost line")) });
    } else {
      const name = pick(r, "name", "title", "task", "task name");
      const start = toIsoDate(pick(r, "start", "start date"));
      if (!name || !start) return errors.push(`Row ${line}: needs a task name and a start date`);
      const workdays = Number(pick(r, "workdays", "duration", "days"));
      const finish = toIsoDate(pick(r, "finish", "end", "end date", "finish date")) ?? (workdays ? addWorkdays(start, workdays) : start);
      out.push({ name, start, finish, claimSeq: Number(pick(r, "claim", "cycle")) || null, done: /^(yes|y|true|1|done|complete)$/i.test(pick(r, "done", "complete", "status")) });
    }
  });
  return { out, errors, total: rows.length };
}

export async function previewImport(kind: ImportKind, jobId: string, text: string) {
  await requireUser(["ADMIN", "ACCOUNTS", "PM"]);
  if (text.length > 2_000_000) return { rows: [], errors: ["File is too big (2 MB max)."], total: 0 };
  const { out, errors, total } = await mapRows(kind, jobId, text);
  // Show the trade's name instead of its id in the preview, and point out hours with no pay rate.
  const lines = await prisma.jobCostLine.findMany({ where: { jobId }, select: { id: true, trade: true } });
  const shown = out.slice(0, 200).map((r) => { const { costLineId, ...rest } = r; return costLineId !== undefined ? { ...rest, trade: lines.find((l) => l.id === costLineId)?.trade ?? null } : rest; });
  const noRate = kind === "labour" ? out.filter((r) => !r.rate).map((r) => `${r.person}: no pay rate yet, so these hours cost $0 until you add one`) : [];
  return { rows: shown, count: out.length, errors: [...errors, ...[...new Set(noRate)]].slice(0, 50), total };
}

export async function commitImport(kind: ImportKind, jobId: string, text: string) {
  const u = await requireUser(["ADMIN", "ACCOUNTS", "PM"]);
  if (u.role === "ACCOUNTS" && kind === "program") return { imported: 0 }; // the build program is Braiden's and the PMs'
  if (u.role === "PM" && kind === "claims") return { imported: 0 }; // claims are Braiden's and accounts' 
  const { out } = await mapRows(kind, jobId, text);
  const model = { costs: "jobCostLine", claims: "jobClaim", bills: "jobBill", labour: "jobLabour", materials: "jobMaterial", program: "jobTask" }[kind];
  let sort = await prisma.jobCostLine.count({ where: { jobId } });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of out) await (prisma as any)[model].create({ data: { ...r, jobId, source: "csv", ...(kind === "costs" ? { sort: sort++ } : {}) } });
  await audit(u.email, `csv import ${kind}`, "Job", jobId, `${out.length} rows`);
  revalidatePath(`/jobs/${jobId}`); revalidatePath("/jobs"); revalidatePath("/wip");
  return { imported: out.length };
}
