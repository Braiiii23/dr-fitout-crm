import "server-only";
import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

// Access for the external lead bot: a secret key in the Authorization header (Bearer <LEADBOT_API_KEY>).
// It can only list free slots, add leads and book slots. Nothing else in the CRM is reachable with it.
const hits = new Map<string, number[]>();

export function botAuth(req: Request): NextResponse | null {
  const key = process.env.LEADBOT_API_KEY ?? "";
  if (key.length < 24) return NextResponse.json({ error: "The lead bot connection isn't switched on (LEADBOT_API_KEY not set)." }, { status: 503 });
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const a = Buffer.from(given), b = Buffer.from(key);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "Wrong or missing key." }, { status: 401 });
  // At most 60 requests a minute.
  const now = Date.now(); const list = (hits.get("bot") ?? []).filter((t) => now - t < 60000); list.push(now); hits.set("bot", list);
  if (list.length > 60) return NextResponse.json({ error: "Too many requests. Wait a minute." }, { status: 429 });
  return null;
}

export const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "") || null;
export const digits = (v: string | null) => (v ?? "").replace(/\D/g, "");
export async function body(req: Request): Promise<Record<string, unknown> | null> {
  try { const j = await req.json(); return j && typeof j === "object" && !Array.isArray(j) ? j as Record<string, unknown> : null; } catch { return null; }
}

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
/** An ISO date-time (e.g. 2026-11-10T09:00:00+10:00) as a Date, or null. */
export const when = (v: unknown) => { if (typeof v !== "string") return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
export const isoDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
export const leadBrand = (v: unknown) => { const s = String(v ?? "").toUpperCase().replace(/\s+/g, ""); return s === "DR" || s === "DRFITOUT" ? "DR" : s === "CONSULTING" ? "CONSULTING" : s === "ENP" || s === "ENPFITOUTS" || s === "" ? "ENP" : null; };
