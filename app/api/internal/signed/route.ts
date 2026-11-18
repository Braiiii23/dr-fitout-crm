import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { appUrl, assertInternalAuth, jsonOk } from "@/lib/internal-api";
import { isSignedLead, leadOut } from "@/lib/internal-leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/internal/signed — Count Dollarcula: signed ENP + DR Fitout + Consulting jobs (no cancelled, no EXAMPLE/TRIAL). */
export async function GET(req: NextRequest) {
  const denied = assertInternalAuth(req);
  if (denied) return denied;
  const rows = (
    await prisma.lead.findMany({
      where: { brand: { in: ["ENP", "DR", "CONSULTING"] }, cancelled: false },
      include: { setter: { select: { name: true } } },
      orderBy: [{ signedDate: "desc" }, { updatedAt: "desc" }],
    })
  ).filter(isSignedLead);
  const base = appUrl();
  const signed = rows.map((l) => leadOut(l, base));
  const totals: Record<string, { count: number; contractValue: number }> = {};
  for (const l of signed) {
    const t = (totals[l.brandLabel] ??= { count: 0, contractValue: 0 });
    t.count++;
    t.contractValue += l.contractValue ?? 0;
  }
  return jsonOk({ appUrl: base, count: signed.length, totals, signed });
}
