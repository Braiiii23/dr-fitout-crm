import { grokAuth, json, grokAudit } from "@/lib/grok-api";
import { prisma } from "@/lib/db";
import { bookSlot, releaseSlot } from "@/lib/automations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ action: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const denied = grokAuth(req); if (denied) return denied;
  const action = (await ctx.params).action;
  if (action === "accounts") {
    const { accountsView } = await import("@/lib/accounts");
    const v = await accountsView();
    return json({ ok: true, month: v.month, day: v.dayOfMonth, bank: v.bank, cashTotal: v.cashTotal, freeToSpend: v.freeToSpend, ideal: v.ideal, income: v.income, gross: v.gross, net: v.net, liveThis: v.liveThis, liveLast: v.liveLast, xeroNet: v.xeroNet, receivablesTotal: v.recvTotal, aged: v.aged, billsDue30: v.billsDue30, work: { ...v.work, securedJobs: v.work.securedJobs.map((j) => ({ name: j.name, contract: j.contract, cost: j.cost, gp: j.gpTotal, gpPct: j.gpPct, leftToInvoice: j.remaining, invoiced: j.inv.invoiced, paid: j.inv.paid })) }, forecast: v.weeks.map((w) => ({ weekOf: w.start, in: w.inn, out: w.out, balance: w.bal })), signedThisMonth: v.signedThisMonth, insights: { ...v.insights, months: v.insights.months } });
  }
  if (action === "wip") {
    const { liveJobs, wipFor } = await import("@/lib/wip");
    const { claimPlan } = await import("@/lib/claim-timing");
    const jobs = await liveJobs("ALL", true);
    return json({ ok: true, jobs: jobs.map((j) => { const w = wipFor(j); return {
      id: j.id, name: j.name, jobNumber: j.jobNumber, brand: j.brand, status: j.status, client: j.client, xeroTracking: j.xeroTracking, contract: j.contractValue, start: j.startDate, finish: j.finishDate,
      progress: w.progress, daysLate: w.daysLate, claimed: w.claimedEx, receivedInc: w.receivedInc, owedInc: w.owedInc, costs: w.costTotal, paid: w.paidTotal, owingKnown: w.owingKnown, pendingTrades: w.pendingCount,
      forecastGp: w.forecastGp, actual: { income: w.actual.income, costs: w.actual.costs, profit: w.actual.profit, pct: w.actual.pct }, flags: w.flags.map((f) => `${f.level}: ${f.text}`),
      claims: claimPlan(j, new Date().toISOString().slice(0, 10)).map((p) => ({ seq: p.seq, name: p.name, pct: p.pct, amountInc: p.amountInc, state: p.state, issueOn: p.issueOn, basis: p.basis })),
    }; }) });
  }
  return json({ ok: false, error: "Unknown action. GET /api/grok lists them." }, 404);
}

export async function POST(req: Request, ctx: Ctx) {
  const denied = grokAuth(req); if (denied) return denied;
  const action = (await ctx.params).action;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (action === "book-slot") {
      const callId = String(b.callId ?? ""), slotId = String(b.slotId ?? "");
      if (!(await prisma.callListItem.findUnique({ where: { id: callId } }))) return json({ ok: false, error: "callId not found" }, 404);
      const slot = await bookSlot(callId, slotId, true);
      await grokAudit("book slot", "CallListItem", callId, slot.label ?? slotId);
      return json({ ok: true, booked: { callId, slotId, start: slot.start } });
    }
    if (action === "release-slot") {
      const callId = String(b.callId ?? "");
      await releaseSlot(callId);
      await grokAudit("release slot", "CallListItem", callId, "");
      return json({ ok: true, released: callId });
    }
    if (action === "refresh-xero") {
      const { syncXero } = await import("@/lib/xero");
      const conn = await prisma.xeroConnection.findUnique({ where: { id: "xero" } });
      if (!conn) return json({ ok: false, error: "Xero isn't connected" }, 409);
      const notes = await syncXero();
      return json({ ok: true, notes });
    }
  } catch (e) { return json({ ok: false, error: (e as Error).message }, 400); }
  return json({ ok: false, error: "Unknown action" }, 404);
}
