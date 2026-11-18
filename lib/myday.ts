import "server-only";
import { randomBytes } from "crypto";
import { prisma } from "./db";
import { encrypt, decrypt } from "./crypto";
import type { CurrentUser } from "./auth";

// ---------- Brisbane dates (UTC+10, no daylight saving) ----------
const BNE = 10 * 3600000;
export const bneToday = () => new Date(Date.now() + BNE).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
/** Start of a Brisbane day as a real instant. */
export const bneStart = (iso: string) => new Date(Date.parse(iso + "T00:00:00Z") - BNE);
export const bneDateOf = (d: Date) => new Date(d.getTime() + BNE).toISOString().slice(0, 10);
export const bneTime = (d: Date) => new Date(d.getTime() + BNE).toISOString().slice(11, 16);
export const mondayOf = (iso: string) => { const wd = (new Date(iso + "T00:00:00Z").getUTCDay() + 6) % 7; return addDays(iso, -wd); };

export type Period = "day" | "week" | "month";
/** The current period containing `today`: [from, to) as dates, and how far through it we are (0–1). */
export function periodRange(period: Period, today = bneToday()) {
  const hour = new Date(Date.now() + BNE).getUTCHours() + new Date(Date.now() + BNE).getUTCMinutes() / 60;
  // Working day 7am–5pm for pace.
  const dayDone = Math.min(1, Math.max(0, (hour - 7) / 10));
  if (period === "day") return { from: today, to: addDays(today, 1), elapsed: dayDone, label: "today" };
  if (period === "week") {
    const from = mondayOf(today); const wd = (new Date(today + "T00:00:00Z").getUTCDay() + 6) % 7; // 0 = Mon
    const workDaysDone = Math.min(5, wd + (wd < 5 ? dayDone : 0));
    return { from, to: addDays(from, 7), elapsed: workDaysDone / 5, label: "this week" };
  }
  const from = today.slice(0, 8) + "01";
  const next = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7), 1)).toISOString().slice(0, 10);
  const days = (Date.parse(next) - Date.parse(from)) / 86400000;
  return { from, to: next, elapsed: Math.min(1, (Number(today.slice(8, 10)) - 1 + dayDone) / days), label: "this month" };
}

// ---------- KPI measures (what the CRM can count by itself) ----------
export const METRICS: Record<string, { label: string; unit: string; roles: string[]; percent?: boolean }> = {
  manual: { label: "Logged by hand", unit: "", roles: ["ADMIN", "SETTER", "TEAM", "ESTIMATOR", "ACCOUNTS"] },
  todos_done: { label: "To-dos ticked off", unit: "to-dos", roles: ["ADMIN", "SETTER", "TEAM", "ESTIMATOR", "ACCOUNTS"] },
  calls_logged: { label: "Calls logged (call outcomes recorded)", unit: "calls", roles: ["ADMIN", "SETTER", "TEAM"] },
  meetings_booked: { label: "Meetings booked into free slots", unit: "meetings", roles: ["ADMIN", "SETTER", "TEAM"] },
  contacts_added: { label: "Contacts added to the call list / directory", unit: "contacts", roles: ["ADMIN", "SETTER", "TEAM"] },
  calendar_meetings: { label: "Meetings in my calendar", unit: "meetings", roles: ["ADMIN", "SETTER", "TEAM", "ESTIMATOR", "ACCOUNTS"] },
  leads_added: { label: "New leads added", unit: "leads", roles: ["ADMIN", "ESTIMATOR"] },
  quotes_sent: { label: "Quotes sent (estimating)", unit: "quotes", roles: ["ADMIN", "ESTIMATOR"] },
  prelims_done: { label: "Prelims done (estimating)", unit: "prelims", roles: ["ADMIN", "ESTIMATOR"] },
  quotes_on_time: { label: "Quotes sent by their final due date (%)", unit: "%", roles: ["ADMIN", "ESTIMATOR"], percent: true },
  prelims_on_time: { label: "Prelims done by their prelim due date (%)", unit: "%", roles: ["ADMIN", "ESTIMATOR"], percent: true },
  signed_value: { label: "Signed work ($ ex GST)", unit: "$", roles: ["ADMIN", "SETTER"] },
  jobs_signed: { label: "Jobs signed", unit: "jobs", roles: ["ADMIN", "SETTER"] },
  claims_invoiced: { label: "Claims invoiced ($ ex GST)", unit: "$", roles: ["ADMIN", "ACCOUNTS"] },
  tasks_done: { label: "Program tasks ticked off (Jobs)", unit: "tasks", roles: ["ADMIN", "PM", "FOREMAN"] },
  labour_logged: { label: "Labour entries logged on jobs", unit: "entries", roles: ["ADMIN", "PM", "FOREMAN", "ACCOUNTS"] },
};

