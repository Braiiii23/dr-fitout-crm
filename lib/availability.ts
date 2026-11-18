import "server-only";
import { prisma } from "./db";
import { BRAIDEN_EMAIL } from "./auth";
import { slotLabel } from "./time";
import { bneToday, addDays, bneStart } from "./myday";

// Booking availability comes from Braiden's calendar: his working hours, minus anything already in his calendar
// (CRM events, Google events, all-day leave, meetings already booked). Bookable times are kept as Free slots so every
// existing way of booking (setters, the lead bot, Grok) works unchanged. Booked slots are never touched.

export type Availability = { enabled: boolean; ownerEmail: string; days: number[]; start: string; end: string; length: number; gap: number; noticeHours: number; horizonDays: number };
const KEY = "availability";
export const DEFAULT_AVAILABILITY: Availability = { enabled: true, ownerEmail: BRAIDEN_EMAIL, days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", length: 60, gap: 15, noticeHours: 24, horizonDays: 21 };

export async function getAvailability(): Promise<Availability> {
  const r = await prisma.integrationSetting.findUnique({ where: { key: KEY } });
  return { ...DEFAULT_AVAILABILITY, ...(r ? JSON.parse(r.value) : {}) };
}
export async function saveAvailability(a: Availability) {
  await prisma.integrationSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: JSON.stringify(a) }, update: { value: JSON.stringify(a) } });
}
export async function ownerUser() {
  const a = await getAvailability();
  return prisma.user.findFirst({ where: { email: a.ownerEmail, active: true }, select: { id: true, name: true, email: true } });
}

const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Open times in the owner's calendar for the next `horizonDays`, as [start, end) pairs. */
export async function openTimes(a: Availability) {
  const owner = await prisma.user.findFirst({ where: { email: a.ownerEmail }, select: { id: true } });
  const today = bneToday();
  const from = bneStart(today), to = bneStart(addDays(today, a.horizonDays + 1));
  const events = owner ? await prisma.calEvent.findMany({ where: { userId: owner.id, start: { lt: to }, end: { gt: from } }, select: { start: true, end: true, allDay: true } }) : [];
  const booked = await prisma.freeSlot.findMany({ where: { status: "Booked", end: { gt: from }, start: { lt: to } }, select: { start: true, end: true } });
  const appts = await prisma.callListItem.findMany({ where: { appointment: { gte: from, lt: to }, slotId: null }, select: { appointment: true } });
  const gapMs = a.gap * 60000;
  const busy = [
    ...events.map((e) => (e.allDay ? { s: bneStart(new Date(e.start.getTime() + 10 * 3600000).toISOString().slice(0, 10)).getTime(), e: e.end.getTime() + 60000 } : { s: e.start.getTime() - gapMs, e: e.end.getTime() + gapMs })),
    ...booked.map((b) => ({ s: b.start.getTime() - gapMs, e: b.end.getTime() + gapMs })),
    ...appts.map((x) => ({ s: x.appointment!.getTime() - gapMs, e: x.appointment!.getTime() + 3600000 + gapMs })),
  ];
  const earliest = Date.now() + a.noticeHours * 3600000;
  const out: { start: Date; end: Date }[] = [];
  for (let d = 0; d <= a.horizonDays; d++) {
    const day = addDays(today, d);
    const wd = new Date(day + "T00:00:00Z").getUTCDay(); // 0 = Sunday
    if (!a.days.includes(wd)) continue;
    const dayStart = bneStart(day).getTime();
    for (let m = mins(a.start); m + a.length <= mins(a.end); m += a.length + a.gap) {
      const s = dayStart + m * 60000, e = s + a.length * 60000;
      if (s < earliest) continue;
      if (busy.some((b) => s < b.e && e > b.s)) continue;
      out.push({ start: new Date(s), end: new Date(e) });
    }
  }
  return out;
}

/** Bring the Free slots in line with the owner's calendar. Booked slots are left alone. */
export async function syncAvailability() {
  const a = await getAvailability();
  if (!a.enabled) return { created: 0, removed: 0, open: 0 };
  const open = await openTimes(a);
  const want = new Map(open.map((o) => [`auto:${o.start.toISOString()}`, o]));
  const existing = await prisma.freeSlot.findMany({ where: { status: "Free", start: { gt: new Date() } }, select: { id: true, externalId: true } });
  // Free slots that aren't (or are no longer) open times go, including old hand-made ones: the calendar is the source now.
  const stale = existing.filter((s) => !s.externalId || !want.has(s.externalId)).map((s) => s.id);
  if (stale.length) await prisma.freeSlot.deleteMany({ where: { id: { in: stale }, status: "Free" } });
  const have = new Set(existing.map((s) => s.externalId));
  let created = 0;
  for (const [ext, o] of want) {
    if (have.has(ext)) continue;
    try { await prisma.freeSlot.create({ data: { externalId: ext, start: o.start, end: o.end, label: slotLabel(o.start, o.end), status: "Free" } }); created++; }
    catch { /* already there (another sync ran at the same time) */ }
  }
  // Old Free slots in the past are no use to anyone.
  await prisma.freeSlot.deleteMany({ where: { status: "Free", end: { lt: new Date() } } });
  return { created, removed: stale.length, open: open.length };
}

/** Run a sync if the owner's calendar just changed (cheap: database only). */
export async function syncAvailabilityFor(userId: string) {
  const owner = await ownerUser();
  if (owner && owner.id === userId) await syncAvailability();
}
