import Link from "next/link";
import { requireViewer } from "@/lib/team-view";
import { requireUser } from "@/lib/auth";
import { accountsView } from "@/lib/accounts";
import { kickXeroSync, xeroSyncRunning, syncIfStale, xeroConfigured } from "@/lib/xero";
import { fmtAUD } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/time";
import { refreshXero, disconnectXero, setJobXeroContact } from "./actions";
import ClaimsToInvoice from "@/components/ClaimsToInvoice";
import type { AccountsView } from "@/lib/accounts";

const $ = (n: number) => fmtAUD(Math.round(n)).replace(/\.00$/, "");
const k = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n / 1000))}k`;
const pct = (n: number, d = 0) => `${n.toFixed(d)}%`;

const NOTICES: Record<string, [string, string]> = {
  connected: ["ok", "Xero is connected. Figures below now come from Xero."],
  cancelled: ["warn", "Xero wasn't connected: the approval was cancelled."],
  expired: ["warn", "That Xero sign-in took too long. Press Connect Xero again."],
  failed: ["bad", "Xero didn't accept the connection. Check the Client ID, secret and redirect address in the Xero app, then try again."],
  scope: ["warn", "Xero refused one of the permissions (usually the Profit and Loss report). Use 'Connect without the P&L report' below; the P&L will be worked out from invoices and bills instead."],
  "not-configured": ["bad", "The Xero keys aren't set on the server yet (XERO_CLIENT_ID and XERO_CLIENT_SECRET)."],
};

export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireViewer(["ADMIN", "ACCOUNTS"], "accounts");
  const sp = await searchParams;
  kickXeroSync(); // refresh in the background; the page shows the latest saved figures now
  const v = await accountsView();
  const I = v.ideal;
  const connected = !!v.conn;
  const notice = sp.xero ? NOTICES[sp.xero] : null;
  const live = connected && v.snaps.bankSummary?.ok;

  const counters = [
    { label: "Turnover vs target", value: pct(I.target ? v.income / I.target * 100 : 0), fill: I.target ? v.income / I.target : 0, mark: v.pace, note: `${$(v.income)} of ${$(I.target)} this month`, good: v.income / Math.max(1, I.target) >= v.pace },
    { label: "Running costs covered", value: pct(v.costsCovered * 100), fill: v.costsCovered, mark: v.pace, note: `Gross profit ${$(v.gross)} vs ${$(I.runningCosts)} a month`, good: v.costsCovered >= v.pace },
    { label: `Gross margin vs ${I.grossGoal}% goal`, value: pct(v.grossPct, 1), fill: I.grossGoal ? v.grossPct / I.grossGoal : 0, mark: 1, note: v.live ? "Live: invoices x each job's GP %" : v.plSource === "worked-out" ? "Worked out from invoices and bills" : "From the Xero P&L", good: v.grossPct >= I.grossGoal },
    { label: "Work on the books", value: `${v.work.monthsCovered.toFixed(1)} mo`, fill: v.work.monthsCovered / v.work.aimMonths, mark: 1, note: `Gross profit still to come from signed work vs running costs (aim ${v.work.aimMonths} months)`, good: v.work.level === "ok" },
    { label: "Cash runway", value: `${v.runway.toFixed(1)} mo`, fill: v.runway / 3, mark: 1, note: "Months of running costs the bank covers (goal 3)", good: v.runway >= 3 },
    { label: "Safety buffer", value: pct(I.bufferMin ? I.buffer / I.bufferMin * 100 : 0), fill: I.bufferMin ? I.buffer / I.bufferMin : 0, mark: 1, note: `${$(I.buffer)} of a ${$(I.bufferMin)} minimum (one month)`, good: I.buffer >= I.bufferMin },
    { label: "Bills covered (30 days)", value: pct(v.billsDue30 ? (Math.max(0, v.freeToSpend) + v.incoming30) / v.billsDue30 * 100 : 100), fill: v.billsDue30 ? (Math.max(0, v.freeToSpend) + v.incoming30) / v.billsDue30 : 1, mark: 1, note: `Free cash + ${$(v.incoming30)} due in vs ${$(v.billsDue30)} due out`, good: v.billsDue30 === 0 || Math.max(0, v.freeToSpend) + v.incoming30 >= v.billsDue30 },
  ];

  const maxFlow = Math.max(1, ...v.weeks.map((w) => Math.max(w.inn, w.out)));
  const maxBal = Math.max(1, I.buffer, ...v.weeks.map((w) => Math.abs(w.bal)));
  // Line up last month by line name (the two months don't always have the same lines), and add lines only last month had.
  const lastByLabel = new Map((v.plLast?.lines ?? []).filter((l) => l.kind !== "head").map((l) => [l.label.toLowerCase(), l.value]));
  const plRows = (v.plThis?.lines ?? []).map((l) => ({ ...l, last: l.kind === "head" ? null : lastByLabel.get(l.label.toLowerCase()) ?? 0 }));

  return (
    <div className="acc space-y-5">
      <div className="acc-top">
        <div>
          <h1 className="est-title">Accounts</h1>
          <p className="est-sub">
            {connected ? <>Live from Xero ({v.conn!.tenantName}) · last synced {v.conn!.lastSyncAt ? fmtDateTime(v.conn!.lastSyncAt) : "never"}{xeroSyncRunning() || (v.conn!.lastSyncAt && Date.now() - v.conn!.lastSyncAt.getTime() > 15 * 60000) ? <span className="acc-refreshing"> · updating from Xero in the background, refresh in a minute for the newest figures</span> : null}</> : "Not connected to Xero yet: targets and CRM figures only"}
            {" · "}Day {v.dayOfMonth} of {v.daysInMonth}
          </p>
        </div>
        <div className="acc-actions">
          {connected && <form action={refreshXero}><button className="btn">Refresh from Xero</button></form>}
          <Link prefetch={false} href="/accounts/report" className="btn">Finance report</Link>
          <Link prefetch={false} href="/accounts/settings" className="acc-link">Targets &amp; settings</Link>
        </div>
      </div>

      {notice && <div className={`acc-notice acc-${notice[0]}`} role="status">{notice[1]}</div>}
      {connected && v.conn!.lastSyncError?.startsWith("RECONNECT: ") && (
        <div className="acc-notice acc-bad acc-reconnect" role="alert">
          <span><b>Xero needs reconnecting.</b> {v.conn!.lastSyncError.slice(11)} The figures below are from the last successful sync.</span>
          <a className="btn" href="/xero/connect">Reconnect Xero</a>
        </div>
      )}
      {connected && v.conn!.lastSyncError && !v.conn!.lastSyncError.startsWith("RECONNECT: ") && <div className="acc-notice acc-warn" role="status">Some Xero data didn&apos;t load: {v.conn!.lastSyncError.slice(0, 400)}</div>}

      {sp.msg && <div className="acc-notice" role="status">{sp.msg}</div>}
      <ClaimsToInvoice />

      <WorkAlert v={v} />

      {!connected && (
        <section className="card acc-connect">
          <h2 className="est-h2" style={{ marginTop: 0 }}>Connect Xero</h2>
          <p>Bank balances, bills, invoices and the profit and loss come from Xero. You&apos;ll sign in on Xero&apos;s own page and approve DR Fitout with read-only access. Nothing in Xero can be changed from here.</p>
          {xeroConfigured() ? (
            <div className="acc-actions">
              <a className="btn" href="/xero/connect">Connect Xero</a>
              <a className="acc-link" href="/xero/connect?basic=1">Connect without the P&amp;L report</a>
            </div>
          ) : <p className="acc-bad-text">The Xero keys aren&apos;t set on the server yet.</p>}
        </section>
      )}

      <section className="acc-kpis">
        <div className="card acc-kpi">
          <div className="est-k">Money in the bank</div>
          <div className="est-big">{live ? $(v.cashTotal) : "—"}</div>
          {live ? (<>
            {v.bank.map((b) => (
              <div key={b.name} className={`acc-line ${b.kind === "other" ? "acc-dim" : ""}`}><span>{b.name}{b.kind === "holding" ? " (tax holding)" : b.kind === "credit" ? " (card)" : b.kind === "other" ? " (not counted)" : ""}</span><b>{$(b.balance)}</b></div>
            ))}
            <div className="acc-line acc-sep"><span>Received into the bank this month</span><b className="acc-good-text">{$(v.cashReceived)}</b></div>
            <div className="acc-line"><span>Paid out this month</span><b>{$(v.cashSpent)}</b></div>
            <div className="acc-line acc-sep"><span>Free to spend after tax holding, card and buffer</span><b className={v.freeToSpend < 0 ? "acc-bad-text" : "acc-good-text"}>{$(v.freeToSpend)}</b></div>
          </>) : <p className="acc-muted">Shows once Xero is connected.</p>}
        </div>
        <div className="card acc-kpi">
          <div className="est-k">Running costs</div>
          <div className="est-big">{$(I.runningCosts)}<span className="acc-unit"> / month</span></div>
          <div className="acc-muted">{$(I.perDay)} a day to keep the doors open · {I.runningFrom}</div>
          <div className="acc-line"><span>Break-even turnover</span><b>{$(I.breakEven)}</b></div>
          {v.plLast && v.plLast.opex > 0 && <div className="acc-line"><span>Xero operating expenses last month</span><b>{$(v.plLast.opex)}</b></div>}
        </div>
        <div className="card acc-kpi">
          <div className="est-k">Invoiced this month vs target</div>
          <div className="est-big">{connected ? $(v.income) : "—"}<span className="acc-unit"> of {$(I.target)}</span></div>
          <div className="acc-track"><span style={{ width: `${Math.min(100, I.target ? v.income / I.target * 100 : 0)}%` }} /><i style={{ left: `${v.pace * 100}%` }} aria-hidden="true" /></div>
          <div className="acc-muted">Invoices raised in Xero this month (ex GST), whether paid or not. Target: {I.targetFrom}. White line: where you need to be today ({pct(v.pace * 100)}).</div>
          <div className="acc-line acc-sep"><span>Sales goal: signed this month</span><b>{$(v.signedThisMonth)} of {$(I.salesGoal)}</b></div>
        </div>
        <div className="card acc-kpi">
          <div className="est-k">Net profit this month{v.live ? " · live" : ""}</div>
          <div className={`est-big ${v.net < 0 ? "acc-bad-text" : ""}`}>{connected ? $(v.net) : "—"}</div>
          {connected && v.live ? (<>
            <div className="acc-line"><span>Gross profit on {$(v.liveThis.income)} invoiced</span><b>{$(v.liveThis.gp)} ({pct(v.liveThis.gpPct, 1)})</b></div>
            <div className="acc-line"><span>Running costs to date (day {v.dayOfMonth} of {v.daysInMonth})</span><b>−{$(v.liveThis.running)}</b></div>
            <div className="acc-line acc-sep"><span>Last month, live</span><b>{$(v.liveLast.net)}</b></div>
            {v.xeroNet != null && <div className="acc-muted">Xero&apos;s P&amp;L says {$(v.xeroNet)} this month (it only counts bills once they&apos;re entered).</div>}
          </>) : connected ? <div className="acc-muted">Gross margin {pct(v.grossPct, 1)}{v.plLast ? ` · last month ${$(v.plLast.net)}` : ""}</div> : null}
          <div className="acc-muted">At the {$(I.target)} target and your actual {I.actualGm.toFixed(1)}% margin: {$(I.netAtTarget)}</div>
        </div>
      </section>

      <SignedJobs v={v} />

      {connected && v.live && <LiveProfit v={v} />}

      {connected && <XeroHistory v={v} />}

      <section className="card acc-pad">
        <div className="acc-head"><h2 className="est-h2">Health counters</h2><span className="acc-muted">White marker: where you need to be today</span></div>
        <div className="acc-counters">
          {counters.map((c) => (
            <div key={c.label} className="acc-counter">
              <div className="acc-line"><span className="acc-strong">{c.label}</span><b className={c.good ? "acc-good-text" : "acc-warn-text"}>{connected || c.label === "Safety buffer" || c.label === "Work on the books" ? c.value : "—"}</b></div>
              <div className={`acc-track acc-track-sm ${c.good ? "" : "is-warn"}`}><span style={{ width: `${Math.max(0, Math.min(100, c.fill * 100))}%` }} />{c.mark < 1 && <i style={{ left: `${c.mark * 100}%` }} aria-hidden="true" />}</div>
              <div className="acc-muted">{c.note}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="acc-two">
        <section className="card acc-pad acc-wide">
          <div className="acc-head"><h2 className="est-h2">Profit &amp; loss</h2><span className="acc-muted">{v.plSource === "xero-report" ? "Xero Profit and Loss report" : v.plSource === "worked-out" ? "Worked out from invoices, bills and bank spending (ex GST)" : "Connect Xero to fill this in"}</span></div>
          {plRows.length ? (
            <div className="overflow-x-auto">
              <table className="acc-pl">
                <thead><tr><th>Line</th><th>This month</th><th>Last month</th></tr></thead>
                <tbody>{plRows.map((r, i) => r.kind === "head"
                  ? <tr key={i} className="acc-pl-head"><td colSpan={3}>{r.label}</td></tr>
                  : <tr key={i} className={r.kind === "total" ? "acc-pl-total" : ""}><td>{r.label}</td><td>{$(r.value)}</td><td>{r.last == null ? "—" : $(r.last)}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <p className="acc-muted">No profit and loss yet.</p>}
          <p className="acc-muted" style={{ marginTop: ".75rem" }}>Break-even at the {I.grossGoal}% margin goal: <b>{$(I.breakEven)} a month</b>.</p>
        </section>

        <div className="acc-side">
          <section className="card acc-pad">
            <div className="acc-head"><h2 className="est-h2">Bills due · 30 days</h2><b>{$(v.billsDue30)}</b></div>
            {v.bills.length ? <ul className="acc-list">{v.bills.slice(0, 12).map((b) => (
              <li key={b.InvoiceID}><span className={`acc-date ${(b.DueDateString ?? "") < v.today ? "is-late" : ""}`}>{b.DueDateString ? fmtDate(b.DueDateString.slice(0, 10)) : "No date"}</span><span className="acc-who">{b.Contact?.Name ?? "Supplier"}{b.InvoiceNumber ? ` · ${b.InvoiceNumber}` : ""}</span><b>{$(b.AmountDue ?? 0)}</b></li>
            ))}</ul> : <p className="acc-muted">{connected ? "No bills due in the next 30 days." : "Shows once Xero is connected."}</p>}
          </section>
          <section className="card acc-pad">
            <div className="acc-head"><h2 className="est-h2">Money coming in · 30 days</h2><b className="acc-good-text">{$(v.incoming30)}</b></div>
            {v.incoming.length ? <ul className="acc-list">{v.incoming.slice(0, 12).map((b) => (
              <li key={b.InvoiceID}><span className={`acc-date ${(b.DueDateString ?? "") < v.today ? "is-late" : ""}`}>{b.DueDateString ? fmtDate(b.DueDateString.slice(0, 10)) : "No date"}</span><span className="acc-who">{b.Contact?.Name ?? "Client"}{b.InvoiceNumber ? ` · ${b.InvoiceNumber}` : ""}</span><b>{$(b.AmountDue ?? 0)}</b></li>
            ))}</ul> : <p className="acc-muted">{connected ? "No invoices due in the next 30 days." : "Shows once Xero is connected."}</p>}
          </section>
        </div>
      </div>

      {(v.stalePay.length > 0 || v.staleRecv.length > 0) && (
        <section className="card acc-pad">
          <div className="acc-head"><h2 className="est-h2">Old unpaid items to check in Xero</h2><span className="acc-muted">Overdue more than {v.settings.staleDays} days. Usually already paid but not reconciled, or in dispute. Left out of the forecast and 30-day lists.</span></div>
          <div className="acc-two">
            <div className="acc-wide" style={{ flexBasis: "320px" }}>
              <div className="acc-line acc-strong"><span>Bills Xero shows as unpaid ({v.stalePay.length})</span><b className="acc-bad-text">{$(v.stalePayTotal)}</b></div>
              <ul className="acc-list">{v.stalePay.slice(0, 8).map((b) => (<li key={b.InvoiceID}><span className="acc-date is-late">{b.DueDateString ? fmtDate(b.DueDateString.slice(0, 10)) : "No date"}</span><span className="acc-who">{b.Contact?.Name ?? "Supplier"}{b.InvoiceNumber ? ` · ${b.InvoiceNumber}` : ""}</span><b>{$(b.AmountDue ?? 0)}</b></li>))}</ul>
              {v.stalePay.length > 8 && <div className="acc-muted">+ {v.stalePay.length - 8} more in Xero</div>}
            </div>
            <div className="acc-wide" style={{ flexBasis: "320px" }}>
              <div className="acc-line acc-strong"><span>Invoices clients haven&apos;t paid ({v.staleRecv.length})</span><b className="acc-bad-text">{$(v.staleRecvTotal)}</b></div>
              <ul className="acc-list">{v.staleRecv.slice(0, 8).map((b) => (<li key={b.InvoiceID}><span className="acc-date is-late">{b.DueDateString ? fmtDate(b.DueDateString.slice(0, 10)) : "No date"}</span><span className="acc-who">{b.Contact?.Name ?? "Client"}{b.InvoiceNumber ? ` · ${b.InvoiceNumber}` : ""}</span><b>{$(b.AmountDue ?? 0)}</b></li>))}</ul>
              {v.staleRecv.length > 8 && <div className="acc-muted">+ {v.staleRecv.length - 8} more in Xero</div>}
            </div>
          </div>
        </section>
      )}

      <section className="card acc-pad">
        <div className="acc-head"><h2 className="est-h2">Cash flow forecast · 13 weeks</h2><span className="acc-muted">{v.securedOnly ? `Only work already won: Xero invoices and bills by due date${v.work.claimsScheduled ? `, ${v.work.claimsScheduled} claims from live jobs on the dates their build programs give (plus ${v.settings.claimTermsDays} days to pay) and their remaining costs to handover` : ""}, and other signed work still to invoice, billed over ${v.settings.jobWeeks} weeks and paid after ${Math.round(v.insights.avgDaysToPay ?? 14)} days. ` : ""}Invoices and bills from Xero by due date{v.settings.addRunningCostsToForecast ? `, plus ${$(I.runningCosts * 12 / 52)} a week of running costs` : ""}. Overdue items count in week 1.{v.weeklyTurnover ? ` Faded weeks are estimates: work continuing at last month's ${$(v.weeklyTurnover * 52 / 12)} turnover.` : ""}</span></div>
        {connected ? (<>
          {v.low.bal < I.buffer && <div className="acc-notice acc-bad" role="alert">Cash is forecast to drop to {$(v.low.bal)} in the week of {fmtDate(v.low.start)}, under your {$(I.buffer)} buffer. Chasing late invoices ({$(v.aged.late1to30 + v.aged.late30plus)}) or moving bill dates helps.</div>}
          <div className="overflow-x-auto"><div className="acc-chart">
            <div className="acc-legend"><span><i className="in" />Money in</span><span><i className="out" />Money out</span><span><i className="buf" />{$(I.buffer)} buffer</span></div>
            <div className="acc-bars">{v.weeks.map((w) => (
              <div key={w.start} className={`acc-col ${w.estimated ? "is-est" : ""}`} title={`Week of ${fmtDate(w.start)}: in ${$(w.inn)}, out ${$(w.out)}, balance ${$(w.bal)}`}>
                <span className="in" style={{ height: `${w.inn / maxFlow * 100}%` }} /><span className="out" style={{ height: `${w.out / maxFlow * 100}%` }} />
              </div>))}</div>
            <div className="acc-bal">
              {v.weeks.map((w) => (
                <div key={w.start} className={`acc-col acc-col-bal ${w.estimated ? "is-est" : ""}`}>
                  <small className={w.bal < I.buffer ? "acc-bad-text" : ""}>{k(w.bal)}</small>
                  <span className={w.bal < I.buffer ? "low" : ""} style={{ height: `${Math.max(0, w.bal) / maxBal * 80}%` }} />
                </div>))}
              <b className="acc-bufline" style={{ bottom: `${I.buffer / maxBal * 80}%` }} aria-hidden="true" />
            </div>
            <div className="acc-weeks">{v.weeks.map((w) => <small key={w.start}>{fmtDate(w.start).replace(/ \d{4}$/, "")}</small>)}</div>
          </div></div>
        </>) : <p className="acc-muted">Shows once Xero is connected.</p>}
      </section>

      <div className="acc-kpis">
        <section className="card acc-pad">
          <h2 className="est-h2" style={{ marginTop: 0 }}>Who owes us</h2>
          <div className="acc-line"><span>Not yet due</span><b>{$(v.aged.notDue)}</b></div>
          <div className="acc-line"><span>1–30 days late</span><b>{$(v.aged.late1to30)}</b></div>
          <div className="acc-line"><span>30+ days late ({v.aged.late30count})</span><b className={v.aged.late30plus ? "acc-bad-text" : ""}>{$(v.aged.late30plus)}</b></div>
          <div className="acc-line acc-sep"><span>Total owed to us</span><b>{$(v.recvTotal)}</b></div>
        </section>
        <section className="card acc-pad">
          <h2 className="est-h2" style={{ marginTop: 0 }}>Tax corner</h2>
          <div className="acc-line"><span>Held for tax ({v.bank.filter((b) => b.kind === "holding").map((b) => b.name).join(", ") || "no holding account set"})</span><b>{$(v.holding)}</b></div>
          <div className="acc-line"><span>GST in money owed to us</span><b>{$(v.recvTotal / 11)}</b></div>
          <div className="acc-line"><span>Company tax on this month&apos;s profit ({I.taxRate}%)</span><b>{$(Math.max(0, v.net) * I.taxRate / 100)}</b></div>
          <p className="acc-muted">Exact GST owing comes from your BAS in Xero.</p>
        </section>
        {connected && (
          <section className="card acc-pad">
            <h2 className="est-h2" style={{ marginTop: 0 }}>Xero connection</h2>
            <div className="acc-line"><span>Organisation</span><b>{v.conn!.tenantName}</b></div>
            <div className="acc-line"><span>Connected by</span><b>{v.conn!.connectedBy}</b></div>
            <div className="acc-line"><span>P&amp;L source</span><b>{v.plSource === "xero-report" ? "Xero report" : "Worked out"}</b></div>
            <div className="acc-actions" style={{ marginTop: ".6rem" }}>
              <a className="acc-link" href="/xero/connect">Reconnect Xero</a>
              <form action={disconnectXero}><button className="tp-del">Disconnect Xero</button></form>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

/** What 12 months of Xero history says, and what the page now uses from it. */
function XeroHistory({ v }: { v: AccountsView }) {
  const x = v.insights;
  if (x.source === "none" || !x.months.length) return null;
  const max = Math.max(1, ...x.months.map((mm) => Math.max(mm.income, mm.jobCosts + mm.running)));
  const facts: [string, string, string][] = [
    ["Running costs", x.completeMonths ? `${$(x.runningAvg3)} / mo` : "—", x.completeMonths >= 6 ? `Last 3 months · ${$(x.runningAvg6)} over 6` : "Last 3 complete months"],
    ["Turnover", x.completeMonths ? `${$(x.incomeAvg3)} / mo` : "—", x.completeMonths >= 6 ? `Last 3 months · ${$(x.incomeAvg6)} over 6` : "Last 3 complete months"],
    ["Gross margin", x.completeMonths ? pct(x.grossPct6, 1) : "—", `Last ${Math.min(6, x.completeMonths)} months · goal ${v.ideal.grossGoal}%`],
    ["Net margin", x.completeMonths ? pct(x.netPct6, 1) : "—", `Last ${Math.min(6, x.completeMonths)} months · goal ${v.settings.netMarginGoal}%`],
    ["Clients take", x.avgDaysToPay != null ? `${Math.round(x.avgDaysToPay)} days to pay` : "—", x.paidCount ? `Average over ${x.paidCount} paid invoices` : "No paid invoices yet"],
    ["Average invoice", x.avgInvoice ? $(x.avgInvoice) : "—", `${x.invoiceCount} invoices in 12 months`],
  ];
  return (
    <section className="card acc-pad">
      <div className="acc-head">
        <h2 className="est-h2">What your Xero shows · last 12 months</h2>
        <span className="acc-muted">{x.source === "xero-report" ? "From Xero's Profit and Loss" : "Worked out from invoices, bills and bank spending"} · {x.completeMonths} complete month{x.completeMonths === 1 ? "" : "s"} of data</span>
      </div>
      {!x.usable && <div className="acc-notice acc-warn" role="status">Xero has {x.completeMonths} complete month{x.completeMonths === 1 ? "" : "s"} of history so far. Running costs switch to Xero&apos;s real figure once there are 3.</div>}
      <div className="acc-facts">
        {facts.map(([a, b, c]) => (<div key={a} className="acc-fact"><span className="acc-muted">{a}</span><b>{b}</b><span className="acc-muted">{c}</span></div>))}
      </div>
      <div className="overflow-x-auto"><div className="acc-hist">
        <div className="acc-legend"><span><i className="in" />Income</span><span><i className="out" />Job costs</span><span><i className="run" />Running costs</span></div>
        <div className="acc-hist-bars">{x.months.map((mm) => (
          <div key={mm.month} className={`acc-hist-col ${mm.month === v.month ? "is-est" : ""}`} title={`${monthLabel(mm.month)}: income ${$(mm.income)}, job costs ${$(mm.jobCosts)}, running costs ${$(mm.running)}, net ${$(mm.net)}`}>
            <span className="in" style={{ height: `${mm.income / max * 100}%` }} />
            <span className="cost"><span className="run" style={{ height: `${mm.running / max * 100}%` }} /><span className="out" style={{ height: `${mm.jobCosts / max * 100}%` }} /></span>
          </div>))}</div>
        <div className="acc-hist-labels">{x.months.map((mm) => (<div key={mm.month}><small>{monthLabel(mm.month)}</small><small className={mm.net < 0 ? "acc-bad-text" : "acc-good-text"}>{mm.net < 0 ? "-" : ""}${Math.abs(Math.round(mm.net / 1000))}k</small></div>))}</div>
      </div></div>
      {x.topClients.length > 0 && (
        <div className="acc-clients">
          <span className="acc-muted">Biggest clients this year</span>
          {x.topClients.map((c) => (<div key={c.name} className="acc-line"><span>{c.name}</span><b>{$(c.total)} · {pct(c.share * 100)}</b></div>))}
          {x.topClients[0] && x.topClients[0].share > 0.3 && <div className="acc-muted acc-warn-text">{x.topClients[0].name} is {pct(x.topClients[0].share * 100)} of the year&apos;s income. Losing one client that size would hurt.</div>}
        </div>
      )}
    </section>
  );
}

/** The "need more work" trigger: how long work already won keeps covering running costs. */
function WorkAlert({ v }: { v: AccountsView }) {
  const w = v.work;
  const weeks = Math.round(w.monthsCovered * 4.33);
  const tone = w.level === "red" ? "acc-bad" : w.level === "amber" ? "acc-warn" : "acc-ok";
  const title = w.level === "red" ? "Need more work ASAP" : w.level === "amber" ? "Work is getting thin" : "Enough work on the books";
  return (
    <section className={`acc-notice acc-work ${tone}`} role={w.level === "ok" ? "status" : "alert"}>
      <div className="acc-work-head"><b>{title}</b><span>{w.monthsCovered.toFixed(1)} months covered</span></div>
      <p>Work already won ({$(w.securedTotal)} still to invoice) brings in about {$(w.securedGp)} of gross profit, using each job&apos;s own GP where it&apos;s entered. That covers running costs for about <b>{weeks} week{weeks === 1 ? "" : "s"}</b>, until around {fmtDate(w.runsOut)}.</p>
      {w.level !== "ok" && w.workNeeded > 0 && (
        <p>To get back to {w.aimMonths} months of work, sign about <b>{$(w.workNeeded)}</b> of new work{v.ideal.avgJob ? <> — roughly <b>{Math.ceil(w.jobsNeeded)} job{Math.ceil(w.jobsNeeded) === 1 ? "" : "s"}</b>, which at a {v.settings.quoteWinRate}% win rate means about <b>{Math.ceil(w.quotesNeeded)} quotes</b></> : null}.</p>
      )}
      <p className="acc-muted">Quotes in progress: {w.quotedCount} ({$(w.quotedValue)} quoted{w.quotedWithValue < w.quotedCount ? `, ${w.quotedCount - w.quotedWithValue} without an amount yet` : ""}), worth about {w.pipelineMonths.toFixed(1)} months if {v.settings.quoteWinRate}% win.
        {v.firstBelow ? ` If nothing new is signed, cash drops below the buffer in the week of ${fmtDate(v.firstBelow.start)}.` : ""}
        {" "}Counts signed jobs in the CRM with a contract value{w.otherWorkOnHand ? ` plus ${$(w.otherWorkOnHand)} entered in settings` : ""}. <Link prefetch={false} href="/accounts/settings" className="acc-link">Adjust</Link></p>
    </section>
  );
}

/** Signed jobs: signed vs actually invoiced and paid in Xero, and what's left to invoice (drives the warning and forecast). */
function SignedJobs({ v }: { v: AccountsView }) {
  const jobs = v.work.securedJobs;
  if (!jobs.length && !v.work.otherWorkOnHand) return null;
  const t = jobs.reduce((a, j) => ({ contract: a.contract + j.contract, inv: a.inv + (j.actual ? j.inv.invoiced : 0), paid: a.paid + (j.actual ? j.inv.paid : 0), owed: a.owed + (j.actual ? j.inv.owed : 0), left: a.left + j.remaining, gpLeft: a.gpLeft + j.gp, gp: a.gp + (j.gpTotal ?? 0) }), { contract: 0, inv: 0, paid: 0, owed: 0, left: 0, gpLeft: 0, gp: 0 });
  const basis = (f: string) => (f === "estimate" ? "estimate" : f === "at cost" ? "at cost" : f === "entered on job" ? "GP on job" : "average margin");
  return (
    <section className="card acc-pad">
      <div className="acc-head"><h2 className="est-h2">Signed jobs</h2><span className="acc-muted">Signed amounts from the CRM; invoiced and paid from Xero. Left to invoice drives the work warning and the cash forecast.</span></div>
      <div className="overflow-x-auto">
        <table className="table jc-table">
          <thead><tr><th>Job</th><th>Signed</th><th>Invoiced</th><th>Paid</th><th>Owed to us</th><th>Left to invoice</th><th>GP</th><th>GP still to come</th><th>Matched in Xero</th></tr></thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td><a href={`/estimating/${j.id}`} className="jc-name">{j.name}</a>{j.signedDate ? <small className="acc-muted" style={{ display: "block" }}>Signed {fmtDate(j.signedDate)}</small> : null}</td>
                <td>{$(j.contract)}</td>
                <td>{j.actual ? $(j.inv.invoiced) : "—"}</td>
                <td>{j.actual ? $(j.inv.paid) : "—"}</td>
                <td className={j.actual && j.inv.owed > 0 ? "acc-warn-text" : ""}>{j.actual ? $(j.inv.owed) : "—"}</td>
                <td>{$(j.remaining)}{!j.actual && <small className="acc-muted" style={{ display: "block" }}>estimated</small>}</td>
                <td>{j.gpTotal != null ? `${$(j.gpTotal)} (${j.gpPct != null ? pct(j.gpPct, 1) : "—"})` : "—"}<small className="acc-muted" style={{ display: "block" }}>{basis(j.from)}</small></td>
                <td>{$(j.gp)}</td>
                <td>
                  {j.actual ? <span className="acc-muted">{j.inv.contact} · {j.inv.count} invoice{j.inv.count === 1 ? "" : "s"} ({j.inv.by})</span> : (
                    <form action={setJobXeroContact} className="acc-match">
                      <input type="hidden" name="id" value={j.id} />
                      <input name="xeroContact" className="input" defaultValue={j.xeroContact ?? ""} placeholder={v.haveSales ? "Xero contact name" : "Connect Xero first"} aria-label={`Xero contact for ${j.name}`} />
                      <button className="btn">Match</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {v.work.otherWorkOnHand > 0 && <tr><td>Signed work not in the CRM</td><td>—</td><td>—</td><td>—</td><td>—</td><td>{$(v.work.otherWorkOnHand)}</td><td>average margin</td><td>{$(v.work.otherWorkOnHand * v.ideal.actualGm / 100)}</td><td /></tr>}
          </tbody>
          <tfoot><tr className="acc-pl-total"><td>Total</td><td>{$(t.contract)}</td><td>{$(t.inv)}</td><td>{$(t.paid)}</td><td>{$(t.owed)}</td><td>{$(t.left + v.work.otherWorkOnHand)}</td><td>{$(t.gp)}</td><td>{$(v.work.securedGp)}</td><td /></tr></tfoot>
        </table>
      </div>
      <p className="acc-muted" style={{ marginTop: ".6rem" }}>Jobs are matched to Xero invoices by job number (in the invoice number or reference), then by client name. If a job shows &quot;estimated&quot;, type the client&apos;s exact Xero contact name and press Match. Unmatched jobs assume {v.settings.depositPct}% invoiced once the deposit clears and 60% once the 50% claim is paid.</p>
    </section>
  );
}

/** How the live net profit is worked out: every invoice raised this month at its job's GP %. */
function LiveProfit({ v }: { v: AccountsView }) {
  const L = v.liveThis;
  const basis = (f: string) => (f === "estimate" ? "estimate" : f === "at cost" ? "at cost" : f === "entered on job" ? "GP on job" : "average margin");
  return (
    <section className="card acc-pad">
      <div className="acc-head"><h2 className="est-h2">Live profit this month</h2><span className="acc-muted">Each invoice raised this month counts at its job&apos;s GP %. Running costs come off day by day.</span></div>
      <div className="overflow-x-auto">
        <table className="acc-pl">
          <thead><tr><th>Invoiced this month</th><th>Invoiced</th><th>GP %</th><th>Gross profit</th></tr></thead>
          <tbody>
            {L.jobs.map((j) => <tr key={j.name}><td>{j.name} <span className="acc-muted">({basis(j.from)})</span></td><td>{$(j.invoiced)}</td><td>{pct(j.ratio * 100, 1)}</td><td>{$(j.gp)}</td></tr>)}
            {L.otherInv > 0 && <tr><td>Other invoices, not matched to a signed job <span className="acc-muted">(average margin)</span></td><td>{$(L.otherInv)}</td><td>{pct(L.otherRatio, 1)}</td><td>{$(L.otherGp)}</td></tr>}
            <tr className="acc-pl-total"><td>Gross profit</td><td>{$(L.income)}</td><td>{pct(L.gpPct, 1)}</td><td>{$(L.gp)}</td></tr>
            <tr><td>Running costs to date ({v.dayOfMonth}/{v.daysInMonth} of {$(v.ideal.runningCosts)})</td><td /><td /><td>−{$(L.running)}</td></tr>
            <tr className="acc-pl-total"><td>Net profit so far</td><td /><td /><td className={L.net < 0 ? "acc-bad-text" : ""}>{$(L.net)}</td></tr>
          </tbody>
        </table>
      </div>
      <p className="acc-muted" style={{ marginTop: ".6rem" }}>Job GP % comes from the GP entered on the job, otherwise the estimator&apos;s cost estimate. Invoices that aren&apos;t matched to a signed job use your average margin ({pct(L.otherRatio, 1)}). Match jobs in the Signed jobs table to make this exact.</p>
    </section>
  );
}
