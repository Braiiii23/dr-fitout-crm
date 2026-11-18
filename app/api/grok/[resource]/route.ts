import { grokAuth, json, RESOURCES, coerce, delegate, afterWrite, grokAudit, scalarFields, notesField, appendTo, FIXED } from "@/lib/grok-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ resource: string }> };

/** GET /api/grok/{resource} — list records. */
export async function GET(req: Request, ctx: Ctx) {
  const denied = grokAuth(req); if (denied) return denied;
  const r = RESOURCES[(await ctx.params).resource];
  if (!r) return json({ ok: false, error: "Unknown resource. GET /api/grok lists them." }, 404);
  const sp = new URL(req.url).searchParams;
  let where: Record<string, unknown> = {}; let orderBy: unknown = undefined;
  try { if (sp.get("where")) where = JSON.parse(sp.get("where")!); if (sp.get("orderBy")) orderBy = JSON.parse(sp.get("orderBy")!); }
  catch { return json({ ok: false, error: "where / orderBy must be JSON" }, 400); }
  const q = (sp.get("q") ?? "").trim();
  if (q) {
    const textFields = scalarFields(r.model).filter((f) => f.type === "String" && /name|company|title|trade|supplier|client|email|phone|description|person|invoiceNumber|jobNumber/i.test(f.name)).map((f) => f.name);
    where = { AND: [where, { OR: textFields.map((f) => ({ [f]: { contains: q } })) }] };
  }
  const take = Math.min(500, Math.max(1, Number(sp.get("limit")) || 100)), skip = Math.max(0, Number(sp.get("offset")) || 0);
  try {
    const [rows, total] = await Promise.all([delegate(r.model).findMany({ where, ...(orderBy ? { orderBy } : {}), take, skip }), delegate(r.model).count({ where })]);
    return json({ ok: true, total, count: rows.length, offset: skip, rows });
  } catch (e) { return json({ ok: false, error: `Query failed: ${(e as Error).message.split("\n").slice(-1)[0]}` }, 400); }
}

/** POST /api/grok/{resource} — create a record. ?dryRun=1 checks it without saving. */
export async function POST(req: Request, ctx: Ctx) {
  const denied = grokAuth(req); if (denied) return denied;
  const name = (await ctx.params).resource; const r = RESOURCES[name];
  if (!r) return json({ ok: false, error: "Unknown resource" }, 404);
  if (!r.write) return json({ ok: false, error: `${name} is read only` }, 403);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, error: "Send a JSON object of fields" }, 400);
  const { data, errors } = coerce(r.model, body, true);
  const nf = notesField(r.model);
  if (nf && body.appendNotes) data[nf] = appendTo(data[nf] as string | null, body.appendNotes);
  Object.assign(data, FIXED[r.model] ?? {});
  if (r.model === "Concept" && body.rooms !== undefined && typeof body.rooms !== "string") data.rooms = JSON.stringify(body.rooms);
  if (errors.length) return json({ ok: false, errors }, 400);
  if (new URL(req.url).searchParams.get("dryRun") === "1") return json({ ok: true, dryRun: true, wouldCreate: data });
  try {
    const row = await delegate(r.model).create({ data });
    await afterWrite(r.model, row.id, null);
    await grokAudit("create", r.model, row.id, Object.keys(data).join(", "));
    return json({ ok: true, created: await delegate(r.model).findUnique({ where: { id: row.id } }) }, 201);
  } catch (e) { return json({ ok: false, error: `Couldn't create: ${(e as Error).message.split("\n").slice(-1)[0]}` }, 400); }
}
