import { prisma } from "@/lib/db";
import { toIcs } from "@/lib/myday";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /cal/{token} — one person's CRM calendar as an .ics feed, for Google / Outlook / Apple to subscribe to.
 *  The token is private to that person (it's in their My Day page) and only gives read access to their own events. */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const token = (await ctx.params).token.replace(/\.ics$/, "");
  if (!/^[A-Za-z0-9_-]{24,}$/.test(token)) return new Response("Not found", { status: 404 });
  const u = await prisma.user.findFirst({ where: { calFeedToken: token, active: true }, select: { id: true, name: true } });
  if (!u) return new Response("Not found", { status: 404 });
  const events = await prisma.calEvent.findMany({ where: { userId: u.id, source: "crm", start: { gte: new Date(Date.now() - 60 * 86400000) } }, orderBy: { start: "asc" }, take: 2000 });
  // The calendar owner's feed also carries the meetings setters booked with him, so they show in his Google Calendar.
  const owner = await (await import("@/lib/availability")).ownerUser();
  if (owner?.id === u.id) {
    const appts = await prisma.callListItem.findMany({ where: { appointment: { gte: new Date(Date.now() - 60 * 86400000) } }, select: { id: true, leadName: true, company: true, phone: true, appointment: true, assignedSetter: true, updatedAt: true, slot: { select: { end: true } } } });
    for (const a of appts) events.push({ id: `appt-${a.id}`, userId: u.id, title: `Meeting: ${a.leadName ?? ""}${a.company ? ` (${a.company})` : ""}`, start: a.appointment!, end: a.slot?.end ?? new Date(a.appointment!.getTime() + 3600000), allDay: false, location: null, notes: [a.phone && `Phone: ${a.phone}`, a.assignedSetter && `Booked by ${a.assignedSetter}`].filter(Boolean).join("\n") || null, private: false, source: "crm", externalId: null, createdAt: a.updatedAt, updatedAt: a.updatedAt });
  }
  return new Response(toIcs(u.name, events), { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": `inline; filename="crm-calendar.ics"` } });
}
