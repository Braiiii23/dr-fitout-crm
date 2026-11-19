import "server-only";
import { timingSafeEqual, createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { audit, runLeadAutomations, runCallAutomations, stageSideEffects } from "./automations";
import { fillGpOnSign } from "./job-estimate";
import { ensureJobForLead } from "./job-from-lead";

// Claude's access to the CRM (the Claude connector at /api/mcp): read everything, create and change records like the admin would.
// Not allowed: deleting anything, changing the software, logins/passwords (User), and the Xero / BuilderTrend connections and settings store.
// Used by two doors: the Claude connector (/api/mcp, CLAUDE_CONNECTOR_KEY) and the Grok API (/api/grok, GROK_ADMIN_KEY).
// Every change is recorded in the audit log as "claude" or "grok".
export type Actor = { id: string; label: string; keyVar?: "CLAUDE_CONNECTOR_KEY" | "GROK_ADMIN_KEY"; door: string };
export const CLAUDE: Actor = { id: "claude", label: "Claude", keyVar: "CLAUDE_CONNECTOR_KEY", door: "The Claude connector" };
export const GROK: Actor = { id: "grok", label: "Grok", keyVar: "GROK_ADMIN_KEY", door: "Grok access" };

const hits: Record<string, number[]> = { claude: [], grok: [] };
/** Checks the connector key. Returns an error message, or null when the request may go ahead. */
export function agentAuthError(req: Request, actor: Actor): { status: number; error: string } | null {
  if (!actor.keyVar) return { status: 403, error: "No outside access for this actor." };
  const key = process.env[actor.keyVar] ?? "";
  if (key.length < 24) return { status: 503, error: `${actor.door} is switched off (${actor.keyVar} isn't set).` };
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim() || (req.headers.get("x-api-key") ?? "").trim();
  if (!got || !timingSafeEqual(createHash("sha256").update(got).digest(), createHash("sha256").update(key).digest())) return { status: 401, error: "Unauthorised" };
  const h = (hits[actor.id] ??= []); const now = Date.now(); while (h.length && now - h[0] > 60000) h.shift(); h.push(now);
  if (h.length > 240) return { status: 429, error: "Too many requests: slow down to 240 a minute." };
  return null;
}

/** URL name → table, and whether Grok may change it. Tables not listed here are off limits. */
export const RESOURCES: Record<string, { model: string; write: boolean; about: string }> = {
  leads: { model: "Lead", write: true, about: "DR Fitout leads (brand is always DR; category: Turnkey fitout | Joint venture | Normal fitout)" },
  clients: { model: "Client", write: true, about: "Client practices. Link leads/jobs/leases with their clientId." },
  leases: { model: "Lease", write: true, about: "Tenancies. status (stage): Enquiring | Concept proposing | Sign. Dates YYYY-MM-DD. files is managed by the app. A lease can have several concepts: send linkConcepts / unlinkConcepts as arrays of concept ids." },
  concepts: { model: "Concept", write: true, about: "Concept designs. rooms is JSON [{name, qty, areaSqm, notes}]. files is managed by the app." },
  "concept-fits": { model: "ConceptFit", write: false, about: "AI test fits of a concept onto a lease's floor plan (read only; run one with the concept_fit tool)" },
  notices: { model: "Notice", write: true, about: "My Day notice board posts (category: Update | Progress | Win | Heads up | Site; link = in-app path like /leases/{id}). Posts show under your name (Claude or Grok)." },
  "notice-replies": { model: "NoticeReply", write: true, about: "Replies on notice board posts (noticeId + body). Show under your name (Claude or Grok)." },
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
  Lease: ["files", "conceptId"], Concept: ["files"], ConceptFit: ["result"],
  Notice: ["authorId", "authorName", "auto"], NoticeReply: ["authorId", "authorName"],
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
  if (model === "Notice" && typeof data.category === "string" && !["Update", "Progress", "Win", "Heads up", "Site"].includes(data.category)) errors.push("category must be Update | Progress | Win | Heads up | Site");
  if (model === "Notice" && typeof data.link === "string" && !/^\/[A-Za-z0-9/_?=&#.%-]*$/.test(data.link)) errors.push("link must be an in-app path like /leases/{id}");
  if (creating) for (const f of writableFields(model)) if (f.isRequired && !f.hasDefaultValue && !(f.name in data)) errors.push(`${f.name} is required`);
  return { data, errors };
}

/** Add text to the end of a notes field (never replacing it). */
export function appendTo(existing: string | null | undefined, text: unknown, by = "Claude") {
  const t = typeof text === "string" ? text.trim() : "";
  if (!t) return existing ?? null;
  const stamp = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", day: "numeric", month: "short", year: "numeric" }).format(new Date());
  return [existing?.trimEnd(), `${stamp} (${by}): ${t}`].filter(Boolean).join("\n\n");
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

export async function agentAudit(actor: Actor, action: string, model: string, id: string | undefined, detail: string) { await audit(actor.id, action, model, id, detail.slice(0, 500)); }

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

// ---------- Operations (used by the MCP tools) ----------
type Out = Record<string, unknown>;
const lastLine = (e: unknown) => (e as Error).message.split("\n").slice(-1)[0];
const table = (name: string) => { const r = RESOURCES[name]; if (!r) throw new Error(`Unknown table "${name}". The overview (crm_overview or GET /api/grok) lists the tables.`); return r; };

export function overview(actor: Actor): Out {
  return {
    actingAs: `the admin, recorded in the audit log as "${actor.id}"`, timezone: "Australia/Brisbane", business: "DR Fitout (medical / allied-health fitouts, Brisbane). Spelt \"DR Fitout\", singular.",
    rules: ["No deleting anything.", "No changes to the software itself.", "No logins, passwords or user accounts.", "No Xero / BuilderTrend connection settings.", "DR Fitout only: brand is always DR.",
      "Read a record before changing it, and use dryRun first.", "Use appendNotes to add a dated note; it never replaces what's there.", "Money is ex GST unless a field says Inc. Dates are YYYY-MM-DD.", "Don't invent values: leave unknowns blank and say so."],
    tables: Object.fromEntries(Object.entries(RESOURCES).map(([name, r]) => [name, {
      about: r.about, canChange: r.write,
      fields: scalarFields(r.model).map((f) => `${f.name}: ${f.type}${f.isRequired ? "" : "?"}`),
      ...(r.write ? { writable: writableFields(r.model).map((f) => f.name) } : {}),
    }])),
  };
}

export async function listRows(name: string, a: { q?: string; where?: unknown; orderBy?: unknown; limit?: number; offset?: number }): Promise<Out> {
  const r = table(name);
  let where = (a.where && typeof a.where === "object" ? a.where : {}) as Record<string, unknown>;
  const q = (a.q ?? "").trim();
  if (q) {
    const textFields = scalarFields(r.model).filter((f) => f.type === "String" && /name|company|title|trade|supplier|client|email|phone|description|person|invoiceNumber|jobNumber|premises|suburb|centre|landlord|tags/i.test(f.name)).map((f) => f.name);
    where = { AND: [where, { OR: textFields.map((f) => ({ [f]: { contains: q } })) }] };
  }
  const take = Math.min(200, Math.max(1, Number(a.limit) || 50)), skip = Math.max(0, Number(a.offset) || 0);
  try {
    const [rows, total] = await Promise.all([delegate(r.model).findMany({ where, ...(a.orderBy ? { orderBy: a.orderBy } : {}), take, skip }), delegate(r.model).count({ where })]);
    return { total, count: rows.length, offset: skip, rows };
  } catch (e) { throw new Error(`Query failed: ${lastLine(e)}`); }
}

export async function getRow(name: string, id: string): Promise<Out> {
  const r = table(name);
  const row = await delegate(r.model).findUnique({ where: { id } });
  if (!row) throw new Error("Not found");
  return { row };
}

/** Leases hold a list of concepts. Pull linkConcepts / unlinkConcepts out of the body and check the ids. */
async function conceptLinks(model: string, body: Record<string, unknown>, current: { id: string; name: string }[]) {
  if (model !== "Lease" || (body.linkConcepts === undefined && body.unlinkConcepts === undefined)) return null;
  const ids = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []).map(String);
  const link = ids(body.linkConcepts), unlink = ids(body.unlinkConcepts);
  delete body.linkConcepts; delete body.unlinkConcepts;
  const found = await prisma.concept.findMany({ where: { id: { in: [...link, ...unlink] } }, select: { id: true, name: true } });
  const missing = [...link, ...unlink].filter((id) => !found.some((c) => c.id === id));
  if (missing.length) throw new Error(`No concept with id ${missing.join(", ")}`);
  const after = [...current.filter((c) => !unlink.includes(c.id)), ...found.filter((c) => link.includes(c.id) && !current.some((x) => x.id === c.id))];
  const names = (l: { name: string }[]) => l.map((c) => c.name).sort().join(", ") || null;
  return { link, unlink, change: names(current) === names(after) ? null : { from: names(current), to: names(after) } };
}

export async function createRow(actor: Actor, name: string, body: Record<string, unknown>, dryRun: boolean): Promise<Out> {
  const r = table(name);
  if (!r.write) throw new Error(`${name} is read only`);
  body = { ...body };
  const links = await conceptLinks(r.model, body, []);
  const { data, errors } = coerce(r.model, body, true);
  Object.assign(data, FIXED[r.model] ?? {});
  if (r.model === "Notice" || r.model === "NoticeReply") data.authorName = actor.label;
  if (r.model === "Concept" && body.rooms !== undefined && typeof body.rooms !== "string") data.rooms = JSON.stringify(body.rooms);
  const nf = notesField(r.model);
  if (nf && body.appendNotes) data[nf] = appendTo(data[nf] as string | null, body.appendNotes, actor.label);
  if (errors.length) throw new Error(errors.join("; "));
  if (dryRun) return { dryRun: true, wouldCreate: links?.change ? { ...data, concepts: links.change.to } : data };
  try {
    const row = await delegate(r.model).create({ data: links ? { ...data, concepts: { connect: links.link.map((id) => ({ id })) } } : data });
    await afterWrite(r.model, row.id, null);
    await agentAudit(actor, "create", r.model, row.id, Object.keys(data).join(", "));
    return { created: await delegate(r.model).findUnique({ where: { id: row.id } }) };
  } catch (e) { throw new Error(`Couldn't create: ${lastLine(e)}`); }
}

export async function updateRow(actor: Actor, name: string, id: string, body: Record<string, unknown>, dryRun: boolean): Promise<Out> {
  const r = table(name);
  if (!r.write) throw new Error(`${name} is read only`);
  const before = await delegate(r.model).findUnique({ where: { id }, ...(r.model === "Lease" ? { include: { concepts: { select: { id: true, name: true } } } } : {}) });
  if (!before) throw new Error("Not found");
  body = { ...body };
  const links = await conceptLinks(r.model, body, (before.concepts ?? []) as { id: string; name: string }[]);
  const { data, errors } = coerce(r.model, body, false);
  if (r.model === "Concept" && body.rooms !== undefined && typeof body.rooms !== "string") data.rooms = JSON.stringify(body.rooms);
  const nf = notesField(r.model);
  if (body.appendNotes) { if (!nf) errors.push(`${name} has no notes field`); else data[nf] = appendTo((data[nf] as string | undefined) ?? before[nf], body.appendNotes, actor.label); }
  if (errors.length) throw new Error(errors.join("; "));
  const changes: Record<string, { from: unknown; to: unknown }> = diff(before, data);
  if (links?.change) changes.concepts = links.change;
  if (dryRun) return { dryRun: true, changes };
  if (!Object.keys(changes).length) return { changes: {}, note: "Nothing to change" };
  try {
    await delegate(r.model).update({ where: { id }, data: links?.change ? { ...data, concepts: { connect: links.link.map((c) => ({ id: c })), disconnect: links.unlink.map((c) => ({ id: c })) } } : data });
    await afterWrite(r.model, id, before);
    await agentAudit(actor, "update", r.model, id, Object.keys(changes).join(", "));
    return { changes, row: await delegate(r.model).findUnique({ where: { id } }) };
  } catch (e) { throw new Error(`Couldn't save: ${lastLine(e)}`); }
}
