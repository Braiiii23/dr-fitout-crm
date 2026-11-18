import "server-only";
import type { XInvoice } from "./xero";

// What 12 months of Xero history says: month-by-month income, job costs and running costs,
// averages over recent complete months, how fast clients pay, and who the biggest clients are.
type Cell = { Value?: string };
type Row = { RowType: string; Title?: string; Cells?: Cell[]; Rows?: Row[] };
type Report = { Reports?: { Rows: Row[] }[] };
export type MonthFigures = { month: string; income: number; jobCosts: number; running: number; gross: number; net: number };

const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
const monthOf = (s?: string) => (s ?? "").slice(0, 7);
const xeroDate = (s?: string) => { const m = /\/Date\((\d+)/.exec(s ?? ""); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : (s ?? "").slice(0, 10); };

/** Multi-month Xero P&L: header cells like "30 Nov 26" / "Nov 2026"; one value column per month. */
function fromReport(r: Report | null): MonthFigures[] | null {
  const rows = r?.Reports?.[0]?.Rows; if (!rows) return null;
  const header = rows.find((x) => x.RowType === "Header")?.Cells?.slice(1).map((c) => c.Value ?? "") ?? [];
  const months = header.map((h) => {
    const m = /([A-Za-z]{3})[a-z]*\s+(\d{2,4})\s*$/.exec(h.trim());
    if (!m) return "";
    const yy = m[2].length === 2 ? `20${m[2]}` : m[2];
    return `${yy}-${MONTHS[m[1].toLowerCase()] ?? "01"}`;
  });
  if (!months.length || months.some((x) => !x)) return null;
  const pick = (titleRe: RegExp) => {
    const sec = rows.find((x) => x.RowType === "Section" && titleRe.test(x.Title ?? ""));
    const sum = sec?.Rows?.find((x) => x.RowType === "SummaryRow");
    return months.map((_, i) => num(sum?.Cells?.[i + 1]?.Value));
  };
  const inc = pick(/^(trading )?income$|^income$/i), cos = pick(/cost of sales/i), op = pick(/operating expenses/i);
  return months.map((month, i) => ({ month, income: inc[i], jobCosts: cos[i], running: op[i], gross: inc[i] - cos[i], net: inc[i] - cos[i] - op[i] }));
}

/** Without the P&L report: sales invoices = income, bills = job costs, money spent straight from the bank = running costs. */
function fromTransactions(sales: XInvoice[], bills: XInvoice[], spend: { DateString?: string; SubTotal?: number }[], monthsWanted: string[]): MonthFigures[] {
  return monthsWanted.map((month) => {
    const income = sales.filter((i) => monthOf(i.DateString) === month).reduce((s, i) => s + num(i.SubTotal), 0);
    const jobCosts = bills.filter((i) => monthOf(i.DateString) === month).reduce((s, i) => s + num(i.SubTotal), 0);
    const running = spend.filter((t) => monthOf(t.DateString) === month).reduce((s, t) => s + num(t.SubTotal), 0);
    return { month, income, jobCosts, running, gross: income - jobCosts, net: income - jobCosts - running };
  });
}

export function xeroInsights(snap: <T>(k: string) => T | null, today: string) {
  const thisMonth = today.slice(0, 7);
  const [y, m] = thisMonth.split("-").map(Number);
  const last25 = Array.from({ length: 25 }, (_, i) => { const d = new Date(Date.UTC(y, m - 1 - i, 1)); return d.toISOString().slice(0, 7); }).reverse();
  const last13 = last25.slice(-13);
  const yearAgo = last13[0];
  const sales = snap<XInvoice[]>("salesHistory") ?? [], bills = snap<XInvoice[]>("billsHistory") ?? [];
  const spend = snap<{ DateString?: string; SubTotal?: number }[]>("spendHistory") ?? [];
  const r1 = fromReport(snap<Report>("plHistory")), r2 = fromReport(snap<Report>("plHistory2"));
  const report = r1 ? [...(r2 ?? []).filter((x) => !r1.some((y1) => y1.month === x.month)), ...r1] : null;
  const source: "xero-report" | "worked-out" | "none" = report ? "xero-report" : sales.length || bills.length || spend.length ? "worked-out" : "none";
  // All 25 months (for quarter and year comparisons); `months` keeps the last 13 for the page's chart.
  const allMonths = (report ?? fromTransactions(sales, bills, spend, last25)).filter((x) => last25.includes(x.month)).sort((a, b) => a.month.localeCompare(b.month));
  const months = allMonths.filter((x) => last13.includes(x.month));
  // Complete months with real activity (skip the current month and empty months before the books started).
  const complete = months.filter((x) => x.month < thisMonth && (x.income > 0 || x.running > 0));
  const recent = (n: number) => complete.slice(-n);
  const avg = (xs: MonthFigures[], f: (x: MonthFigures) => number) => (xs.length ? xs.reduce((s, x) => s + f(x), 0) / xs.length : 0);
  const r3 = recent(3), r6 = recent(6);
  const inc6 = r6.reduce((s, x) => s + x.income, 0);

  // How long clients take to pay (invoice date to fully paid), over the year.
  const paid = sales.filter((i) => i.Status === "PAID" && i.FullyPaidOnDate && i.DateString && monthOf(i.DateString) >= yearAgo);
  const days = paid.map((i) => (Date.parse(xeroDate(i.FullyPaidOnDate)) - Date.parse(xeroDate(i.DateString))) / 86400000).filter((d) => d >= 0 && d < 400);
  const avgDaysToPay = days.length ? days.reduce((s, d) => s + d, 0) / days.length : null;

  // Biggest clients over the last 12 months.
  const byClient = new Map<string, number>();
  for (const i of sales.filter((s) => monthOf(s.DateString) >= yearAgo)) { const k = i.Contact?.Name ?? "Unknown"; byClient.set(k, (byClient.get(k) ?? 0) + num(i.SubTotal)); }
  const yearIncome = [...byClient.values()].reduce((s, v) => s + v, 0);
  const topClients = [...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, total]) => ({ name, total, share: yearIncome ? total / yearIncome : 0 }));
  const invoices = sales.filter((i) => num(i.SubTotal) > 0 && monthOf(i.DateString) >= yearAgo);

  return {
    source, months, allMonths, completeMonths: complete.length,
    runningAvg3: avg(r3, (x) => x.running), runningAvg6: avg(r6, (x) => x.running),
    incomeAvg3: avg(r3, (x) => x.income), incomeAvg6: avg(r6, (x) => x.income),
    grossPct6: inc6 ? r6.reduce((s, x) => s + x.gross, 0) / inc6 * 100 : 0,
    netPct6: inc6 ? r6.reduce((s, x) => s + x.net, 0) / inc6 * 100 : 0,
    bestMonth: complete.length ? complete.reduce((a, b) => (b.income > a.income ? b : a)) : null,
    worstMonth: complete.length ? complete.reduce((a, b) => (b.income < a.income ? b : a)) : null,
    avgDaysToPay, paidCount: days.length,
    avgInvoice: invoices.length ? invoices.reduce((s, i) => s + num(i.SubTotal), 0) / invoices.length : 0, invoiceCount: invoices.length,
    topClients,
    usable: complete.length >= 3,
  };
}
export type XeroInsights = ReturnType<typeof xeroInsights>;

