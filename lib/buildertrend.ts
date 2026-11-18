import "server-only";
import { prisma } from "./db";
import { encrypt, decrypt } from "./crypto";

// BuilderTrend has no public API, but it can publish its Schedule as a calendar feed (iCal / .ics link).
// We read that feed: each schedule item becomes a task on the matching job. Read-only; nothing is sent to BuilderTrend.

const KEY_URL = "bt:feedUrl", KEY_STATE = "bt:state";
export type BtEvent = { uid: string; title: string; jobName: string | null; start: string; finish: string; description: string | null };
export type BtState = { lastSync: string | null; error: string | null; events: number; matched: number; unmatchedJobs: { name: string; count: number; first: string; last: string }[] };

export async function getFeedUrl() {
  const r = await prisma.integrationSetting.findUnique({ where: { key: KEY_URL } });
  if (!r) return null;
  try { return decrypt(r.value); } catch { return null; }
}
export async function setFeedUrl(url: string | null) {
  if (!url) { await prisma.integrationSetting.deleteMany({ where: { key: { in: [KEY_URL, KEY_STATE] } } }); return; }
  await prisma.integrationSetting.upsert({ where: { key: KEY_URL }, create: { key: KEY_URL, value: encrypt(url) }, update: { value: encrypt(url) } });
}
export async function getState(): Promise<BtState> {
  const r = await prisma.integrationSetting.findUnique({ where: { key: KEY_STATE } });
  return r ? JSON.parse(r.value) : { lastSync: null, error: null, events: 0, matched: 0, unmatchedJobs: [] };
}
async function saveState(s: BtState) {
  await prisma.integrationSetting.upsert({ where: { key: KEY_STATE }, create: { key: KEY_STATE, value: JSON.stringify(s) }, update: { value: JSON.stringify(s) } });
}

