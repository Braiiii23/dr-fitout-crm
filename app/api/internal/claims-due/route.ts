import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { appUrl, assertInternalAuth, jsonOk } from "@/lib/internal-api";
import { claimPlan } from "@/lib/claim-timing";
import { brisbaneToday } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/internal/claims-due?days=14 — Count Dollarcula / Anita: claim invoices to issue (ready now or due within `days`),
 *  worked out from each live job's build program. */
export async function GET(req: NextRequest) {
  const denied = assertInternalAuth(req);
  if (denied) return denied;
  const days = Math.min(90, Math.max(0, Number(new URL(req.url).searchParams.get("days")) || 14));
  const today = brisbaneToday();
  const until = new Date(Date.parse(today + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
  const s = await prisma.accountsSettings.findUnique({ where: { id: "settings" } });
  const jobs = await prisma.job.findMany({ where: { status: "Live" }, include: { claims: true, tasks: true } });
  const claims = jobs.flatMap((j) => claimPlan(j, today, s?.claimTermsDays ?? 10, s?.claimNoticeDays ?? 3)
    .filter((p) => p.state !== "issued" && p.issueOn && p.issueOn <= until)
    .map((p) => ({
      jobId: j.id, job: j.name, jobNumber: j.jobNumber, xeroTracking: j.xeroTracking, client: j.client, brand: j.brand, brandLabel: j.brand === "DR" ? "DR Fitout" : "ENP Fitouts",
      claimId: p.claimId, claim: p.seq, name: p.name, pct: p.pct, amountEx: p.amount, amountInc: p.amountInc,
      issueOn: p.issueOn, readyNow: p.state === "ready", basis: p.basis, suggestedDue: p.dueOn,
      invoiceNumber: j.claims.find((c) => c.id === p.claimId)?.invoiceNumber ?? null, crmUrl: `${appUrl()}/jobs/${j.id}?tab=claims`,
    })))
    .sort((a, b) => a.issueOn!.localeCompare(b.issueOn!));
  return jsonOk({ today, until, count: claims.length, claims });
}
