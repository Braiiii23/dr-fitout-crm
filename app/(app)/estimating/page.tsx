import Link from "next/link";
import { requireViewer } from "@/lib/team-view";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getBrand } from "@/lib/brand";
import { BRANDS } from "@/lib/constants";
import { fmtDate } from "@/lib/time";
import { fmtAUD } from "@/lib/money";
import { EST_STEPS, estPercent, nextStep, stepsDone, summariseTrades, scopeCoverage } from "@/lib/estimating";
import { toggleStep, saveEstimate } from "./actions";
import { boardSort, nextDue, dueTone, daysUntil, priorityRank } from "@/lib/est-priority";
import { brisbaneToday } from "@/lib/time";
import { jobEstimate, jobMoney } from "@/lib/job-estimate";
import QuoteJobFields from "@/components/QuoteJobFields";
import { createQuoteJob } from "./actions";

// Estimating board: every quote in progress with a % bar built from Justin's checklist.
// Shows job details and the quote amount only, never GP, contract value or setter pay.
export default async function EstimatingPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const user = await requireViewer(["ADMIN", "ESTIMATOR", "ACCOUNTS", "BDM", "PM"]);
  const brand = await getBrand();
  const brands = brand === "ALL" ? ["ENP", "DR"] : [brand];
  const select = {
    id: true, brand: true, leadName: true, company: true, phone: true, email: true, location: true, projectType: true,
    sizeSqm: true, budget: true, timeframe: true, lookingFor: true, notes: true, stage: true, appointment: true,
    quoteValue: true, estimatorNotes: true, estPlansRequestedAt: true, dateReceived: true, quotedDate: true, estPriority: true, estPrelimDue: true, estFinalDue: true, estOtherCosts: true, estContingencyPct: true, contractValue: true, grossProfit: true, signedDate: true,
    estPlansAt: true, estScopeAt: true, estExcelAt: true, estRfqAt: true, estPrelimAt: true, estRfqRecAt: true, estProposalAt: true, estSentAt: true, updatedAt: true,
    tradeQuotes: { select: { trade: true, price: true, status: true } },
    scopeItems: { select: { trade: true, byClient: true } },
  } as const;
  const started = { OR: EST_STEPS.map((s) => ({ [s.key]: { not: null } })) };
  const rows = await prisma.lead.findMany({
    where: { brand: { in: brands }, cancelled: false, OR: [{ stage: "Quoting" }, started, { stage: "Signed", signedDate: { gte: new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10) } }] },
    select,
    orderBy: [{ updatedAt: "desc" }],
  });
  // Priority first (High → Normal → Low), then the soonest due date, then how far along.
  const active = rows.filter((r) => !r.estSentAt && r.stage !== "Lost" && r.stage !== "Signed")
    .sort(boardSort(estPercent));
  const today = brisbaneToday();
  // Jobs we can't start pricing yet: no plans received.
  const waitingPlans = active.filter((r) => !r.estPlansAt).map((r) => ({ r, since: waitingSince(r), days: Math.max(0, -daysUntil(waitingSince(r), today)), due: nextDue(r) }))
    .sort((a, b) => priorityRank(a.r.estPriority) - priorityRank(b.r.estPriority) || b.days - a.days);
  // Every open prelim / final due date, soonest first.
  const dues = active.flatMap((r) => ([
    r.estPrelimDue && !r.estPrelimAt && !r.estProposalAt ? { r, kind: "Prelim", date: r.estPrelimDue } : null,
    r.estFinalDue ? { r, kind: "Final", date: r.estFinalDue } : null,
  ].filter(Boolean) as { r: (typeof active)[number]; kind: string; date: string }[])).sort((a, b) => a.date.localeCompare(b.date) || priorityRank(a.r.estPriority) - priorityRank(b.r.estPriority));
  const sent = rows.filter((r) => r.estSentAt && r.stage !== "Lost" && r.stage !== "Signed")
    .sort((a, b) => (b.estSentAt ?? "").localeCompare(a.estSentAt ?? "")).slice(0, 20);

  const signed = rows.filter((r) => r.stage === "Signed").sort((a, b) => (b.signedDate ?? "").localeCompare(a.signedDate ?? ""));
  const money = (r: (typeof rows)[number]) => jobMoney(r);
  const costRows = [
    ...active.map((r) => ({ r, group: "Estimating" })), ...sent.map((r) => ({ r, group: "Sent" })), ...signed.map((r) => ({ r, group: "Signed" })),
  ].map(({ r, group }) => ({ r, group, m: money(r) }));
  const sum = (g: string) => costRows.filter((c) => c.group === g).reduce((t, c) => ({ sell: t.sell + c.m.sell, cost: t.cost + (c.m.cost ?? 0), gp: t.gp + (c.m.gp ?? 0), n: t.n + 1 }), { sell: 0, cost: 0, gp: 0, n: 0 });
  const totals = ["Estimating", "Sent", "Signed"].map((g) => ({ g, ...sum(g) }));
  const overall = active.length ? Math.round(active.reduce((n, r) => n + estPercent(r), 0) / active.length) : 0;
  // How many quotes are waiting on each step (their next unticked step).
  const waiting = EST_STEPS.map((s) => ({ ...s, n: active.filter((r) => nextStep(r)?.key === s.key).length }));
  const maxWaiting = Math.max(1, ...waiting.map((w) => w.n));
  const brandName = brand === "ALL" ? "ENP Fitouts · DR Fitout" : BRANDS[brand].name;
  const isAdmin = user.role === "ADMIN";
  const goal = (await prisma.accountsSettings.findUnique({ where: { id: "settings" } }))?.grossMarginGoal ?? 25;

  return (
    <div className="est space-y-5">
      <div>
        <h1 className="est-title">Estimating</h1>
        <p className="est-sub">{brandName} · {active.length} quote{active.length === 1 ? "" : "s"} in progress · {sent.length} sent and awaiting a decision</p>
        {sp.error && <div className="acc-notice acc-warn" role="alert" style={{ marginTop: ".6rem" }}>{sp.error}</div>}
        {(user.role === "ESTIMATOR" || user.role === "ADMIN") && (
          <details className="card acc-pad est-newjob" open={sp.new === "1"}>
            <summary className="btn" style={{ width: "max-content" }}>+ New quote job</summary>
            <form action={createQuoteJob} className="tp-form" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", marginTop: ".8rem" }}>
              <QuoteJobFields isNew />
              <div className="tp-form-actions"><button className="btn">Add to the board</button></div>
            </form>
            <p className="acc-muted">It goes straight onto this board (stage Quoting) and into Braiden&apos;s leads. Stage, contract value and setter stay with Braiden.</p>
          </details>
        )}
      </div>

      <section className="card est-summary">
        <div className="est-overall">
          <div className="est-k">Overall progress</div>
          <div className="est-big">{overall}%</div>
          <div className="est-bar est-bar-lg" role="progressbar" aria-valuenow={overall} aria-valuemin={0} aria-valuemax={100} aria-label="Overall estimating progress">
            <span style={{ width: `${overall}%` }} />
          </div>
          <div className="est-hint">Average across the {active.length} quote{active.length === 1 ? "" : "s"} still being estimated</div>
        </div>
        <div className="est-waiting">
          <div className="est-k">Waiting on</div>
          {waiting.map((w) => (
            <div key={w.key} className="est-wrow">
              <span className="est-wlabel">{w.label}</span>
              <span className="est-wbar"><span style={{ width: `${(w.n / maxWaiting) * 100}%` }} /></span>
              <span className="est-wn">{w.n}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card acc-pad">
        <div className="acc-head"><h2 className="est-h2">Job costs</h2><span className="acc-muted">Same figures as the Accounts page. Signed jobs use the signed amount; GP entered on a job overrides the estimate. GP under the {goal}% goal shows orange.</span></div>
        <div className="jc-totals">
          {totals.map((t) => (
            <div key={t.g} className="jc-total">
              <span className="acc-muted">{t.g} ({t.n})</span>
              <b>{fmtAUD(Math.round(t.sell)).replace(/\.00$/, "")}</b>
              <span className="acc-muted">Cost {fmtAUD(Math.round(t.cost)).replace(/\.00$/, "")} · GP {fmtAUD(Math.round(t.gp)).replace(/\.00$/, "")}{t.sell ? ` (${(t.gp / t.sell * 100).toFixed(1)}%)` : ""}</span>
            </div>
          ))}
        </div>
        {costRows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="table jc-table">
              <thead><tr><th>Job</th><th>Status</th><th>Job cost</th><th>Quote / signed</th><th>GP</th><th>GP %</th><th>Based on</th></tr></thead>
              <tbody>{costRows.map(({ r, group, m }) => (
                <tr key={r.id}>
                  <td><a href={`/estimating/${r.id}`} className="jc-name">{r.company || r.leadName || "Unnamed"}</a></td>
                  <td>{group}</td>
                  <td>{m.cost != null ? fmtAUD(Math.round(m.cost)).replace(/\.00$/, "") : "—"}</td>
                  <td>{m.sell ? <>{fmtAUD(Math.round(m.sell)).replace(/\.00$/, "")}{m.signed ? " signed" : ""}</> : "—"}</td>
                  <td>{m.gp != null ? fmtAUD(Math.round(m.gp)).replace(/\.00$/, "") : "—"}</td>
                  <td className={m.gpPct != null && m.gpPct < goal ? "acc-warn-text" : ""}>{m.gpPct != null ? `${m.gpPct.toFixed(1)}%` : "—"}</td>
                  <td>{m.from === "none" ? "No estimate yet" : m.from === "estimate" ? (m.final ? "Estimate" : "Estimate (not final)") : m.from === "at cost" ? "At cost" : "GP on job"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      {waitingPlans.length > 0 && (
        <section className="card acc-pad est-planwait">
          <div className="acc-head"><h2 className="est-h2">⏳ Waiting on plans <span className="est-waiting-n">{waitingPlans.length}</span></h2><span className="acc-muted">Can&apos;t start pricing until these come in. Tick <b>Plans</b> on the card when they arrive.</span></div>
          <ol className="est-wait-list">{waitingPlans.map(({ r, days, due }) => {
            const dueSoon = due && daysUntil(due.date, today) <= 7;
            return (
              <li key={r.id} className={`est-wait ${days >= 7 ? "long" : ""} ${dueSoon ? "due-soon" : ""}`}>
                <span className="est-wait-days"><b>{days}</b><small>day{days === 1 ? "" : "s"}</small></span>
                <a href={`#q-${r.id}`} className="est-due-name">{r.company || r.leadName || "Unnamed"}</a>
                {r.estPriority === "High" && <span className="est-prio-chip">High priority</span>}
                <span className="est-wait-due">{due ? <>{due.kind} due {fmtDate(due.date)}{dueSoon ? <b className="est-wait-warn"> · plans still not in!</b> : null}</> : <span className="acc-muted">No due date</span>}</span>
              </li>
            );
          })}</ol>
        </section>
      )}

      <section className="card acc-pad est-dues">
        <div className="acc-head"><h2 className="est-h2">Due dates</h2><span className="acc-muted">Prelim and final quotes due to clients. Overdue in red, due this week in amber.</span></div>
        {dues.length ? (
          <ol className="est-due-list">{dues.map(({ r, kind, date }) => {
            const tone = dueTone(date, today), d = daysUntil(date, today);
            return (
              <li key={r.id + kind} className={`est-due ${tone} ${r.estPriority === "High" ? "is-high" : ""}`}>
                <span className="est-due-date"><b>{fmtDate(date)}</b><small>{tone === "overdue" ? `${-d} day${d === -1 ? "" : "s"} overdue` : tone === "today" ? "Due today" : `in ${d} day${d === 1 ? "" : "s"}`}</small></span>
                <span className={`est-due-kind k-${kind.toLowerCase()}`}>{kind}</span>
                <a href={`#q-${r.id}`} className="est-due-name">{r.company || r.leadName || "Unnamed"}</a>
                {r.estPriority === "High" && <span className="est-prio-chip">High priority</span>}
                <span className="acc-muted est-due-step">{estPercent(r)}% · next: {nextStep(r)?.label ?? "done"}</span>
              </li>
            );
          })}</ol>
        ) : <p className="acc-muted">No due dates set. Add a prelim and final due date on each quote below.</p>}
      </section>

      <h2 className="est-h2">In progress <span className="acc-muted" style={{ fontSize: ".8rem", fontWeight: 600 }}>by priority, then due date</span></h2>
      {active.length === 0 && <div className="card est-empty">Nothing being estimated right now. Leads moved to the Quoting stage show up here.</div>}
      <div className="est-grid">
        {active.map((r) => <QuoteCard key={r.id} r={r} isAdmin={isAdmin} goal={goal} />)}
      </div>

      {sent.length > 0 && (<>
        <h2 className="est-h2">Sent · awaiting a decision</h2>
        <div className="est-grid">
          {sent.map((r) => <QuoteCard key={r.id} r={r} isAdmin={isAdmin} goal={goal} />)}
        </div>
      </>)}

      {/* Won jobs sit at the bottom, out of the way of the quotes still being worked on. */}
      {signed.length > 0 && (<>
        <h2 className="est-h2 est-h2-signed">Signed · last 6 months <span>{signed.length} won · {fmtAUD(Math.round(signed.reduce((t, r) => t + (r.contractValue ?? 0), 0))).replace(/\.00$/, "")}</span></h2>
        <div className="est-grid">
          {signed.map((r) => <QuoteCard key={r.id} r={r} isAdmin={isAdmin} goal={goal} />)}
        </div>
      </>)}
    </div>
  );
}

type Row = {
  id: string; brand: string; leadName: string | null; company: string | null; phone: string | null; email: string | null;
  location: string | null; projectType: string | null; sizeSqm: number | null; budget: string | null; timeframe: string | null;
  lookingFor: string | null; notes: string | null; stage: string | null; appointment: Date | null; quoteValue: number | null;
  estimatorNotes: string | null; estPlansRequestedAt: string | null; dateReceived: string | null; quotedDate: string | null; estPriority: string | null; estPrelimDue: string | null; estFinalDue: string | null; estOtherCosts: number | null; estContingencyPct: number | null;
  contractValue: number | null; grossProfit: number | null; signedDate: string | null; estPlansAt: string | null; estScopeAt: string | null; estExcelAt: string | null;
  estRfqAt: string | null; estPrelimAt: string | null; estRfqRecAt: string | null; estProposalAt: string | null; estSentAt: string | null;
  tradeQuotes: { trade: string; price: number | null; status: string }[];
  scopeItems: { trade: string; byClient: boolean }[];
};

function QuoteCard({ r, isAdmin, goal }: { r: Row; isAdmin: boolean; goal: number }) {
  const pct = estPercent(r);
  const done = stepsDone(r);
  const next = nextStep(r);
  const b = BRANDS[r.brand as "ENP" | "DR"];
  const facts: [string, string | null][] = [
    ["Location", r.location], ["Project", r.projectType], ["Size", r.sizeSqm ? `${r.sizeSqm} m²` : null],
    ["Budget", r.budget], ["Timeframe", r.timeframe], ["Phone", r.phone],
  ];
  return (
    <article id={`q-${r.id}`} className={`card est-card ${r.stage === "Signed" ? "is-signed" : ""} ${r.stage !== "Signed" && r.estPriority === "High" ? "is-high" : ""} ${r.estPriority === "Low" ? "is-low" : ""}`} data-brand={r.brand}>
      {r.stage !== "Signed" && r.estPriority === "High" && <span className="est-won est-high-badge">High priority</span>}
      {r.stage === "Signed" && <span className="est-won" aria-label="Signed">Signed</span>}
      <header className="est-card-head">
        <div className="min-w-0">
          <div className="est-name">{r.company || r.leadName || "Unnamed"}</div>
          {r.company && r.leadName && <div className="est-who">{r.leadName}</div>}
        </div>
        <span className="est-brand" style={{ background: b.color }}>{b.name}</span>
      </header>

      {!r.estPlansAt && r.stage !== "Signed" && <WaitingPlans r={r} />}
      <MoneyStrip r={r} goal={goal} />


      <div className="est-progress">
        <div className="est-progress-top">
          <span className="est-pct">{pct}%</span>
          <span className="est-next">{next ? `Next: ${next.label}` : "All steps done"} · {done}/{EST_STEPS.length}</span>
        </div>
        <div className="est-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Estimate progress ${pct}%`}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className="est-steps">
          {EST_STEPS.map((s) => {
            const at = r[s.key];
            return (
              <form key={s.key} action={toggleStep}>
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="step" value={s.key} />
                <button className={`est-step ${at ? "is-done" : ""}`} aria-pressed={!!at} title={at ? `${s.label}: done ${fmtDate(at)}. Tap to undo` : `Mark ${s.label} done`}>
                  <span className="est-tick" aria-hidden="true">{at ? "✓" : ""}</span>
                  <span className="est-step-name">{s.short}</span>
                  <span className="est-step-date">{at ? fmtDate(at) : " "}</span>
                </button>
              </form>
            );
          })}
        </div>
      </div>

      <dl className="est-facts">
        {facts.filter(([, v]) => v).map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
      </dl>
      {r.lookingFor && (r.lookingFor.length <= 160
        ? <p className="est-note"><b>Looking for:</b> {r.lookingFor}</p>
        : <details className="est-note est-more"><summary><b>Looking for:</b> {r.lookingFor.slice(0, 140).trimEnd()}… <span className="est-more-btn">Show all</span></summary><p>{r.lookingFor}</p></details>)}

      {(r.estPrelimDue || r.estFinalDue) && r.stage !== "Signed" && <DueStrip r={r} />}

      <TradePackLink r={r} />

      <form action={saveEstimate} className="est-form">
        <input type="hidden" name="id" value={r.id} />
        <label className="est-field"><span className="label">Priority</span>
          <select name="estPriority" className="input" defaultValue={r.estPriority ?? "Normal"}><option>High</option><option>Normal</option><option>Low</option></select>
        </label>
        {!r.estPlansAt && <label className="est-field"><span className="label">Plans requested</span><input name="estPlansRequestedAt" type="date" className="input" defaultValue={r.estPlansRequestedAt ?? ""} /></label>}
        <label className="est-field"><span className="label">Prelim due</span><input name="estPrelimDue" type="date" className="input" defaultValue={r.estPrelimDue ?? ""} /></label>
        <label className="est-field"><span className="label">Final due</span><input name="estFinalDue" type="date" className="input" defaultValue={r.estFinalDue ?? ""} /></label>
        <label className="est-field"><span className="label">Quote amount (ex GST)</span>
          <input name="quoteValue" inputMode="decimal" className="input" placeholder="$0" defaultValue={r.quoteValue ?? ""} />
        </label>
        <label className="est-field est-field-wide"><span className="label">Estimator notes</span>
          <textarea name="estimatorNotes" rows={2} className="input" defaultValue={r.estimatorNotes ?? ""} placeholder="e.g. waiting on 2 RFQs back" />
        </label>
        <div className="est-actions">
          <button className="btn">Save</button>
          {r.quoteValue ? <span className="est-amt">{fmtAUD(r.quoteValue)}</span> : null}
          {isAdmin && <Link prefetch={false} href={`/leads/${b.slug}/${r.id}`} className="est-open">Open lead →</Link>}
        </div>
      </form>
    </article>
  );
}

function TradePackLink({ r }: { r: Row }) {
  const t = summariseTrades(r.tradeQuotes);
  const sc = scopeCoverage(r.scopeItems, r.tradeQuotes);
  const est = jobEstimate(r);
  return (
    <Link prefetch={false} href={`/estimating/${r.id}`} className="tp-link">
      <span>
        <b>Trade pack</b>
        <span className="tp-link-sub">
          {r.tradeQuotes.length === 0 ? "No trade quotes yet" : `${t.tradesCovered} trade${t.tradesCovered === 1 ? "" : "s"} priced · ${t.received} received · ${t.requested} waiting`}
        </span>
        {est.hasEstimate && est.sell > 0 && <span className="tp-link-sub"><b>Est. GP {est.gpPct.toFixed(1)}%</b> · {fmtAUD(Math.round(est.gp))} on {fmtAUD(est.sell)}</span>}
        <span className="tp-link-sub">
          {sc.total === 0 ? "No scope list yet" : `Scope ${sc.covered + sc.client}/${sc.total} covered`}{sc.missing ? <b className="tp-missing-txt"> · {sc.missing} not quoted</b> : null}
        </span>
      </span>
      <span className="tp-link-amt">{t.total ? fmtAUD(t.total) : ""} →</span>
    </Link>
  );
}

/** Job cost, quote or signed amount, and GP: the same figures the Accounts page uses. */
function MoneyStrip({ r, goal }: { r: Row; goal: number }) {
  const m = jobMoney(r);
  const f = (n: number | null) => (n == null ? "—" : fmtAUD(Math.round(n)).replace(/\.00$/, ""));
  return (
    <div className={`jc-strip ${m.signed ? "is-signed" : ""}`}>
      <div><span>Job cost</span><b>{f(m.cost)}</b><small>{m.from === "estimate" ? (m.final ? "Estimate" : "Estimate, not final") : m.from === "at cost" ? "At cost" : m.from === "entered on job" ? "From GP on job" : "No estimate yet"}</small></div>
      <div><span>{m.signed ? "Signed" : "Quote"}</span><b>{m.sell ? f(m.sell) : "—"}</b><small>{m.signed ? (r.signedDate ? `Signed ${fmtDate(r.signedDate)}` : "Signed") : "Ex GST"}</small></div>
      <div><span>Gross profit</span><b className={m.gpPct != null && m.gpPct < goal ? "acc-warn-text" : ""}>{f(m.gp)}</b><small>{m.gpPct != null ? `${m.gpPct.toFixed(1)}%` : "—"}</small></div>
    </div>
  );
}

/** Prelim and final due dates on a card, coloured by how close they are. */
function DueStrip({ r }: { r: Row }) {
  const today = brisbaneToday();
  const item = (label: string, date: string | null, done: boolean) => {
    if (!date) return null;
    const tone = done ? "done" : dueTone(date, today), d = daysUntil(date, today);
    return <div className={`est-duechip ${tone}`}><span>{label} due</span><b>{fmtDate(date)}</b><small>{done ? "Done" : tone === "overdue" ? `${-d}d overdue` : tone === "today" ? "Today" : `in ${d}d`}</small></div>;
  };
  return <div className="est-duestrip">{item("Prelim", r.estPrelimDue, !!r.estPrelimAt || !!r.estProposalAt || !!r.estSentAt)}{item("Final", r.estFinalDue, !!r.estSentAt)}</div>;
}

/** When we started waiting on plans: the request date if set, else when the quote / lead came in. */
function waitingSince(r: { estPlansRequestedAt: string | null; quotedDate: string | null; dateReceived: string | null; createdAt?: Date }): string {
  return r.estPlansRequestedAt ?? r.quotedDate ?? r.dateReceived ?? brisbaneToday();
}

/** Big striped banner on a card while its plans haven't arrived. */
function WaitingPlans({ r }: { r: Row }) {
  const today = brisbaneToday();
  const since = waitingSince(r);
  const days = Math.max(0, -daysUntil(since, today));
  return (
    <div className={`est-waitbanner ${days >= 7 ? "long" : ""}`} role="status">
      <span className="est-waitbanner-icon" aria-hidden="true">⏳</span>
      <div><b>Waiting on plans</b><small>{days === 0 ? "Since today" : `${days} day${days === 1 ? "" : "s"}, since ${fmtDate(since)}`}{r.estPlansRequestedAt ? "" : " (set the date plans were requested below)"}</small></div>
    </div>
  );
}
