import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { bneToday, addDays, mondayOf, bneStart, bneDateOf } from "@/lib/myday";
import { WeekCalendar, MonthCalendar, monthGridStart, colourFor, type CalItem } from "@/components/MyDayBits";
import { OPEN_LEASE, keyDates } from "@/lib/leases";

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
  const events = await prisma.calEvent.findMany({ where: { start: { lt: to }, end: { gt: from }, ...(only ? { userId: only } : {}) }, orderBy: { start: "asc" } });
  const fromDay = bneDateOf(from), toDay = bneDateOf(to);
  const [appts, leases] = await Promise.all([
    prisma.lead.findMany({ where: { brand: "DR", appointment: { gte: from, lt: to } }, select: { id: true, leadName: true, company: true, appointment: true, location: true } }),
    prisma.lease.findMany({ where: { status: { in: OPEN_LEASE } }, include: { client: { select: { name: true } } } }),
  ]);
  const leaseDates = leases.flatMap((l) => keyDates(l).map((d) => ({ ...d, premises: [l.tenancy, l.premises].filter(Boolean).join(", "), client: l.client?.name }))).filter((d) => d.date >= fromDay && d.date < toDay);
  const items: CalItem[] = [
    ...events.map((e) => {
      const u = byId.get(e.userId);
      const hidden = e.private && e.userId !== me.id;
      return { id: e.id, title: hidden ? "Busy" : e.title, start: e.start, end: e.end, allDay: e.allDay, location: hidden ? null : e.location, notes: hidden ? null : e.notes, who: u?.name ?? "?", colour: colourFor(u?.email ?? e.userId), tag: e.source === "google" ? "Google" : hidden ? "Private" : undefined };
    }),
    // DR lead appointments and lease key dates (option notices, reviews, expiries) show for everyone.
    ...(only ? [] : appts.map((l) => ({ id: `a-${l.id}`, title: `Appointment: ${l.leadName ?? ""}${l.company ? ` (${l.company})` : ""}`, start: l.appointment!, end: new Date(l.appointment!.getTime() + 3600000), allDay: false, who: "Lead", colour: "#f59e0b", tag: "Lead", location: l.location }))),
    ...(only ? [] : leaseDates.map((d) => ({ id: `l-${d.leaseId}-${d.kind}`, title: `${d.label}: ${d.client ?? d.premises}`, start: bneStart(d.date), end: bneStart(addDays(d.date, 1)), allDay: true, who: "Lease", colour: "#a46be0", tag: "Lease", notes: d.premises }))),
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
    </div>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Where setters' bookable times come from: the owner's calendar plus these rules. */