export async function measure(source: string, u: { id: string; email: string; role: string; setterId: string | null }, from: string, to: string, kpiId?: string): Promise<number> {
  const a = bneStart(from), b = bneStart(to);
  const auditCount = async (where: object) => prisma.auditLog.count({ where: { userEmail: u.email, createdAt: { gte: a, lt: b }, ...where } });
  switch (source) {
    case "manual": return kpiId ? (await prisma.kpiEntry.aggregate({ where: { kpiId, date: { gte: from, lt: to } }, _sum: { value: true } }))._sum.value ?? 0 : 0;
    case "todos_done": return prisma.todoCompletion.count({ where: { userId: u.id, date: { gte: from, lt: to } } });
    case "calls_logged": return auditCount({ entity: "CallListItem", action: { startsWith: "status" } });
    case "meetings_booked": return auditCount({ action: "book slot" });
    case "contacts_added": return auditCount({ entity: "CallListItem", action: { in: ["create", "create contact"] } });
    case "calendar_meetings": return prisma.calEvent.count({ where: { userId: u.id, allDay: false, start: { gte: a, lt: b } } });
    case "leads_added": return auditCount({ entity: "Lead", action: { in: ["create", "create quote job"] } });
    case "quotes_sent": return prisma.lead.count({ where: { estSentAt: { gte: from, lt: to } } });
    case "prelims_done": return prisma.lead.count({ where: { estPrelimAt: { gte: from, lt: to } } });
    case "signed_value": return (await prisma.lead.aggregate({ where: { stage: "Signed", cancelled: false, signedDate: { gte: from, lt: to }, ...(u.role === "SETTER" ? { setterId: u.setterId ?? "-" } : {}) }, _sum: { contractValue: true } }))._sum.contractValue ?? 0;
    case "jobs_signed": return prisma.lead.count({ where: { stage: "Signed", cancelled: false, signedDate: { gte: from, lt: to }, ...(u.role === "SETTER" ? { setterId: u.setterId ?? "-" } : {}) } });
    case "tasks_done": return auditCount({ action: "task done" });
    case "labour_logged": return auditCount({ action: { in: ["add labour"] } });
    case "claims_invoiced": return (await prisma.jobClaim.aggregate({ where: { invoicedDate: { gte: from, lt: to }, status: { in: ["Authorised", "Paid"] } }, _sum: { amount: true } }))._sum.amount ?? 0;
    default: return 0;
  }
}

/** Work out how to track a KPI from its name. Returns a measure the CRM can count, or "manual" (logged by hand). */
const GUESS: [RegExp, string][] = [
  [/prelim.*(on.?time|by (the )?due|before due|late)|(on.?time|late).*prelim/i, "prelims_on_time"],
  [/(quote|estimate|proposal|tender).*(on.?time|by (the )?due|before due|late)|(on.?time|late).*(quote|estimate|proposal|tender)/i, "quotes_on_time"],
  [/to-?dos?|tasks? on my list|checklist/i, "todos_done"],
  [/program|schedule tasks?|tasks? (done|completed|ticked)/i, "tasks_done"],
  [/prelim/i, "prelims_done"],
  [/quotes?\s*(sent|issued|out|submitted)|proposals?\s*sent|quotes?$/i, "quotes_sent"],
  [/claims?|invoic|billed|billing/i, "claims_invoiced"],
  [/jobs?\s*(signed|won)|wins?\b|contracts? signed|deals? (won|closed)/i, "jobs_signed"],
  [/signed|revenue|sales|turnover|contract value|\$ ?won/i, "signed_value"],
  [/meetings?\s*(booked|set|made)|appointments?\s*(booked|set)|bookings?/i, "meetings_booked"],
  [/calls?|dials?|phone/i, "calls_logged"],
  [/contacts?\s*(added|new)|new contacts?|directory/i, "contacts_added"],
  [/leads?|enquir/i, "leads_added"],
  [/labou?r|hours|timesheet|time ?clock/i, "labour_logged"],
  [/meetings?|site visits? booked|calendar/i, "calendar_meetings"],
];
export function guessMetric(name: string): string {
  const hit = GUESS.find(([re]) => re.test(name));
  return hit ? hit[1] : "manual";
}

