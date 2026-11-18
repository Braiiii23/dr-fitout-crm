import { grokAuth, json, RESOURCES, coerce, delegate, afterWrite, grokAudit, diff, notesField, appendTo } from "@/lib/grok-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ resource: string; id: string }> };

/** GET /api/grok/{resource}/{id} */
export async function GET(req: Request, ctx: Ctx) {
  const denied = grokAuth(req); if (denied) return denied;
  const { resource, id } = await ctx.params; const r = RESOURCES[resource];
  if (!r) return json({ ok: false, error: "Unknown resource" }, 404);
  const row = await delegate(r.model).findUnique({ where: { id } });
  return row ? json({ ok: true, row }) : json({ ok: false, error: "Not found" }, 404);
}

/** PATCH /api/grok/{resource}/{id} — change fields. appendNotes adds a dated note. ?dryRun=1 shows the change without saving. */
export async function PATCH(req: Request, ctx: Ctx) {
  const denied = grokAuth(req); if (denied) return denied;
  const { resource, id } = await ctx.params; const r = RESOURCES[resource];
  if (!r) return json({ ok: false, error: "Unknown resource" }, 404);
  if (!r.write) return json({ ok: false, error: `${resource} is read only` }, 403);
  const before = await delegate(r.model).findUnique({ where: { id } });
  if (!before) return json({ ok: false, error: "Not found" }, 404);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, error: "Send a JSON object of fields" }, 400);
  const { data, errors } = coerce(r.model, body, false);
  if (r.model === "Concept" && body.rooms !== undefined && typeof body.rooms !== "string") data.rooms = JSON.stringify(body.rooms);
  const nf = notesField(r.model);
  if (body.appendNotes) { if (!nf) errors.push(`${resource} has no notes field`); else data[nf] = appendTo((data[nf] as string | undefined) ?? before[nf], body.appendNotes); }
  if (errors.length) return json({ ok: false, errors }, 400);
  const changes = diff(before, data);
  if (new URL(req.url).searchParams.get("dryRun") === "1") return json({ ok: true, dryRun: true, changes });
  if (!Object.keys(changes).length) return json({ ok: true, changes: {}, note: "Nothing to change" });
  try {
    await delegate(r.model).update({ where: { id }, data });
    await afterWrite(r.model, id, before);
    await grokAudit("update", r.model, id, Object.keys(changes).join(", "));
    return json({ ok: true, changes, row: await delegate(r.model).findUnique({ where: { id } }) });
  } catch (e) { return json({ ok: false, error: `Couldn't save: ${(e as Error).message.split("\n").slice(-1)[0]}` }, 400); }
}

/** No deleting through Grok. */
export async function DELETE() { return json({ ok: false, error: "Grok can't delete records. Ask the admin." }, 403); }
