// The Claude connector: a remote MCP server (Streamable HTTP, JSON responses, no sessions).
// Add it in Claude: Customize > Connectors > Add custom connector, URL https://<crm>/api/mcp,
// request header Authorization: Bearer <CLAUDE_CONNECTOR_KEY>. See docs/CLAUDE_CONNECTOR.md.
// Claude can read everything and create / change records. It can't delete, change the software, or touch logins.
import { NextResponse } from "next/server";
import { agentAuthError, CLAUDE, RESOURCES } from "@/lib/agent-api";
import { runTool } from "@/lib/agent-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPPORTED = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const TABLES = Object.keys(RESOURCES);
const WRITABLE = Object.entries(RESOURCES).filter(([, r]) => r.write).map(([n]) => n);

type Tool = { name: string; title: string; description: string; inputSchema: Record<string, unknown>; annotations: Record<string, unknown> };
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const READ = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

const TOOLS: Tool[] = [
  { name: "crm_overview", title: "CRM overview", annotations: READ, inputSchema: obj({}),
    description: "Start here. The rules, every table, its fields and which fields can be changed. DR Fitout's back-of-house CRM: leads (with category Turnkey fitout / Joint venture / Normal fitout), clients, leases (stages Enquiring → Concept proposing → Sign), concepts, jobs, WIP, estimating, accounts, directory, calendar, to-dos, KPIs." },
  { name: "crm_list", title: "List or search records", annotations: READ,
    description: "List records in a table. q = text search on names, companies, addresses etc. where = Prisma filter object, e.g. {\"status\":\"Concept proposing\"} or {\"category\":\"Turnkey fitout\",\"stage\":\"Quoting\"}. orderBy e.g. {\"updatedAt\":\"desc\"}.",
    inputSchema: obj({ table: { type: "string", enum: TABLES }, q: { type: "string" }, where: { type: "object" }, orderBy: { type: "object" }, limit: { type: "integer", minimum: 1, maximum: 200 }, offset: { type: "integer", minimum: 0 } }, ["table"]) },
  { name: "crm_get", title: "Get one record", annotations: READ, inputSchema: obj({ table: { type: "string", enum: TABLES }, id: { type: "string" } }, ["table", "id"]),
    description: "One record by id." },
  { name: "crm_create", title: "Create a record", annotations: WRITE,
    description: "Create a record. data = the fields (see crm_overview for each table's writable fields). Run with dryRun true first and check wouldCreate, then again with dryRun false. appendNotes inside data adds a dated note. brand is always DR and can't be set. Can't create users.",
    inputSchema: obj({ table: { type: "string", enum: WRITABLE }, data: { type: "object" }, dryRun: { type: "boolean", default: true } }, ["table", "data"]) },
  { name: "crm_update", title: "Change a record", annotations: WRITE,
    description: "Change some fields on a record. Send only the fields to change. Read it first with crm_get. Run with dryRun true first and check changes, then again with dryRun false. Use data.appendNotes to add a dated note instead of replacing notes.",
    inputSchema: obj({ table: { type: "string", enum: WRITABLE }, id: { type: "string" }, data: { type: "object" }, dryRun: { type: "boolean", default: true } }, ["table", "id", "data"]) },
  { name: "crm_lease_dates", title: "Lease key dates", annotations: READ, inputSchema: obj({ days: { type: "integer", minimum: 1, maximum: 730 } }),
    description: "Upcoming lease key dates across all leases: option notice deadlines, rent reviews, expiries and starts (default next 180 days, plus anything up to 30 days overdue)." },
  { name: "crm_wip", title: "WIP for every job", annotations: READ, inputSchema: obj({}),
    description: "Every job's WIP: progress, claims and when to issue them, costs, what's owed, forecast GP, actual profit, flags." },
  { name: "crm_accounts", title: "Accounts summary", annotations: READ, inputSchema: obj({}),
    description: "Cash, profit and loss, live profit this month, receivables, bills due, work on the books, 13-week cash forecast (from Xero)." },
  { name: "crm_concept_fit", title: "Fit a concept to a tenancy", annotations: WRITE,
    inputSchema: obj({ leaseId: { type: "string" }, conceptId: { type: "string" }, brief: { type: "string", description: "Optional changes, e.g. '5 consult rooms not 6'" } }, ["leaseId", "conceptId"]),
    description: "Run the AI concept fit: lays one of our concepts out on the lease's tenancy floor plan (the lease needs a file of kind 'floor plan'). Saves the result on the lease and moves an Enquiring lease to Concept proposing. Takes up to a couple of minutes." },
  { name: "crm_refresh_xero", title: "Refresh from Xero", annotations: WRITE, inputSchema: obj({}),
    description: "Pull the latest bank, invoices, bills and P&L from Xero now." },
];

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handle(m: Rpc): Promise<unknown | null> {
  const isNote = m.id === undefined || m.id === null;
  switch (m.method) {
    case "initialize": {
      const asked = String(m.params?.protocolVersion ?? "");
      return ok(m.id, {
        protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "dr-fitout-crm", title: "DR Fitout CRM", version: "2.1.0" },
        instructions: "DR Fitout's back-of-house CRM. Call crm_overview first. Read before you change, dry-run every create/update, never invent values. Deleting, user accounts and software changes are not available.",
      });
    }
    case "ping": return ok(m.id, {});
    case "tools/list": return ok(m.id, { tools: TOOLS });
    case "tools/call": {
      const name = String(m.params?.name ?? "");
      if (!TOOLS.some((t) => t.name === name)) return fail(m.id, -32602, `Unknown tool: ${name}`);
      try {
        const out = await runTool(CLAUDE, name, (m.params?.arguments ?? {}) as Record<string, unknown>);
        const text = JSON.stringify(out, null, 1);
        return ok(m.id, { content: [{ type: "text", text: text.length > 200000 ? `${text.slice(0, 200000)}\n…(cut short: use limit/offset or a narrower where)` : text }], isError: false });
      } catch (e) {
        return ok(m.id, { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true });
      }
    }
    default:
      if (isNote) return null; // notifications/initialized and friends: nothing to send back
      return fail(m.id, -32601, `Method not found: ${m.method}`);
  }
}

const headers = { "Cache-Control": "no-store" };
export async function POST(req: Request) {
  const denied = agentAuthError(req, CLAUDE);
  if (denied) return NextResponse.json(fail(null, -32001, denied.error), { status: denied.status, headers });
  const body = (await req.json().catch(() => null)) as Rpc | Rpc[] | null;
  if (!body) return NextResponse.json(fail(null, -32700, "Parse error"), { status: 400, headers });
  const list = Array.isArray(body) ? body : [body];
  const out = (await Promise.all(list.map(handle))).filter((x) => x !== null);
  if (!out.length) return new Response(null, { status: 202, headers });
  return NextResponse.json(Array.isArray(body) ? out : out[0], { headers });
}
// No server-to-client stream and no sessions.
export async function GET() { return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } }); }
export async function DELETE() { return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } }); }
