import type { NextRequest } from "next/server";
import type { FreeSlot } from "@prisma/client";
import { prisma } from "@/lib/db";
import { asList, assertInternalAuth, compact, dateTime, jsonErr, jsonOk, pick, readJson, str } from "@/lib/internal-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const slotOut = (s: FreeSlot & { _count?: { bookings: number } }) => ({
  id: s.id,
  externalId: s.externalId,
  label: s.label,
  start: s.start,
  end: s.end,
  status: s.status,
  bookings: s._count?.bookings ?? undefined,
});

/** GET /api/internal/slots?scope=upcoming|all&status=Free  (default upcoming = end >= now) */
export async function GET(req: NextRequest) {
  const denied = assertInternalAuth(req);
  if (denied) return denied;
  const sp = req.nextUrl.searchParams;
  const scope = (sp.get("scope") || "upcoming").toLowerCase();
  const status = sp.get("status")?.trim();
  const rows = await prisma.freeSlot.findMany({
    where: {
      ...(scope === "all" ? {} : { end: { gte: new Date() } }),
      ...(status ? { status } : {}),
    },
    include: { _count: { select: { bookings: true } } },
    orderBy: { start: "asc" },
    take: 1000,
  });
  return jsonOk({ count: rows.length, slots: rows.map(slotOut) });
}

function normStatus(v: unknown) {
  const s = str(v);
  if (s === undefined || s === null) return undefined;
  if (/^free$/i.test(s)) return "Free";
  if (/^booked$/i.test(s)) return "Booked";
  throw new Error(`status must be Free | Booked (got "${s}")`);
}

/**
 * POST { slots: [...], replaceAll?: boolean } — upsert by externalId.
 * replaceAll: true deletes slots whose externalId is NOT in the payload (only if every item has an externalId
 * and none failed). Slots with bookings are unlinked from calls first (CallListItem.slotId set null) — they are reported.
 */
export async function POST(req: NextRequest) {
  const denied = assertInternalAuth(req);
  if (denied) return denied;
  const body = await readJson<Record<string, unknown>>(req);
  const items = asList(body, "slots");
  const replaceAll = !!body && !Array.isArray(body) && body.replaceAll === true;
  if (!items) return jsonErr("Body must be { slots: [...] }", 400);
  if (items.length > 2000) return jsonErr("Max 2000 slots per request", 413);
  if (replaceAll && !items.length) return jsonErr("replaceAll with an empty slots array refused (would wipe every slot)", 400);

  const results: Record<string, unknown>[] = [];
  const seen: string[] = [];
  let created = 0, updated = 0, failed = 0;

  for (const [i, o] of items.entries()) {
    try {
      if (!o || typeof o !== "object") throw new Error("slot must be an object");
      const p = (...k: string[]) => pick(o, ...k);
      const externalId = str(p("externalId", "airtableId", "Airtable ID")) ?? null;
      const start = dateTime(p("start", "Start"));
      const end = dateTime(p("end", "End"));
      if (start === null || end === null) throw new Error("start/end cannot be null");
      const data = compact({ label: str(p("label", "Label", "name")) ?? undefined, start, end, status: normStatus(p("status", "Status")) });
      if (start && end && end <= start) throw new Error("end must be after start");

      const existing = externalId ? await prisma.freeSlot.findUnique({ where: { externalId } }) : null;
      if (externalId) seen.push(externalId);
      if (existing) {
        const row = await prisma.freeSlot.update({ where: { id: existing.id }, data });
        updated++;
        results.push({ index: i, action: "updated", slot: slotOut(row) });
      } else {
        if (!data.start || !data.end) throw new Error("start and end (ISO) are required to create a slot");
        const label = data.label ?? `${data.start.toISOString()} – ${data.end.toISOString()}`;
        const row = await prisma.freeSlot.create({ data: { ...data, start: data.start, end: data.end, label, externalId } });
        created++;
        results.push({ index: i, action: "created", slot: slotOut(row) });
      }
    } catch (e) {
      failed++;
      results.push({ index: i, action: "error", error: e instanceof Error ? e.message.split("\n").pop() : String(e) });
    }
  }

  let deleted = 0;
  let replaceSkipped: string | undefined;
  if (replaceAll) {
    if (failed) replaceSkipped = "some slots failed — replaceAll skipped, nothing deleted";
    else if (seen.length !== items.length) replaceSkipped = "every slot needs an externalId for replaceAll — nothing deleted";
    else {
      const stale = await prisma.freeSlot.findMany({ where: { OR: [{ externalId: null }, { externalId: { notIn: seen } }] }, select: { id: true } });
      const ids = stale.map((s) => s.id);
      if (ids.length) {
        await prisma.$transaction([
          prisma.callListItem.updateMany({ where: { slotId: { in: ids } }, data: { slotId: null } }),
          prisma.freeSlot.deleteMany({ where: { id: { in: ids } } }),
        ]);
      }
      deleted = ids.length;
    }
  }
  return jsonOk({ created, updated, failed, deleted, replaceAll, ...(replaceSkipped ? { replaceSkipped } : {}), results }, failed && !created && !updated ? 400 : 200);
}