/** On-time share for quotes (Sent vs final due) or prelims (Prelim vs prelim due), for items completed in the period. */
export async function onTime(kind: "quotes" | "prelims", from: string, to: string) {
  const pairs: [string, string][] = kind === "quotes"
    ? (await prisma.lead.findMany({ where: { estSentAt: { gte: from, lt: to }, estFinalDue: { not: null } }, select: { estSentAt: true, estFinalDue: true } })).map((r) => [r.estSentAt!, r.estFinalDue!])
    : (await prisma.lead.findMany({ where: { estPrelimAt: { gte: from, lt: to }, estPrelimDue: { not: null } }, select: { estPrelimAt: true, estPrelimDue: true } })).map((r) => [r.estPrelimAt!, r.estPrelimDue!]);
  const ok = pairs.filter(([done, due]) => done.slice(0, 10) <= due).length;
  return { n: pairs.length, ok, pct: pairs.length ? (ok / pairs.length) * 100 : null };
}

/** Starting KPIs by role (each person can edit, delete or add their own). */
export const DEFAULT_KPIS: Record<string, { name: string; source: string; target: number; period: Period; unit?: string }[]> = {
  SETTER: [{ name: "Calls made", source: "calls_logged", target: 40, period: "day" }, { name: "Meetings booked", source: "meetings_booked", target: 5, period: "week" }, { name: "To-dos done", source: "todos_done", target: 5, period: "day" }],
  TEAM: [{ name: "Calls made", source: "calls_logged", target: 20, period: "day" }, { name: "Contacts added", source: "contacts_added", target: 10, period: "week" }, { name: "To-dos done", source: "todos_done", target: 5, period: "day" }],
  ESTIMATOR: [{ name: "Quotes sent", source: "quotes_sent", target: 3, period: "week" }, { name: "Prelims done", source: "prelims_done", target: 3, period: "week" }, { name: "To-dos done", source: "todos_done", target: 5, period: "day" }],
  ACCOUNTS: [{ name: "Claims invoiced", source: "claims_invoiced", target: 400000, period: "month", unit: "$" }, { name: "To-dos done", source: "todos_done", target: 5, period: "day" }],
  BDM: [{ name: "New leads", source: "leads_added", target: 10, period: "week" }, { name: "Meetings booked", source: "meetings_booked", target: 5, period: "week" }, { name: "Signed work", source: "signed_value", target: 1000000, period: "month", unit: "$" }, { name: "To-dos done", source: "todos_done", target: 5, period: "day" }],
  PM: [{ name: "Program tasks done", source: "tasks_done", target: 15, period: "week" }, { name: "Labour entries logged", source: "labour_logged", target: 10, period: "week" }, { name: "To-dos done", source: "todos_done", target: 5, period: "day" }],
  FOREMAN: [{ name: "To-dos done", source: "todos_done", target: 5, period: "day" }, { name: "Site meetings", source: "calendar_meetings", target: 5, period: "week" }],
  ADMIN: [{ name: "Signed work", source: "signed_value", target: 1000000, period: "month", unit: "$" }, { name: "New leads", source: "leads_added", target: 10, period: "week" }, { name: "To-dos done", source: "todos_done", target: 5, period: "day" }],
};
export async function ensureKpis(u: CurrentUser) {
  if (await prisma.kpi.count({ where: { userId: u.id } })) return;
  const list = DEFAULT_KPIS[u.role] ?? DEFAULT_KPIS.TEAM;
  for (const [k, d] of list.entries()) await prisma.kpi.create({ data: { userId: u.id, name: d.name, source: d.source, target: d.target, period: d.period, unit: d.unit ?? METRICS[d.source]?.unit ?? null, sort: k } });
}

