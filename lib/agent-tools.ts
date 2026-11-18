import "server-only";
// The operations Claude (via the MCP connector) and Grok (via /api/grok) can run. Same rules for both: no deleting, no users, no software changes.
import { prisma } from "./db";
import { agentAudit, createRow, getRow, listRows, overview, updateRow, type Actor } from "./agent-api";

export async function runTool(actor: Actor, name: string, a: Record<string, unknown>): Promise<unknown> {
  const s = (k: string) => String(a[k] ?? "");
  switch (name) {
    case "crm_overview": return overview(actor);
    case "crm_list": return listRows(s("table"), a as never);
    case "crm_get": return getRow(s("table"), s("id"));
    case "crm_create": return createRow(actor, s("table"), (a.data ?? {}) as Record<string, unknown>, a.dryRun !== false);
    case "crm_update": return updateRow(actor, s("table"), s("id"), (a.data ?? {}) as Record<string, unknown>, a.dryRun !== false);
    case "crm_lease_dates": {
      const { keyDates } = await import("@/lib/leases");
      const days = Math.min(730, Math.max(1, Number(a.days) || 180));
      const leases = await prisma.lease.findMany({ include: { client: { select: { name: true } } } });
      return { dates: leases.flatMap((l) => keyDates(l).map((d) => ({ ...d, premises: [l.tenancy, l.premises].filter(Boolean).join(", "), client: l.client?.name ?? null, stage: l.status })))
        .filter((d) => d.days >= -30 && d.days <= days).sort((x, y) => x.date.localeCompare(y.date)) };
    }
    case "crm_wip": {
      const { liveJobs, wipFor } = await import("@/lib/wip");
      const { claimPlan } = await import("@/lib/claim-timing");
      const today = new Date().toISOString().slice(0, 10);
      return { jobs: (await liveJobs("DR", true)).map((j) => { const w = wipFor(j); return {
        id: j.id, name: j.name, jobNumber: j.jobNumber, status: j.status, client: j.client, contract: j.contractValue, start: j.startDate, finish: j.finishDate,
        progress: w.progress, daysLate: w.daysLate, claimed: w.claimedEx, receivedInc: w.receivedInc, owedInc: w.owedInc, costs: w.costTotal, paid: w.paidTotal,
        forecastGp: w.forecastGp, actual: { income: w.actual.income, costs: w.actual.costs, profit: w.actual.profit, pct: w.actual.pct }, flags: w.flags.map((f) => `${f.level}: ${f.text}`),
        claims: claimPlan(j, today).map((p) => ({ seq: p.seq, name: p.name, pct: p.pct, amountInc: p.amountInc, state: p.state, issueOn: p.issueOn })),
      }; }) };
    }
    case "crm_accounts": {
      const { accountsView } = await import("@/lib/accounts");
      const v = await accountsView();
      return { month: v.month, day: v.dayOfMonth, bank: v.bank, cashTotal: v.cashTotal, freeToSpend: v.freeToSpend, income: v.income, gross: v.gross, net: v.net, liveThis: v.liveThis, liveLast: v.liveLast,
        receivablesTotal: v.recvTotal, aged: v.aged, billsDue30: v.billsDue30, signedThisMonth: v.signedThisMonth, forecast: v.weeks.map((w) => ({ weekOf: w.start, in: w.inn, out: w.out, balance: w.bal })) };
    }
    case "crm_concept_fit": {
      const { runConceptFit } = await import("@/lib/concept-fit");
      const fit = await runConceptFit(s("leaseId"), s("conceptId"), s("brief").slice(0, 2000), actor.label);
      await prisma.lease.updateMany({ where: { id: s("leaseId"), status: "Enquiring" }, data: { status: "Concept proposing" } });
      await agentAudit(actor, "concept fit", "Lease", s("leaseId"), `${s("conceptId")} → ${fit.status}`);
      if (fit.status !== "done") throw new Error(fit.error ?? "The concept fit didn't work.");
      return { fitId: fit.id, result: fit.result ? JSON.parse(fit.result) : null, view: `/leases/${s("leaseId")}?fit=${fit.id}` };
    }
    case "crm_refresh_xero": {
      const conn = await prisma.xeroConnection.findUnique({ where: { id: "xero" } });
      if (!conn) throw new Error("Xero isn't connected.");
      const { syncXero } = await import("@/lib/xero");
      return { notes: await syncXero() };
    }
  }
  throw new Error(`Unknown tool ${name}`);
}

