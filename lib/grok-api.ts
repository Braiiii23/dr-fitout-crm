import "server-only";
import { NextResponse } from "next/server";
import { timingSafeEqual, createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { audit, runLeadAutomations, runCallAutomations, stageSideEffects } from "./automations";
import { fillGpOnSign } from "./job-estimate";
import { ensureJobForLead } from "./job-from-lead";

// Grok's full access: read everything, create and change records like the admin would.
// Not allowed: deleting anything, changing the software, logins/passwords (User), and the Xero / BuilderTrend connections and settings store.
// Auth: Authorization: Bearer <GROK_ADMIN_KEY>. Every change is recorded in the audit log as "grok".

export const json = (d: unknown, status = 200) => NextResponse.json(d, { status, headers: { "Cache-Control": "no-store" } });

const hits: number[] = [];
export function grokAuth(req: Request): NextResponse | null {
  const key = process.env.GROK_ADMIN_KEY ?? "";
  if (key.length < 24) return json({ ok: false, error: "Grok access is switched off (GROK_ADMIN_KEY isn't set)." }, 503);
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim() || (req.headers.get("x-api-key") ?? "").trim();
  if (!got || !timingSafeEqual(createHash("sha256").update(got).digest(), createHash("sha256").update(key).digest())) return json({ ok: false, error: "Unauthorised" }, 401);
  const now = Date.now(); while (hits.length && now - hits[0] > 60000) hits.shift(); hits.push(now);
  if (hits.length > 240) return json({ ok: false, error: "Too many requests: slow down to 240 a minute." }, 429);
  return null;
}

/** URL name → table, and whether Grok may change it. Tables not listed here are off limits. */
export const RESOURCES: Record<string, { model: string; write: boolean; about: string }> = {
  leads: { model: "Lead", write: true, about: "DR Fitout leads (brand is always DR; category: Turnkey fitout | Joint venture | Normal fitout)" },
  clients: { model: "Client", write: true, about: "Client practices. Link leads/jobs/leases with their clientId." },
  leases: { model: "Lease", write: true, about: "Tenancies. status (stage): Enquiring | Concept proposing | Sign. Dates YYYY-MM-DD. files is managed by the app." },
  concepts: { model: "Concept", write: true, about: "Concept designs. rooms is JSON [{name, qty, areaSqm, notes}]. files is managed by the app." },
  "concept-fits": { model: "ConceptFit", write: false, about: "AI test fits of a concept onto a lease's floor plan (read only; run one with POST /api/grok/actions/concept-fit)" },
  directory: { model: "CallListItem", write: true, about: "The Directory: designers, leasing agents, landlords, clients and trades (business is always DR)" },
  "trade-quotes": { model: "TradeQuote", write: true, about: "Estimating: trade quotes on a lead's trade pack" },
  "scope-items": { model: "ScopeItem", write: true, about: "Estimating: scope of works items" },
  jobs: { model: "Job", write: true, about: "Live and completed jobs (WIP)" },
  claims: { model: "JobClaim", write: true, about: "A job's claim schedule and invoices" },
  "cost-lines": { model: "JobCostLine", write: true, about: "A job's trades and costs (paid: null = Pending)" },
  bills: { model: "JobBill", write: true, about: "Supplier invoices on a job" },
  labour: { model: "JobLabour", write: true, about: "Labour hours on a job" },
  materials: { model: "JobMaterial", write: true, about: "Materials receipts on a job" },
  tasks: { model: "JobTask", write: true, about: "A job's build program" },
  "calendar-events": { model: "CalEvent", write: true, about: "Team calendar events" },
  todos: { model: "Todo", write: true, about: "To-dos and tasks given out" },
  kpis: { model: "Kpi", write: true, about: "KPIs set for people" },
  "kpi-entries": { model: "KpiEntry", write: true, about: "KPI entries logged by hand" },
  reminders: { model: "ReminderRequest", write: true, about: "Reminder queue" },
  "accounts-settings": { model: "AccountsSettings", write: true, about: "Accounts targets and settings (one row, id \"settings\")" },
  "claim-notices": { model: "ClaimNotice", write: false, about: "Notices sent to accounts about claims (read only)" },
  emails: { model: "EmailLog", write: false, about: "Emails the CRM sent or logged (read only)" },
  audit: { model: "AuditLog", write: false, about: "Who changed what (read only)" },
  snapshots: { model: "JobSnapshot", write: false, about: "Weekly WIP snapshots (read only)" },
};
// Fields that only the app itself manages.
const LOCKED: Record<string, string[]> = {
  CallListItem: ["slotId", "setterId", "business"], Lead: ["brand", "setterId"], Job: ["brand"],
  Lease: ["files"], Concept: ["files"], ConceptFit: ["result"],
};
/** Values Grok can't choose: this is a DR Fitout-only CRM. */
export const FIXED: Record<string, Record<string, unknown>> = { Lead: { brand: "DR" }, Job: { brand: "DR" }, CallListItem: { business: "DR" } };
const ALWAYS_LOCKED = ["id", "createdAt", "updatedAt"];

type Field = { name: string; kind: string; type: string; isRequired: boolean; isList: boolean; hasDefaultValue: boolean };
const modelInfo = (model: string) => Prisma.dmmf.datamodel.models.find((m) => m.name === model)!;
export const scalarFields = (model: string): Field[] => (modelInfo(model).fields as unknown as Field[]).filter((f) => f.kind === "scalar" || f.kind === "enum");
export const writableFields = (model: string) => scalarFields(model).filter((f) => !ALWAYS_LOCKED.includes(f.name) && !(LOCKED[model] ?? []).includes(f.name));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const delegate = (model: string) => (prisma as any)[model.charAt(0).toLowerCase() + model.slice(1)];

/** Check and convert incoming values to each field's type. Unknown or locked fields are errors, not silently dropped. */
export function coerce(model: string, body: Record<string, unknown>, creating: boolean) {
  const fields = new Map(writableFields(model).map((f) => [f.name, f]));
  const data: Record<string, unknown> = {}; const errors: string[] = [];
  for (const [k, v] of Object.entries(body)) {
    if (k === "appendNotes") continue;
    const f = fields.get(k);
    if (!f) { errors.push(ALWAYS_LOCKED.includes(k) || (LOCKED[model] ?? []).includes(k) ? `${k} can't be set directly` : `${k} isn't a field on ${model}`); continue; }
    if (v === null) { if (f.isRequired) errors.push(`${k} can't be empty`); else data[k] = null; continue; }
    if (f.type === "String") data[k] = String(v).slice(0, 20000);
    else if (f.type === "Int") { const n = Number(v); if (Number.isInteger(n)) data[k] = n; else errors.push(`${k} must be a whole number`); }
    else if (f.type === "Float") { const n = Number(v); if (Number.isFinite(n)) data[k] = n; else errors.push(`${k} must be a number`); }
    else if (f.type === "Boolean") { if (typeof v === "boolean") data[k] = v; else if (/^(true|false)$/i.test(String(v))) data[k] = /true/i.test(String(v)); else errors.push(`${k} must be true or false`); }
    else if (f.type === "DateTime") { const d = new Date(String(v)); if (Number.isNaN(d.getTime())) errors.push(`${k} must be an ISO date-time`); else data[k] = d; }
    else data[k] = v; // enums
  }
  if (model === "Lease" && typeof data.status === "string" && !["Enquiring", "Concept proposing", "Sign"].includes(data.status)) errors.push("status must be Enquiring | Concept proposing | Sign");
  if (model === "Lead" && typeof data.category === "string" && !["Turnkey fitout", "Joint venture", "Normal fitout"].includes(data.category)) errors.push("category must be Turnkey fitout | Joint venture | Normal fitout");
  if (creating) for (const f of writableFields(model)) if (f.isRequired && !f.hasDefaultValue && !(f.name in data)) errors.push(`${f.name} is required`);
  return { data, errors };
}

/** Add text to the end of a notes field (never replacing it). */
export function appendTo(existing: string | null | undefined, text: unknown) {
  const t = typeof text === "string" ? text.trim() : "";
  if (!t) return existing ?? null;
  const stamp = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", day: "numeric", month: "short", year: "numeric" }).format(new Date());
  return [existing?.trimEnd(), `${stamp} (Grok): ${t}`].filter(Boolean).join("\n\n");
}
const NOTES_FIELD: Record<string, string> = { Lead: "notes", CallListItem: "callNotes", Job: "notes", JobClaim: "notes", JobCostLine: "notes", JobBill: "notes", JobLabour: "notes", Client: "notes", Lease: "notes" };
export const notesField = (model: string) => NOTES_FIELD[model] ?? null;

/** The same follow-on work the app does when someone saves these records in the browser. */
export async function afterWrite(model: string, id: string, before: Record<string, unknown> | null) {
  if (model === "Lead") {
    const l = await prisma.lead.findUniqueOrThrow({ where: { id } });
    const side = stageSideEffects(l.brand, l.stage, l);
    if (Object.keys(side).length) await prisma.lead.update({ where: { id }, data: side });
    await runLeadAutomations(id);
    if (!before || before.stage !== l.stage || before.contractValue !== l.contractValue) { await fillGpOnSign(id, "grok"); await ensureJobForLead(id); }
  }
  if (model === "CallListItem") await runCallAutomations(id);
}

export async function grokAudit(action: string, model: string, id: string | undefined, detail: string) { await audit("grok", action, model, id, detail.slice(0, 500)); }

/** What changed, for the reply. */
export function diff(before: Record<string, unknown> | null, after: Record<string, unknown>) {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(after)) {
    const b = before?.[k];
    const same = b instanceof Date && v instanceof Date ? b.getTime() === v.getTime() : b === v;
    if (!same) out[k] = { from: b ?? null, to: v };
  }
  return out;
}
