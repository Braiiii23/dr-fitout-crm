// What the in-app assistant can look up and change for the signed-in person.
// Claude only PREPARES changes here; nothing is saved until the person presses Apply.
import { prisma } from "@/lib/db";
import { canOpen, isViewOnly, type AnyRole } from "@/lib/access";
import type { CurrentUser } from "@/lib/auth";
import type { AiTool } from "@/lib/ai";
import { RESOURCES, scalarFields, writableFields, listRows, getRow, createRow, updateRow, type Actor } from "@/lib/agent-api";

/** Table → the app area whose permissions decide who may read / change it. Tables not listed are off limits to the assistant. */
const AREA: Record<string, string> = {
  leads: "/leads", clients: "/clients", leases: "/leases", concepts: "/concepts", "concept-fits": "/concepts",
  directory: "/directory", notices: "/myday", "notice-replies": "/myday", todos: "/myday", "calendar-events": "/calendar",
  jobs: "/jobs", claims: "/jobs", "cost-lines": "/jobs", bills: "/jobs", labour: "/jobs", materials: "/jobs", tasks: "/jobs",
  "trade-quotes": "/estimating", "scope-items": "/estimating", kpis: "/kpis", "kpi-entries": "/kpis",
};

export const assistantActor = (u: CurrentUser): Actor => ({ id: `${u.email} (via assistant)`, label: u.name, door: "The assistant" });

const role = (u: CurrentUser) => u.role as AnyRole;
export const canRead = (u: CurrentUser, t: string) => !!AREA[t] && !!RESOURCES[t] && canOpen(role(u), AREA[t]) === true;
/** Team logins are shared, so they never change data through the assistant. */
export const canChange = (u: CurrentUser, t: string) => u.role !== "TEAM" && canRead(u, t) && !!RESOURCES[t]?.write && !isViewOnly(role(u), AREA[t]);

export function readableTables(u: CurrentUser) { return Object.keys(AREA).filter((t) => canRead(u, t)); }
export function changeableTables(u: CurrentUser) { return Object.keys(AREA).filter((t) => canChange(u, t)); }

/** Short description of each table this person can change, so Claude uses real field names. */
export function tablesGuide(u: CurrentUser) {
  const lines = readableTables(u).map((t) => {
    const r = RESOURCES[t];
    const can = canChange(u, t);
    const fields = (can ? writableFields(r.model) : scalarFields(r.model)).map((f) => `${f.name}:${f.type}${f.isRequired && !f.hasDefaultValue ? "*" : ""}`).join(", ");
    return `- ${t} (${can ? "can change" : "read only"}): ${r.about}. Fields: ${fields}`;
  });
  return lines.join("\n");
}

export type PendingOp = { kind: "create" | "update"; table: string; id?: string; body: Record<string, unknown>; label: string; details: { field: string; from?: string; to: string }[]; reason?: string };

export const ASSISTANT_TOOLS: AiTool[] = [
  { name: "find_records", description: "Search a table. Use before changing anything so you have the record's id. `search` matches names, companies, suburbs etc. `where` is an optional Prisma where object, e.g. {\"status\":\"Enquiring\"}.",
    input_schema: { type: "object", properties: { table: { type: "string" }, search: { type: "string" }, where: { type: "object" }, limit: { type: "integer", maximum: 50 } }, required: ["table"] } },
  { name: "get_record", description: "Read one record in full by id.", input_schema: { type: "object", properties: { table: { type: "string" }, id: { type: "string" } }, required: ["table", "id"] } },
  { name: "prepare_create", description: "Prepare a NEW record. Nothing is saved: the person sees it and presses Apply. `fields` uses the table's field names. Use appendNotes (text) to add a dated note.",
    input_schema: { type: "object", properties: { table: { type: "string" }, fields: { type: "object" }, reason: { type: "string", description: "One short line on what this does" } }, required: ["table", "fields"] } },
  { name: "prepare_update", description: "Prepare a change to an existing record (by id). Only include fields that change. Use appendNotes (text) to add a dated note without replacing existing notes. Nothing is saved until the person presses Apply.",
    input_schema: { type: "object", properties: { table: { type: "string" }, id: { type: "string" }, fields: { type: "object" }, reason: { type: "string" } }, required: ["table", "id", "fields"] } },
];

const show = (v: unknown): string => v === null || v === undefined || v === "" ? "(blank)" : v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "object" ? JSON.stringify(v).slice(0, 200) : String(v).slice(0, 300);
const nameOf = (row: Record<string, unknown> | null | undefined, fallback: string) => {
  if (!row) return fallback;
  for (const k of ["name", "title", "company", "premises", "clientName", "description", "trade", "supplier", "body"]) if (typeof row[k] === "string" && row[k]) return String(row[k]).slice(0, 80);
  return fallback;
};
const SINGULAR: Record<string, string> = { leads: "lead", clients: "client", leases: "lease", concepts: "concept", directory: "directory contact", notices: "notice", "notice-replies": "notice reply", todos: "to-do", "calendar-events": "calendar event", jobs: "job", claims: "claim", "cost-lines": "cost line", bills: "bill", labour: "labour entry", materials: "materials entry", tasks: "job task", "trade-quotes": "trade quote", "scope-items": "scope item", kpis: "KPI", "kpi-entries": "KPI entry" };
export const singular = (t: string) => SINGULAR[t] ?? t;

