import { prisma } from "@/lib/db";
import { addDays, bneStart } from "@/lib/myday";
import { getAvailability, ownerUser, syncAvailability } from "@/lib/availability";
import { WeekCalendar, type CalItem } from "@/components/MyDayBits";

/** Braiden's calendar for setters: his busy times (no details) and the open times they can book. */
export default async function OwnerAvailability({ week, baseHref, setterId }: { week: string; baseHref: string; setterId: string | null }) {
  await syncAvailability();
  const [a, owner] = await Promise.all([getAvailability(), ownerUser()]);
  if (!owner) return null;
  const from = bneStart(week), to = bneStart(addDays(week, 7));
  const [events, slots, myCalls] = await Promise.all([
    prisma.calEvent.findMany({ where: { userId: owner.id, start: { lt: to }, end: { gt: from } }, select: { id: true, start: true, end: true, allDay: true } }),
    prisma.freeSlot.findMany({ where: { start: { gte: from, lt: to } }, include: { bookings: { select: { leadName: true, company: true, setterId: true } } }, orderBy: { start: "asc" } }),
    setterId ? prisma.callListItem.findMany({ where: { setterId, slotId: null, callStatus: { notIn: ["Not Interested", "Do Not Call"] } }, select: { id: true, leadName: true, company: true }, orderBy: { updatedAt: "desc" }, take: 200 }) : Promise.resolve([]),
  ]);
  const now = new Date();
  const items: CalItem[] = [
    ...events.map((e) => ({ id: `busy-${e.id}`, title: "Busy", start: e.start, end: e.end, allDay: e.allDay, tag: "Busy", colour: "#6b7280" })),
    ...slots.filter((s) => s.status === "Booked").map((s) => {
      const mine = s.bookings.find((b) => b.setterId === setterId);
      return { id: `bk-${s.id}`, title: mine ? `Booked: ${mine.leadName ?? ""}${mine.company ? ` (${mine.company})` : ""}` : "Booked", start: s.start, end: s.end, allDay: false, tag: "Booked", colour: "#f59e0b" };
    }),
    ...slots.filter((s) => s.status === "Free" && s.start > now).map((s) => ({ id: `open-${s.id}`, title: "Available", start: s.start, end: s.end, allDay: false, tag: "Open", colour: "#16a34a", slotId: s.id })),
  ];
  const openCount = slots.filter((s) => s.status === "Free" && s.start > now).length;
  return (
    <section className="card acc-pad">
      <div className="acc-head"><h2 className="est-h2">{owner.name.split(" ")[0]}&apos;s calendar</h2><span className="acc-muted">{openCount} open time{openCount === 1 ? "" : "s"} this week · green = available to book ({a.length} min). Tap one to book a meeting.</span></div>
      <WeekCalendar week={week} items={items} baseHref={baseHref} bookCalls={myCalls.map((c) => ({ id: c.id, label: `${c.leadName ?? "Unnamed"}${c.company ? ` (${c.company})` : ""}` }))} />
    </section>
  );
}