export type KpiView = { id: string; setBy: string | null; percent: boolean; note: string | null; name: string; unit: string | null; target: number; period: Period; source: string; actual: number; pct: number; pace: number; paceTarget: number; status: "ahead" | "on" | "behind"; label: string };
export async function kpiViews(u: CurrentUser): Promise<KpiView[]> {
  const kpis = await prisma.kpi.findMany({ where: { userId: u.id, active: true }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] });
  const user = { id: u.id, email: u.email, role: u.role, setterId: u.setterId ?? null };
  return Promise.all(kpis.map(async (k) => {
    const p = periodRange(k.period as Period);
    // Percentage KPIs (e.g. "95% of quotes on time") are judged against the target directly, not paced through the period.
    const percent = !!METRICS[k.source]?.percent || (k.source === "manual" && k.unit === "%");
    let actual = 0, note: string | null = null;
    if (k.source === "quotes_on_time" || k.source === "prelims_on_time") {
      const r = await onTime(k.source === "quotes_on_time" ? "quotes" : "prelims", p.from, p.to);
      actual = r.pct ?? 0; note = r.n ? `${r.ok} of ${r.n} on time` : `None ${k.source === "quotes_on_time" ? "sent" : "done"} with a due date yet`;
    } else if (percent) {
      const agg = await prisma.kpiEntry.aggregate({ where: { kpiId: k.id, date: { gte: p.from, lt: p.to } }, _avg: { value: true }, _count: true });
      actual = agg._avg.value ?? 0; note = agg._count ? `average of ${agg._count} entr${agg._count === 1 ? "y" : "ies"}` : "Nothing logged yet";
    } else actual = await measure(k.source, user, p.from, p.to, k.id);
    const noData = percent && note !== null && /^(None|Nothing)/.test(note);
    const pct = percent ? actual / 100 : k.target ? actual / k.target : 0;
    const paceTarget = percent ? k.target : k.target * Math.max(p.elapsed, 0.05);
    const pace = noData ? 1 : percent ? (k.target ? actual / k.target : 0) : paceTarget ? actual / paceTarget : 0;
    return { id: k.id, setBy: k.setBy, percent, note, name: k.name, unit: k.unit, target: k.target, period: k.period as Period, source: k.source, actual, pct, pace, paceTarget, status: pace >= 1.1 ? "ahead" : pace >= 0.9 ? "on" : "behind", label: p.label, ...(percent ? { status: (noData ? "on" : actual >= k.target ? (actual >= Math.min(100, k.target + 3) ? "ahead" : "on") : "behind") as "ahead" | "on" | "behind" } : {}) };
  }));
}

/** Productivity: to-dos ticked off today and how you're pacing on your KPIs, as 0–100. */
export function productivity(todos: { done: boolean }[], kpis: KpiView[]) {
  const parts: number[] = [];
  if (todos.length) parts.push(todos.filter((t) => t.done).length / todos.length);
  if (kpis.length) parts.push(kpis.reduce((t, k) => t + Math.min(1.2, k.pace), 0) / kpis.length);
  const score = parts.length ? Math.round(Math.min(1, parts.reduce((a, b) => a + b, 0) / parts.length) * 100) : 0;
  const level = score >= 95 ? "Smashing it" : score >= 70 ? "On track" : score >= 40 ? "Building momentum" : "Warming up";
  return { score, level, hasData: parts.length > 0 };
}

/** Days in a row (before today) where you ticked tasks off and left nothing due that day unfinished. */
export async function streak(userId: string, today = bneToday()) {
  const since = addDays(today, -60);
  const [done, open] = await Promise.all([
    prisma.todoCompletion.groupBy({ by: ["date"], where: { userId, date: { gte: since, lt: today } }, _count: true }),
    prisma.todo.groupBy({ by: ["date"], where: { userId, done: false, parentId: null, date: { gte: since, lt: today } }, _count: true }),
  ]);
  const ticked = new Set(done.map((r) => r.date)), missed = new Set(open.map((r) => r.date));
  let n = 0, day = addDays(today, -1);
  for (let i = 0; i < 60; i++, day = addDays(day, -1)) {
    const wd = new Date(day + "T00:00:00Z").getUTCDay();
    if (missed.has(day)) break;
    if (!ticked.has(day)) { if (wd === 0 || wd === 6) continue; break; } // weekends off don't break a streak
    n++;
  }
  return n;
}

