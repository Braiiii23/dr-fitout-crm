import "server-only";
import { prisma } from "./db";
import { brisbaneToday } from "./time";
import type { XInvoice } from "./xero";
import { xeroInsights } from "./xero-insights";
import { jobMoney } from "./job-estimate";
import { matchJobInvoices } from "./job-invoices";
import { fullJobInclude, wipFor } from "./wip";
import { claimPlan } from "./claim-timing";

// ---------- small helpers ----------
const num = (v: unknown) => { const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
const matches = (name: string, list: string) => list.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).some((f) => name.toLowerCase().includes(f));
const dateOnly = (s?: string) => (s ? s.slice(0, 10) : "");
const addDays = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

type Cell = { Value?: string };
type ReportRow = { RowType: string; Title?: string; Cells?: Cell[]; Rows?: ReportRow[] };
type Report = { Reports?: { Rows: ReportRow[] }[] };

export type PLLine = { kind: "head" | "row" | "total"; label: string; value: number };
export type PL = { lines: PLLine[]; income: number; cos: number; gross: number; opex: number; net: number; source: "xero-report" | "worked-out" | "none" };

/** Read Xero's Profit and Loss report into lines plus the headline totals. Works with AU wording (Trading Income, Cost of Sales...). */
function parsePL(r: Report | null): PL | null {
  const rows = r?.Reports?.[0]?.Rows;
  if (!rows) return null;
  const lines: PLLine[] = [];
  let income = 0, cos = 0, opex = 0, gross: number | null = null, net: number | null = null;
  for (const sec of rows) {
    if (sec.RowType !== "Section") continue;
    const title = sec.Title ?? "";
    if (title) lines.push({ kind: "head", label: title.replace(/^Less\s+/i, ""), value: 0 });
    for (const row of sec.Rows ?? []) {
      const label = row.Cells?.[0]?.Value ?? ""; const value = num(row.Cells?.[1]?.Value);
      if (row.RowType === "Row") {
        if (/gross profit/i.test(label)) { gross = value; lines.push({ kind: "total", label, value }); }
        else if (/net profit/i.test(label)) { net = value; lines.push({ kind: "total", label, value }); }
        else lines.push({ kind: "row", label, value });
      } else if (row.RowType === "SummaryRow") {
        lines.push({ kind: "total", label, value });
        if (/cost of sales/i.test(title)) cos = value;
        else if (/operating expenses/i.test(title)) opex = value;
        else if (/income/i.test(title) && !/other/i.test(title)) income = value;
      }
    }
  }
  return { lines, income, cos, opex, gross: gross ?? income - cos, net: net ?? income - cos - opex, source: "xero-report" };
}

/** When the P&L report isn't available: income from sales invoices, costs from bills and direct spending, by month. */
function workedOutPL(sales: XInvoice[], bills: XInvoice[], spend: { DateString?: string; SubTotal?: number }[], month: string): PL {
  const inMonth = (d?: string) => dateOnly(d).startsWith(month);
  const income = sales.filter((i) => inMonth(i.DateString)).reduce((s, i) => s + num(i.SubTotal), 0);
  const billed = bills.filter((i) => inMonth(i.DateString)).reduce((s, i) => s + num(i.SubTotal), 0);
  const spent = spend.filter((t) => inMonth(t.DateString)).reduce((s, t) => s + num(t.SubTotal), 0);
  const costs = billed + spent;
  return {
    // Bills are mostly trades and materials, so they stand in for cost of sales; money paid straight
    // from the bank (wages, rent, cards) stands in for running costs.
    lines: [
      { kind: "head", label: "Income", value: 0 }, { kind: "row", label: "Sales invoices", value: income }, { kind: "total", label: "Total income", value: income },
      { kind: "head", label: "Job costs", value: 0 }, { kind: "row", label: "Supplier and trade bills", value: billed }, { kind: "total", label: "Gross profit (after bills)", value: income - billed },
      { kind: "head", label: "Running costs", value: 0 }, { kind: "row", label: "Paid directly from the bank", value: spent },
      { kind: "total", label: "Net profit", value: income - costs },
    ],
    income, cos: billed, gross: income - billed, opex: spent, net: income - costs, source: "worked-out",
  };
}

