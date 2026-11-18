import Link from "next/link";
import ActionForm from "./ActionForm";
import { addDays, bneDateOf, bneTime, bneToday } from "@/lib/myday";
import { saveEvent, deleteEvent } from "@/app/(app)/myday/actions";
import { bookSlotAction } from "@/app/(app)/calls/actions";

const PALETTE = ["#e11d48", "#2563eb", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#ea580c", "#0d9488"];
export const colourFor = (key: string) => PALETTE[[...key].reduce((t, c) => t + c.charCodeAt(0), 0) % PALETTE.length];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dm = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}`;

/** The big productivity bar: score, level, and what it's made of. */
export function ProductivityBar({ score, level, todosDone, todosTotal, kpiPace, streak, small }: { score: number; level: string; todosDone: number; todosTotal: number; kpiPace: number | null; streak: number; small?: boolean }) {
  const tone = score >= 95 ? "max" : score >= 70 ? "good" : score >= 40 ? "mid" : "low";
  return (
    <div className={`prod ${tone} ${small ? "small" : ""}`} role="img" aria-label={`Productivity ${score}%: ${level}`}>
      <div className="prod-top">
        <div><span className="prod-k">Productivity today</span><b className="prod-level">{level}</b></div>
        <div className="prod-score"><b>{score}</b><span>%</span></div>
      </div>
      <div className="prod-track"><div className="prod-fill" style={{ width: `${Math.max(3, score)}%` }}><span className="prod-shine" /></div>
        {[40, 70, 95].map((m) => <i key={m} style={{ left: `${m}%` }} />)}
      </div>
      {!small && <div className="prod-parts">
        <span>✅ {todosDone}/{todosTotal} to-dos done</span>
        {kpiPace != null && <span>📈 KPIs at {Math.round(kpiPace * 100)}% of pace</span>}
        <span>🔥 {streak} day streak</span>
      </div>}
    </div>
  );
}

export type CalItem = { id: string; title: string; start: Date; end: Date; allDay: boolean; location?: string | null; notes?: string | null; who?: string; colour?: string; editable?: boolean; tag?: string; private?: boolean; slotId?: string };

/** A Monday–Sunday week of events. Editable events open an edit form in place. */
export function WeekCalendar({ week, items, baseHref, showWho, bookCalls }: { week: string; items: CalItem[]; baseHref: string; showWho?: boolean; bookCalls?: { id: string; label: string }[] }) {
  const today = bneToday();
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const sep = baseHref.includes("?") ? "&" : "?";
  return (
    <div className="wk">
      <div className="wk-nav">
        <Link prefetch={false} href={`${baseHref}${sep}week=${addDays(week, -7)}`} className="wk-btn" aria-label="Previous week">‹</Link>
        <b>{dm(days[0])} – {dm(days[6])} {days[6].slice(0, 4)}</b>
        <Link prefetch={false} href={`${baseHref}${sep}week=${addDays(week, 7)}`} className="wk-btn" aria-label="Next week">›</Link>
        {week !== addDays(today, -((new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7)) && <Link prefetch={false} href={baseHref} className="acc-link">This week</Link>}
      </div>
      <div className="wk-grid">
        {days.map((d, i) => {
          const list = items.filter((e) => bneDateOf(e.start) <= d && bneDateOf(new Date(e.end.getTime() - 1)) >= d).sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime());
          return (
            <section key={d} className={`wk-day ${d === today ? "is-today" : ""} ${i >= 5 ? "is-weekend" : ""}`} aria-label={`${DOW[i]} ${dm(d)}`}>
              <h3><span>{DOW[i]}</span> {dm(d)}</h3>
              {list.length === 0 && <p className="wk-empty">—</p>}
              {list.map((e) => (
                <details key={e.id + d} className={`wk-ev ${e.slotId ? "wk-open" : ""}`} style={{ borderLeftColor: e.colour ?? "#c8102e" }}>
                  <summary>
                    <span className="wk-time">{e.allDay ? "All day" : `${bneTime(e.start)}–${bneTime(e.end)}`}</span>
                    <span className="wk-title">{e.title}</span>
                    {showWho && e.who && <span className="wk-who" style={{ color: e.colour }}>{e.who}</span>}
                    {e.tag && <span className="wk-tag">{e.tag}</span>}
                  </summary>
                  <div className="wk-more">
                    {e.location && <p>📍 {e.location}</p>}
                    {e.notes && <p className="wk-notes">{e.notes}</p>}
                    {e.slotId && bookCalls ? (bookCalls.length ? (
                      <form action={bookSlotAction} className="wk-book">
                        <input type="hidden" name="slotId" value={e.slotId} /><input type="hidden" name="setStatus" value="on" />
                        <label><span className="label">Book this time for</span><select name="id" className="input" required>{bookCalls.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
                        <button className="btn">Book meeting</button>
                      </form>) : <p className="acc-muted">You have no calls to book. Calls assigned to you appear here.</p>)
                    : e.editable ? <EventForm e={e} /> : <p className="acc-muted">{e.tag === "Google" ? "From Google Calendar: edit it there." : e.tag === "Booked" ? "Booked through the call list." : e.tag === "Busy" ? "Not available." : ""}</p>}
                  </div>
                </details>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** Add / edit an event (only your own CRM events). */
export function EventForm({ e, date }: { e?: CalItem; date?: string }) {
  const d = e ? bneDateOf(e.start) : date ?? bneToday();
  return (
    <>
      <ActionForm action={saveEvent} className="ev-form">
        {e && <input type="hidden" name="id" value={e.id} />}
        <label className="ev-wide"><span className="label">What</span><input name="title" className="input" defaultValue={e?.title ?? ""} placeholder="e.g. Site meeting, Hyperdome" required /></label>
        <label><span className="label">Date</span><input name="date" type="date" className="input" defaultValue={d} required /></label>
        <label><span className="label">Start</span><input name="startTime" type="time" className="input" defaultValue={e && !e.allDay ? bneTime(e.start) : "09:00"} /></label>
        <label><span className="label">End</span><input name="endTime" type="time" className="input" defaultValue={e && !e.allDay ? bneTime(e.end) : "10:00"} /></label>
        <label className="ev-wide"><span className="label">Where</span><input name="location" className="input" defaultValue={e?.location ?? ""} /></label>
        <label className="ev-wide"><span className="label">Notes</span><textarea name="notes" className="input" rows={2} defaultValue={e?.notes ?? ""} /></label>
        <label className="tp-check"><input type="checkbox" name="allDay" defaultChecked={e?.allDay} /> All day</label>
        <label className="tp-check"><input type="checkbox" name="private" defaultChecked={e?.private} /> Private (team sees “Busy”)</label>
        <div className="ev-actions"><button className="btn">{e ? "Save" : "Add to my calendar"}</button></div>
      </ActionForm>
      {e && <ActionForm action={deleteEvent}><input type="hidden" name="id" value={e.id} /><button className="tp-del">Delete</button></ActionForm>}
    </>
  );
}

const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** First day (Monday) of the 6-week grid that shows `month` (YYYY-MM). */
export const monthGridStart = (month: string) => { const first = `${month}-01`; const wd = (new Date(first + "T00:00:00Z").getUTCDay() + 6) % 7; return addDays(first, -wd); };
export const shiftMonth = (month: string, n: number) => { const d = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 + n, 1)); return d.toISOString().slice(0, 7); };

/** A Monday–Sunday month grid. Each day lists its events (time, title, who); tap one for details. */
export function MonthCalendar({ month, items, hrefFor, showWho, maxPerDay = 4 }: { month: string; items: CalItem[]; hrefFor: (month: string) => string; showWho?: boolean; maxPerDay?: number }) {
  const today = bneToday();
  const start = monthGridStart(month);
  const lastDay = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10);
  const weeks = Math.ceil((Date.parse(lastDay) - Date.parse(start)) / 86400000 / 7 + 1 / 7);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
  const on = (d: string) => items.filter((e) => bneDateOf(e.start) <= d && bneDateOf(new Date(e.end.getTime() - 1)) >= d)
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime());
  const Ev = ({ e }: { e: CalItem }) => (
    <details className="mo-ev" style={{ ["--c" as string]: e.colour ?? "#c8102e" }}>
      <summary><i className="mo-dot" /><span className="mo-time">{e.allDay ? "All day" : bneTime(e.start)}</span> <span className="mo-title">{e.title}</span></summary>
      <div className="mo-pop">
        <b>{e.title}</b>
        <p>{e.allDay ? "All day" : `${bneTime(e.start)}–${bneTime(e.end)}`}{showWho && e.who ? ` · ${e.who}` : ""}{e.tag ? ` · ${e.tag}` : ""}</p>
        {e.location && <p>📍 {e.location}</p>}
        {e.notes && <p className="wk-notes">{e.notes}</p>}
      </div>
    </details>
  );
  return (
    <div className="mo">
      <div className="wk-nav">
        <Link prefetch={false} href={hrefFor(shiftMonth(month, -1))} className="wk-btn" aria-label="Previous month">‹</Link>
        <b className="mo-name">{MONTHS_LONG[+month.slice(5, 7) - 1]} {month.slice(0, 4)}</b>
        <Link prefetch={false} href={hrefFor(shiftMonth(month, 1))} className="wk-btn" aria-label="Next month">›</Link>
        {month !== today.slice(0, 7) && <Link prefetch={false} href={hrefFor(today.slice(0, 7))} className="acc-link">This month</Link>}
      </div>
      <div className="mo-head" aria-hidden="true">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <span key={d}>{d}</span>)}</div>
      <div className="mo-grid">
        {days.map((d) => {
          const list = on(d), out = d.slice(0, 7) !== month;
          const wd = (new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7;
          return (
            <section key={d} className={`mo-day ${out ? "is-out" : ""} ${d === today ? "is-today" : ""} ${wd >= 5 ? "is-weekend" : ""} ${list.length ? "" : "is-empty"}`} aria-label={`${d}, ${list.length} event${list.length === 1 ? "" : "s"}`}>
              <h3><span className="mo-wd">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][wd]} </span>{Number(d.slice(8, 10))}{d.slice(8, 10) === "01" ? ` ${MONTHS_LONG[+d.slice(5, 7) - 1].slice(0, 3)}` : ""}</h3>
              {list.slice(0, maxPerDay).map((e) => <Ev key={e.id + d} e={e} />)}
              {list.length > maxPerDay && (
                <details className="mo-more"><summary>+{list.length - maxPerDay} more</summary>
                  <div className="mo-morelist">{list.slice(maxPerDay).map((e) => <Ev key={e.id + d + "m"} e={e} />)}</div>
                </details>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