// ---------- calendar feed + Google ----------
export async function feedToken(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { calFeedToken: true } });
  if (u?.calFeedToken) return u.calFeedToken;
  const t = randomBytes(24).toString("base64url");
  await prisma.user.update({ where: { id: userId }, data: { calFeedToken: t } });
  return t;
}
export const setGoogleIcal = (userId: string, url: string | null) => prisma.user.update({ where: { id: userId }, data: { googleIcal: url ? encrypt(url) : null, googleSyncedAt: null, googleSyncNote: null } });
const googleUrl = (enc: string | null) => { if (!enc) return null; try { return decrypt(enc); } catch { return null; } };

type Ev = { uid: string; title: string; start: Date; end: Date; allDay: boolean; location: string | null };
const unfold = (t: string) => t.replace(/\r?\n[ \t]/g, "");
const unesc = (v: string) => v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
function icsTime(v: string, params: string): { d: Date; allDay: boolean } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(v.trim());
  if (!m) return null;
  if (!m[4]) return { d: bneStart(`${m[1]}-${m[2]}-${m[3]}`), allDay: true };
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  // "Z" = UTC. A TZID or floating time is taken as Brisbane time (the team's calendars are local).
  void params;
  return { d: new Date(m[7] === "Z" ? utc : utc - BNE), allDay: false };
}
/** Events from an .ics feed between `from` and `to`, with simple repeating rules (daily / weekly / monthly) expanded. */
export function parseCalendar(text: string, from: Date, to: Date): Ev[] {
  const out: Ev[] = [];
  for (const block of unfold(text).split("BEGIN:VEVENT").slice(1)) {
    const body = block.split("END:VEVENT")[0];
    const get = (n: string) => { const m = new RegExp(`^${n}((?:;[^:\\r\\n]*)?):(.*)$`, "mi").exec(body); return m ? { p: m[1] ?? "", v: m[2].trim() } : null; };
    const all = (n: string) => [...body.matchAll(new RegExp(`^${n}(?:;[^:\\r\\n]*)?:(.*)$`, "gmi"))].map((m) => m[1].trim());
    if (/^STATUS:CANCELLED/mi.test(body)) continue;
    const uid = get("UID")?.v, ds = get("DTSTART"), de = get("DTEND");
    if (!uid || !ds) continue;
    const s = icsTime(ds.v, ds.p); if (!s) continue;
    const e = de ? icsTime(de.v, de.p) : null;
    const dur = Math.max(e ? e.d.getTime() - s.d.getTime() : s.allDay ? 86400000 : 3600000, 15 * 60000);
    const title = unesc(get("SUMMARY")?.v ?? "(no title)"), location = get("LOCATION") ? unesc(get("LOCATION")!.v) : null;
    const exdates = new Set(all("EXDATE").flatMap((x) => x.split(",")).map((x) => icsTime(x, "")?.d.getTime()).filter(Boolean) as number[]);
    const rule = get("RRULE")?.v;
    const push = (st: Date, n: number) => { if (st >= to || st.getTime() + dur <= from.getTime() || exdates.has(st.getTime())) return; out.push({ uid: n ? `${uid}#${st.toISOString()}` : uid, title, start: st, end: new Date(st.getTime() + dur), allDay: s.allDay, location }); };
    if (!rule) { push(s.d, 0); continue; }
    const r = Object.fromEntries(rule.split(";").map((x) => x.split("=")));
    const freq = r.FREQ, interval = Math.max(1, Number(r.INTERVAL) || 1), count = Number(r.COUNT) || 0;
    const until = r.UNTIL ? icsTime(r.UNTIL, "")?.d ?? to : to;
    const days = r.BYDAY ? String(r.BYDAY).split(",").map((d: string) => ["SU", "MO", "TU", "WE", "TH", "FR", "SA"].indexOf(d.slice(-2))) : null;
    let n = 0, cur = new Date(s.d);
    for (let i = 0; i < 1000 && cur <= until && cur < to && (!count || n < count); i++) {
      if (freq === "WEEKLY" && days) {
        // each listed weekday in this week
        const weekStart = new Date(cur.getTime() - ((new Date(cur.getTime() + BNE).getUTCDay()) * 86400000));
        for (const wd of days.sort()) { const st = new Date(weekStart.getTime() + wd * 86400000); if (st < s.d || st > until || (count && n >= count)) continue; push(st, ++n); }
        cur = new Date(cur.getTime() + 7 * interval * 86400000);
      } else {
        push(cur, ++n);
        if (freq === "DAILY") cur = new Date(cur.getTime() + interval * 86400000);
        else if (freq === "WEEKLY") cur = new Date(cur.getTime() + 7 * interval * 86400000);
        else if (freq === "MONTHLY") { const d = new Date(cur); d.setUTCMonth(d.getUTCMonth() + interval); cur = d; }
        else if (freq === "YEARLY") { const d = new Date(cur); d.setUTCFullYear(d.getUTCFullYear() + interval); cur = d; }
        else break;
      }
    }
  }
  return out;
}

