import "server-only";
import { prisma } from "./db";
import { brisbaneToday, daysDiff } from "./time";

const norm = (s?: string | null) => (s ?? "").toLowerCase().replace(/\b(pty|ltd|limited|the)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

/** Leads for the same company received in the last 12 months, across ENP, DR Fitout and Consulting. */
export async function companyDuplicates(company: string | null) {
  if (!norm(company)) return [];
  const today = brisbaneToday();
  const leads = await prisma.lead.findMany({ select: { id: true, brand: true, leadName: true, company: true, stage: true, dateReceived: true, createdAt: true } });
  return leads.filter((l) => {
    if (norm(l.company) !== norm(company)) return false;
    const d = l.dateReceived ?? l.createdAt.toISOString().slice(0, 10);
    const diff = daysDiff(today, d);
    return diff >= 0 && diff <= 365;
  }).map((l) => ({ leadId: l.id, brand: l.brand, name: l.leadName, company: l.company, stage: l.stage, received: l.dateReceived }));
}

/** "6 Nov 2026" in Brisbane, for note stamps. */
export const stamp = () => new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", day: "numeric", month: "short", year: "numeric" }).format(new Date());
