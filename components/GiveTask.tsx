"use client";
import { useState } from "react";
import ActionForm from "./ActionForm";
import { TaskFields } from "./TaskList";
import { giveTodo, takeBackTodo } from "@/app/(app)/myday/actions";

type Given = { id: string; text: string; person: string; userId: string; date: string | null; time: string | null; deadline: string | null; recurrence: string | null; priority: number; labels: string | null; description: string | null; project: string | null; section: string | null; status: "done" | "late" | "open" };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dm = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}`;

/** Braiden's "Give someone a task" form and the list of tasks he's given out. */
export default function GiveTask({ people, given, today }: { people: { id: string; name: string }[]; given: Given[]; today: string }) {
  const [more, setMore] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div>
      <ActionForm action={giveTodo} className="ev-form" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        <label><span className="label">For</span><select name="userId" className="input" required defaultValue="">{[<option key="" value="" disabled>Pick a person</option>, ...people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)]}</select></label>
        <label className="ev-wide"><span className="label">Task</span><input name="text" className="input" placeholder="e.g. Chase Kew Hair plans" required maxLength={300} /></label>
        <label><span className="label">Due date</span><input name="date" type="date" className="input" defaultValue={today} /></label>
        <label><span className="label">Priority</span><select name="priority" className="input" defaultValue={4}><option value={1}>P1 (urgent)</option><option value={2}>P2 (high)</option><option value={3}>P3 (medium)</option><option value={4}>P4 (normal)</option></select></label>
        {more && <>
          <label><span className="label">Time</span><input name="time" type="time" className="input" /></label>
          <label><span className="label">Deadline</span><input name="deadline" type="date" className="input" /></label>
          <label><span className="label">Repeat</span><select name="recurrence" className="input" defaultValue=""><option value="">Doesn&apos;t repeat</option><option value="daily">Every day</option><option value="weekdays">Every weekday</option><option value="weekly">Every week</option><option value="fortnightly">Every fortnight</option><option value="monthly">Every month</option></select></label>
          <label><span className="label">Labels</span><input name="labels" className="input" placeholder="e.g. crm-follow-up" /></label>
          <label className="ev-wide"><span className="label">Description</span><textarea name="description" className="input" rows={2} placeholder="Details, contact info, links" /></label>
        </>}
        <div className="ev-actions acc-actions"><button className="btn">Give task</button>{!more && <button type="button" className="acc-link" onClick={() => setMore(true)}>More options</button>}</div>
      </ActionForm>
      {given.length > 0 && <>
        <h3 className="give-h">Tasks you&apos;ve given out</h3>
        <ul className="give-list">{given.map((g) => (
          <li key={g.id}>
            <span><b>{g.text}</b> <span className="acc-muted">· {g.person}{g.date ? ` · due ${g.date === today ? "today" : dm(g.date)}` : ""}{g.deadline ? ` · deadline ${dm(g.deadline)}` : ""}</span>
              {editing === g.id && <ActionForm action={async (fd) => { await giveTodo(fd); setEditing(null); }} className="ev-form"><input type="hidden" name="id" value={g.id} /><input type="hidden" name="userId" value={g.userId} /><TaskFields t={g} /><div className="ev-actions"><button className="btn">Save</button></div></ActionForm>}
            </span>
            <span className={`give-status ${g.status}`}>{g.status === "done" ? "Done" : g.status === "late" ? "Overdue" : "Open"}</span>
            <span className="acc-actions">
              {g.status !== "done" && <button type="button" className="acc-link" onClick={() => setEditing(editing === g.id ? null : g.id)}>{editing === g.id ? "Close" : "Change"}</button>}
              <ActionForm action={takeBackTodo}><input type="hidden" name="id" value={g.id} /><button className="tp-del">Remove</button></ActionForm>
            </span>
          </li>))}</ul>
      </>}
    </div>
  );
}
