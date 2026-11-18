"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/automations";
import { getAvailability, saveAvailability, syncAvailability } from "@/lib/availability";

/** Braiden's booking availability: working days and hours, meeting length, gap, notice and how far ahead. */
export async function saveAvailabilityAction(fd: FormData) {
  const u = await requireUser(["ADMIN"]);
  const cur = await getAvailability();
  const t = (k: string, d: string) => { const v = String(fd.get(k) ?? ""); return /^\d{2}:\d{2}$/.test(v) ? v : d; };
  const n = (k: string, d: number, min: number, max: number) => { const v = Number(fd.get(k)); return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d; };
  const days = [0, 1, 2, 3, 4, 5, 6].filter((d) => fd.get(`day${d}`) === "on");
  const next = { ...cur, enabled: true, days: days.length ? days : cur.days, start: t("start", cur.start), end: t("end", cur.end), length: n("length", cur.length, 15, 240), gap: n("gap", cur.gap, 0, 120), noticeHours: n("noticeHours", cur.noticeHours, 0, 336), horizonDays: n("horizonDays", cur.horizonDays, 1, 90) };
  if (next.end <= next.start) next.end = cur.end;
  await saveAvailability(next);
  const r = await syncAvailability();
  await audit(u.email, "booking availability", "Calendar", undefined, `${next.start}-${next.end}, ${next.length}min, ${r.open} open times`);
  revalidatePath("/calendar");
}
export async function rebuildAvailability() { await requireUser(["ADMIN"]); await syncAvailability(); revalidatePath("/calendar"); }
