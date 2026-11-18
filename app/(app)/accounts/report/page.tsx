import Link from "next/link";
import { requireViewer } from "@/lib/team-view";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { accountsView } from "@/lib/accounts";
import { kickXeroSync, syncIfStale } from "@/lib/xero";
import { fmtAUD } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/time";
import { estPercent } from "@/lib/estimating";
import { periodWindows, sumMonths, type PeriodKind } from "@/lib/xero-insights";
import PrintButton from "@/components/PrintButton";

const $ = (n: number) => fmtAUD(Math.round(n)).replace(/\.00$/, "");
const pct = (n: number, d = 1) => `${n.toFixed(d)}%`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const label = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

// One-page-per-section finance pack for meetings: headline numbers, P&L, trend, cash, who owes whom,
// the sales pipeline from the CRM, and points to discuss. Prints or saves as PDF from the browser.
export default async function FinanceReport({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const u = await requireViewer(["ADMIN", "ACCOUNTS"], "accounts");
  const sp = await searchParams;
  const kind: PeriodKind = sp.period === "quarter" || sp.period === "year" ? sp.period : "month";
  kickXeroSync(); // refresh in the background; the page shows the latest saved figures now
  const v = await accountsView();
  const I = v.ideal;
  const x = v.insights;
  const connected = !!v.conn;
  const monthName = `${FULL[Number(v.month.slice(5, 7)) - 1]} ${v.month.slice(0, 4)}`;

  // ----- quarter / financial year -----
  const win = periodWindows(kind, v.month);
  const all = x.allMonths;
  const cur = sumMonths(all, win.current.months), prev = sumMonths(all, win.previous.months), ly = sumMonths(all, win.lastYear.months);
  const periodTarget = I.target * win.length;
  const firstMonth = win.current.months[0];
  const periodDays = (() => { const [fy, fm] = firstMonth.split("-").map(Number); const start = Date.UTC(fy, fm - 1, 1); const end = Date.UTC(fy, fm - 1 + win.length, 1); return { total: (end - start) / 86400000, gone: (Date.parse(v.today + "T00:00:00Z") - start) / 86400000 + 1 }; })();
  const periodPace = Math.min(1, periodDays.gone / periodDays.total);
  const periodTitle = kind === "month" ? monthName : win.current.name.replace(" to date", "");
  const tab = (k: PeriodKind, text: string) => <Link prefetch={false} href={k === "month" ? "/accounts/report" : `/accounts/report?period=${k}`} className={`fr-tab ${kind === k ? "is-on" : ""}`} aria-current={kind === k ? "page" : undefined}>{text}</Link>;

  // ----- sales pipeline from the CRM -----
  const leads = await prisma.lead.findMany({
    where: { brand: { in: ["ENP", "DR"] }, cancelled: false },
    select: {
      stage: true, contractValue: true, quoteValue: true, signedDate: true, createdAt: true,
      estPlansAt: true, estScopeAt: true, estExcelAt: true, estRfqAt: true, estPrelimAt: true, estRfqRecAt: true, estProposalAt: true, estSentAt: true,
    },
  });
  const since30 = Date.now() - 30 * 86400000;
  const quoting = leads.filter((l) => l.stage === "Quoting");
  const signedMonth = leads.filter((l) => l.stage === "Signed" && (l.signedDate ?? "").startsWith(v.month));
  const pipeline = {
    enquiries30: leads.filter((l) => l.createdAt.getTime() >= since30).length,
    quoting: quoting.length,
    quotedValue: quoting.reduce((s, l) => s + (l.quoteValue ?? 0), 0),
    quotedWithValue: quoting.filter((l) => (l.quoteValue ?? 0) > 0).length,
    sent: quoting.filter((l) => l.estSentAt).length,
    estAvg: quoting.length ? quoting.reduce((s, l) => s + estPercent(l), 0) / quoting.length : 0,
    signedCount: signedMonth.length,
    signedValue: signedMonth.reduce((s, l) => s + (l.contractValue ?? 0), 0),
  };

  // ----- forecast checkpoints -----
  const wk = (n: number) => v.weeks[Math.min(n, v.weeks.length) - 1];
  const lastPL = v.plLast;
  const thisPL = v.plThis;
  const oneYear = x.months.filter((mm) => mm.month < v.month).slice(-12);
  const yearTotals = oneYear.reduce((t, mm) => ({ income: t.income + mm.income, jobCosts: t.jobCosts + mm.jobCosts, running: t.running + mm.running, net: t.net + mm.net }), { income: 0, jobCosts: 0, running: 0, net: 0 });

  // ----- points to discuss (worked out, not opinions) -----
  const points: string[] = [];
  const W = v.work;
  if (W.level !== "ok") points.push(`${W.level === "red" ? "Need more work ASAP" : "Work is getting thin"}: signed work covers about ${Math.round(W.monthsCovered * 4.33)} week${Math.round(W.monthsCovered * 4.33) === 1 ? "" : "s"} of running costs (until around ${fmtDate(W.runsOut)}). About ${$(W.workNeeded)} of new work${I.avgJob ? ` (${Math.ceil(W.jobsNeeded)} jobs, ~${Math.ceil(W.quotesNeeded)} quotes)` : ""} gets back to ${W.aimMonths} months.`);
  if (connected && v.low.bal < I.buffer) points.push(`Cash is forecast to fall to ${$(v.low.bal)} in the week of ${fmtDate(v.low.start)}, under the ${$(I.buffer)} buffer.`);
  if (connected && v.runway < 1) points.push(`The bank covers ${v.runway.toFixed(1)} months of running costs (goal 3).`);
  if (I.buffer < I.bufferMin) points.push(`The safety buffer (${$(I.buffer)}) is below one month of running costs (${$(I.bufferMin)}).`);
  if (x.completeMonths >= 3 && x.grossPct6 < I.grossGoal) points.push(`Gross margin over the last 6 months is ${pct(x.grossPct6)}, under the ${I.grossGoal}% goal.`);
  if (thisPL && thisPL.income > 0 && thisPL.cos / thisPL.income < 0.25 && v.dayOfMonth > 5) points.push(`Only ${$(thisPL.cos)} of job costs are in Xero against ${$(thisPL.income)} of income this month. Bills may not be entered yet, so this month's margin will drop.`);
  if (v.aged.late30plus > 0) points.push(`${$(v.aged.late30plus)} owed to us is more than 30 days late (${v.aged.late30count} invoice${v.aged.late30count === 1 ? "" : "s"}).`);
  if (v.stalePayTotal > 0) points.push(`Xero shows ${$(v.stalePayTotal)} of bills over ${v.settings.staleDays} days overdue (${v.stalePay.length}). Check whether they're paid but not reconciled.`);
  if (x.topClients[0] && x.topClients[0].share > 0.3) points.push(`${x.topClients[0].name} is ${pct(x.topClients[0].share * 100, 0)} of the year's income.`);
  if (kind !== "month" && cur.income > 0) {
    const gm = cur.gross / cur.income * 100;
    if (gm < I.grossGoal) points.unshift(`Gross margin for ${win.current.name} is ${pct(gm)}, under the ${I.grossGoal}% goal.`);
    if (cur.income < periodTarget * periodPace) points.unshift(`Turnover for ${win.current.name} is ${$(cur.income)}, ${pct(cur.income / periodTarget * 100, 0)} of the ${$(periodTarget)} target with ${pct(periodPace * 100, 0)} of the period gone.`);
    if (ly.income > 0) points.unshift(`Turnover is ${cur.income >= ly.income ? "up" : "down"} ${pct(Math.abs(cur.income - ly.income) / ly.income * 100, 0)} on the same months last year (${$(ly.income)}).`);
  }
  const pace = I.target ? v.income / I.target : 0;
  if (connected && pace < v.pace) points.push(`Turnover is ${pct(pace * 100, 0)} of the ${$(I.target)} target with ${pct(v.pace * 100, 0)} of the month gone.`);
  if (I.avgJob && pipeline.signedCount < Math.ceil(I.jobsTarget * v.pace)) points.push(`${pipeline.signedCount} job${pipeline.signedCount === 1 ? "" : "s"} signed this month; about ${Math.ceil(I.jobsTarget)} a month are needed for the target.`);

  return (
    <div className="fr">
      <div className="fr-bar no-print">
        <Link prefetch={false} href="/accounts" className="acc-link">Back to Accounts</Link>
        <nav className="fr-tabs" aria-label="Report period">{tab("month", "Month")}{tab("quarter", "Quarter")}{tab("year", "Financial year")}</nav>
        <PrintButton label="Print or save as PDF" />
      </div>

      <article className="fr-page">
        <header className="fr-head">
          <div>
            <div className="fr-kicker">ENP Fitouts · DR Fitout</div>
            <h1>Finance report · {periodTitle}</h1>
            <p>Prepared {fmtDate(v.today)} for {u.name} · day {v.dayOfMonth} of {v.daysInMonth} · {connected ? `Xero data synced ${v.conn!.lastSyncAt ? fmtDateTime(v.conn!.lastSyncAt) : "—"}` : "Xero not connected: CRM figures and targets only"}</p>
          </div>
        </header>

        {kind === "month" ? (
          <section className="fr-section">
          <h2>Headline numbers</h2>
          <div className="fr-grid">
            {[
              ["Turnover this month", connected ? $(v.income) : "—", `${pct(pace * 100, 0)} of ${$(I.target)} target · pace ${pct(v.pace * 100, 0)}`],
              ["Signed this month", $(v.signedThisMonth), `Sales goal ${$(I.salesGoal)}`],
              ["Gross profit", connected ? $(v.gross) : "—", connected ? `${pct(v.grossPct)} margin · goal ${I.grossGoal}%` : ""],
              ["Net profit", connected ? $(v.net) : "—", v.live ? `Live: invoices x job GP % − running costs to date. Xero P&L says ${v.xeroNet != null ? $(v.xeroNet) : "—"}` : lastPL ? `Last month ${$(lastPL.net)}` : ""],
              ["Cash in the bank", connected ? $(v.cashTotal) : "—", connected ? `Free to spend ${$(v.freeToSpend)}` : ""],
              ["Owed to us", connected ? $(v.recvTotal) : "—", connected ? `${$(v.aged.late30plus)} over 30 days late` : ""],
              ["Bills due in 30 days", connected ? $(v.billsDue30) : "—", connected ? `Plus ${$(v.stalePayTotal)} old unpaid to check` : ""],
              ["Running costs", `${$(I.runningCosts)} / mo`, I.runningFrom],
              ["Work on the books", `${W.monthsCovered.toFixed(1)} months`, `${$(W.securedTotal)} signed work still to invoice`],
            ].map(([a, b, c]) => (<div key={a} className="fr-stat"><span>{a}</span><b>{b}</b><small>{c}</small></div>))}
          </div>
        </section>

        ) : (
          <section className="fr-section">
            <h2>Headline numbers · {win.current.name}</h2>
            <div className="fr-grid">
              {[
                ["Turnover", $(cur.income), `${pct(periodTarget ? cur.income / periodTarget * 100 : 0, 0)} of ${$(periodTarget)} target · pace ${pct(periodPace * 100, 0)}`],
                ["Gross profit", $(cur.gross), cur.income ? `${pct(cur.gross / cur.income * 100)} margin · goal ${I.grossGoal}%` : ""],
                ["Net profit", $(cur.net), cur.income ? `${pct(cur.net / cur.income * 100)} net margin` : ""],
                ["Running costs", $(cur.running), `${$(cur.running / Math.max(1, cur.monthsFound))} a month on average`],
                [win.previous.name, $(prev.income), prev.income ? `Net ${$(prev.net)} · ${pct(prev.gross / prev.income * 100)} gross margin` : "No data in Xero"],
                [win.lastYear.name, $(ly.income), ly.income ? `Turnover ${cur.income >= ly.income ? "up" : "down"} ${pct(Math.abs(cur.income - ly.income) / ly.income * 100, 0)} this year` : "No data in Xero"],
                ["Cash in the bank today", connected ? $(v.cashTotal) : "—", connected ? `Free to spend ${$(v.freeToSpend)}` : ""],
                ["Owed to us today", connected ? $(v.recvTotal) : "—", connected ? `${$(v.aged.late30plus)} over 30 days late` : ""],
              ].map(([a1, b1, c1]) => (<div key={a1} className="fr-stat"><span>{a1}</span><b>{b1}</b><small>{c1}</small></div>))}
            </div>
          </section>
        )}

        <section className="fr-section">
          <h2>Points to discuss</h2>
          {points.length ? <ol className="fr-points">{points.map((p) => <li key={p}>{p}</li>)}</ol> : <p className="fr-muted">Nothing flagged.</p>}
        </section>

        {kind === "month" ? (
        <section className="fr-section">
          <h2>Profit and loss</h2>
          {thisPL || lastPL ? (
            <table className="fr-table">
              <thead><tr><th>Line</th><th>This month (to date)</th><th>Last month</th><th>At the target</th></tr></thead>
              <tbody>
                {([
                  ["Income", thisPL?.income, lastPL?.income, I.target],
                  ["Cost of sales", thisPL?.cos, lastPL?.cos, I.target - I.grossAtTarget],
                  ["Gross profit", thisPL?.gross, lastPL?.gross, I.grossAtTarget],
                  ["Running costs", thisPL?.opex, lastPL?.opex, I.runningCosts],
                  ["Net profit", thisPL?.net, lastPL?.net, I.netAtTarget],
                ] as [string, number | undefined, number | undefined, number][]).map(([l, a, b, t]) => (
                  <tr key={l} className={l === "Gross profit" || l === "Net profit" ? "fr-total" : ""}><td>{l}</td><td>{a == null ? "—" : $(a)}</td><td>{b == null ? "—" : $(b)}</td><td>{$(t)}</td></tr>
                ))}
                <tr><td>Gross margin</td><td>{thisPL?.income ? pct(thisPL.gross / thisPL.income * 100) : "—"}</td><td>{lastPL?.income ? pct(lastPL.gross / lastPL.income * 100) : "—"}</td><td>{I.grossGoal}%</td></tr>
                <tr><td>Net margin</td><td>{thisPL?.income ? pct(thisPL.net / thisPL.income * 100) : "—"}</td><td>{lastPL?.income ? pct(lastPL.net / lastPL.income * 100) : "—"}</td><td>{pct(I.netPctAtTarget)}</td></tr>
              </tbody>
            </table>
          ) : <p className="fr-muted">Connect Xero to fill this in.</p>}
          <p className="fr-muted">{v.plSource === "xero-report" ? "From Xero's Profit and Loss report (ex GST)." : v.plSource === "worked-out" ? "Worked out from Xero invoices, bills and bank spending (ex GST)." : ""}</p>
        </section>

        ) : (
          <section className="fr-section">
            <h2>Profit and loss · {win.current.name}</h2>
            <table className="fr-table">
              <thead><tr><th>Line</th><th>{win.current.name}</th><th>{win.previous.name}</th><th>{win.lastYear.name}</th><th>Target ({win.length} mo)</th></tr></thead>
              <tbody>
                {([
                  ["Income", cur.income, prev.income, ly.income, periodTarget],
                  ["Cost of sales", cur.jobCosts, prev.jobCosts, ly.jobCosts, periodTarget - I.grossAtTarget * win.length],
                  ["Gross profit", cur.gross, prev.gross, ly.gross, I.grossAtTarget * win.length],
                  ["Running costs", cur.running, prev.running, ly.running, I.runningCosts * win.length],
                  ["Net profit", cur.net, prev.net, ly.net, I.netAtTarget * win.length],
                ] as [string, number, number, number, number][]).map(([l, a1, b1, c1, t]) => (
                  <tr key={l} className={l === "Gross profit" || l === "Net profit" ? "fr-total" : ""}><td>{l}</td><td className={a1 < 0 ? "fr-neg" : ""}>{$(a1)}</td><td className={b1 < 0 ? "fr-neg" : ""}>{prev.monthsFound ? $(b1) : "—"}</td><td className={c1 < 0 ? "fr-neg" : ""}>{ly.monthsFound ? $(c1) : "—"}</td><td>{$(t)}</td></tr>
                ))}
                {(["Gross margin", "Net margin"] as const).map((l) => {
                  const m = (p: { income: number; gross: number; net: number }) => (p.income ? pct((l === "Gross margin" ? p.gross : p.net) / p.income * 100) : "—");
                  return <tr key={l}><td>{l}</td><td>{m(cur)}</td><td>{prev.monthsFound ? m(prev) : "—"}</td><td>{ly.monthsFound ? m(ly) : "—"}</td><td>{l === "Gross margin" ? `${I.grossGoal}%` : pct(I.netPctAtTarget)}</td></tr>;
                })}
              </tbody>
            </table>
            <p className="fr-muted">{x.source === "xero-report" ? "From Xero's Profit and Loss report" : "Worked out from Xero invoices, bills and bank spending"} (ex GST). The current month is to date.{(prev.monthsFound < prev.monthsWanted || ly.monthsFound < ly.monthsWanted) ? " Some earlier months aren't in Xero, so comparisons may be partial." : ""}</p>

            <h3>Month by month</h3>
            <table className="fr-table">
              <thead><tr><th>Month</th><th>Income</th><th>Target</th><th>Job costs</th><th>Running costs</th><th>Net</th><th>Gross margin</th></tr></thead>
              <tbody>
                {(("all" in win && win.all) || win.current.months).map((mo) => {
                  const r = all.find((mm) => mm.month === mo);
                  const future = mo > v.month;
                  return (
                    <tr key={mo} className={future ? "fr-future" : ""}>
                      <td>{label(mo)}{mo === v.month ? " (to date)" : ""}</td>
                      <td>{r && !future ? $(r.income) : "—"}</td><td>{$(I.target)}</td>
                      <td>{r && !future ? $(r.jobCosts) : "—"}</td><td>{r && !future ? $(r.running) : "—"}</td>
                      <td className={r && r.net < 0 ? "fr-neg" : ""}>{r && !future ? $(r.net) : "—"}</td>
                      <td>{r && r.income && !future ? pct(r.gross / r.income * 100) : "—"}</td>
                    </tr>
                  );
                })}
                <tr className="fr-total"><td>{win.current.name}</td><td>{$(cur.income)}</td><td>{$(periodTarget)}</td><td>{$(cur.jobCosts)}</td><td>{$(cur.running)}</td><td className={cur.net < 0 ? "fr-neg" : ""}>{$(cur.net)}</td><td>{cur.income ? pct(cur.gross / cur.income * 100) : "—"}</td></tr>
              </tbody>
            </table>
          </section>
        )}

        {kind === "month" && oneYear.length > 0 && (
          <section className="fr-section fr-break">
            <h2>Last 12 months</h2>
            <table className="fr-table">
              <thead><tr><th>Month</th><th>Income</th><th>Job costs</th><th>Running costs</th><th>Net</th><th>Gross margin</th></tr></thead>
              <tbody>
                {oneYear.map((mm) => (
                  <tr key={mm.month}><td>{label(mm.month)}</td><td>{$(mm.income)}</td><td>{$(mm.jobCosts)}</td><td>{$(mm.running)}</td><td className={mm.net < 0 ? "fr-neg" : ""}>{$(mm.net)}</td><td>{mm.income ? pct(mm.gross / mm.income * 100) : "—"}</td></tr>
                ))}
                <tr className="fr-total"><td>12 months</td><td>{$(yearTotals.income)}</td><td>{$(yearTotals.jobCosts)}</td><td>{$(yearTotals.running)}</td><td className={yearTotals.net < 0 ? "fr-neg" : ""}>{$(yearTotals.net)}</td><td>{yearTotals.income ? pct((yearTotals.income - yearTotals.jobCosts) / yearTotals.income * 100) : "—"}</td></tr>
              </tbody>
            </table>
            <p className="fr-muted">Clients take {x.avgDaysToPay != null ? `${Math.round(x.avgDaysToPay)} days` : "—"} to pay on average · average invoice {x.avgInvoice ? $(x.avgInvoice) : "—"}{x.topClients.length ? ` · biggest clients: ${x.topClients.slice(0, 3).map((c) => `${c.name} (${pct(c.share * 100, 0)})`).join(", ")}` : ""}.</p>
          </section>
        )}

        {connected && (
          <section className="fr-section">
            <h2>Cash</h2>
            <div className="fr-two">
              <table className="fr-table">
                <thead><tr><th>Account</th><th>Balance</th></tr></thead>
                <tbody>
                  {v.bank.map((b) => (<tr key={b.name}><td>{b.name}{b.kind === "holding" ? " (tax holding)" : b.kind === "credit" ? " (card)" : b.kind === "other" ? " (not counted)" : ""}</td><td>{$(b.balance)}</td></tr>))}
                  <tr className="fr-total"><td>Cash</td><td>{$(v.cashTotal)}</td></tr>
                  <tr><td>Free to spend after tax holding, card and buffer</td><td>{$(v.freeToSpend)}</td></tr>
                </tbody>
              </table>
              <table className="fr-table">
                <thead><tr><th>Forecast balance</th><th>Amount</th></tr></thead>
                <tbody>
                  {[4, 8, 13].map((n) => { const w = wk(n); return w ? (<tr key={n}><td>In {n} weeks (w/c {fmtDate(w.start)})</td><td className={w.bal < I.buffer ? "fr-neg" : ""}>{$(w.bal)}</td></tr>) : null; })}
                  <tr><td>Lowest point (w/c {fmtDate(v.low.start)})</td><td className={v.low.bal < I.buffer ? "fr-neg" : ""}>{$(v.low.bal)}</td></tr>
                  <tr><td>Safety buffer</td><td>{$(I.buffer)}</td></tr>
                </tbody>
              </table>
            </div>
            <p className="fr-muted">Forecast uses Xero invoices and bills by due date{v.settings.addRunningCostsToForecast ? `, ${$(I.runningCosts * 12 / 52)} a week of running costs` : ""}{v.weeklyTurnover ? ", and after 30 days assumes work continues at last month's turnover" : ""}. Items over {v.settings.staleDays} days overdue are left out.</p>
          </section>
        )}

        {connected && (
          <section className="fr-section fr-break">
            <h2>Who owes whom</h2>
            <div className="fr-two">
              <div>
                <h3>Owed to us · {$(v.recvTotal)}</h3>
                <table className="fr-table">
                  <tbody>
                    <tr><td>Not yet due</td><td>{$(v.aged.notDue)}</td></tr>
                    <tr><td>1–30 days late</td><td>{$(v.aged.late1to30)}</td></tr>
                    <tr><td>Over 30 days late ({v.aged.late30count})</td><td className={v.aged.late30plus ? "fr-neg" : ""}>{$(v.aged.late30plus)}</td></tr>
                  </tbody>
                </table>
                <h3>Largest overdue</h3>
                <table className="fr-table">
                  <tbody>{[...v.staleRecv, ...v.incoming.filter((i) => (i.DueDateString ?? "") < v.today)].sort((a, b) => (b.AmountDue ?? 0) - (a.AmountDue ?? 0)).slice(0, 8).map((i) => (
                    <tr key={i.InvoiceID}><td>{i.Contact?.Name ?? "Client"}{i.InvoiceNumber ? ` · ${i.InvoiceNumber}` : ""}<small> due {i.DueDateString ? fmtDate(i.DueDateString.slice(0, 10)) : "—"}</small></td><td>{$(i.AmountDue ?? 0)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              <div>
                <h3>Bills due in 30 days · {$(v.billsDue30)}</h3>
                <table className="fr-table">
                  <tbody>{v.bills.slice(0, 8).map((b) => (
                    <tr key={b.InvoiceID}><td>{b.Contact?.Name ?? "Supplier"}<small> due {b.DueDateString ? fmtDate(b.DueDateString.slice(0, 10)) : "—"}</small></td><td>{$(b.AmountDue ?? 0)}</td></tr>
                  ))}{v.bills.length === 0 && <tr><td>None</td><td /></tr>}</tbody>
                </table>
                <h3>Old unpaid bills to check · {$(v.stalePayTotal)}</h3>
                <table className="fr-table">
                  <tbody>{v.stalePay.slice(0, 6).map((b) => (
                    <tr key={b.InvoiceID}><td>{b.Contact?.Name ?? "Supplier"}<small> due {b.DueDateString ? fmtDate(b.DueDateString.slice(0, 10)) : "—"}</small></td><td>{$(b.AmountDue ?? 0)}</td></tr>
                  ))}{v.stalePay.length === 0 && <tr><td>None</td><td /></tr>}</tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        <section className="fr-section">
          <h2>Sales pipeline (CRM)</h2>
          <div className="fr-grid">
            {[
              ["New enquiries", String(pipeline.enquiries30), "Last 30 days"],
              ["Quotes in progress", String(pipeline.quoting), `${pipeline.sent} sent · estimating ${pct(pipeline.estAvg, 0)} done on average`],
              ["Quoted value", $(pipeline.quotedValue), `${pipeline.quotedWithValue} of ${pipeline.quoting} quotes have an amount`],
              ["Signed this month", `${pipeline.signedCount} · ${$(pipeline.signedValue)}`, I.avgJob ? `About ${Math.ceil(I.jobsTarget)} a month needed for the target` : ""],
            ].map(([a, b, c]) => (<div key={a} className="fr-stat"><span>{a}</span><b>{b}</b><small>{c}</small></div>))}
          </div>
        </section>

        <section className="fr-section">
          <h2>Meeting notes and actions</h2>
          <div className="fr-lines" aria-hidden="true">{Array.from({ length: 8 }, (_, i) => <div key={i} />)}</div>
        </section>
      </article>
    </div>
  );
}
