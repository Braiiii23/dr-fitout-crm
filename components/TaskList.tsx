"use client";
import { useState } from "react";
import type { Todo, TodoCompletion } from "@prisma/client";
import { REPEATS } from "@/lib/task-consts";
import { saveTodo, toggleTodo, deleteTodo, carryOver } from "@/app/(app)/myday/actions";
import ActionForm from "./ActionForm";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dm = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}`;
const repeatLabel = (r: string) => REPEATS.find(([k]) => k === r)?.[1] ?? r.replace(/^every/i, "Every");
const time12 = (t: string) => { const h = Number(t.slice(0, 2)); return `${h % 12 || 12}:${t.slice(3)}${h < 12 ? "am" : "pm"}`; };

/** Turn web addresses in a description into links. */
function Linkify({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g);
  return <>{parts.map((p, i) => /^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer" className="acc-link">{p.replace(/^https?:\/\//, "").slice(0, 60)}</a> : <span key={i}>{p}</span>)}</>;
}

/** Title, description, project, section, dates, repeat, priority and labels. Used to add and to edit. */
export function TaskFields({ t, compact }: { t?: Partial<Todo>; compact?: boolean }) {
  return (<>
    <label className="ev-wide"><span className="label">Task</span><input name="text" className="input" defaultValue={t?.text ?? ""} placeholder="e.g. Call Dad for his birthday" required maxLength={300} /></label>
    {!compact && <label className="ev-wide"><span className="label">Description</span><textarea name="description" className="input" rows={2} defaultValue={t?.description ?? ""} placeholder="Details, contact info, links" /></label>}
    <label><span className="label">Due date</span><input name="date" type="date" className="input" defaultValue={t?.date ?? ""} /></label>
    <label><span className="label">Time</span><input name="time" type="time" className="input" defaultValue={t?.time ?? ""} /></label>
    <label><span className="label">Deadline</span><input name="deadline" type="date" className="input" defaultValue={t?.deadline ?? ""} /></label>
    <label><span className="label">Repeat</span><select name="recurrence" className="input" defaultValue={t?.recurrence ?? ""}>{REPEATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}{t?.recurrence && !REPEATS.some(([k]) => k === t.recurrence) && <option value={t.recurrence}>{repeatLabel(t.recurrence)}</option>}</select></label>
    <label><span className="label">Priority</span><select name="priority" className="input" defaultValue={t?.priority ?? 4}><option value={1}>P1 (urgent)</option><option value={2}>P2 (high)</option><option value={3}>P3 (medium)</option><option value={4}>P4 (normal)</option></select></label>
    {!compact && <>
      <label><span className="label">Project</span><input name="project" className="input" defaultValue={t?.project ?? ""} placeholder="e.g. DR Fitout, Personal" list="task-projects" /></label>
      <label><span className="label">Section</span><input name="section" className="input" defaultValue={t?.section ?? ""} placeholder="e.g. Admin" /></label>
      <label className="ev-wide"><span className="label">Labels</span><input name="labels" className="input" defaultValue={t?.labels ?? ""} placeholder="comma separated, e.g. crm-follow-up, calls" /></label>
    </>}
  </>);
}

type T = Todo;
function TaskRow({ t, subs, today, sub, meId }: { t: T; subs: T[]; today: string; sub?: boolean; meId: string }) {
  const given = !!t.assignedById && t.assignedById !== meId;
  const [open, setOpen] = useState(false);
  const kids = subs.filter((s) => s.parentId === t.id);
  const deadlineTone = t.deadline ? (t.deadline < today ? "late" : t.deadline === today ? "today" : "") : "";
  const labels = (t.labels ?? "").split(",").filter(Boolean);
  return (
    <li className={`tk ${t.done ? "done" : ""} p${t.priority} ${sub ? "is-sub" : ""}`}>
      <ActionForm action={toggleTodo}><input type="hidden" name="id" value={t.id} /><button className="tk-tick" aria-label={t.done ? `Mark "${t.text}" not done` : `Tick off "${t.text}"`}>{t.done ? "✓" : ""}</button></ActionForm>
      <details className="tk-body" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>
          <span className="tk-title">{t.text}</span>
          {t.description && <span className="tk-desc">{t.description.split("\n")[0].slice(0, 90)}</span>}
          <span className="tk-meta">
            {t.time && <span className="tk-time">{time12(t.time)}</span>}
            {t.date && t.date !== today && <span className={t.date < today && !t.done ? "tk-late" : ""}>{dm(t.date)}</span>}
            {t.recurrence && <span title="Repeats">↻ {repeatLabel(t.recurrence)}</span>}
            {t.deadline && <span className={`tk-deadline ${deadlineTone}`}>Deadline {dm(t.deadline)}</span>}
            {kids.length > 0 && <span>☑ {kids.filter((k) => k.done).length}/{kids.length}</span>}
            {labels.map((l) => <span key={l} className={`tk-label ${/crm/i.test(l) ? "crm" : ""}`}>@{l}</span>)}
            {t.assignedBy && t.assignedById !== meId && <span className="tk-from">From {t.assignedBy}</span>}
            {t.project && <span className="tk-project">{t.project}{t.section ? ` › ${t.section}` : ""}</span>}
          </span>
        </summary>
        {open && <div className="tk-more">
          {t.description && <p className="tk-fulldesc"><Linkify text={t.description} /></p>}
          {given ? <p className="acc-muted">{t.assignedBy} gave you this task, so only they can change it. Tick it off when it&apos;s done.</p>
            : <ActionForm action={saveTodo} className="ev-form"><input type="hidden" name="id" value={t.id} /><TaskFields t={t} /><div className="ev-actions"><button className="btn">Save</button></div></ActionForm>}
          {!sub && <ActionForm action={saveTodo} className="tk-subadd"><input type="hidden" name="parentId" value={t.id} /><input name="text" className="input" placeholder="Add a subtask" aria-label={`Add a subtask to ${t.text}`} required /><button className="btn">Add</button></ActionForm>}
          {!given && <ActionForm action={deleteTodo}><input type="hidden" name="id" value={t.id} /><button className="tp-del">Delete task{kids.length ? " and its subtasks" : ""}</button></ActionForm>}
        </div>}
      </details>
      {kids.length > 0 && <ul className="tk-subs">{kids.map((k) => <TaskRow key={k.id} t={k} subs={subs} today={today} sub meId={meId} />)}</ul>}
    </li>
  );
}

/** My Day's task list: overdue, today, next 7 days, no date, and what was finished today. */
export default function TaskList({ tasks, subs, finished, today, projects, meId }: { tasks: T[]; subs: T[]; finished: TodoCompletion[]; today: string; projects: string[]; meId: string }) {
  const [more, setMore] = useState(false);
  const week = new Date(Date.parse(today + "T00:00:00Z") + 7 * 86400000).toISOString().slice(0, 10);
  const order = (a: T, b: T) => (a.time ?? "99").localeCompare(b.time ?? "99") || a.priority - b.priority || a.sort - b.sort;
  const overdue = tasks.filter((t) => !t.done && t.date && t.date < today).sort((a, b) => a.date!.localeCompare(b.date!) || a.priority - b.priority);
  const todayList = tasks.filter((t) => t.date === today).sort((a, b) => Number(a.done) - Number(b.done) || order(a, b));
  const upcoming = tasks.filter((t) => !t.done && t.date && t.date > today && t.date <= week).sort((a, b) => a.date!.localeCompare(b.date!) || order(a, b));
  const noDate = tasks.filter((t) => !t.done && !t.date).sort((a, b) => a.priority - b.priority);
  const later = tasks.filter((t) => !t.done && t.date && t.date > week).sort((a, b) => a.date!.localeCompare(b.date!) || order(a, b));
  const Group = ({ title, list, tone }: { title: string; list: T[]; tone?: string }) => list.length ? (
    <div className={`tk-group ${tone ?? ""}`}><h3>{title} <span>{list.length}</span></h3><ul className="tk-list">{list.map((t) => <TaskRow key={t.id} t={t} subs={subs} today={today} meId={meId} />)}</ul></div>
  ) : null;
  const emailText = finished.map((f) => `• ${f.title}${f.project ? ` (${f.project})` : ""}`).join("\n");
  return (
    <div className="tasks">
      <datalist id="task-projects">{projects.map((p) => <option key={p} value={p} />)}</datalist>
      <ActionForm action={saveTodo} className="tk-add">
        <input name="text" className="input" placeholder="Add a task and press Enter" aria-label="New task" maxLength={300} required />
        <input type="hidden" name="date" value={today} />
        <button className="btn">Add</button>
      </ActionForm>
      <details className="tk-addmore" onToggle={(e) => setMore((e.currentTarget as HTMLDetailsElement).open)}><summary className="acc-link">Add with details (description, project, time, deadline, repeat, priority, labels)</summary>
        {more && <ActionForm action={saveTodo} className="ev-form"><TaskFields t={{ date: today, priority: 4 }} /><div className="ev-actions"><button className="btn">Add task</button></div></ActionForm>}
      </details>
      {overdue.length > 0 && <div className="tk-carry"><span>{overdue.length} overdue</span><ActionForm action={carryOver}><button className="acc-link">Move them to today</button></ActionForm></div>}
      <Group title="Overdue" list={overdue} tone="bad" />
      <Group title="Today" list={todayList} />
      {!overdue.length && !todayList.length && <p className="md-empty">Nothing due today. Add what you want to get done.</p>}
      {upcoming.length > 0 && <details className="tk-fold"><summary>Next 7 days <span>{upcoming.length}</span></summary><ul className="tk-list">{upcoming.map((t) => <TaskRow key={t.id} t={t} subs={subs} today={today} meId={meId} />)}</ul></details>}
      {later.length > 0 && <details className="tk-fold"><summary>Later <span>{later.length}</span></summary><ul className="tk-list">{later.map((t) => <TaskRow key={t.id} t={t} subs={subs} today={today} meId={meId} />)}</ul></details>}
      {noDate.length > 0 && <details className="tk-fold"><summary>No date <span>{noDate.length}</span></summary><ul className="tk-list">{noDate.map((t) => <TaskRow key={t.id} t={t} subs={subs} today={today} meId={meId} />)}</ul></details>}
      <details className="tk-fold" open={finished.length > 0 && finished.length <= 6}><summary>Finished today <span>{finished.length}</span></summary>
        {finished.length ? <>
          <ul className="tk-finished">{finished.map((f) => <li key={f.id}>✓ {f.title}{f.project ? <small> · {f.project}</small> : null}</li>)}</ul>
          <div className="tk-email"><div className="tk-email-head"><span className="label">For the team email</span><button type="button" className="acc-link" onClick={() => navigator.clipboard?.writeText(emailText)}>Copy</button></div><pre>{emailText}</pre></div>
        </> : <p className="acc-muted">Nothing ticked off yet today.</p>}
      </details>
    </div>
  );
}
