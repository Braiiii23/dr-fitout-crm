import Link from "next/link";
import { requireViewer } from "@/lib/team-view";
import { requireUser } from "@/lib/auth";
import { kickBuildertrendSync } from "@/lib/buildertrend";
import { getBrand } from "@/lib/brand";
import { liveJobs, wipFor } from "@/lib/wip";
import { brisbaneToday } from "@/lib/time";
import { MoneyBar, ProgressBar, FlagChips, aud, dmy } from "@/components/WipBits";
import { saveJob, fillMissingNow } from "./actions";
import { lastFill } from "@/lib/job-fill";
import { claimPlan } from "@/lib/claim-timing";

// Jobs: every live job at a glance. Opens the job's WIP detail.
export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireViewer(["ADMIN", "ACCOUNTS", "PM"]);
  const isAdmin = me.role === "ADMIN";
  kickBuildertrendSync();
  const sp = await searchParams;
  const brand = await getBrand();
  const showDone = true; // completed jobs always show, in their own section at the bottom
  const today = brisbaneToday();
  const all = (await liveJobs(brand, true)).map((j) => ({ j, w: wipFor(j, today) }));
  // Completed AND paid in full go to the bottom. Completed jobs still owed money stay up top (they need chasing).
  const finished = ({ j, w }: { j: { status: string }; w: { paidInFull: boolean } }) => j.status === "Complete" && w.paidInFull;
  const jobs = all.filter((x) => !finished(x));
  const done = all.filter(finished).sort((a, b) => (b.j.finishDate ?? "").localeCompare(a.j.finishDate ?? ""));
  // Most urgent first: red flags, then amber, then soonest handover.
  jobs.sort((a, b) => (b.w.flags.filter((f) => f.level === "red").length - a.w.flags.filter((f) => f.level === "red").length) || (b.w.flags.length - a.w.flags.length) || (a.j.finishDate ?? "9").localeCompare(b.j.finishDate ?? "9"));
  const fill = await lastFill();
  const missing = all.filter(({ j }) => j.status !== "Complete" && (!j.contractValue || !j.xeroTracking || !j.client));
  const totals = jobs.reduce((t, { j, w }) => ({ contract: t.contract + j.contractValue, received: t.received + w.receivedEx, owed: t.owed + w.owedInc }), { contract: 0, received: 0, owed: 0 });
  return (
    <div className="wip space-y-5">
      <div className="acc-top">
        <div>
          <h1 className="est-title">Jobs</h1>
          <p className="est-sub">{jobs.length} live job{jobs.length === 1 ? "" : "s"} · {aud(totals.contract)} contracts · {aud(totals.received)} received · {aud(totals.owed)} inc GST owed to us{done.length ? ` · ${done.length} completed` : ""}</p>
        </div>
        <div className="acc-actions">
          <Link prefetch={false} href="/wip" className="btn">WIP view</Link>
          {(isAdmin || me.role === "PM") && <Link prefetch={false} href="/jobs/buildertrend" className="acc-link">BuilderTrend</Link>}
          {done.length > 0 && <a href="#completed" className="acc-link">Completed and paid</a>}
        </div>
      </div>

      {(missing.length > 0 || (fill?.jobs.length ?? 0) > 0) && (
        <section className="card acc-pad">
          <div className="acc-head"><h2 className="est-h2">Missing job details</h2><span className="acc-muted">Blank details are filled automatically from Xero and CRM leads after every Xero sync and Grok import. Nothing already on a job is overwritten.</span></div>
          {fill && fill.jobs.some((x) => x.filled.length) && <div className="wip-fill-list"><b>Filled in {new Date(fill.at).toLocaleString("en-AU", { timeZone: "Australia/Brisbane", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}:</b>
            <ul>{fill.jobs.filter((x) => x.filled.length).map((x) => <li key={x.jobId}><Link prefetch={false} className="jc-name" href={`/jobs/${x.jobId}?tab=details`}>{x.job}</Link>: {x.filled.join("; ")}</li>)}</ul></div>}
          {missing.length > 0 && <div className="wip-fill-list"><b>Still to check ({missing.length}):</b>
            <ul>{missing.map(({ j }) => <li key={j.id}><Link prefetch={false} className="jc-name" href={`/jobs/${j.id}?tab=details`}>{j.name}</Link>: needs {[!j.contractValue && "the contract value", !j.xeroTracking && "its Xero tracking code", !j.client && "the client"].filter(Boolean).join(", ")}. <span className="acc-muted">Not found in Xero or the CRM, so enter it on the Job details tab (or have Grok send it).</span></li>)}</ul></div>}
          {fill && fill.jobs.some((x) => x.toCheck.some((t) => /estimate|still marked/.test(t))) && <div className="wip-fill-list"><b>Please confirm:</b>
            <ul>{fill.jobs.flatMap((x) => x.toCheck.filter((t) => /estimate|still marked/.test(t)).map((t) => <li key={x.jobId + t}><Link prefetch={false} className="jc-name" href={`/jobs/${x.jobId}?tab=details`}>{x.job}</Link>: {t}</li>))}</ul></div>}
          <form action={fillMissingNow} className="acc-actions" style={{ marginTop: ".5rem" }}><button className="btn">Fill missing details now</button></form>
        </section>
      )}

      {isAdmin && <details className="card acc-pad wip-new">
        <summary className="btn" style={{ width: "max-content" }}>+ New job</summary>
        <form action={saveJob} className="tp-form" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <label><span className="label">Job name</span><input name="name" className="input" required placeholder="e.g. Hecho En Mexico Robina" /></label>
          <input type="hidden" name="brand" value="DR" />
          <label><span className="label">Job number</span><input name="jobNumber" className="input" placeholder="898" /></label>
          <label><span className="label">Xero tracking</span><input name="xeroTracking" className="input" placeholder="HECH002" /></label>
          <label><span className="label">Client</span><input name="client" className="input" /></label>
          <label><span className="label">Contract (ex GST)</span><input name="contractValue" inputMode="decimal" className="input" required /></label>
          <label><span className="label">Start</span><input name="startDate" type="date" className="input" /></label>
          <label><span className="label">Expected handover</span><input name="finishDate" type="date" className="input" /></label>
          <label><span className="label">Project manager</span><input name="pm" className="input" /></label>
          <label className="tp-check"><input type="checkbox" name="defaultClaims" defaultChecked /> Start with the usual 30 / 30 / 35 / 5 claims</label>
          <div className="tp-form-actions"><button className="btn">Create job</button></div>
        </form>
        <p className="acc-muted">Jobs are also created automatically when a lead is marked Signed.</p>
      </details>}

      {jobs.length === 0 && <div className="card est-empty">No live jobs right now. Mark a lead as Signed, or press New job.</div>}
      <div className="wip-grid">
        {jobs.map(({ j, w }) => (
          <article key={j.id} className="card wip-card" data-brand={j.brand}>
            <header className="wip-card-head">
              <div className="min-w-0">
                <Link prefetch={false} href={`/jobs/${j.id}`} className="wip-name">{j.name}</Link>
                <div className="acc-muted">{[j.jobNumber && `Job ${j.jobNumber}`, j.client, j.pm && `PM ${j.pm}`].filter(Boolean).join(" · ")}</div>
              </div>
              <span className="wip-brand">{j.brand === "DR" ? "DR Fitout" : "ENP Fitouts"}</span>
            </header>
            <ProgressBar w={w} />
            <div className="wip-dates">
              <span>Start <b>{dmy(j.startDate)}</b></span><span>Handover <b>{dmy(j.finishDate)}</b></span>
              {j.status === "Complete" ? <span className="wip-late">Completed · awaiting payment</span> : w.daysLate > 0 ? <span className="wip-late">{w.daysLate} day{w.daysLate === 1 ? "" : "s"} late</span> : j.status !== "Live" ? <span className="wip-chip">{j.status}</span> : null}
            </div>
            <div className="wip-contract"><span className="acc-muted">Contract</span><b>{aud(j.contractValue)}</b><span className="acc-muted">ex GST · forecast GP {aud(w.forecastGp)} ({w.forecastGpPct.toFixed(1)}%)</span></div>
            {(() => { const p = claimPlan(j, today).find((x) => x.state !== "issued"); return p ? (
              <div className={`wip-nextclaim ${p.state}`}><span>Next claim</span><b>Claim {p.seq} · {p.pct}% · {aud(p.amountInc)} inc</b><small>{p.state === "ready" ? "Ready to invoice now" : p.issueOn ? `Invoice ${dmy(p.issueOn)}` : "No date yet"}{p.issueOn ? ` · ${p.basis}` : ""}</small></div>) : null; })()}
            <MoneyBar contract={j.contractValue} w={w} />
            {w.actual.income > 0 && <div className="wip-actual-line"><span>Actual to date</span><b className={w.actual.profit < 0 ? "acc-bad-text" : ""}>{aud(w.actual.profit)} profit</b><small>{w.actual.pct.toFixed(1)}% on {aud(w.actual.income)} invoiced · {aud(w.actual.costs)} spent</small></div>}
            <FlagChips w={w} jobId={j.id} />
            <Link prefetch={false} href={`/jobs/${j.id}`} className="wip-open">Open job</Link>
          </article>
        ))}
      </div>

      {done.length > 0 && (<>
        <h2 id="completed" className="est-h2 est-h2-signed">Completed and paid in full <span>{done.length} job{done.length === 1 ? "" : "s"} · {aud(done.reduce((t, { w }) => t + w.actual.profit, 0))} actual profit on {aud(done.reduce((t, { w }) => t + w.actual.income, 0))} invoiced</span></h2>
        <div className="wip-grid">
          {done.map(({ j, w }) => <CompletedCard key={j.id} j={j} w={w} />)}
        </div>
      </>)}
    </div>
  );
}

/** A finished job: its final, actual profit and loss against what it was signed at and budgeted for. */
function CompletedCard({ j, w }: { j: Awaited<ReturnType<typeof liveJobs>>[number]; w: ReturnType<typeof wipFor> }) {
  const A = w.actual;
  const budgetGp = j.contractValue - w.costTotal;
  const vsBudget = A.profit - budgetGp;
  return (
    <article className="card wip-card is-complete" data-brand={j.brand}>
      <span className="est-won wip-done-badge">Paid in full</span>
      <header className="wip-card-head">
        <div className="min-w-0">
          <Link prefetch={false} href={`/jobs/${j.id}`} className="wip-name">{j.name}</Link>
          <div className="acc-muted">{[j.jobNumber && `Job ${j.jobNumber}`, j.client, j.finishDate && `Handed over ${dmy(j.finishDate)}`].filter(Boolean).join(" · ")}</div>
        </div>
        <span className="wip-brand">{j.brand === "DR" ? "DR Fitout" : "ENP Fitouts"}</span>
      </header>
      <div className="wip-pl">
        <div className="wip-pl-big"><span>Actual profit</span><b className={A.profit < 0 ? "acc-bad-text" : ""}>{aud(A.profit)}</b><small>{A.pct.toFixed(1)}% margin{A.invoicedPct < 99.5 ? ` · only ${A.invoicedPct.toFixed(0)}% of the contract invoiced` : ""}</small></div>
        <table className="wip-pl-table"><tbody>
          <tr><td>Invoiced</td><td>{aud(A.income)}</td></tr>
          <tr><td>Trades, suppliers and site costs</td><td>−{aud(A.trades + A.otherBills)}</td></tr>
          {A.labour > 0 && <tr><td>Our labour</td><td>−{aud(A.labour)}</td></tr>}
          {A.materials > 0 && <tr><td>Materials</td><td>−{aud(A.materials)}</td></tr>}
          <tr className="is-total"><td>Profit</td><td>{aud(A.profit)}</td></tr>
          <tr><td>Budgeted profit</td><td>{aud(budgetGp)} <small className={vsBudget < 0 ? "acc-bad-text" : "acc-good-text"}>{vsBudget >= 0 ? "+" : "−"}{aud(Math.abs(vsBudget))}</small></td></tr>
          <tr><td>Cash received</td><td>{aud(w.receivedInc)} inc{w.owedInc > 0.5 ? <small className="acc-bad-text"> · {aud(w.owedInc)} still owed</small> : null}</td></tr>
        </tbody></table>
      </div>
      <Link prefetch={false} href={`/jobs/${j.id}`} className="wip-open">Open job</Link>
    </article>
  );
}
