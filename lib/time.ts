// Australia/Brisbane is UTC+10 all year (no daylight saving).
export const TZ = "Australia/Brisbane";
const OFFSET_MS = 10 * 60 * 60 * 1000;

/** Today in Brisbane as YYYY-MM-DD */
export function brisbaneToday(now: Date = new Date()): string {
  return new Date(now.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}
/** Previous calendar month in Brisbane as YYYY-MM (the month "Payable This Month" pays for). */
export function previousBrisbaneMonth(now: Date = new Date()): string {
  const b = new Date(now.getTime() + OFFSET_MS);
  const y = b.getUTCFullYear();
  const m = b.getUTCMonth(); // 0-based current month => previous month is m-1
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toISOString().slice(0, 7);
}
/** Whole-day difference a - b for YYYY-MM-DD (or ISO) values, like Airtable DATETIME_DIFF(a,b,'days'). */
export function daysDiff(a: string | Date, b: string | Date): number {
  const ta = typeof a === "string" ? Date.parse(a.length === 10 ? a + "T00:00:00Z" : a) : a.getTime();
  const tb = typeof b === "string" ? Date.parse(b.length === 10 ? b + "T00:00:00Z" : b) : b.getTime();
  return Math.trunc((ta - tb) / 86400000);
}
export function fmtDateTime(d?: Date | string | null): string {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(dt);
}
export function fmtDate(d?: string | null): string {
  if (!d) return "";
  const dt = new Date(d.length === 10 ? d + "T00:00:00Z" : d);
  return new Intl.DateTimeFormat("en-AU", { timeZone: d.length === 10 ? "UTC" : TZ, day: "numeric", month: "short", year: "numeric" }).format(dt);
}
/** Value for <input type="datetime-local"> in Brisbane time */
export function toLocalInput(d?: Date | null): string {
  if (!d) return "";
  return new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 16);
}
/** Parse <input type="datetime-local"> value entered in Brisbane time */
export function fromLocalInput(v?: string | null): Date | null {
  if (!v) return null;
  const t = Date.parse(v + ":00Z");
  return isNaN(t) ? null : new Date(t - OFFSET_MS);
}
export function slotLabel(start: Date, end: Date): string {
  const f = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-AU", { timeZone: TZ, ...o }).format(d);
  const t = (d: Date) => f(d, { hour: "numeric", minute: "2-digit", hour12: true }).replace(" ", "").toLowerCase();
  return `${f(start, { weekday: "short" })} ${f(start, { day: "numeric", month: "short" })}, ${t(start)} to ${t(end)}`;
}

/** Current calendar month in Brisbane as YYYY-MM. */
export function currentBrisbaneMonth(now: Date = new Date()): string {
  return new Date(now.getTime() + OFFSET_MS).toISOString().slice(0, 7);
}
