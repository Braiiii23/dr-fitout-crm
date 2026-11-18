import Link from "next/link";
import ActionForm from "@/components/ActionForm";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { bneToday, addDays, mondayOf, bneStart, ensureKpis, kpiViews, productivity, streak, feedToken, METRICS, type KpiView } from "@/lib/myday";
import { ProductivityBar, WeekCalendar, EventForm, colourFor, type CalItem } from "@/components/MyDayBits";
import KpiFields from "@/components/KpiFields";
import TaskList from "@/components/TaskList";
import GiveTask from "@/components/GiveTask";
import { saveKpi, deleteKpi, logKpi, saveGoogleLink, syncGoogleNow } from "./actions";

const fmtNum = (k: { unit: string | null }, n: number) => (k.unit === "%" ? `${Math.round(n)}%` : k.unit === "$" ? `$${Math.round(n).toLocaleString("en-AU")}` : Math.round(n * 10) / 10 + (k.unit ? ` ${k.unit}` : ""));

export default async function MyDay({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const u = await requireUser(["ADMIN", "BDM", "PM", "FOREMAN", "SETTER", "TEAM", "ESTIMATOR", "ACCOUNTS"]);
  const sp = await searchParams;
  const today = bneToday();
  const week = /^\d{4}-\d{2}-\d{2}$/.test(sp.week ?? "") ? mondayOf(sp.week) : mondayOf(today);
  await ensureKpis(u);

  // Tasks: everything open (and anything ticked off today), with subtasks; plus today's completions.
  const [allTasks, finished, kpis, st, me] = await Promise.all([
    prisma.todo.findMany({ where: { userId: u.id, OR: [{ done: false }, { doneAt: { gte: bneStart(today) } }] }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] }),
    prisma.todoCompletion.findMany({ where: { userId: u.id, date: today }, orderBy: { completedAt: "asc" } }),
    kpiViews(u), streak(u.id, today),
    prisma.user.findUnique({ where: { id: u.id }, select: { googleIcal: true, googleSyncedAt: true, googleSyncNote: true } }),
  ]);
  const tasks = allTasks.filter((t) => !t.parentId), subs = allTasks.filter((t) => t.parentId);
  // Productivity: tasks due today or overdue (open) plus everything ticked off today.
  const dueOpen = tasks.filter((t) => !t.done && t.date && t.date <= today).length;
  const todos = [...Array(finished.length).fill({ done: true }), ...Array(dueOpen).fill({ done: false })] as { done: boolean }[];
  const projects = [...new Set(allTasks.map((t) => t.project).filter((x): x is string => !!x))].sort();
  const p = productivity(todos, kpis);
  const kpiPace = kpis.length ? kpis.reduce((t, k) => t + Math.min(1.2, k.pace), 0) / kpis.length : null;

  // My calendar: my events (CRM + Google), plus meetings booked for me through the call list (setters).
  const from = bneStart(week), to = bneStart(addDays(week, 7));
  const events = await prisma.calEvent.findMany({ where: { userId: u.id, start: { lt: to }, end: { gt: from } }, orderBy: { start: "asc" } });
  // Setters see the meetings they booked; the calendar owner (Braiden) sees every booked meeting, since they're with him.
  const isOwner = (await (await import("@/lib/availability")).ownerUser())?.id === u.id;
  const booked = u.setterId || isOwner ? await prisma.callListItem.findMany({ where: { ...(isOwner ? {} : { setterId: u.setterId! }), appointment: { gte: from, lt: to } }, select: { id: true, leadName: true, company: true, appointment: true } }) : [];
  const items: CalItem[] = [
    ...events.map((e) => ({ ...e, editable: e.source === "crm", tag: e.source === "google" ? "Google" : e.private ? "Private" : undefined, colour: e.source === "google" ? "#4285f4" : colourFor(u.email) })),
    ...booked.map((b) => ({ id: `b-${b.id}`, title: `Meeting: ${b.leadName ?? ""}${b.company ? ` (${b.company})` : ""}`, start: b.appointment!, end: new Date(b.appointment!.getTime() + 3600000), allDay: false, tag: "Booked", colour: "#f59e0b" })),
  ];
  const token = await feedToken(u.id);
  const feedUrl = `${process.env.APP_URL ?? ""}/cal/${token}.ics`;
  const team = u.role === "ADMIN" ? await teamOverview(today) : null;
  // Tasks Braiden has given out (open, plus anything finished in the last week).
  const givenRaw = u.role === "ADMIN" ? await prisma.todo.findMany({ where: { assignedById: u.id, parentId: null, OR: [{ done: false }, { doneAt: { gte: bneStart(addDays(today, -7)) } }] }, orderBy: [{ done: "asc" }, { date: "asc" }] }) : [];
  const people = u.role === "ADMIN" ? await prisma.user.findMany({ where: { active: true, NOT: { id: u.id } }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const given = givenRaw.map((g) => ({ id: g.id, text: g.text, person: nameOf.get(g.userId) ?? "?", userId: g.userId, date: g.date, time: g.time, deadline: g.deadline, recurrence: g.recurrence, priority: g.priority, labels: g.labels, description: g.description, project: g.project, section: g.section, status: (g.done ? "done" : g.date && g.date < today ? "late" : "open") as "done" | "late" | "open" }));

  return (
    <div className="myday space-y-5 team-editable">
      <div>
        <h1 className="est-title">G&apos;day {u.name.split(" ")[0]}</h1>
        <p className="est-sub">{new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", weekday: "long", day: "numeric", month: "long" }).format(new Date())} · your day, your calendar and how you&apos;re tracking</p>
      </div>

      <ProductivityBar score={p.score} level={p.hasData ? p.level : "Add a to-do to get started"} todosDone={todos.filter((t) => t.done).length} todosTotal={todos.length} kpiPace={kpiPace} streak={st} />

      <div className="md-grid">
        {/* ---------- tasks ---------- */}
        <section className="card acc-pad md-todos">
          <div className="acc-head"><h2 className="est-h2">My tasks</h2><span className="acc-muted">{finished.length} done today · {dueOpen} still due</span></div>
          <TaskList tasks={tasks} subs={subs} finished={finished} today={today} projects={projects} meId={u.id} />
        </section>

        {/* ---------- KPIs ---------- */}
        <section className="card acc-pad md-kpis">
          <div className="acc-head"><h2 className="est-h2">My KPIs</h2><span className="acc-muted">White line = where you should be by now</span></div>
          <div className="kpi-list">{kpis.map((k) => <KpiCard key={k.id} k={k} />)}</div>
          <details className="tp-add-scope"><summary className="acc-link">+ Add a KPI</summary><KpiForm /></details>
        </section>
      </div>

      {u.role === "ADMIN" && (
        <section className="card acc-pad">
          <div className="acc-head"><h2 className="est-h2">Give someone a task</h2><span className="acc-muted">It goes on their My Day as &quot;From {u.name.split(" ")[0]}&quot;. They can tick it off but not change or delete it.</span></div>
          <GiveTask people={people} given={given} today={today} />
        </section>
      )}

      {/* ---------- calendar ---------- */}
      <section className="card acc-pad">
        <div className="acc-head"><h2 className="est-h2">My calendar</h2><Link prefetch={false} href="/calendar" className="acc-link">Team calendar →</Link></div>
        <details className="md-addev"><summary className="btn" style={{ width: "max-content" }}>+ Add to my calendar</summary><EventForm date={today} /></details>
        <WeekCalendar week={week} items={items} baseHref="/myday" />
      </section>

      <section id="google" className="card acc-pad md-links">
        <h2 className="est-h2" style={{ marginTop: 0 }}>Link with Google Calendar</h2>
        <div className="md-two">
          <div>
            <h3>1. See these CRM events in Google Calendar</h3>
            <ol className="acc-muted">
              <li>Copy your private calendar link: <input readOnly className="input md-feed" value={feedUrl} aria-label="Your private calendar link" /></li>
              <li>In Google Calendar on a computer: <b>Other calendars → + → From URL</b>, paste it, and press <b>Add calendar</b>. (Outlook: <b>Add calendar → Subscribe from web</b>.)</li>
            </ol>
            <p className="acc-muted">Google refreshes subscribed calendars every few hours, so a change here can take a while to show there. Keep this link private.</p>
          </div>
          <div>
            <h3>2. See your Google events here</h3>
            <ol className="acc-muted">
              <li>In Google Calendar: <b>Settings → your calendar → Integrate calendar</b> and copy the <b>Secret address in iCal format</b>.</li>
              <li>Paste it here. Your Google events show on this calendar and the team calendar (read every 15 minutes).</li>
            </ol>
            <ActionForm action={saveGoogleLink} className="acc-actions"><input name="url" className="input" style={{ flex: "1 1 260px" }} placeholder={me?.googleIcal ? "Linked. Paste a new address to replace it" : "https://calendar.google.com/calendar/ical/…/basic.ics"} autoComplete="off" /><button className="btn">{me?.googleIcal ? "Replace" : "Link Google"}</button></ActionForm>
            {me?.googleIcal && <div className="acc-actions" style={{ marginTop: ".4rem" }}>
              <span className="acc-muted">{me.googleSyncNote ?? "Linked"}{me.googleSyncedAt ? ` · read ${new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", hour: "numeric", minute: "2-digit", day: "numeric", month: "short" }).format(me.googleSyncedAt)}` : ""}</span>
              <ActionForm action={syncGoogleNow}><button className="acc-link">Read it now</button></ActionForm>
              <ActionForm action={saveGoogleLink}><input type="hidden" name="url" value="" /><button className="tp-del">Unlink</button></ActionForm>
            </div>}
          </div>
        </div>
      </section>

      {team && (
        <section className="card acc-pad">
          <div className="acc-head"><h2 className="est-h2">Team today</h2><span className="acc-muted">Everyone&apos;s productivity and KPIs (only you see this)</span></div>
          <div className="md-team">{team.map((t) => (
            <div key={t.id} className="md-person">
              <div className="md-person-head"><b style={{ color: colourFor(t.email) }}>{t.name}</b><span className="acc-muted">{t.role.toLowerCase()}</span></div>
              <ProductivityBar score={t.p.score} level={t.p.hasData ? t.p.level : "No to-dos or KPIs yet"} todosDone={t.done} todosTotal={t.total} kpiPace={null} streak={0} small />
              <ul className="md-person-kpis">{t.kpis.map((k) => <li key={k.id} className={k.status}><span>{k.name}</span><b>{fmtNum(k, k.actual)} / {fmtNum(k, k.target)}</b><small>{k.label}</small></li>)}</ul>
            </div>))}</div>
        </section>
      )}
    </div>
  );
}

function KpiCard({ k }: { k: KpiView }) {
  const fill = Math.min(100, k.pct * 100), marker = k.percent ? Math.min(100, k.target) : Math.min(100, (k.paceTarget / k.target) * 100);
  return (
    <div className={`kpi ${k.status}`}>
      <div className="kpi-top"><b>{k.name}</b><span className={`kpi-status ${k.status}`}>{k.status === "ahead" ? "Ahead" : k.status === "on" ? "On pace" : "Behind"}</span></div>
      <div className="kpi-nums"><b>{fmtNum(k, k.actual)}</b><span>{k.percent ? `target ${fmtNum(k, k.target)} ${k.label}` : `of ${fmtNum(k, k.target)} ${k.label}`}{k.note ? ` · ${k.note}` : ""}</span></div>
      <div className="kpi-track"><div className="kpi-fill" style={{ width: `${fill}%` }} /><i style={{ left: `${marker}%` }} title="Where you should be by now" /></div>
      <div className="kpi-foot">
        <span className="acc-muted">{k.source === "manual" ? "Logged by hand" : `Tracked automatically: ${METRICS[k.source]?.label ?? k.source}`}</span>
        {k.source === "manual" && <ActionForm action={logKpi} className="kpi-log"><input type="hidden" name="kpiId" value={k.id} /><input name="value" inputMode="decimal" className="input" placeholder="+ amount" aria-label={`Log ${k.name}`} required /><button className="btn">Log</button></ActionForm>}
        {k.setBy ? <span className="acc-muted">Set by {k.setBy}</span> : <details className="kpi-edit"><summary className="acc-link">Edit</summary><KpiForm k={k} /><ActionForm action={deleteKpi}><input type="hidden" name="id" value={k.id} /><button className="tp-del">Delete KPI</button></ActionForm></details>}
      </div>
    </div>
  );
}

function KpiForm({ k }: { k?: KpiView }) {
  return (
    <ActionForm action={saveKpi} className="ev-form">
      {k && <input type="hidden" name="id" value={k.id} />}
      <KpiFields k={k} />
      <div className="ev-actions"><button className="btn">{k ? "Save KPI" : "Add KPI"}</button></div>
    </ActionForm>
  );
}

/** Braiden's view of everyone: productivity and KPIs today. */
async function teamOverview(today: string) {
  const users = await prisma.user.findMany({ where: { active: true }, select: { id: true, email: true, name: true, role: true, setterId: true }, orderBy: { name: "asc" } });
  return Promise.all(users.map(async (x) => {
    const cu = { ...x, role: x.role as never };
    const [doneN, dueN, kpis] = await Promise.all([prisma.todoCompletion.count({ where: { userId: x.id, date: today } }), prisma.todo.count({ where: { userId: x.id, done: false, parentId: null, date: { lte: today } } }), kpiViews(cu)]);
    const todos = [...Array(doneN).fill({ done: true }), ...Array(dueN).fill({ done: false })] as { done: boolean }[];
    return { ...x, kpis, p: productivity(todos, kpis), done: todos.filter((t) => t.done).length, total: todos.length };
  }));
}
