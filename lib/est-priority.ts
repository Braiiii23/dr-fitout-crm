export const PRIORITIES = ["High", "Normal", "Low"] as const;
const RANK: Record<string, number> = { High: 0, Normal: 1, Low: 2 };
export const priorityRank = (p?: string | null) => RANK[p ?? "Normal"] ?? 1;

type Due = { estPrelimDue?: string | null; estFinalDue?: string | null; estPrelimAt?: string | null; estProposalAt?: string | null; estSentAt?: string | null };
/** The next due date still open: prelim until the proposal is done, then final. */
export function nextDue(r: Due): { kind: "Prelim" | "Final"; date: string } | null {
  if (r.estPrelimDue && !r.estPrelimAt && !r.estProposalAt && !r.estSentAt) return { kind: "Prelim", date: r.estPrelimDue };
  if (r.estFinalDue && !r.estSentAt) return { kind: "Final", date: r.estFinalDue };
  return null;
}
export const daysUntil = (iso: string, today: string) => Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
export function dueTone(iso: string, today: string): "overdue" | "today" | "soon" | "later" {
  const d = daysUntil(iso, today);
  return d < 0 ? "overdue" : d === 0 ? "today" : d <= 7 ? "soon" : "later";
}
/** Board order: priority first, then the soonest open due date, then how far along. */
export const boardSort = <T extends Due & { estPriority?: string | null }>(pct: (r: T) => number) => (a: T, b: T) =>
  (priorityRank(a.estPriority) - priorityRank(b.estPriority))
  || ((nextDue(a)?.date ?? "9999") .localeCompare(nextDue(b)?.date ?? "9999"))
  || (pct(b) - pct(a));
