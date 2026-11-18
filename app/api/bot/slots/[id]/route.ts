import { prisma } from "@/lib/db";
import { botAuth, json, body, when } from "@/lib/bot-api";
import { audit } from "@/lib/automations";
import { slotLabel } from "@/lib/time";

// {id} is the slot id, or "ext:<calendar event id>" for a slot added with an externalId.
async function find(id: string) {
  return id.startsWith("ext:") ? prisma.freeSlot.findUnique({ where: { externalId: id.slice(4) } }) : prisma.freeSlot.findUnique({ where: { id } });
}

// PATCH /api/bot/slots/{id}   { "start": ISO, "end": ISO }   Only free slots can be moved; booked ones are never touched.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = botAuth(req); if (denied) return denied;
  const slot = await find((await ctx.params).id);
  if (!slot) return json({ error: "Slot not found." }, 404);
  if (slot.status !== "Free") return json({ error: "That slot is booked, so it wasn't changed." }, 409);
  const b = await body(req);
  const start = when(b?.start) ?? slot.start, end = when(b?.end) ?? slot.end;
  if (end <= start) return json({ error: "End must be after start." }, 400);
  const clash = await prisma.freeSlot.findFirst({ where: { id: { not: slot.id }, start: { lt: end }, end: { gt: start } } });
  if (clash) return json({ error: "That time overlaps another slot." }, 409);
  const s = await prisma.freeSlot.update({ where: { id: slot.id }, data: { start, end, label: slotLabel(start, end) } });
  await audit("lead bot", "update slot", "FreeSlot", s.id, s.label);
  return json({ updated: true, slot: { id: s.id, externalId: s.externalId, start: s.start.toISOString(), end: s.end.toISOString(), label: s.label, status: s.status } });
}

// DELETE /api/bot/slots/{id}   Only free slots can be removed; booked ones are never touched.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = botAuth(req); if (denied) return denied;
  const slot = await find((await ctx.params).id);
  if (!slot) return json({ error: "Slot not found." }, 404);
  if (slot.status !== "Free") return json({ error: "That slot is booked, so it wasn't removed." }, 409);
  const res = await prisma.freeSlot.deleteMany({ where: { id: slot.id, status: "Free" } });
  if (!res.count) return json({ error: "It was booked a moment ago, so it wasn't removed." }, 409);
  await audit("lead bot", "remove slot", "FreeSlot", slot.id, slot.label);
  return json({ removed: true, id: slot.id });
}
