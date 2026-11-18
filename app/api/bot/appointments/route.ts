import { prisma } from "@/lib/db";
import { botAuth, json, isoDate } from "@/lib/bot-api";
import { slotLabel } from "@/lib/time";

// GET /api/bot/appointments?from=YYYY-MM-DD&to=YYYY-MM-DD&invited=false
// Appointments booked on the call list (by setters or the bot), with whether the calendar invite has gone out.
export async function GET(req: Request) {
  const denied = botAuth(req); if (denied) return denied;
  const sp = new URL(req.url).searchParams;
  const from = isoDate(sp.get("from")), to = isoDate(sp.get("to"));
  const invited = sp.get("invited");
  const calls = await prisma.callListItem.findMany({
    where: {
      appointment: { gte: from ? new Date(from + "T00:00:00+10:00") : new Date(Date.now() - 86400000), ...(to ? { lt: new Date(new Date(to + "T00:00:00+10:00").getTime() + 86400000) } : {}) },
      ...(invited === "false" ? { inviteSentAt: null } : invited === "true" ? { inviteSentAt: { not: null } } : {}),
    },
    include: { setter: { select: { name: true } }, slot: true },
    orderBy: { appointment: "asc" }, take: 300,
  });
  return json({
    timezone: "Australia/Brisbane",
    appointments: calls.map((c) => ({
      callId: c.id, leadId: c.leadId, business: c.business, status: c.callStatus,
      start: c.appointment!.toISOString(), end: c.slot ? c.slot.end.toISOString() : null, label: c.slot ? slotLabel(c.slot.start, c.slot.end) : null,
      name: c.leadName, company: c.company, phone: c.phone, email: c.email, setter: c.setter?.name ?? c.assignedSetter ?? null,
      notes: c.callNotes, inviteSent: !!c.inviteSentAt, inviteSentAt: c.inviteSentAt?.toISOString() ?? null,
    })),
  });
}
