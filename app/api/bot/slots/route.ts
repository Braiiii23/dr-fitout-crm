import { prisma } from "@/lib/db";
import { botAuth, json, body, str, when } from "@/lib/bot-api";
import { audit } from "@/lib/automations";
import { slotLabel } from "@/lib/time";

const out = (s: { id: string; externalId: string | null; start: Date; end: Date; status: string }) => ({ id: s.id, externalId: s.externalId, start: s.start.toISOString(), end: s.end.toISOString(), label: slotLabel(s.start, s.end), status: s.status });

// GET /api/bot/slots?days=30&status=free|booked|all   Bookable slots (default: free ones in the next 30 days).
export async function GET(req: Request) {
  const denied = botAuth(req); if (denied) return denied;
  const sp = new URL(req.url).searchParams;
  const days = Math.min(120, Math.max(1, Number(sp.get("days")) || 30));
  const status = sp.get("status") ?? "free";
  const slots = await prisma.freeSlot.findMany({
    where: { start: { gt: new Date(), lt: new Date(Date.now() + days * 86400000) }, ...(status === "all" ? {} : { status: status === "booked" ? "Booked" : "Free" }) },
    orderBy: { start: "asc" }, take: 500,
  });
  return json({ timezone: "Australia/Brisbane", slots: slots.map(out) });
}

// POST /api/bot/slots   { "start": ISO, "end": ISO, "externalId": "calendar event id" }
// Adds a slot. With an externalId that already exists, updates that slot instead (only while it's still free).
export async function POST(req: Request) {
  const denied = botAuth(req); if (denied) return denied;
  const b = await body(req);
  const start = when(b?.start), end = when(b?.end), externalId = str(b?.externalId, 200);
  if (!start || !end || end <= start) return json({ error: "Send start and end as ISO date-times, end after start (e.g. 2026-11-12T09:00:00+10:00)." }, 400);
  if (end.getTime() - start.getTime() > 12 * 3600000) return json({ error: "A slot can't be longer than 12 hours." }, 400);
  if (externalId) {
    const existing = await prisma.freeSlot.findUnique({ where: { externalId } });
    if (existing) {
      if (existing.status !== "Free") return json({ error: "That slot is booked, so it wasn't changed.", slot: out(existing) }, 409);
      const s = await prisma.freeSlot.update({ where: { id: existing.id }, data: { start, end, label: slotLabel(start, end) } });
      await audit("lead bot", "update slot", "FreeSlot", s.id, s.label);
      return json({ updated: true, slot: out(s) });
    }
  }
  const clash = await prisma.freeSlot.findFirst({ where: { start: { lt: end }, end: { gt: start } } });
  if (clash) return json({ error: "That time overlaps an existing slot.", slot: out(clash) }, 409);
  const s = await prisma.freeSlot.create({ data: { start, end, label: slotLabel(start, end), status: "Free", externalId } });
  await audit("lead bot", "add slot", "FreeSlot", s.id, s.label);
  return json({ created: true, slot: out(s) }, 201);
}
