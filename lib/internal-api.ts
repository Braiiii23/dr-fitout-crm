import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";

/**
 * Shared helpers for /api/internal/* routes used by teammate bots
 * (Leadardo, Count Dollarcula, Anita Reminder, Braiden routines).
 * Auth: `Authorization: Bearer <CRM_HOOK_SECRET>` or `x-crm-hook-secret: <CRM_HOOK_SECRET>`.
 * The secret is never logged or echoed.
 */

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function isInternalAuthorised(req: NextRequest | Request): boolean {
  const secret = process.env.CRM_HOOK_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") || "";
  const bearer = /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, "").trim() : "";
  const alt = (req.headers.get("x-crm-hook-secret") || "").trim();
  return (!!bearer && safeEqual(bearer, secret)) || (!!alt && safeEqual(alt, secret));
}

/** Returns a 401 response when unauthorised, otherwise null. */
export function assertInternalAuth(req: NextRequest | Request): NextResponse | null {
  if (isInternalAuthorised(req)) return null;
  return jsonErr("Unauthorised", 401);
}

export function appUrl() {
  return (process.env.APP_URL || "https://crm-production-b8fa.up.railway.app").replace(/\/$/, "");
}

export function jsonOk(data: Record<string, unknown> = {}, status = 200) {
  return NextResponse.json({ ok: status < 400, ...data }, { status });
}

export function jsonErr(error: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

export async function readJson<T = unknown>(req: Request): Promise<T | undefined> {
  try {
    return (await req.json()) as T;
  } catch {
    return undefined;
  }
}

// ---------- value coercion ----------

export type Brand = "ENP" | "DR" | "CONSULTING";
export const BRAND_LABEL: Record<Brand, string> = { ENP: "ENP Fitouts", DR: "DR Fitout", CONSULTING: "Consulting" };
export const BRAND_SLUG: Record<Brand, string> = { ENP: "enp", DR: "dr", CONSULTING: "consulting" };

/** DR Fitout CRM: only DR leads. Accepts "DR", "DR Fitout", "DR Fitouts", "dr-fitout"; anything else is rejected. */
export function normBrand(v: unknown): Brand | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return s === "dr" || s.startsWith("dr ") || s.startsWith("dr fitout") || s === "dr-fitout" ? "DR" : null;
}

export function str(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (Array.isArray(v)) return v.length ? v.map(String).join(", ") : null;
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v).trim();
  return s === "" ? null : s;
}

export function num(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function int(v: unknown): number | null | undefined {
  const n = num(v);
  return n === undefined || n === null ? n : Math.round(n);
}

export function bool(v: unknown): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "y", "checked", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "", "off"].includes(s)) return false;
  return undefined;
}

/** DateTime column value. undefined = not provided, null = clear, Invalid → undefined (ignored). */
export function dateTime(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Airtable-style date-only string "YYYY-MM-DD" (the schema stores these as strings). */
export function dateOnly(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  // Format in Australia/Brisbane so an ISO midnight-UTC+10 stays on the right day.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Attachments are stored as a JSON array [{url, filename}]. Accepts string URL(s), JSON string, or Airtable attachment objects. */
export function attachmentsJson(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  let arr: unknown = v;
  if (typeof v === "string") {
    const s = v.trim();
    if (s.startsWith("[") || s.startsWith("{")) {
      try { arr = JSON.parse(s); } catch { arr = s; }
    } else {
      arr = s.split(/[\n,]+/).map((u) => u.trim()).filter(Boolean);
    }
  }
  const list = Array.isArray(arr) ? arr : [arr];
  const out = list
    .map((a) => {
      if (typeof a === "string") return { url: a, filename: a.split("/").pop()?.split("?")[0] || a };
      if (a && typeof a === "object") {
        const o = a as Record<string, unknown>;
        const url = typeof o.url === "string" ? o.url : null;
        if (!url) return null;
        return { url, filename: typeof o.filename === "string" ? o.filename : url.split("/").pop()?.split("?")[0] || url };
      }
      return null;
    })
    .filter(Boolean);
  return out.length ? JSON.stringify(out) : null;
}

export function parseAttachments(v: string | null): { url: string; filename: string }[] {
  if (!v) return [];
  try {
    const p = JSON.parse(v);
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}

/** Drop undefined keys so Prisma leaves those columns unchanged on update. */
export function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Accept `{ [key]: [...] }`, a bare array, or a single object. */
export function asList(body: unknown, key: string): Record<string, unknown>[] | null {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    if (Array.isArray(o[key])) return o[key] as Record<string, unknown>[];
    return [o];
  }
  return null;
}

/** Look up a field by several aliases (camelCase API names + Airtable column names). */
export function pick(o: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (k in o) return o[k];
  return undefined;
}

export const TEST_ROW = /example|trial/i;
