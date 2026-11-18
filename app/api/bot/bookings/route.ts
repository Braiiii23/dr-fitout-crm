import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { botAuth, body, str } from "@/lib/bot-api";
import { audit, bookSlot } from "@/lib/automations";
import { slotLabel } from "@/lib/time";

// Book a free slot for a lead: the booking goes on the lead's call-list row (created if it has none),
// exactly as if a setter booked it, and the lead gets the appointment.
export async function POST(req: Request) {
  const denied = botAuth(req); if (denied) return denied;
  const b = await body(req);
  if (!b) return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  const slotId = str(b.slotId, 60), leadId = str(b.leadId, 60);
  if (!slotId || !leadId) return NextResponse.json({ error: "Give slotId and leadId." }, { status: 400 });
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { calls: true } });
  if (!lead || (lead.brand !== "ENP" && lead.brand !== "DR")) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
  const slot = await prisma.freeSlot.findUnique({ where: { id: slotId } });
  if (!slot) return NextResponse.json({ error: "Slot not found." }, { status: 404 });
  if (slot.status !== "Free" || slot.start <= new Date()) return NextResponse.json({ error: "That slot isn't free any more. Fetch /api/bot/slots again." }, { status: 409 });

  const call = lead.calls[0] ?? await prisma.callListItem.create({
    data: {
      business: lead.brand, contactType: "CLIENT", leadName: lead.leadName ?? lead.company ?? "Lead", company: lead.company, phone: lead.phone, email: lead.email,
      leadInfo: `Booked by the lead bot. ${lead.lookingFor ?? ""}`.slice(0, 2000), leadId: lead.id, addedToCrm: true, callStatus: "To Call",
    },
  });
  try {
    await bookSlot(call.id, slot.id, true);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 409 });
  }
  await prisma.lead.update({ where: { id: lead.id }, data: { appointment: slot.start, ...(lead.stage === "New" ? { stage: "Contacted" } : {}) } });
  await audit("lead bot", "book slot", "Lead", lead.id, slotLabel(slot.start, slot.end));
  return NextResponse.json({ booked: true, leadId: lead.id, slotId: slot.id, start: slot.start.toISOString(), label: slotLabel(slot.start, slot.end) }, { status: 201 });
}
