/** Small CSV reader: quoted fields, commas and newlines inside quotes, "" escapes. Returns header + rows as objects. */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const out: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let k = 0; k < src.length; k++) {
    const ch = src[k];
    if (q) { if (ch === '"') { if (src[k + 1] === '"') { cell += '"'; k++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && src[k + 1] === "\n") k++; row.push(cell); out.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); out.push(row); }
  const lines = out.filter((r) => r.some((c) => c.trim() !== ""));
  if (!lines.length) return { headers: [], rows: [] };
  const headers = lines[0].map((h) => h.trim());
  return { headers, rows: lines.slice(1).map((r) => Object.fromEntries(headers.map((h, k) => [h, (r[k] ?? "").trim()]))) };
}

/** Find a value by any of several header names (case, spaces and punctuation ignored). */
export function pick(row: Record<string, string>, ...names: string[]): string {
  const keys = Object.keys(row); const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const nme of names) { const k = keys.find((x) => norm(x) === norm(nme)); if (k && row[k] !== "") return row[k]; }
  return "";
}

/** Dates as YYYY-MM-DD from 2026-11-06, 6/11/2026 (Australian), 6 Nov 2026 or Nov 6, 2026. */
export function toIsoDate(v: string): string | null {
  const t = v.trim(); if (!t) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t); if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/.exec(t); if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  const dt = new Date(t); return Number.isNaN(dt.getTime()) ? null : new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate())).toISOString().slice(0, 10);
}
export const money = (v: string) => { const x = Number(v.replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1")); return v.trim() === "" || !Number.isFinite(x) ? null : x; };

/** Finish date from a start date and a number of Mon–Fri workdays (BuilderTrend schedule exports give Start + Workdays). */
export function addWorkdays(start: string, workdays: number): string {
  const d = new Date(start + "T00:00:00Z"); let left = Math.max(1, Math.round(workdays)) - 1;
  while (left > 0) { d.setUTCDate(d.getUTCDate() + 1); const wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) left--; }
  return d.toISOString().slice(0, 10);
}