// ---------- periods: Australian financial year (1 July – 30 June) and its quarters ----------
export type PeriodKind = "month" | "quarter" | "year";
const ymAdd = (ym: string, n: number) => { const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const range = (from: string, count: number) => Array.from({ length: count }, (_, i) => ymAdd(from, i));
const fyStart = (ym: string) => { const y = Number(ym.slice(0, 4)), mo = Number(ym.slice(5, 7)); return `${mo >= 7 ? y : y - 1}-07`; };
const qStart = (ym: string) => { const mo = Number(ym.slice(5, 7)); const off = (mo - 7 + 12) % 3; return ymAdd(ym, -off); };
const fyName = (start: string) => `FY${String(Number(start.slice(0, 4)) + 1).slice(2)}`;
const qName = (start: string) => { const fy = fyStart(start); const q = (Number(start.slice(5, 7)) - 7 + 12) % 12 / 3 + 1; return `Q${q} ${fyName(fy)}`; };

/** Months for the current period (to date), the one before, and the same one a year earlier. */
export function periodWindows(kind: PeriodKind, thisMonth: string) {
  if (kind === "month") return {
    current: { name: "This month", months: [thisMonth] }, previous: { name: "Last month", months: [ymAdd(thisMonth, -1)] },
    lastYear: { name: "Same month last year", months: [ymAdd(thisMonth, -12)] }, length: 1,
  };
  if (kind === "quarter") {
    const s = qStart(thisMonth), elapsed = range(s, 3).filter((x) => x <= thisMonth);
    return {
      current: { name: `${qName(s)} to date`, months: elapsed }, previous: { name: qName(ymAdd(s, -3)), months: range(ymAdd(s, -3), 3) },
      lastYear: { name: `${qName(ymAdd(s, -12))}, same months`, months: elapsed.map((x) => ymAdd(x, -12)) }, length: 3, all: range(s, 3),
    };
  }
  const s = fyStart(thisMonth), elapsed = range(s, 12).filter((x) => x <= thisMonth);
  return {
    current: { name: `${fyName(s)} to date`, months: elapsed }, previous: { name: `${fyName(ymAdd(s, -12))} full year`, months: range(ymAdd(s, -12), 12) },
    lastYear: { name: `${fyName(ymAdd(s, -12))}, same months`, months: elapsed.map((x) => ymAdd(x, -12)) }, length: 12, all: range(s, 12),
  };
}

export function sumMonths(all: MonthFigures[], wanted: string[]) {
  const got = all.filter((x) => wanted.includes(x.month));
  const t = got.reduce((a, x) => ({ income: a.income + x.income, jobCosts: a.jobCosts + x.jobCosts, running: a.running + x.running, gross: a.gross + x.gross, net: a.net + x.net }), { income: 0, jobCosts: 0, running: 0, gross: 0, net: 0 });
  return { ...t, monthsFound: got.length, monthsWanted: wanted.length, rows: got };
}
