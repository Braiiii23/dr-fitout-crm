import { prisma } from "@/lib/db";
import { botAuth, json, isoDate } from "@/lib/bot-api";
import { brisbaneToday } from "@/lib/time";

// GET /api/bot/follow-ups?until=YYYY-MM-DD   Stay in Touch leads, and leads with a Next Follow-up on or before `until`
// (default: two weeks from today). Read-only, for handing to Anita.
export async function GET(req: Request) {
  const denied = botAuth(req); if (denied) return denied;
  const today = brisbaneToday();
  const until = isoDate(new URL(req.url).searchParams.get("until")) ?? new Date(Date.parse(today + "T00:00:00Z") + 14 * 86400000).toISOString().slice(0, 10);
  const leads = await prisma.lead.findMany({
    where: { cancelled: false, OR: [{ stage: "Stay in Touch" }, { nextFollowUp: { not: null, lte: until }, stage: { notIn: ["Signed", "Lost"] } }] },
    select: { id: true, brand: true, stage: true, leadName: true, company: true, phone: true, email: true, nextFollowUp: true, lastContacted: true, notes: true, setter: { select: { name: true } } },
    orderBy: [{ nextFollowUp: "asc" }], take: 300,
  });
  return json({
    today, until,
    leads: leads.map((l) => ({
      leadId: l.id, brand: l.brand, stage: l.stage, name: l.leadName, company: l.company, phone: l.phone, email: l.email,
      nextFollowUp: l.nextFollowUp, overdue: !!l.nextFollowUp && l.nextFollowUp < today, lastContacted: l.lastContacted, setter: l.setter?.name ?? null,
      lastNote: l.notes ? l.notes.trim().split(/\n\s*\n/).pop()!.slice(0, 400) : null,
    })),
  });
}