// ---------- .ics parsing ----------
const unfold = (t: string) => t.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
const unescape = (v: string) => v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
/** An iCal date or date-time as a Brisbane calendar date (YYYY-MM-DD). */
function icsDate(v: string, _params: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/.exec(v.trim());
  if (!m) return null;
  if (!m[4]) return `${m[1]}-${m[2]}-${m[3]}`; // all-day (VALUE=DATE)
  if (m[7] === "Z") { // UTC: shift to Brisbane (UTC+10, no daylight saving)
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + 10 * 3600000);
    return d.toISOString().slice(0, 10);
  }
  return `${m[1]}-${m[2]}-${m[3]}`; // local or TZID time: the date part is the local date
}
const minusDay = (iso: string) => new Date(Date.parse(iso + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);

export function parseIcs(text: string): BtEvent[] {
  const out: BtEvent[] = [];
  for (const block of unfold(text).split(/BEGIN:VEVENT/).slice(1)) {
    const body = block.split(/END:VEVENT/)[0];
    const get = (name: string) => { const m = new RegExp(`^${name}((?:;[^:\\r\\n]*)?):(.*)$`, "mi").exec(body); return m ? { params: m[1] ?? "", value: m[2].trim() } : null; };
    const uid = get("UID")?.value, summary = get("SUMMARY")?.value;
    const ds = get("DTSTART"), de = get("DTEND");
    if (!uid || !summary || !ds) continue;
    const start = icsDate(ds.value, ds.params); if (!start) continue;
    let finish = de ? icsDate(de.value, de.params) ?? start : start;
    // All-day events end the day after (exclusive), so step back a day.
    if (de && !/T/.test(de.value) && finish > start) finish = minusDay(finish);
    if (finish < start) finish = start;
    const description = get("DESCRIPTION") ? unescape(get("DESCRIPTION")!.value) : null;
    const location = get("LOCATION") ? unescape(get("LOCATION")!.value) : null;
    const title = unescape(summary);
    // BuilderTrend usually puts the job name in the description ("Job: ...") or as "Job Name - Task" in the title.
    const fromDesc = description ? /(?:^|\n)\s*Job(?: Name)?\s*:\s*(.+)/i.exec(description)?.[1]?.trim() : null;
    out.push({ uid, title, jobName: fromDesc || location || null, start, finish, description });
  }
  return out;
}

const norm = (s?: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Which job an event belongs to: BuilderTrend job name set on the job, then job name, then job number. */
function matchJob(e: BtEvent, jobs: { id: string; name: string; jobNumber: string | null; btJobName: string | null }[]) {
  const hay = norm(`${e.jobName ?? ""} ${e.title} ${e.description ?? ""}`);
  return jobs.find((j) => j.btJobName && hay.includes(norm(j.btJobName)))
    ?? jobs.find((j) => norm(j.name).length >= 5 && hay.includes(norm(j.name)))
    ?? jobs.find((j) => j.jobNumber && new RegExp(`\\b${j.jobNumber}\\b`).test(hay))
    ?? null;
}
/** The task name without the job name in front of it ("Hecho Robina - Sheeting" → "Sheeting"). */
function taskName(e: BtEvent, job: { name: string; btJobName: string | null }) {
  let t = e.title;
  const names = [job.btJobName, job.name, e.jobName].filter(Boolean) as string[];
  // Also the short form before " - " ("Groomd Studio - Slacks Creek" → "Groomd Studio").
  for (const prefix of [...names, ...names.map((x) => x.split(/\s+[-–]\s+/)[0])]) {
    const re = new RegExp(`^\\s*${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[-:–|]\\s*`, "i");
    t = t.replace(re, "");
  }
  return t.trim() || e.title;
}

/** Fetch the feed and update every matched job's program. Manual claim links and Done ticks are kept. */
export async function syncBuildertrend(): Promise<BtState> {
  const url = await getFeedUrl();
  const state: BtState = { lastSync: new Date().toISOString(), error: null, events: 0, matched: 0, unmatchedJobs: [] };
  if (!url) { state.error = "No BuilderTrend calendar link saved."; await saveState(state); return state; }
  let text: string;
  try {
    const res = await fetch(url.replace(/^webcal:/i, "https:"), { signal: AbortSignal.timeout(30000), headers: { Accept: "text/calendar, */*" } });
    if (!res.ok) throw new Error(`BuilderTrend returned ${res.status}`);
    text = await res.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("That link didn't return a calendar feed.");
  } catch (e) {
    state.error = `Couldn't read the BuilderTrend feed: ${(e as Error).message}`;
    await saveState(state); return state;
  }
  const events = parseIcs(text);
  state.events = events.length;
  const jobs = await prisma.job.findMany({ where: { status: { not: "Complete" } }, select: { id: true, name: true, jobNumber: true, btJobName: true, finishDate: true } });
  const unmatched = new Map<string, { name: string; count: number; first: string; last: string }>();
  const seen = new Map<string, Set<string>>();
  for (const e of events) {
    const job = matchJob(e, jobs);
    if (!job) {
      const key = e.jobName || e.title.split(/\s+[-:–|]\s+/)[0] || "Unknown";
      const u = unmatched.get(key) ?? { name: key, count: 0, first: e.start, last: e.finish };
      u.count++; if (e.start < u.first) u.first = e.start; if (e.finish > u.last) u.last = e.finish; unmatched.set(key, u);
      continue;
    }
    state.matched++;
    (seen.get(job.id) ?? seen.set(job.id, new Set()).get(job.id)!).add(e.uid);
    const data = { name: taskName(e, job), start: e.start, finish: e.finish };
    let existing = await prisma.jobTask.findFirst({ where: { externalId: e.uid } });
    // A task already on the job with the same name (entered by hand or from a CSV) is taken over, keeping its claim link and Done tick.
    if (!existing) {
      const same = await prisma.jobTask.findMany({ where: { jobId: job.id, externalId: null } });
      existing = same.find((t) => norm(t.name) === norm(data.name)) ?? null;
    }
    if (existing) await prisma.jobTask.update({ where: { id: existing.id }, data: { ...data, jobId: job.id, externalId: e.uid, source: "buildertrend" } });
    else await prisma.jobTask.create({ data: { ...data, jobId: job.id, externalId: e.uid, source: "buildertrend" } });
  }
  // Items removed from BuilderTrend are removed here too (only ones that came from BuilderTrend).
  for (const [jobId, uids] of seen) await prisma.jobTask.deleteMany({ where: { jobId, source: "buildertrend", externalId: { notIn: [...uids] } } });
  state.unmatchedJobs = [...unmatched.values()].sort((a, b) => b.count - a.count).slice(0, 40);
  await saveState(state);
  return state;
}

let btRunning: Promise<void> | null = null;
/** Start a BuilderTrend refresh without waiting for it (pages call this so they open straight away). */
export function kickBuildertrendSync() {
  if (btRunning) return;
  btRunning = syncBuildertrendIfStale().catch(() => undefined).finally(() => { btRunning = null; });
}
/** Sync if the last one is over 30 minutes old. */
export async function syncBuildertrendIfStale() {
  const url = await getFeedUrl(); if (!url) return;
  const s = await getState();
  if (s.lastSync && Date.now() - Date.parse(s.lastSync) < 30 * 60000) return;
  try { await syncBuildertrend(); } catch { /* shown on the settings page */ }
}
