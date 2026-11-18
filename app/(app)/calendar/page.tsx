import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { bneToday, addDays, mondayOf, bneStart } from "@/lib/myday";
import { WeekCalendar, MonthCalendar, monthGridStart, colourFor, type CalItem } from "@/components/MyDayBits";
import { getAvailability, ownerUser } from "@/lib/availability";
import { saveAvailabilityAction, rebuildAvailability } from "./actions";

// Team calendar: everyone's meetings in one week (private ones show as "Busy").
export default async function TeamCalendar({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireUser(["ADMIN", "BDM", "PM", "FOREMAN", "SETTER", "TEAM", "ESTIMATOR", "ACCOUNTS"]);
  const sp = await searchParams;
  const today = bneToday();
  const view = sp.view === "week" ? "week" : "month";
  const week = /^\d{4}-\d{2}-\d{2}$/.test(sp.week ?? "") ? mondayOf(sp.week) : mondayOf(today);
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month : today.slice(0, 7);
  const only = sp.who ?? null;
  // Month view covers the whole 6-week grid (so the days from the months either side show their events too).
  const from = view === "month" ? bneStart(monthGridStart(month)) : bneStart(week);
  const to = view === "month" ? bneStart(addDays(monthGridStart(month), 42)) : bneStart(addDays(week, 7));
  const users = await prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, email: true, setterId: true }, orderBy: { name: "asc" } });
  const byId = new Map(users.map((u) => [u.id, u]));
  const bySetter = new Map(users.filter((u) => u.setterId).map((u) => [u.setterId!, u]));
  const events = await prisma.calEvent.findMany({ where: { start: { lt: to }, end: { gt: from }, ...(only ? { userId: only } : {}) }, orderBy: { start: "asc" } });
  const booked = await prisma.callListItem.findMany({ where: { appointment: { gte: from, lt: to } }, select: { id: true, leadName: true, company: true, appointment: true, setterId: true, assignedSetter: true } });
  const items: CalItem[] = [
    ...events.map((e) => {
      const u = byId.get(e.userId);
      const hidden = e.private && e.userId !== me.id;
      return { id: e.id, title: hidden ? "Busy" : e.title, start: e.start, end: e.end, allDay: e.allDay, location: hidden ? null : e.location, notes: hidden ? null : e.notes, who: u?.name ?? "?", colour: colourFor(u?.email ?? e.userId), tag: e.source === "google" ? "Google" : hidden ? "Private" : undefined };
    }),
    ...booked.filter((b) => !only || bySetter.get(b.setterId ?? "")?.id === only).map((b) => {
      const u = bySetter.get(b.setterId ?? "");
      return { id: `b-${b.id}`, title: `Meeting: ${b.leadName ?? ""}${b.company ? ` (${b.company})` : ""}`, start: b.appointment!, end: new Date(b.appointment!.getTime() + 3600000), allDay: false, who: u?.name ?? b.assignedSetter ?? "Booked", colour: "#f59e0b", tag: "Booked" };
    }),
  ];
  const q = (extra: Record<string, string>) => `/calendar?${new URLSearchParams({ ...(only ? { who: only } : {}), ...extra })}`;
  const base = view === "week" ? q({ view: "week" }) : q({});
  return (
    <div className="myday space-y-5">
      <div className="acc-top">
        <div><h1 className="est-title">Team calendar</h1><p className="est-sub">Everyone&apos;s meetings. Private events show as “Busy”. Add your own, or link your Google Calendar (read-only), on <Link prefetch={false} href="/myday#google" className="acc-link">My Day</Link>.</p></div>
      </div>
      <div className="cal-views" role="group" aria-label="Calendar view">
        <Link prefetch={false} href={only ? `/calendar?who=${only}&month=${month}` : `/calendar?month=${month}`} className={`fr-tab ${view === "month" ? "is-on" : ""}`} aria-current={view === "month" ? "page" : undefined}>Month</Link>
        <Link prefetch={false} href={only ? `/calendar?who=${only}&view=week` : "/calendar?view=week"} className={`fr-tab ${view === "week" ? "is-on" : ""}`} aria-current={view === "week" ? "page" : undefined}>Week</Link>
      </div>
      <nav className="md-people" aria-label="Whose calendar">
        <Link prefetch={false} href={view === "week" ? `/calendar?view=week&week=${week}` : `/calendar?month=${month}`} className={`dir-tab ${!only ? "dir-tab-on" : ""}`}>Everyone</Link>
        {users.map((u) => <Link prefetch={false} key={u.id} href={view === "week" ? `/calendar?who=${u.id}&view=week&week=${week}` : `/calendar?who=${u.id}&month=${month}`} className={`dir-tab ${only === u.id ? "dir-tab-on" : ""}`}><i className="md-dot" style={{ background: colourFor(u.email) }} />{u.name}</Link>)}
      </nav>
      <section className="card acc-pad">{view === "month"
        ? <MonthCalendar month={month} items={items} showWho hrefFor={(m) => q({ month: m })} />
        : <WeekCalendar week={week} items={items} baseHref={base} showWho />}</section>
      <AvailabilityPanel canEdit={me.role === "ADMIN"} />
    </div>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Where setters' bookable times come from: the owner's calendar plus these rules. */
async function AvailabilityPanel({ canEdit }: { canEdit: boolean }) {
  const [a, owner] = await Promise.all([getAvailability(), ownerUser()]);
  const open = await prisma.freeSlot.count({ where: { status: "Free", start: { gt: new Date() } } });
  return (
    <section id="availability" className="card acc-pad">
      <div className="acc-head"><h2 className="est-h2">Booking availability</h2><span className="acc-muted">Setters book meetings into open times in {owner?.name ?? "Braiden"}&apos;s calendar. {open} open time{open === 1 ? "" : "s"} in the next {a.horizonDays} days.</span></div>
      <p className="acc-muted">Open times = working hours below, minus everything already in {owner?.name.split(" ")[0] ?? "Braiden"}&apos;s calendar (CRM events, Google events, all-day leave, booked meetings). They update every 15 minutes and straight away when the calendar changes. Add a &quot;Busy&quot; event on My Day to block time.</p>
      {canEdit ? (
        <form action={saveAvailabilityAction} className="ev-form" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          <div className="ev-wide av-days">{[1, 2, 3, 4, 5, 6, 0].map((d) => <label key={d} className="tp-check"><input type="checkbox" name={`day${d}`} defaultChecked={a.days.includes(d)} /> {DAYS[d]}</label>)}</div>
          <label><span className="label">From</span><input name="start" type="time" className="input" defaultValue={a.start} /></label>
          <label><span className="label">Until</span><input name="end" type="time" className="input" defaultValue={a.end} /></label>
          <label><span className="label">Meeting length (min)</span><input name="length" type="number" className="input" defaultValue={a.length} /></label>
          <label><span className="label">Gap between (min)</span><input name="gap" type="number" className="input" defaultValue={a.gap} /></label>
          <label><span className="label">Notice needed (hours)</span><input name="noticeHours" type="number" className="input" defaultValue={a.noticeHours} /></label>
          <label><span className="label">Book up to (days ahead)</span><input name="horizonDays" type="number" className="input" defaultValue={a.horizonDays} /></label>
          <div className="ev-actions acc-actions"><button className="btn">Save availability</button></div>
        </form>
      ) : <p>{a.days.map((d) => DAYS[d]).join(", ")} · {a.start}–{a.end} · {a.length}-minute meetings · {a.noticeHours} hours&apos; notice</p>}
      {canEdit && <form action={rebuildAvailability}><button className="acc-link">Rebuild open times now</button></form>}
    </section>
  );
}
