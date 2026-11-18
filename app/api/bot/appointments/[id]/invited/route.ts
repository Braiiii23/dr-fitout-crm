import { prisma } from "@/lib/db";
import { botAuth, json, body } from "@/lib/bot-api";
import { audit } from "@/lib/automations";

// POST /api/bot/appointments/{callId}/invited   { "invited": true }   (false clears it)
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = botAuth(req); if (denied) return denied;
  const { id } = await ctx.params;
  const b = await body(req);
  const on = b?.invited !== false;
  const call = await prisma.callListItem.findUnique({ where: { id }, select: { appointment: true } });
  if (!call) return json({ error: "Appointment not found." }, 404);
  if (!call.appointment) return json({ error: "That call has no appointment booked." }, 409);
  await prisma.callListItem.update({ where: { id }, data: { inviteSentAt: on ? new Date() : null } });
  await audit("lead bot", on ? "invite sent" : "invite cleared", "CallListItem", id);
  return json({ callId: id, inviteSent: on });
}
