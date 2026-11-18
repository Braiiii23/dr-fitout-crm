// The Grok API: Grok (an xAI agent) working on the CRM over plain REST, with GROK_ADMIN_KEY.
// Same rules as the Claude connector: read everything, create and change records, never delete, no users, no software changes.
// See docs/GROK_API.md.
import { NextResponse } from "next/server";
import { agentAuthError, GROK, createRow, getRow, listRows, overview, updateRow } from "@/lib/agent-api";
import { runTool } from "@/lib/agent-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
type Ctx = { params: Promise<{ path?: string[] }> };

const json = (d: unknown, status = 200) => NextResponse.json(d, { status, headers: { "Cache-Control": "no-store" } });
const err = (e: unknown, status = 400) => json({ ok: false, error: (e as Error).message }, (e as Error).message === "Not found" ? 404 : status);
const ACTIONS: Record<string, string> = { "lease-dates": "crm_lease_dates", wip: "crm_wip", accounts: "crm_accounts", "concept-fit": "crm_concept_fit", "refresh-xero": "crm_refresh_xero" };
const parse = (v: string | null) => { if (!v) return undefined; try { return JSON.parse(v); } catch { throw new Error("where / orderBy must be JSON"); } };

async function guard(req: Request) { const d = agentAuthError(req, GROK); return d ? json({ ok: false, error: d.error }, d.status) : null; }

export async function GET(req: Request, ctx: Ctx) {
  const denied = await guard(req); if (denied) return denied;
  const [a, b] = (await ctx.params).path ?? [];
  const sp = new URL(req.url).searchParams;
  try {
    if (!a) return json({ ok: true, ...overview(GROK), endpoints: {
      "GET /api/grok/{table}?q=&where={json}&orderBy={json}&limit=&offset=": "List records (q = text search; where = Prisma filter).",
      "GET /api/grok/{table}/{id}": "One record.",
      "POST /api/grok/{table}?dryRun=1": "Create (JSON body of fields). Without dryRun=1 it saves.",
      "PATCH /api/grok/{table}/{id}?dryRun=1": "Change fields (JSON body). appendNotes adds a dated (Grok) note.",
      "GET /api/grok/actions/lease-dates?days=180 | wip | accounts": "Lease key dates; WIP for every job; accounts summary.",
      "POST /api/grok/actions/concept-fit": "{ leaseId, conceptId, brief? } AI concept fit on the lease's floor plan.",
      "POST /api/grok/actions/refresh-xero": "Pull the latest from Xero.",
    } });
    if (a === "actions") { if (!ACTIONS[b] || ["concept-fit", "refresh-xero"].includes(b)) return json({ ok: false, error: "Unknown action (or use POST)." }, 404); return json({ ok: true, ...(await runTool(GROK, ACTIONS[b], { days: Number(sp.get("days")) || undefined }) as object) }); }
    if (b) return json({ ok: true, ...(await getRow(a, b)) });
    return json({ ok: true, ...(await listRows(a, { q: sp.get("q") ?? undefined, where: parse(sp.get("where")), orderBy: parse(sp.get("orderBy")), limit: Number(sp.get("limit")) || undefined, offset: Number(sp.get("offset")) || undefined })) });
  } catch (e) { return err(e); }
}

export async function POST(req: Request, ctx: Ctx) {
  const denied = await guard(req); if (denied) return denied;
  const [a, b] = (await ctx.params).path ?? [];
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, error: "Send a JSON object" }, 400);
  try {
    if (a === "actions") { if (!ACTIONS[b]) return json({ ok: false, error: "Unknown action" }, 404); return json({ ok: true, ...(await runTool(GROK, ACTIONS[b], body) as object) }); }
    if (!a || b) return json({ ok: false, error: "POST /api/grok/{table} to create" }, 404);
    const out = await createRow(GROK, a, body, new URL(req.url).searchParams.get("dryRun") === "1");
    return json({ ok: true, ...out }, out.created ? 201 : 200);
  } catch (e) { return err(e); }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const denied = await guard(req); if (denied) return denied;
  const [a, b] = (await ctx.params).path ?? [];
  if (!a || !b) return json({ ok: false, error: "PATCH /api/grok/{table}/{id}" }, 404);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, error: "Send a JSON object of fields" }, 400);
  try { return json({ ok: true, ...(await updateRow(GROK, a, b, body, new URL(req.url).searchParams.get("dryRun") === "1")) }); }
  catch (e) { return err(e); }
}

/** No deleting through Grok. */
export async function DELETE(req: Request) {
  const denied = await guard(req); if (denied) return denied;
  return json({ ok: false, error: "Grok can't delete records. Ask the admin." }, 403);
}
