import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { bneToday, addDays } from "@/lib/myday";
import { ROLE_LABEL, type AnyRole } from "@/lib/access";
import { colourFor } from "@/components/MyDayBits";
import CopyText from "@/components/CopyText";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dm = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}`;
const time12 = (t: string) => { const h = Number(t.slice(0, 2)); return `${h % 12 || 12}:${t.slice(3)}${h < 12 ? "am" : "pm"}`; };

// Braiden / CEO: everyone's to-do lists (view only) and the whole team's "finished" list for the team email.
export default async function TeamTasks({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const today = bneToday();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date : today;
  const who = sp.who ?? null;
  const week = addDays(today, 7);
  const users = await prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, email: true, role: true }, orderBy: { name: "asc" } });
  const shown = who ? users.filter((u) => u.id === who) : users;
  const ids = shown.map((u) => u.id);
  const [open, finished] = await Promise.all([
    prisma.todo.findMany({ where: { userId: { in: ids }, done: false, parentId: null }, orderBy: [{ date: "asc" }, { time: "asc" }, { priority: "asc" }] }),
    prisma.todoCompletion.findMany({ where: { userId: { in: ids }, date: day }, orderBy: { completedAt: "asc" } }),
  ]);
  const subs = await prisma.todo.findMany({ where: { parentId: { in: open.map((t) => t.id) } }, select: { parentId: true, done: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const people = shown.map((u) => {
    const mine = open.filter((t) => t.userId === u.id);
    return {
      ...u,
      overdue: mine.filter((t) => t.date && t.date < today),
      todayL: mine.filter((t) => t.date === today),
      next: mine.filter((t) => t.date && t.date > today && t.date <= week),
      later: mine.filter((t) => t.date && t.date > week),
      noDate: mine.filter((t) => !t.date),
      done: finished.filter((f) => f.userId === u.id),
    };
  });
  // The whole team's finished list for the day, grouped by person (for the team email).
  const emailText = people.filter((p) => p.done.length).map((p) => `${p.name}\n${p.done.map((f) => `• ${f.title}${f.project ? ` (${f.project})` : ""}`).join("\n")}`).join("\n\n");
  const q = (extra: Record<string, string>) => `/tasks?${new URLSearchParams({ ...(who ? { who } : {}), ...(day !== today ? { date: day } : {}), ...extra })}`;

  const Row = ({ t }: { t: (typeof open)[number] }) => {
    const kids = subs.filter((s) => s.parentId === t.id);
    return (
      <li className={`tt-row p${t.priority}`}>
        <i className="tt-dot" />
        <span className="tt-title">{t.text}{t.assignedBy && t.assignedById === me.id ? <span className="tk-from"> · from you</span> : t.assignedBy ? <span className="tk-from"> · from {t.assignedBy}</span> : null}</span>
        <span className="tt-meta">
          {t.time && <span className="tk-time">{time12(t.time)}</span>}
          {t.date && t.date !== today && <span className={t.date < today ? "tk-late" : ""}>{dm(t.date)}</span>}
          {t.deadline && <span className={`tk-deadline ${t.deadline <= today ? "late" : ""}`}>Deadline {dm(t.deadline)}</span>}
          {t.recurrence && <span>↻</span>}
          {kids.length > 0 && <span>☑ {kids.filter((k) => k.done).length}/{kids.length}</span>}
          {(t.labels ?? "").split(",").filter(Boolean).map((l) => <span key={l} className={`tk-label ${/crm/i.test(l) ? "crm" : ""}`}>@{l}</span>)}
          {t.project && <span className="tk-project">{t.project}{t.section ? ` › ${t.section}` : ""}</span>}
        </span>
      </li>
    );
  };
  const List = ({ title, list, tone, fold }: { title: string; list: (typeof open); tone?: string; fold?: boolean }) => !list.length ? null : fold
    ? <details className="tt-fold"><summary>{title} <span>{list.length}</span></summary><ul className="tt-list">{list.map((t) => <Row key={t.id} t={t} />)}</ul></details>
    : <div className={`tt-group ${tone ?? ""}`}><h4>{title} <span>{list.length}</span></h4><ul className="tt-list">{list.map((t) => <Row key={t.id} t={t} />)}</ul></div>;

  return (
    <div className="myday space-y-5">
      <div>
        <h1 className="est-title">Team tasks</h1>
        <p className="est-sub">Everyone&apos;s to-do lists (view only) and what they finished. To give someone a task, use <Link href="/myday" className="acc-link">My Day</Link>.</p>
      </div>
      <nav className="md-people" aria-label="Whose tasks">
        <Link href={day !== today ? `/tasks?date=${day}` : "/tasks"} className={`dir-tab ${!who ? "dir-tab-on" : ""}`}>Everyone</Link>
        {users.map((u) => <Link key={u.id} href={`/tasks?who=${u.id}${day !== today ? `&date=${day}` : ""}`} className={`dir-tab ${who === u.id ? "dir-tab-on" : ""}`}><i className="md-dot" style={{ background: colourFor(u.email) }} />{u.name}</Link>)}
      </nav>

      <section className="card acc-pad">
        <div className="acc-head">
          <h2 className="est-h2">Finished {day === today ? "today" : `on ${dm(day)}`}</h2>
          <span className="acc-actions">
            <Link href={q({ date: addDays(day, -1) })} className="wk-btn" aria-label="Previous day">‹</Link>
            {day !== today && <Link href={who ? `/tasks?who=${who}` : "/tasks"} className="acc-link">Today</Link>}
            {day < today && <Link href={q({ date: addDays(day, 1) })} className="wk-btn" aria-label="Next day">›</Link>}
          </span>
        </div>
        {finished.length ? (
          <div className="tt-done-grid">
            <div className="tt-done-people">{people.filter((p) => p.done.length).map((p) => (
              <div key={p.id}><b style={{ color: colourFor(p.email) }}>{p.name}</b> <span className="acc-muted">{p.done.length}</span>
                <ul className="tk-finished">{p.done.map((f) => <li key={f.id}>✓ {f.title}{f.project ? <small> · {f.project}</small> : null}</li>)}</ul></div>))}</div>
            <CopyText label="For the team email" text={emailText} />
          </div>
        ) : <p className="acc-muted">Nothing ticked off {day === today ? "yet today" : "that day"}.</p>}
      </section>

      <div className="tt-grid">{people.map((p) => {
        const openN = p.overdue.length + p.todayL.length;
        return (
          <section key={p.id} className="card acc-pad tt-person">
            <div className="kp-head"><b style={{ color: colourFor(p.email) }}>{p.name}</b><span className="acc-muted">{ROLE_LABEL[p.role as AnyRole] ?? p.role} · {p.done.length} done · {openN} due{p.overdue.length ? ` (${p.overdue.length} overdue)` : ""}</span></div>
            <List title="Overdue" list={p.overdue} tone="bad" />
            <List title="Today" list={p.todayL} />
            {!p.overdue.length && !p.todayL.length && <p className="acc-muted">Nothing due today.</p>}
            <List title="Next 7 days" list={p.next} fold />
            <List title="Later" list={p.later} fold />
            <List title="No date" list={p.noDate} fold />
          </section>
        );
      })}</div>
      <p className="acc-muted">Tasks given by {nameOf.get(me.id)?.split(" ")[0] ?? "you"} show “from you”.</p>
    </div>
  );
}