/** Handles Claude's tool calls. Prepared changes are pushed onto `pending`. */
export function makeToolHandler(u: CurrentUser, pending: PendingOp[]) {
  const actor = assistantActor(u);
  return async (name: string, input: Record<string, unknown>): Promise<string> => {
    const t = String(input.table ?? "");
    if (!RESOURCES[t] || !AREA[t]) throw new Error(`Unknown table "${t}". Tables: ${readableTables(u).join(", ")}`);
    if (!canRead(u, t)) throw new Error(`This login can't see ${t}.`);
    const fields = (input.fields && typeof input.fields === "object" ? input.fields : {}) as Record<string, unknown>;
    if (name === "find_records") {
      const where = { ...((input.where as object) ?? {}), ...(t === "leads" ? { brand: "DR" } : t === "jobs" ? { brand: "DR" } : t === "directory" ? { business: "DR" } : {}) };
      const out = await listRows(t, { q: input.search as string | undefined, where, limit: Math.min(50, Number(input.limit) || 20), orderBy: { updatedAt: "desc" } as unknown }).catch(() => listRows(t, { q: input.search as string | undefined, where, limit: Math.min(50, Number(input.limit) || 20) }));
      return JSON.stringify(out);
    }
    if (name === "get_record") return JSON.stringify(await getRow(t, String(input.id ?? "")));
    if (name === "prepare_create" || name === "prepare_update") {
      if (!canChange(u, t)) throw new Error(u.role === "TEAM" ? "The shared team login can't change data. Ask the person to sign in with their own login." : `This login can only look at ${t}, not change it.`);
      if (pending.length >= 10) throw new Error("That's 10 changes already. Stop and let the person apply these first.");
      if (name === "prepare_create") {
        const r = await createRow(actor, t, fields, true) as { wouldCreate: Record<string, unknown> };
        const details = Object.entries(r.wouldCreate).map(([field, v]) => ({ field, to: show(v) }));
        pending.push({ kind: "create", table: t, body: fields, label: `New ${singular(t)}: ${nameOf(r.wouldCreate, "untitled")}`, details, reason: input.reason ? String(input.reason).slice(0, 200) : undefined });
        return `Prepared (not saved yet). It's change #${pending.length}; the person will press Apply.`;
      }
      const id = String(input.id ?? "");
      const before = (await getRow(t, id)).row as Record<string, unknown>;
      if ((t === "leads" || t === "jobs") && before.brand !== "DR") throw new Error("That record isn't DR Fitout's.");
      const r = await updateRow(actor, t, id, fields, true) as { changes: Record<string, { from: unknown; to: unknown }> };
      const details = Object.entries(r.changes).map(([field, c]) => ({ field, from: show(c.from), to: show(c.to) }));
      if (!details.length) return "No change: those values are already set.";
      pending.push({ kind: "update", table: t, id, body: fields, label: `Update ${singular(t)}: ${nameOf(before, id)}`, details, reason: input.reason ? String(input.reason).slice(0, 200) : undefined });
      return `Prepared (not saved yet). It's change #${pending.length}; the person will press Apply.`;
    }
    throw new Error(`Unknown tool ${name}`);
  };
}

/** Saves a prepared batch. Permissions are checked again at this moment, as the person who presses Apply. */
export async function applyPending(u: CurrentUser, id: string) {
  const p = await prisma.aiPendingChange.findUnique({ where: { id } });
  if (!p || p.userId !== u.id) throw new Error("Those changes weren't found.");
  if (p.status !== "pending") throw new Error(p.status === "applied" ? "Those changes were already applied." : "Those changes were cancelled.");
  if (Date.now() - p.createdAt.getTime() > 60 * 60 * 1000) throw new Error("Those changes are over an hour old. Ask again so they're prepared from the latest data.");
  const claimed = await prisma.aiPendingChange.updateMany({ where: { id, status: "pending" }, data: { status: "applying" } });
  if (!claimed.count) throw new Error("Those changes are already being applied.");
  const ops = JSON.parse(p.ops) as PendingOp[];
  const actor = assistantActor(u);
  const done: { label: string; ok: boolean; error?: string; link?: string }[] = [];
  for (const op of ops) {
    try {
      if (!canChange(u, op.table)) throw new Error("Your login can't change this");
      let rowId = op.id;
      if (op.kind === "create") { const r = await createRow(actor, op.table, op.body, false) as { created?: { id: string } }; rowId = r.created?.id; }
      else await updateRow(actor, op.table, op.id!, op.body, false);
      done.push({ label: op.label, ok: true, link: linkFor(op.table, rowId) });
    } catch (e) { done.push({ label: op.label, ok: false, error: (e as Error).message }); }
  }
  await prisma.aiPendingChange.update({ where: { id }, data: { status: "applied", result: JSON.stringify(done) } });
  return done;
}

export async function cancelPending(u: CurrentUser, id: string) {
  await prisma.aiPendingChange.updateMany({ where: { id, userId: u.id, status: "pending" }, data: { status: "cancelled" } });
}

function linkFor(table: string, id?: string) {
  if (!id) return undefined;
  const map: Record<string, string> = { leads: `/leads/dr/${id}`, clients: `/clients/${id}`, leases: `/leases/${id}`, concepts: `/concepts/${id}`, jobs: `/jobs/${id}`, notices: "/myday", todos: "/myday", "calendar-events": "/calendar", directory: "/directory" };
  return map[table];
}