/** Read one person's Google Calendar (secret iCal address) into their calendar here. Read-only copies; edit them in Google. */
export async function syncGoogle(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { googleIcal: true } });
  const url = googleUrl(u?.googleIcal ?? null); if (!url) return;
  const from = new Date(Date.now() - 30 * 86400000), to = new Date(Date.now() + 120 * 86400000);
  try {
    const res = await fetch(url.replace(/^webcal:/i, "https:"), { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`Google returned ${res.status}`);
    const text = await res.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("That address didn't return a calendar");
    const evs = parseCalendar(text, from, to);
    await prisma.$transaction([
      prisma.calEvent.deleteMany({ where: { userId, source: "google" } }),
      prisma.calEvent.createMany({ data: evs.slice(0, 2000).map((e) => ({ userId, title: e.title.slice(0, 300), start: e.start, end: e.end, allDay: e.allDay, location: e.location?.slice(0, 300) ?? null, source: "google", externalId: e.uid.slice(0, 300) })) }),
      prisma.user.update({ where: { id: userId }, data: { googleSyncedAt: new Date(), googleSyncNote: `${evs.length} events` } }),
    ]);
    await (await import("./availability")).syncAvailabilityFor(userId);
  } catch (e) {
    await prisma.user.update({ where: { id: userId }, data: { googleSyncedAt: new Date(), googleSyncNote: `Couldn't read Google Calendar: ${(e as Error).message}` } });
  }
}
/** Refresh every linked Google Calendar older than 15 minutes (background job). */
export async function syncAllGoogle() {
  const users = await prisma.user.findMany({ where: { googleIcal: { not: null }, active: true }, select: { id: true, googleSyncedAt: true } });
  for (const u of users) if (!u.googleSyncedAt || Date.now() - u.googleSyncedAt.getTime() > 15 * 60000) await syncGoogle(u.id);
}

/** The person's CRM events as an .ics feed (what Google / Outlook subscribe to). */
export function toIcs(name: string, events: { id: string; title: string; start: Date; end: Date; allDay: boolean; location: string | null; notes: string | null; updatedAt: Date }[]) {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  const ts = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = (d: Date) => bneDateOf(d).replace(/-/g, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ENP Fitouts CRM//My Day//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${esc(`CRM · ${name}`)}`, "X-WR-TIMEZONE:Australia/Brisbane", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.id}@enp-crm`, `DTSTAMP:${ts(e.updatedAt)}`,
      ...(e.allDay ? [`DTSTART;VALUE=DATE:${day(e.start)}`, `DTEND;VALUE=DATE:${day(new Date(e.end.getTime() + (bneDateOf(e.end) === bneDateOf(e.start) ? 86400000 : 0)))}`] : [`DTSTART:${ts(e.start)}`, `DTEND:${ts(e.end)}`]),
      `SUMMARY:${esc(e.title)}`, ...(e.location ? [`LOCATION:${esc(e.location)}`] : []), ...(e.notes ? [`DESCRIPTION:${esc(e.notes)}`] : []), "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
