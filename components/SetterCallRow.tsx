"use client";
import { useState } from "react";
import ActionForm from "./ActionForm";
import { saveSetterCall } from "@/app/(app)/setters/calls/actions";

type Call = { id: string; priority: string; leadName: string | null; company: string | null; phone: string | null; email: string | null; business: string; callStatus: string; attempts: number; lastCalled: string | null; appointment: string | null; callNotes: string | null; leadInfo: string | null; setterId: string | null; possibleDuplicate: boolean };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dm = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}`;

/** One call on a setter's list: quick status (+ log the call), and an edit panel for everything else. */
export default function SetterCallRow({ c, statuses, setters, readOnly }: { c: Call; statuses: string[]; setters: { id: string; name: string }[]; readOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const tone = c.callStatus === "Appointment Set" ? "good" : ["Not Interested", "Wrong Number"].includes(c.callStatus) ? "dead" : c.callStatus === "Call Back" ? "warn" : "";
  return (
    <li className={`sc-row ${tone} ${c.priority === "High" ? "is-high" : c.priority === "Low" ? "is-low" : ""}`}>
      <div className="sc-main">
        <div className="sc-who">{c.priority === "High" && <span className="sc-prio">High priority</span>}<b>{c.leadName ?? "Unnamed"}</b>{c.possibleDuplicate && <span title="Possible duplicate" className="sc-dup"> ⚠</span>}{c.company && <span className="acc-muted"> · {c.company}</span>} <span className={`dir-badge ${c.business === "DR" ? "dir-badge-dr" : ""}`}>{c.business === "DR" ? "DR" : "ENP"}</span></div>
        <div className="sc-meta">
          {c.phone && <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="dir-accent">{c.phone}</a>}
          <span>{c.attempts} attempt{c.attempts === 1 ? "" : "s"}</span>
          {c.lastCalled && <span>last called {dm(c.lastCalled)}</span>}
          {c.appointment && <span className="sc-appt">Meeting {new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(c.appointment))}</span>}
        </div>
        {c.callNotes && <div className="sc-notes">{c.callNotes.split("\n").slice(-1)[0].slice(0, 160)}</div>}
      </div>
      {readOnly ? <span className={`sc-status ${tone}`}>{c.callStatus}</span> : (
        <ActionForm action={saveSetterCall} className="sc-quick" keep>
          <input type="hidden" name="id" value={c.id} />
          <select name="priority" className="input sc-prio-pick" defaultValue={c.priority} aria-label={`Priority for ${c.leadName ?? "call"}`}><option>High</option><option>Normal</option><option>Low</option></select>
          <select name="callStatus" className="input" defaultValue={c.callStatus} aria-label={`Status for ${c.leadName ?? "call"}`}>{statuses.map((s) => <option key={s}>{s}</option>)}</select>
          <label className="tp-check sc-log" title="Adds an attempt and today's date"><input type="checkbox" name="logAttempt" /> Called</label>
          <button className="btn">Save</button>
        </ActionForm>
      )}
      <div className="sc-actions">
        {!readOnly && <button type="button" className="acc-link" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Close" : "Edit"}</button>}
        <a href={`/calls/${c.id}`} className="acc-link">Full page</a>
      </div>
      {open && (
        <ActionForm action={async (fd) => { await saveSetterCall(fd); setOpen(false); }} className="ev-form sc-edit">
          <input type="hidden" name="id" value={c.id} />
          <label><span className="label">Name</span><input name="leadName" className="input" defaultValue={c.leadName ?? ""} /></label>
          <label><span className="label">Company</span><input name="company" className="input" defaultValue={c.company ?? ""} /></label>
          <label><span className="label">Phone</span><input name="phone" className="input" defaultValue={c.phone ?? ""} /></label>
          <label><span className="label">Email</span><input name="email" className="input" defaultValue={c.email ?? ""} /></label>
          <label><span className="label">Priority</span><select name="priority" className="input" defaultValue={c.priority}><option>High</option><option>Normal</option><option>Low</option></select></label>
          <label><span className="label">Status</span><select name="callStatus" className="input" defaultValue={c.callStatus}>{statuses.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label><span className="label">Attempts</span><input name="attempts" type="number" min={0} className="input" defaultValue={c.attempts} /></label>
          <label><span className="label">Last called</span><input name="lastCalled" type="date" className="input" defaultValue={c.lastCalled ?? ""} /></label>
          <label><span className="label">Setter</span><select name="setterId" className="input" defaultValue={c.setterId ?? ""}><option value="">Unassigned</option>{setters.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label><span className="label">Business</span><select name="business" className="input" defaultValue={c.business}><option value="ENP">ENP Fitouts</option><option value="DR">DR Fitout</option></select></label>
          <label className="ev-wide"><span className="label">Notes</span><textarea name="callNotes" className="input" rows={3} defaultValue={c.callNotes ?? ""} /></label>
          {c.leadInfo && <p className="ev-wide acc-muted">Lead info: {c.leadInfo}</p>}
          <div className="ev-actions"><button className="btn">Save call</button></div>
        </ActionForm>
      )}
    </li>
  );
}