export async function accountsView() {
  const settings = (await prisma.accountsSettings.findUnique({ where: { id: "settings" } })) ?? (await prisma.accountsSettings.create({ data: { id: "settings" } }));
  const conn = await prisma.xeroConnection.findUnique({ where: { id: "xero" } });
  const snaps = Object.fromEntries((await prisma.xeroSnapshot.findMany()).map((s) => [s.key, s]));
  const snap = <T,>(k: string): T | null => (snaps[k]?.ok ? (JSON.parse(snaps[k].json) as T) : null);
  const today = brisbaneToday();
  const month = today.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const prevMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dayOfMonth = Number(today.slice(8, 10));

  // ----- bank -----
  const bank: { name: string; balance: number; kind: "cash" | "holding" | "credit" | "other" }[] = [];
  const bs = snap<Report>("bankSummary");
  const bsRows = bs?.Reports?.[0]?.Rows ?? [];
  const header = bsRows.find((r) => r.RowType === "Header")?.Cells?.map((c) => c.Value ?? "") ?? [];
  const closingIdx = Math.max(header.findIndex((h) => /closing/i.test(h)), 0) || (header.length ? header.length - 1 : 5);
  const receivedIdx = header.findIndex((h) => /received/i.test(h)), spentIdx = header.findIndex((h) => /spent/i.test(h));
  let cashReceived = 0, cashSpent = 0;
  for (const sec of bsRows) for (const r of sec.Rows ?? []) {
    if (r.RowType !== "Row") continue;
    const name = r.Cells?.[0]?.Value ?? ""; const balance = num(r.Cells?.[closingIdx]?.Value);
    // Credit cards: anything listed in settings, plus names that are obviously cards.
    const kind = matches(name, settings.creditAccounts) || /american express|amex|credit card|visa|mastercard/i.test(name) ? "credit" : matches(name, settings.holdingAccounts) ? "holding"
      : !settings.cashAccounts || matches(name, settings.cashAccounts) ? "cash" : "other";
    bank.push({ name, balance, kind });
    if (kind === "cash" || kind === "holding") { if (receivedIdx > 0) cashReceived += num(r.Cells?.[receivedIdx]?.Value); if (spentIdx > 0) cashSpent += num(r.Cells?.[spentIdx]?.Value); }
  }
  const cashTotal = bank.filter((b) => b.kind === "cash" || b.kind === "holding").reduce((s, b) => s + b.balance, 0);
  const holding = bank.filter((b) => b.kind === "holding").reduce((s, b) => s + b.balance, 0);
  const creditOwed = bank.filter((b) => b.kind === "credit").reduce((s, b) => s + Math.min(0, b.balance), 0);
  const freeToSpend = cashTotal - holding - settings.bufferAmount + creditOwed;

  // ----- money owed both ways -----
  // Items overdue by more than staleDays are usually paid-but-not-reconciled or in dispute: list them to check in Xero,
  // and keep them out of the 30-day lists and the cash forecast so they don't swamp week 1.
  const staleBefore = addDays(today, -settings.staleDays);
  const isStale = (i: XInvoice) => { const d = dateOnly(i.DueDateString); return !!d && d < staleBefore; };
  const recvAll = (snap<XInvoice[]>("receivables") ?? []).filter((i) => num(i.AmountDue) > 0);
  const payAll = (snap<XInvoice[]>("payables") ?? []).filter((i) => num(i.AmountDue) > 0);
  const recv = recvAll.filter((i) => !isStale(i)), pay = payAll.filter((i) => !isStale(i));
  const staleRecv = recvAll.filter(isStale).sort((a, b) => num(b.AmountDue) - num(a.AmountDue));
  const stalePay = payAll.filter(isStale).sort((a, b) => num(b.AmountDue) - num(a.AmountDue));
  const in30 = addDays(today, 30);
  const bills = pay.filter((i) => dateOnly(i.DueDateString) <= in30).sort((a, b) => dateOnly(a.DueDateString).localeCompare(dateOnly(b.DueDateString)));
  const incoming = recv.filter((i) => dateOnly(i.DueDateString) <= in30).sort((a, b) => dateOnly(a.DueDateString).localeCompare(dateOnly(b.DueDateString)));
  const aged = { notDue: 0, late1to30: 0, late30plus: 0, late30count: 0 };
  for (const i of recvAll) {
    const late = daysBetween(dateOnly(i.DueDateString) || today, today);
    if (late <= 0) aged.notDue += num(i.AmountDue); else if (late <= 30) aged.late1to30 += num(i.AmountDue); else { aged.late30plus += num(i.AmountDue); aged.late30count++; }
  }
  const billsDue30 = bills.reduce((s, i) => s + num(i.AmountDue), 0);
  const incoming30 = incoming.reduce((s, i) => s + num(i.AmountDue), 0);

  // ----- profit and loss -----
  const plThis = parsePL(snap<Report>("plThis")) ?? (conn ? workedOutPL(snap<XInvoice[]>("salesRecent") ?? [], snap<XInvoice[]>("billsRecent") ?? [], snap<{ DateString?: string; SubTotal?: number }[]>("spendRecent") ?? [], month) : null);
  const plLast = parsePL(snap<Report>("plLast")) ?? (conn ? workedOutPL(snap<XInvoice[]>("salesRecent") ?? [], snap<XInvoice[]>("billsRecent") ?? [], snap<{ DateString?: string; SubTotal?: number }[]>("spendRecent") ?? [], prevMonth) : null);
  const plSource = snaps.plThis?.ok ? "xero-report" : snaps.plThis?.note === "not-allowed" ? "worked-out" : plThis?.source ?? "none";

  // ----- CRM -----
  const signed = await prisma.lead.findMany({ where: { stage: "Signed", contractValue: { gt: 0 }, brand: { in: ["ENP", "DR"] } }, select: { contractValue: true } });
  const crmAvgJob = signed.length ? signed.reduce((s, l) => s + (l.contractValue ?? 0), 0) / signed.length : 0;
  const since30 = new Date(Date.now() - 30 * 86400000);
  const enquiries30 = await prisma.lead.count({ where: { createdAt: { gte: since30 } } });
  const signedThisMonth = (await prisma.lead.findMany({ where: { stage: "Signed", signedDate: { startsWith: month } }, select: { contractValue: true } })).reduce((s, l) => s + (l.contractValue ?? 0), 0);

  // ----- what 12 months of Xero history says -----
  const insights = xeroInsights(snap, today);
  const fromXero = settings.useXeroFigures && insights.usable && insights.runningAvg3 > 0;
  const opexFromReport = insights.source === "xero-report";

  // ----- work on the books: signed work still to invoice, and quotes in progress -----
  const signedJobs = await prisma.lead.findMany({
    where: { stage: "Signed", cancelled: false, contractValue: { gt: 0 }, brand: { in: ["ENP", "DR"] } },
    select: { id: true, brand: true, stage: true, company: true, leadName: true, contractValue: true, grossProfit: true, signedDate: true, depositClearedDate: true, claim50PaidDate: true, jobNumber: true, xeroContact: true,
      quoteValue: true, estOtherCosts: true, estContingencyPct: true, tradeQuotes: { select: { trade: true, price: true, status: true } }, scopeItems: { select: { trade: true, byClient: true } } },
  });
  const yearAgoIso = addDays(today, -365);
  const recentSigned = signedJobs.filter((j) => !j.signedDate || j.signedDate >= yearAgoIso);
  const quoting = await prisma.lead.findMany({ where: { stage: "Quoting", cancelled: false, brand: { in: ["ENP", "DR"] } }, select: { quoteValue: true } });

  // ----- running costs: Xero's operating expenses (P&L), average of the last 3 complete months -----
  const g = settings.grossMarginGoal / 100, n = settings.netMarginGoal / 100;
  const R = fromXero ? insights.runningAvg3 : settings.runningCostsMonthly;
  const runningFrom = fromXero
    ? (opexFromReport ? "Xero operating expenses: average of the last 3 complete months" : "Estimated from bank spending (Xero P&L not available)")
    : "Your settings";

  // ----- realistic monthly turnover target (the $1M stays the sales goal) -----
  // Enough turnover to cover running costs and still make the net margin goal at the margin you actually achieve,
  // and at least a little above what you've averaged over the last 6 months. Rounded to the nearest $10k.
  const salesGoal = settings.monthlyTarget;
  const actualGm = insights.usable && insights.grossPct6 > 0 ? insights.grossPct6 / 100 : g;
  const neededForNet = actualGm - n > 0.05 ? R / (actualGm - n) : R / Math.max(actualGm, 0.05) * 1.25;
  const stretch = insights.usable ? insights.incomeAvg6 * 1.05 : 0;
  const autoTarget = Math.round(Math.max(neededForNet, stretch) / 10000) * 10000;
  const T = settings.accountsTarget > 0 ? settings.accountsTarget : autoTarget || salesGoal;
  const targetFrom = settings.accountsTarget > 0 ? "Set in settings"
    : insights.usable ? (stretch >= neededForNet ? "Last 6 months' average turnover + 5%" : `Covers running costs and a ${settings.netMarginGoal}% net margin at your ${(actualGm * 100).toFixed(1)}% gross margin`)
    : "Sales goal (not enough Xero history yet)";
  const avgJob = settings.avgJobSize > 0 ? settings.avgJobSize : crmAvgJob;
  const breakEven = g > 0 ? R / g : 0;
  const jobsTarget = avgJob ? salesGoal / avgJob : 0, jobsBreakEven = avgJob ? breakEven / avgJob : 0;
  const ideal = {
    target: T, grossGoal: settings.grossMarginGoal, grossAtTarget: T * g, runningCosts: R, perDay: R / 30.4, breakEven,
    netAtTarget: T * actualGm - R, netPctAtTarget: T ? (T * actualGm - R) / T * 100 : 0, costCeiling: T * g - T * n, netGoal: settings.netMarginGoal,
    avgJob, avgJobFrom: settings.avgJobSize > 0 ? "settings" : signed.length ? `${signed.length} signed job${signed.length === 1 ? "" : "s"} in the CRM` : "no signed jobs yet",
    jobsTarget, jobsBreakEven, quotesNeeded: jobsTarget / (settings.quoteWinRate / 100), winRate: settings.quoteWinRate, enquiries30,
    bufferMin: R, bufferIdealLow: 2 * R, bufferIdealHigh: 3 * R, buffer: settings.bufferAmount, bufferDays: R ? settings.bufferAmount / (R / 30.4) : 0,
    taxRate: settings.companyTaxRate, runningFrom, targetFrom, salesGoal, neededForNet, stretch, actualGm: actualGm * 100,
  };

  // ----- 13-week cash forecast -----
  const monday = (() => { const d = new Date(today + "T00:00:00Z"); const wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd); return d.toISOString().slice(0, 10); })();
  const weeklyRunning = settings.addRunningCostsToForecast ? R * 12 / 52 : 0;
  // Beyond the next 30 days there are few invoices or bills in Xero yet, so assume work carries on at last month's
  // turnover: money in incl. GST, and job costs at (1 - gross margin goal), also incl. GST.
  const lastIncome = (plLast?.income ?? 0) || (plThis?.income ?? 0);
  const weeklyTurnover = !settings.forecastSecuredOnly && settings.forecastRecurringIncome ? lastIncome * 12 / 52 : 0;
  const horizon = addDays(today, 30);
  // Secured-only: signed work still to invoice is billed evenly over the typical job length, paid after the
  // average days clients take to pay; its job costs go out at your actual cost ratio two weeks after billing.
  // Same figures as the estimating board (jobMoney), with the average Xero margin for jobs without a GP or estimate.
  // Every sales invoice Xero has (24 months), newest copy of each.
  const allSales = new Map<string, XInvoice>();
  for (const i of [...(snap<XInvoice[]>("salesHistory") ?? []), ...(snap<XInvoice[]>("salesRecent") ?? []), ...(snap<XInvoice[]>("receivables") ?? [])]) allSales.set(i.InvoiceID, i);
  const salesList = [...allSales.values()];
  const haveSales = salesList.length > 0;
  const secured = recentSigned.map((j) => {
    const m = jobMoney(j, actualGm);
    const ratio = m.sell > 0 && m.gp != null ? Math.max(0, m.gp) / m.sell : actualGm;
    const inv = matchJobInvoices(j, salesList);
    // Actual: left to invoice = signed - invoiced in Xero. Without a match, fall back to the deposit/claim ticks.
    const claimed = j.claim50PaidDate ? 0.6 : j.depositClearedDate ? settings.depositPct / 100 : 0;
    const remaining = inv.matched ? Math.max(0, m.sell - inv.invoiced) : m.sell * (1 - claimed);
    return {
      id: j.id, brand: j.brand, name: j.company || j.leadName || "Job", signedDate: j.signedDate, contract: m.sell, cost: m.cost, gpTotal: m.gp, gpPct: m.gpPct,
      from: m.from, final: m.final, remaining, ratio, inv, xeroContact: j.xeroContact, actual: inv.matched,
    };
  });
  const jobRatio = (j: { ratio: number }) => j.ratio;

  // ----- live profit: each invoice raised x that job's GP %, minus running costs as the month goes -----
  const invoiceJob = new Map<string, { name: string; ratio: number; from: string }>();
  for (const j of secured) for (const id of j.inv.ids) invoiceJob.set(id, { name: j.name, ratio: j.ratio, from: j.from });
  const liveFor = (monthKey: string, runningShare: number) => {
    const inv = salesList.filter((i) => (i.Status === "AUTHORISED" || i.Status === "PAID") && (i.DateString ?? "").startsWith(monthKey) && num(i.SubTotal) > 0);
    const byJob = new Map<string, { name: string; invoiced: number; gp: number; ratio: number; from: string }>();
    let otherInv = 0;
    for (const i of inv) {
      const j = invoiceJob.get(i.InvoiceID);
      if (!j) { otherInv += num(i.SubTotal); continue; }
      const row = byJob.get(j.name) ?? { name: j.name, invoiced: 0, gp: 0, ratio: j.ratio, from: j.from };
      row.invoiced += num(i.SubTotal); row.gp += num(i.SubTotal) * j.ratio; byJob.set(j.name, row);
    }
    const jobs = [...byJob.values()].sort((a, b) => b.invoiced - a.invoiced);
    const income = jobs.reduce((t, j) => t + j.invoiced, 0) + otherInv;
    const gp = jobs.reduce((t, j) => t + j.gp, 0) + otherInv * actualGm;
    const running = R * runningShare;
    return { income, gp, gpPct: income ? gp / income * 100 : 0, running, net: gp - running, jobs, otherInv, otherGp: otherInv * actualGm, otherRatio: actualGm * 100 };
  };
  // ----- live jobs in WIP: claims come in on the dates worked out from each job's program -----
  const wipJobs = (await prisma.job.findMany({ where: { status: "Live" }, include: fullJobInclude })).map((j) => ({ j, w: wipFor(j, today), plan: claimPlan(j, today, settings.claimTermsDays, settings.claimNoticeDays) }));
  const leadsInWip = new Set(wipJobs.map((x) => x.j.leadId).filter(Boolean) as string[]);
  const claimIn: { date: string; inc: number }[] = [];
  const wipCostWeeks: { from: string; to: string; perWeekInc: number }[] = [];
  for (const { j, w, plan } of wipJobs) {
    for (const p of plan) if (p.state !== "issued") claimIn.push({ date: p.dueOn ?? addDays(j.finishDate ?? addDays(today, settings.jobWeeks * 7), settings.claimTermsDays), inc: p.amountInc });
    // Costs still to pay on the job (forecast cost − paid − bills already in Xero), spread to handover.
    const left = Math.max(0, w.forecastCost - w.paidTotal - w.billsOwing) * 1.1;
    const to = j.finishDate && j.finishDate > today ? j.finishDate : addDays(today, settings.jobWeeks * 7);
    const nWeeks = Math.max(1, Math.ceil((Date.parse(to) - Date.parse(today)) / (7 * 86400000)));
    if (left > 0) wipCostWeeks.push({ from: today, to, perWeekInc: left / nWeeks });
  }
  // Signed CRM jobs that are now in WIP use their claim dates instead of the even spread.
  const spread = secured.filter((j) => !leadsInWip.has(j.id));
  // Jobs in WIP that aren't signed leads in the CRM (e.g. older jobs) still count as work on the books.
  const wipOnly = wipJobs.filter(({ j }) => !j.leadId || !secured.some((x) => x.id === j.leadId));
  const wipOnlyLeft = wipOnly.reduce((t, { j, w }) => t + Math.max(0, j.contractValue - w.claimedEx), 0);
  const wipOnlyGp = wipOnly.reduce((t, { j, w }) => t + Math.max(0, j.contractValue - w.claimedEx) * (j.contractValue ? Math.max(0, w.forecastGp) / j.contractValue : actualGm), 0);

  const securedTotal = secured.reduce((t, j) => t + j.remaining, 0) + settings.otherWorkOnHand + wipOnlyLeft;
  const spreadTotal = spread.reduce((t, j) => t + j.remaining, 0) + settings.otherWorkOnHand;
  const payLagWeeks = Math.round((insights.avgDaysToPay ?? 14) / 7);

  const securedCosts = spread.reduce((t, j) => t + j.remaining * (1 - jobRatio(j)), 0) + settings.otherWorkOnHand * (1 - actualGm);
  const perWeek = settings.forecastSecuredOnly ? spreadTotal / Math.max(1, settings.jobWeeks) : 0;
  const costPerWeek = settings.forecastSecuredOnly ? securedCosts / Math.max(1, settings.jobWeeks) : 0;
  const billWeek = (w: number) => w >= 1 && w <= settings.jobWeeks;
  let bal = cashTotal + creditOwed;
  const weeks = Array.from({ length: 13 }, (_, w) => {
    const start = addDays(monday, w * 7), end = addDays(start, 6);
    const due = (d: string) => (w === 0 ? d <= end : d >= start && d <= end);
    const estimated = settings.forecastSecuredOnly ? false : start > horizon;
    const securedIn = billWeek(w - payLagWeeks) ? perWeek * 1.1 : 0;
    const securedOut = billWeek(w - 2) ? costPerWeek * 1.1 : 0;
    const wipIn = claimIn.filter((c) => due(c.date)).reduce((t, c) => t + c.inc, 0);
    const wipOut = wipCostWeeks.filter((c) => start <= c.to && end >= c.from).reduce((t, c) => t + c.perWeekInc, 0);
    const inn = recv.filter((i) => due(dateOnly(i.DueDateString) || today)).reduce((s, i) => s + num(i.AmountDue), 0) + (estimated ? weeklyTurnover * 1.1 : 0) + securedIn + wipIn;
    const out = pay.filter((i) => due(dateOnly(i.DueDateString) || today)).reduce((s, i) => s + num(i.AmountDue), 0) + weeklyRunning + (estimated ? weeklyTurnover * (1 - g) * 1.1 : 0) + securedOut + wipOut;
    bal += inn - out;
    return { start, inn, out, bal, estimated };
  });
  const low = weeks.reduce((a, b) => (b.bal < a.bal ? b : a), weeks[0]);
  const firstBelow = weeks.find((w) => w.bal < settings.bufferAmount) ?? null;

  // ----- "need more work" warning -----
  // Gross profit still to come from work already won, measured in months of running costs.
  const securedGp = secured.reduce((t, j) => t + j.remaining * jobRatio(j), 0) + settings.otherWorkOnHand * actualGm + wipOnlyGp;
  const monthsCovered = R ? securedGp / R : 0;
  const quotedValue = quoting.reduce((t, q) => t + (q.quoteValue ?? 0), 0);
  const quotedCount = quoting.length, quotedWithValue = quoting.filter((q) => (q.quoteValue ?? 0) > 0).length;
  const pipelineMonths = R ? quotedValue * (settings.quoteWinRate / 100) * actualGm / R : 0;
  const aimMonths = settings.workAlertMonths + 1;
  const workNeeded = Math.max(0, (aimMonths * R - securedGp) / Math.max(actualGm, 0.05));
  const level: "ok" | "amber" | "red" = monthsCovered < settings.workAlertMonths ? "red" : monthsCovered < aimMonths ? "amber" : "ok";
  const work = {
    wipJobsCounted: wipOnly.length, wipOnlyLeft, claimsScheduled: claimIn.length,
    level, monthsCovered, runsOut: addDays(today, Math.round(monthsCovered * 30.4)), securedTotal,
    securedJobs: secured.map((j) => ({ ...j, gp: j.remaining * jobRatio(j), gpFrom: j.from })).sort((a, b) => b.remaining - a.remaining),
    otherWorkOnHand: settings.otherWorkOnHand, securedGp, quotedValue, quotedCount, quotedWithValue, pipelineMonths, aimMonths, workNeeded,
    jobsNeeded: avgJob ? workNeeded / avgJob : 0, quotesNeeded: avgJob ? workNeeded / avgJob / (settings.quoteWinRate / 100) : 0,
    alertMonths: settings.workAlertMonths,
  };

  // ----- month progress -----
  const pace = dayOfMonth / daysInMonth;
  const liveThis = liveFor(month, pace);
  const liveLast = liveFor(prevMonth, 1);
  // Live figures when Xero invoices are available; Xero's own P&L otherwise.
  const live = haveSales;
  const income = live ? liveThis.income : plThis?.income ?? 0;
  const gross = live ? liveThis.gp : plThis?.gross ?? 0;
  const net = live ? liveThis.net : plThis?.net ?? 0;
  return {
    settings, conn, plSource, snaps: Object.fromEntries(Object.entries(snaps).map(([k, s]) => [k, { ok: s.ok, note: s.note, at: s.fetchedAt }])),
    today, month, dayOfMonth, daysInMonth, pace,
    bank, cashTotal, holding, creditOwed, freeToSpend,
    bills, incoming, aged, billsDue30, incoming30, recvTotal: aged.notDue + aged.late1to30 + aged.late30plus,
    plThis, plLast, income, gross, grossPct: income ? gross / income * 100 : 0, net, live, xeroNet: plThis?.net ?? null, xeroNetLast: plLast?.net ?? null,
    cashReceived, cashSpent, haveSales, liveThis, liveLast,
    signedThisMonth, ideal, weeks, low, firstBelow, weeklyTurnover, insights, work, securedOnly: settings.forecastSecuredOnly,
    staleRecv, stalePay, staleRecvTotal: staleRecv.reduce((t, i) => t + num(i.AmountDue), 0), stalePayTotal: stalePay.reduce((t, i) => t + num(i.AmountDue), 0),
    runway: R ? (cashTotal + creditOwed) / R : 0,
    costsCovered: R ? gross / R : 0,
  };
}
export type AccountsView = Awaited<ReturnType<typeof accountsView>>;
