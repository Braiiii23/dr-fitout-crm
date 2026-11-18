import Link from "next/link";
import { requireViewer } from "@/lib/team-view";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { kickBuildertrendSync } from "@/lib/buildertrend";
import { fullJobInclude, wipFor } from "@/lib/wip";
import { brisbaneToday } from "@/lib/time";
import { MoneyBar, ProgressBar, aud, dmy } from "@/components/WipBits";
import CsvImport from "@/components/CsvImport";
import { claimPlan, suggestClaim } from "@/lib/claim-timing";
import { lastXeroJobSync } from "@/lib/xero-jobs";
import { saveJobXero, jobXeroUpdate, linkJobLead, pullTradePack, saveJob, deleteJob, applySplit, saveClaim, saveCostLine, saveBill, saveLabour, approveAllLabour, saveMaterial, saveTask, deleteRow } from "../actions";

const TABS = [["summary", "Summary"], ["claims", "Claims"], ["costs", "Costs"], ["labour", "Labour & materials"], ["program", "Program"], ["import", "Import CSV"], ["details", "Job details"]] as const;

function Del({ kind, id, jobId }: { kind: string; id: string; jobId: string }) {
  return <form action={deleteRow}><input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} /><input type="hidden" name="jobId" value={jobId} /><button className="tp-del">Delete</button></form>;
}
const F = ({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) => <label className={wide ? "tp-wide" : undefined}><span className="label">{label}</span>{children}</label>;

export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const me = await requireViewer(["ADMIN", "ACCOUNTS", "PM"]);
  const isAdmin = me.role === "ADMIN"; // creating/deleting jobs, contract and lead links are Braiden's
  const canProgram = isAdmin || me.role === "PM"; // build program and job dates: Braiden and project managers
  const canClaims = isAdmin || me.role === "ACCOUNTS"; // claims: Braiden and accounts
  kickBuildertrendSync();
  const { id } = await params; const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab : "summary";
  const job = await prisma.job.findUnique({ where: { id }, include: fullJobInclude });
  if (!job) notFound();
  const today = brisbaneToday();
  const w = wipFor(job, today);
  const settings = await prisma.accountsSettings.findUnique({ where: { id: "settings" } });
  const plan = claimPlan(job, today, settings?.claimTermsDays ?? 10, settings?.claimNoticeDays ?? 3);
  const planOf = (id: string) => plan.find((p) => p.claimId === id);
  const xj = await lastXeroJobSync();
  const xr = xj?.jobs.find((x) => x.jobId === job.id);
  const leadOpts = tab === "details" ? await prisma.lead.findMany({ where: { brand: { in: ["ENP", "DR"] }, cancelled: false, stage: { in: ["Signed", "Quoting"] } }, select: { id: true, company: true, leadName: true, stage: true, jobNumber: true }, orderBy: { updatedAt: "desc" }, take: 200 }) : [];
  const tradeCount = job.leadId ? await prisma.tradeQuote.count({ where: { leadId: job.leadId } }) : 0;
  const lead = job.leadId ? await prisma.lead.findUnique({ where: { id: job.leadId }, select: { brand: true, grossProfit: true } }) : null;
  const lineOpts = job.costLines.map((l) => <option key={l.id} value={l.id}>{l.trade}</option>);
  const claimOpts = job.claims.map((c) => <option key={c.id} value={c.seq}>{c.seq} · {c.name}</option>);
  const H = ({ name }: { name: string }) => <input type="hidden" name={name} value={job.id} />;

  return (
    <div className="wip space-y-5" data-brand={job.brand}>
      <div><Link prefetch={false} href="/jobs" className="acc-link">All jobs</Link> · <Link prefetch={false} href="/wip" className="acc-link">WIP view</Link></div>
      <header className="wip-head">
        <div className="min-w-0">
          <div className="est-k">{job.brand === "DR" ? "DR Fitout" : "ENP Fitouts"} · {job.status}{job.jobNumber ? ` · Job ${job.jobNumber}` : ""}{job.xeroTracking ? ` · Xero ${job.xeroTracking}` : ""}</div>
          <h1 className="est-title">{job.name}</h1>
          <p className="est-sub">{[job.client, job.pm && `PM ${job.pm}`, `Start ${dmy(job.startDate)}`, `Handover ${dmy(job.finishDate)}`].filter(Boolean).join(" · ")}{w.daysLate > 0 && <span className="wip-late" style={{ marginLeft: ".5rem" }}>{w.daysLate} days late</span>}</p>
        </div>
        <div className="wip-headnums">
          <div><span>Contract</span><b>{aud(job.contractValue)}</b></div>
          <div><span>Forecast GP</span><b className={lead?.grossProfit != null && w.forecastGp < lead.grossProfit ? "acc-warn-text" : ""}>{aud(w.forecastGp)}</b><small>{w.forecastGpPct.toFixed(1)}%{lead?.grossProfit != null ? ` · signed ${aud(lead.grossProfit)}` : ""}</small></div>
          <div><span>Cash position</span><b className={w.cashPositionEx < 0 ? "acc-bad-text" : ""}>{aud(w.cashPositionEx)}</b><small>received − paid out, ex GST</small></div>
        </div>
      </header>

      <nav className="wip-tabs no-print" aria-label="Job sections">
        {TABS.map(([k, label]) => <Link prefetch={false} key={k} href={`/jobs/${job.id}?tab=${k}`} className={`wip-tab ${tab === k ? "is-on" : ""}`} aria-current={tab === k ? "page" : undefined}>{label}{k === "summary" && w.flags.length ? <span className="wip-count">{w.flags.length}</span> : null}</Link>)}
      </nav>

      {tab === "summary" && (<>
        <section className="card acc-pad wip-sum">
          <ProgressBar w={w} />
          <MoneyBar contract={job.contractValue} w={w} />
          <div className="wip-stats">
            {[
              ["Claimed", aud(w.claimedEx), `${w.claimedPct}% of contract`], ["Cash received", aud(w.receivedInc), "inc GST"], ["Owed to us", aud(w.owedInc), "inc GST, on raised claims"],
              ["Costs", aud(w.costTotal), `${aud(w.lockedCost)} locked or paid`], ["Paid", aud(w.paidTotal), "on trades with a known paid"], ["Owing (known)", aud(w.owingKnown), `${w.pendingCount} trades pending (${aud(w.pendingCost)})`],
              ["Labour", `${w.hours.toFixed(2)} h`, `${aud(w.labourCost, true)}${w.unapprovedHours ? ` · ${w.unapprovedHours.toFixed(2)} h not approved` : ""}`], ["Supplier invoices owing", aud(w.billsOwing), `${w.unmappedBills.length} not mapped to a claim`],
              ["Next", w.nextTask ? w.nextTask.name : "—", w.nextTask ? `${dmy(w.nextTask.start)} to ${dmy(w.nextTask.finish)}` : ""],
            ].map(([a, b, c]) => <div key={a} className="wip-stat"><span>{a}</span><b>{b}</b><small>{c}</small></div>)}
          </div>
        </section>
        <section className="card acc-pad">
          <div className="acc-head"><h2 className="est-h2">Profit and loss</h2><span className="acc-muted">Actual = invoiced to the client, less what&apos;s actually been paid or billed. Ex GST. {job.status === "Complete" ? "Final figures." : `To date: ${w.actual.invoicedPct.toFixed(0)}% of the contract invoiced so far.`}</span></div>
          <div className="overflow-x-auto"><table className="acc-pl">
            <thead><tr><th>Line</th><th>Signed / budget</th><th>Forecast</th><th>Actual{job.status === "Complete" ? "" : " to date"}</th></tr></thead>
            <tbody>
              <tr><td>Income (contract / invoiced)</td><td>{aud(job.contractValue)}</td><td>{aud(job.contractValue)}</td><td>{aud(w.actual.income)}</td></tr>
              <tr><td>Trades and suppliers</td><td>−{aud(w.costTotal)}</td><td>−{aud(w.forecastCost)}</td><td>−{aud(w.actual.trades + w.actual.otherBills)}</td></tr>
              {(w.actual.labour > 0 || w.actual.materials > 0) && <tr><td>Labour and materials not on a trade</td><td>—</td><td>—</td><td>−{aud(w.actual.labour + w.actual.materials)}</td></tr>}
              <tr className="acc-pl-total"><td>Gross profit</td><td>{aud(job.contractValue - w.costTotal)}</td><td>{aud(w.forecastGp)}</td><td className={w.actual.profit < 0 ? "acc-bad-text" : ""}>{aud(w.actual.profit)}</td></tr>
              <tr><td>Margin</td><td>{job.contractValue ? ((job.contractValue - w.costTotal) / job.contractValue * 100).toFixed(1) : "0.0"}%</td><td>{w.forecastGpPct.toFixed(1)}%</td><td>{w.actual.pct.toFixed(1)}%</td></tr>
              {lead?.grossProfit != null && <tr><td>GP at signing</td><td colSpan={3}>{aud(lead.grossProfit)} ({job.contractValue ? (lead.grossProfit / job.contractValue * 100).toFixed(1) : "0"}%)</td></tr>}
              <tr><td>Cash received (inc GST)</td><td colSpan={3}>{aud(w.receivedInc)}{w.owedInc > 0.5 ? ` · ${aud(w.owedInc)} still owed` : ""}</td></tr>
            </tbody>
          </table></div>
          <details style={{ marginTop: ".7rem" }}><summary className="acc-link">Budget vs actual by trade</summary>
            <div className="overflow-x-auto"><table className="acc-pl" style={{ marginTop: ".5rem" }}>
              <thead><tr><th>Trade</th><th>Budget</th><th>Actual</th><th>Difference</th></tr></thead>
              <tbody>{w.actual.tradeRows.map((t) => (
                <tr key={t.id}><td>{t.trade}</td><td>{aud(t.budget)}</td><td>{t.pending ? <span className="wip-pending">Pending</span> : aud(t.actual)}</td>
                  <td className={!t.pending && t.actual > t.budget + 0.5 ? "acc-bad-text" : ""}>{t.pending ? "—" : `${t.actual > t.budget ? "+" : t.actual < t.budget ? "−" : ""}${aud(Math.abs(t.actual - t.budget))}`}</td></tr>))}</tbody>
            </table></div>
            <p className="acc-muted">Actual per trade = paid plus approved bills not yet paid. Pending trades have nothing paid or billed yet.</p>
          </details>
        </section>
        <section className="card acc-pad">
          <h2 className="est-h2" style={{ marginTop: 0 }}>Needs action</h2>
          {w.flags.length ? <ul className="wip-flags">{w.flags.map((f) => <li key={f.text} className={f.level}><Link prefetch={false} href={`/jobs/${job.id}?tab=${f.tab}`}>{f.text}</Link></li>)}</ul> : <p className="acc-good-text">Nothing flagged. This job is on track.</p>}
        </section>
        <section className="card acc-pad">
          <h2 className="est-h2" style={{ marginTop: 0 }}>Claims at a glance</h2>
          <div className="wip-claimline">{w.claims.map((c) => (
            <div key={c.id} className={`wip-claimdot s-${c.status.replace(" ", "").toLowerCase()} ${c.overdueDays ? "is-overdue" : ""}`}>
              <b>{c.pct}%</b><span>{c.name}</span><small>{c.status}{c.overdueDays ? ` · ${c.overdueDays}d overdue` : c.dueDate && c.claimed && c.outstandingInc > 0 ? ` · due ${dmy(c.dueDate)}` : ""}</small>
            </div>))}</div>
        </section>
      </>)}

      {tab === "claims" && (
        <section className="card acc-pad">
          <div className="acc-actions" style={{ justifyContent: "space-between", marginBottom: ".6rem" }}>
            <span className="acc-muted">{job.xeroTracking ? `Xero: invoices and bills tagged ${job.xeroTracking} fill this in automatically` : "Add the job's Xero tracking code on the Job details tab so its invoices and bills come in automatically"}{xj ? ` · last checked ${new Date(xj.at).toLocaleString("en-AU", { timeZone: "Australia/Brisbane", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : ""}</span>
            <form action={jobXeroUpdate}><H name="jobId" /><button className="btn">Update from Xero</button></form>
          </div>
          {xr && xr.unmatchedSales.length > 0 && <div className="acc-notice acc-warn" role="status" style={{ marginBottom: ".6rem" }}>Xero invoices on this job not matched to a claim: {xr.unmatchedSales.map((x) => `${x.number} ${aud(x.amount, true)} ex${x.date ? ` (${dmy(x.date)})` : ""}`).join(", ")}. Put the invoice number on the right claim to link it.</div>}
          <div className="acc-head"><h2 className="est-h2">Claim schedule</h2><span className="acc-muted">This job&apos;s own signed split ({w.claims.map((c) => c.pct).join(" / ")} = {w.scheduledPct}%). Amounts ex GST; received is inc GST.</span></div>
          <div className="overflow-x-auto"><table className="table wip-rows">
            <thead><tr><th>#</th><th>Claim</th><th>%</th><th>Amount ex</th><th>Inc GST</th><th>Issue on</th><th>Invoice</th><th>Status</th><th>Due</th><th>Received inc</th><th>Owing inc</th><th /></tr></thead>
            <tbody>{w.claims.map((c) => (
              <tr key={c.id} className={c.overdueDays ? "is-bad" : ""}>
                <td>{c.seq}</td><td>{c.name}{c.hook && <small className="acc-muted" style={{ display: "block" }}>{c.hook}</small>}</td><td>{c.pct}%</td><td>{aud(c.amount, true)}</td><td>{aud(c.inc, true)}</td>
                <td>{(() => { const p = planOf(c.id); if (!p) return "—"; if (p.state === "issued") return <span className="acc-muted">{c.invoicedDate ? `Issued ${dmy(c.invoicedDate)}` : "Issued"}</span>; return <>{p.issueOn ? <b className={p.state === "ready" ? "acc-bad-text" : p.state === "soon" ? "acc-warn-text" : ""}>{p.state === "ready" ? `Ready (${dmy(p.issueOn)})` : dmy(p.issueOn)}</b> : <span className="acc-muted">No date</span>}<small className="acc-muted" style={{ display: "block" }}>{p.basis}</small></>; })()}</td>
                <td>{c.invoiceNumber ?? "—"}</td><td>{c.status}</td><td>{dmy(c.dueDate)}{c.overdueDays ? <small className="acc-bad-text" style={{ display: "block" }}>{c.overdueDays} days overdue</small> : null}</td>
                <td>{aud(c.receivedInc, true)}</td><td>{c.claimed ? aud(c.outstandingInc, true) : "—"}</td>
                <td>{canClaims && <details className="tp-edit" key={`${c.id}-${c.status}-${c.receivedInc}`}><summary>Edit</summary>
                  <form action={saveClaim} className="tp-form"><H name="jobId" /><input type="hidden" name="id" value={c.id} />
                    <F label="#"><input name="seq" className="input" defaultValue={c.seq} /></F><F label="Name"><input name="name" className="input" defaultValue={c.name} /></F>
                    <F label="%"><input name="pct" className="input" defaultValue={c.pct} /></F><F label="Amount ex GST"><input name="amount" className="input" defaultValue={c.amount} /></F>
                    <F label="Invoice"><input name="invoiceNumber" className="input" defaultValue={c.invoiceNumber ?? ""} /></F>
                    <F label="Status"><select name="status" className="input" defaultValue={c.status}>{["Not due", "Draft", "Authorised", "Paid"].map((x) => <option key={x}>{x}</option>)}</select></F>
                    <F label="Invoiced"><input name="invoicedDate" type="date" className="input" defaultValue={c.invoicedDate ?? ""} /></F><F label="Due"><input name="dueDate" type="date" className="input" defaultValue={c.dueDate ?? ""} /></F>
                    <F label="Received inc GST"><input name="receivedInc" className="input" defaultValue={c.receivedInc} /></F>
                    <F label="Issue on (blank = from program)"><input name="issueOn" type="date" className="input" defaultValue={c.issueOn ?? ""} /></F><F label="Milestone"><input name="hook" className="input" defaultValue={c.hook ?? ""} /></F>
                    <F label="Notes" wide><input name="notes" className="input" defaultValue={c.notes ?? ""} /></F>
                    <div className="tp-form-actions"><button className="btn">Save</button></div></form>
                  <Del kind="claim" id={c.id} jobId={job.id} /></details>}</td>
              </tr>))}</tbody>
          </table></div>
          {canClaims && <details className="tp-add-scope"><summary className="btn" style={{ width: "max-content" }}>+ Add a claim</summary>
            <form action={saveClaim} className="tp-form"><H name="jobId" />
              <F label="#"><input name="seq" className="input" defaultValue={w.claims.length + 1} /></F><F label="Name"><input name="name" className="input" required /></F>
              <F label="%"><input name="pct" className="input" required /></F><F label="Amount ex GST (blank = % of contract)"><input name="amount" className="input" /></F>
              <F label="Milestone"><input name="hook" className="input" /></F><div className="tp-form-actions"><button className="btn">Add claim</button></div></form>
          </details>}
          {canClaims && w.claims.every((c) => !c.claimed) && (
            <form action={applySplit} className="acc-actions" style={{ marginTop: ".8rem" }}><H name="jobId" />
              <label><span className="label">Replace with a split</span><input name="split" className="input" placeholder="30/30/20/15/5" /></label><button className="btn">Apply split</button>
              <span className="acc-muted">Only before any claim is raised. The last claim takes the remainder so it adds up to the contract.</span></form>)}
        </section>
      )}

      {tab === "costs" && (<>
        <section className="card acc-pad">
          <div className="acc-actions" style={{ marginBottom: ".6rem" }}>
            {tradeCount > 0 && <form action={pullTradePack}><H name="jobId" /><button className="btn">Pull trade pack from estimating ({tradeCount} quotes)</button></form>}
            <form action={jobXeroUpdate}><H name="jobId" /><button className="btn">Update bills from Xero</button></form>
            {!job.leadId && <span className="acc-muted">Link this job to its lead (Job details tab) to pull Justin&apos;s trade pack.</span>}
          </div>
          <div className="acc-head"><h2 className="est-h2">Trades and costs</h2><span className="acc-muted">Ex GST. Paid left blank = Pending (not $0). New construction&apos;s paid can come from linked labour and receipts.</span></div>
          <div className="overflow-x-auto"><table className="table wip-rows">
            <thead><tr><th>Trade</th><th>Cost</th><th>Status</th><th>Paid</th><th>Owing</th><th>Claim</th><th>Bills owing</th><th /></tr></thead>
            <tbody>{w.lines.map((l) => (
              <tr key={l.id} className={l.over ? "is-bad" : ""}>
                <td>{l.trade}{l.supplier && <small className="acc-muted" style={{ display: "block" }}>{l.supplier}</small>}{l.notes && <small className="acc-muted" style={{ display: "block" }}>{l.notes}</small>}</td>
                <td>{aud(l.cost, true)}</td><td>{l.costStatus}</td>
                <td>{l.paidNow == null ? <span className="wip-pending">Pending</span> : <>{aud(l.paidNow, true)}{l.paidFrom === "linked" && <small className="acc-muted" style={{ display: "block" }}>from labour / receipts / bills</small>}</>}</td>
                <td className={l.owing != null && l.owing < 0 ? "acc-bad-text" : ""}>{l.owing == null ? <span className="wip-pending">Pending</span> : aud(l.owing, true)}</td>
                <td>{l.claimSeq ?? <span className="acc-muted">—</span>}</td><td>{l.authorisedBills ? aud(l.authorisedBills, true) : "—"}</td>
                <td><details className="tp-edit" key={`${l.id}-${l.paid}-${l.cost}`}><summary>Edit</summary>
                  <form action={saveCostLine} className="tp-form"><H name="jobId" /><input type="hidden" name="id" value={l.id} />
                    <F label="Trade"><input name="trade" className="input" defaultValue={l.trade} /></F><F label="Supplier"><input name="supplier" className="input" defaultValue={l.supplier ?? ""} /></F>
                    <F label="Cost ex GST"><input name="cost" className="input" defaultValue={l.cost} /></F>
                    <F label="Status"><select name="costStatus" className="input" defaultValue={l.costStatus}>{["Quoted", "Provisional", "Locked"].map((x) => <option key={x}>{x}</option>)}</select></F>
                    <F label="Paid ex GST (blank = Pending)"><input name="paid" className="input" defaultValue={l.paid ?? ""} /></F>
                    <F label="Claim"><select name="claimSeq" className="input" defaultValue={l.claimSeq ?? ""}><option value="">To confirm</option>{claimOpts}</select></F>
                    <F label="Notes" wide><input name="notes" className="input" defaultValue={l.notes ?? ""} /></F>
                    <div className="tp-form-actions"><button className="btn">Save</button></div></form>
                  <Del kind="cost" id={l.id} jobId={job.id} /></details></td>
              </tr>))}</tbody>
            <tfoot><tr className="acc-pl-total"><td>Total</td><td>{aud(w.costTotal, true)}</td><td /><td>{aud(w.paidTotal, true)}</td><td>{aud(w.owingKnown, true)}</td><td /><td>{aud(w.lines.reduce((t, l) => t + l.authorisedBills, 0), true)}</td><td /></tr></tfoot>
          </table></div>
          <p className="acc-muted">Owing ({aud(w.owingKnown, true)}) only counts the {w.lines.length - w.pendingCount} trades with a known paid figure. {w.pendingCount} trades ({aud(w.pendingCost, true)} of costs) are Pending.</p>
          <details className="tp-add-scope"><summary className="btn" style={{ width: "max-content" }}>+ Add a trade</summary>
            <form action={saveCostLine} className="tp-form"><H name="jobId" />
              <F label="Trade"><input name="trade" className="input" required /></F><F label="Supplier"><input name="supplier" className="input" /></F>
              <F label="Cost ex GST"><input name="cost" className="input" required /></F><F label="Status"><select name="costStatus" className="input">{["Quoted", "Provisional", "Locked"].map((x) => <option key={x}>{x}</option>)}</select></F>
              <F label="Paid ex GST (blank = Pending)"><input name="paid" className="input" /></F><F label="Claim"><select name="claimSeq" className="input"><option value="">To confirm</option>{claimOpts}</select></F>
              <div className="tp-form-actions"><button className="btn">Add trade</button></div></form>
          </details>
        </section>
        <section className="card acc-pad">
          <div className="acc-head"><h2 className="est-h2">Supplier invoices</h2><span className="acc-muted">Bills on this job. Unpaid ones not mapped to a claim are flagged.</span></div>
          {job.bills.length ? <div className="overflow-x-auto"><table className="table wip-rows">
            <thead><tr><th>Supplier</th><th>Invoice</th><th>Amount ex</th><th>Status</th><th>Due</th><th>Trade</th><th>Claim</th><th /></tr></thead>
            <tbody>{job.bills.map((b) => (
              <tr key={b.id} className={b.status !== "Paid" && b.claimSeq == null ? "is-warn" : ""}>
                <td>{b.supplier}</td><td>{b.invoiceNumber ?? "—"}</td><td>{aud(b.amount, true)}</td><td>{b.status}</td><td>{dmy(b.dueDate)}</td>
                <td>{job.costLines.find((l) => l.id === b.costLineId)?.trade ?? "—"}</td><td>{b.claimSeq ?? <span className="acc-warn-text">Not mapped</span>}</td>
                <td><details className="tp-edit" key={`${b.id}-${b.status}-${b.claimSeq}`}><summary>Edit</summary>
                  <form action={saveBill} className="tp-form"><H name="jobId" /><input type="hidden" name="id" value={b.id} />
                    <F label="Supplier"><input name="supplier" className="input" defaultValue={b.supplier} /></F><F label="Invoice"><input name="invoiceNumber" className="input" defaultValue={b.invoiceNumber ?? ""} /></F>
                    <F label="Amount ex GST"><input name="amount" className="input" defaultValue={b.amount} /></F>
                    <F label="Status"><select name="status" className="input" defaultValue={b.status}>{["Draft", "Authorised", "Paid"].map((x) => <option key={x}>{x}</option>)}</select></F>
                    <F label="Due"><input name="dueDate" type="date" className="input" defaultValue={b.dueDate ?? ""} /></F><F label="Paid on"><input name="paidDate" type="date" className="input" defaultValue={b.paidDate ?? ""} /></F>
                    <F label="Trade"><select name="costLineId" className="input" defaultValue={b.costLineId ?? ""}><option value="">—</option>{lineOpts}</select></F>
                    <F label="Claim"><select name="claimSeq" className="input" defaultValue={b.claimSeq ?? ""}><option value="">Not mapped</option>{claimOpts}</select></F>
                    <div className="tp-form-actions"><button className="btn">Save</button></div></form>
                  <Del kind="bill" id={b.id} jobId={job.id} /></details></td>
              </tr>))}</tbody></table></div> : <p className="acc-muted">No supplier invoices yet.</p>}
          <details className="tp-add-scope"><summary className="btn" style={{ width: "max-content" }}>+ Add a supplier invoice</summary>
            <form action={saveBill} className="tp-form"><H name="jobId" />
              <F label="Supplier"><input name="supplier" className="input" required /></F><F label="Invoice"><input name="invoiceNumber" className="input" /></F>
              <F label="Amount ex GST"><input name="amount" className="input" required /></F><F label="Status"><select name="status" className="input">{["Authorised", "Draft", "Paid"].map((x) => <option key={x}>{x}</option>)}</select></F>
              <F label="Due"><input name="dueDate" type="date" className="input" /></F><F label="Trade"><select name="costLineId" className="input"><option value="">—</option>{lineOpts}</select></F>
              <F label="Claim"><select name="claimSeq" className="input"><option value="">Not mapped</option>{claimOpts}</select></F>
              <div className="tp-form-actions"><button className="btn">Add invoice</button></div></form>
          </details>
        </section>
      </>)}

      {tab === "labour" && (<>
        <section className="card acc-pad">
          <div className="acc-head"><h2 className="est-h2">Labour (BuilderTrend Time Clock)</h2><span className="acc-muted">{w.hours.toFixed(2)} hours · {aud(w.labourCost, true)} at ordinary rates{w.unapprovedHours ? ` · ${w.unapprovedHours.toFixed(2)} h not approved` : ""}</span></div>
          {job.labour.length ? <div className="overflow-x-auto"><table className="table wip-rows">
            <thead><tr><th>Date</th><th>Person</th><th>Hours</th><th>Rate</th><th>Cost</th><th>Approved</th><th>Trade</th><th /></tr></thead>
            <tbody>{job.labour.map((x) => (
              <tr key={x.id} className={!x.approved ? "is-warn" : ""}>
                <td>{dmy(x.date)}</td><td>{x.person}{x.notes && <small className="acc-muted" style={{ display: "block" }}>{x.notes}</small>}</td><td>{x.hours.toFixed(2)}</td><td>{aud(x.rate, true)}</td><td>{aud(x.hours * x.rate, true)}</td>
                <td>{x.approved ? "Yes" : <span className="acc-warn-text">Pending</span>}</td><td>{job.costLines.find((l) => l.id === x.costLineId)?.trade ?? "—"}</td>
                <td><details className="tp-edit" key={`${x.id}-${x.approved}-${x.hours}`}><summary>Edit</summary>
                  <form action={saveLabour} className="tp-form"><H name="jobId" /><input type="hidden" name="id" value={x.id} />
                    <F label="Date"><input name="date" type="date" className="input" defaultValue={x.date} /></F><F label="Person"><input name="person" className="input" defaultValue={x.person} /></F>
                    <F label="Hours"><input name="hours" className="input" defaultValue={x.hours} /></F><F label="Rate $/h"><input name="rate" className="input" defaultValue={x.rate} /></F>
                    <F label="Trade"><select name="costLineId" className="input" defaultValue={x.costLineId ?? ""}><option value="">—</option>{lineOpts}</select></F>
                    <label className="tp-check"><input type="checkbox" name="approved" defaultChecked={x.approved} /> Approved</label>
                    <div className="tp-form-actions"><button className="btn">Save</button></div></form>
                  <Del kind="labour" id={x.id} jobId={job.id} /></details></td>
              </tr>))}</tbody></table></div> : <p className="acc-muted">No hours yet. Import the BuilderTrend Time Clock export from the Import CSV tab.</p>}
          <div className="acc-actions" style={{ marginTop: ".6rem" }}>
            {w.unapprovedHours > 0 && <form action={approveAllLabour}><H name="jobId" /><button className="btn">Approve all hours</button></form>}
            <details className="tp-add-scope"><summary className="btn" style={{ width: "max-content" }}>+ Add hours</summary>
              <form action={saveLabour} className="tp-form"><H name="jobId" />
                <F label="Date"><input name="date" type="date" className="input" defaultValue={today} /></F><F label="Person"><input name="person" className="input" required /></F>
                <F label="Hours"><input name="hours" className="input" required /></F><F label="Rate $/h"><input name="rate" className="input" /></F>
                <F label="Trade"><select name="costLineId" className="input" defaultValue={job.costLines.find((l) => /new construction/i.test(l.trade))?.id ?? ""}><option value="">—</option>{lineOpts}</select></F>
                <div className="tp-form-actions"><button className="btn">Add hours</button></div></form>
            </details>
          </div>
        </section>
        <section className="card acc-pad">
          <div className="acc-head"><h2 className="est-h2">Materials receipts</h2><span className="acc-muted">{aud(w.materialsTotal, true)} ex GST</span></div>
          {job.materials.length ? <div className="overflow-x-auto"><table className="table wip-rows">
            <thead><tr><th>Date</th><th>Supplier</th><th>What</th><th>Amount ex</th><th>Trade</th><th /></tr></thead>
            <tbody>{job.materials.map((m) => (
              <tr key={m.id}><td>{dmy(m.date)}</td><td>{m.supplier}</td><td>{m.description ?? "—"}</td><td>{aud(m.amount, true)}</td><td>{job.costLines.find((l) => l.id === m.costLineId)?.trade ?? "—"}</td><td><Del kind="material" id={m.id} jobId={job.id} /></td></tr>))}</tbody></table></div> : <p className="acc-muted">No receipts yet.</p>}
          <details className="tp-add-scope"><summary className="btn" style={{ width: "max-content" }}>+ Add a receipt</summary>
            <form action={saveMaterial} className="tp-form"><H name="jobId" />
              <F label="Date"><input name="date" type="date" className="input" defaultValue={today} /></F><F label="Supplier"><input name="supplier" className="input" required /></F>
              <F label="What"><input name="description" className="input" /></F><F label="Amount ex GST"><input name="amount" className="input" required /></F>
              <F label="Trade"><select name="costLineId" className="input"><option value="">—</option>{lineOpts}</select></F>
              <div className="tp-form-actions"><button className="btn">Add receipt</button></div></form>
          </details>
        </section>
      </>)}

      {tab === "program" && (
        <section className="card acc-pad">
          <div className="acc-head"><h2 className="est-h2">Build program</h2><span className="acc-muted">Tasks against the claims they support. &quot;To confirm&quot; where the link isn&apos;t clear.</span></div>
          {job.tasks.length ? <div className="wip-gantt">{(() => {
            const start = job.tasks[0].start, end = job.tasks.reduce((a, t) => (t.finish > a ? t.finish : a), job.tasks[0].finish);
            const span = Math.max(1, (Date.parse(end) - Date.parse(start)) / 86400000 + 1);
            const pos = (x: string) => ((Date.parse(x) - Date.parse(start)) / 86400000) / span * 100;
            const todayPos = today >= start && today <= end ? pos(today) : null;
            return job.tasks.map((t) => (
              <div key={t.id} className={`wip-gt ${t.done || t.finish < today ? "is-done" : ""}`}>
                <div className="wip-gt-name"><b>{t.name}</b><small>{dmy(t.start)}{t.finish !== t.start ? ` to ${dmy(t.finish)}` : ""} · {t.claimSeq ? `Claim ${t.claimSeq}` : (() => { const sg = suggestClaim(t.name, job.claims); return sg ? `Claim ${sg} (suggested)` : "To confirm"; })()}{t.source === "buildertrend" ? " · BuilderTrend" : ""}</small></div>
                <div className="wip-gt-track">{todayPos != null && <i style={{ left: `${todayPos}%` }} aria-hidden="true" />}<span className={t.claimSeq ? `c${t.claimSeq}` : "c0"} style={{ left: `${pos(t.start)}%`, width: `${Math.max(1.2, pos(t.finish) - pos(t.start) + 100 / span)}%` }} /></div>
                {canProgram && <details className="tp-edit" key={`${t.id}-${t.claimSeq}-${t.done}`}><summary>Edit</summary>
                  <form action={saveTask} className="tp-form"><H name="jobId" /><input type="hidden" name="id" value={t.id} />
                    <F label="Task"><input name="name" className="input" defaultValue={t.name} /></F><F label="Start"><input name="start" type="date" className="input" defaultValue={t.start} /></F>
                    <F label="Finish"><input name="finish" type="date" className="input" defaultValue={t.finish} /></F>
                    <F label="Claim"><select name="claimSeq" className="input" defaultValue={t.claimSeq ?? ""}><option value="">To confirm</option>{claimOpts}</select></F>
                    <label className="tp-check"><input type="checkbox" name="done" defaultChecked={t.done} /> Done</label>
                    <div className="tp-form-actions"><button className="btn">Save</button></div></form>
                  <Del kind="task" id={t.id} jobId={job.id} /></details>}
              </div>));
          })()}</div> : <p className="acc-muted">No program yet. Import Josh&apos;s BuilderTrend schedule (Title, Start, Workdays) from the Import CSV tab.</p>}
          {canProgram && <details className="tp-add-scope"><summary className="btn" style={{ width: "max-content" }}>+ Add a task</summary>
            <form action={saveTask} className="tp-form"><H name="jobId" />
              <F label="Task"><input name="name" className="input" required /></F><F label="Start"><input name="start" type="date" className="input" required /></F>
              <F label="Finish"><input name="finish" type="date" className="input" /></F><F label="Claim"><select name="claimSeq" className="input"><option value="">To confirm</option>{claimOpts}</select></F>
              <div className="tp-form-actions"><button className="btn">Add task</button></div></form>
          </details>}
        </section>
      )}

      {tab === "import" && (
        <section className="card acc-pad">
          <div className="acc-head"><h2 className="est-h2">Import from CSV</h2><span className="acc-muted">For BuilderTrend exports (Time Clock, schedule), Xero bills, or anything kept in a spreadsheet. You see a preview before anything is saved.</span></div>
          <CsvImport jobId={job.id} allowProgram={canProgram} />
        </section>
      )}

      {tab === "details" && !canProgram && (
        <section className="card acc-pad">
          <h2 className="est-h2" style={{ marginTop: 0 }}>Xero details</h2>
          <p className="acc-muted">The Xero tracking code links this job to its claim invoices, supplier bills and tagged spend in Xero. Saving pulls them in straight away.</p>
          <form action={saveJobXero} className="tp-form" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}><input type="hidden" name="id" value={job.id} />
            <F label="Xero tracking code"><input name="xeroTracking" className="input" defaultValue={job.xeroTracking ?? ""} placeholder="e.g. HECH002" /></F>
            <F label="Client (as in Xero)"><input name="client" className="input" defaultValue={job.client ?? ""} /></F>
            <div className="tp-form-actions"><button className="btn">Save</button></div>
          </form>
          <p className="acc-muted">Contract value, dates, status and the build program are set by Braiden.</p>
        </section>
      )}

      {tab === "details" && canProgram && (
        <section className="card acc-pad">
          <h2 className="est-h2" style={{ marginTop: 0 }}>Job details</h2>
          <form action={saveJob} className="tp-form" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}><input type="hidden" name="id" value={job.id} />
            <F label="Job name"><input name="name" className="input" defaultValue={job.name} /></F>
            <F label="Brand"><select name="brand" className="input" defaultValue={job.brand}><option value="ENP">ENP Fitouts</option><option value="DR">DR Fitout</option></select></F>
            <F label="Job number"><input name="jobNumber" className="input" defaultValue={job.jobNumber ?? ""} /></F><F label="Xero tracking"><input name="xeroTracking" className="input" defaultValue={job.xeroTracking ?? ""} /></F>
            <F label="Client"><input name="client" className="input" defaultValue={job.client ?? ""} /></F><F label="Contract ex GST"><input name="contractValue" className="input" defaultValue={job.contractValue} readOnly={!isAdmin} title={isAdmin ? undefined : "Set by Braiden"} /></F>
            <F label="Status"><select name="status" className="input" defaultValue={job.status}>{["Live", "On hold", "Complete"].map((x) => <option key={x}>{x}</option>)}</select></F>
            <F label="Start"><input name="startDate" type="date" className="input" defaultValue={job.startDate ?? ""} /></F><F label="Expected handover"><input name="finishDate" type="date" className="input" defaultValue={job.finishDate ?? ""} /></F>
            <F label="Project manager"><input name="pm" className="input" defaultValue={job.pm ?? ""} /></F>
            <F label="Job name in BuilderTrend"><input name="btJobName" className="input" defaultValue={job.btJobName ?? ""} placeholder="e.g. Hecho Robina - Robina Town Centre" /></F><F label="Notes" wide><textarea name="notes" className="input" rows={3} defaultValue={job.notes ?? ""} /></F>
            <div className="tp-form-actions"><button className="btn">Save details</button></div>
          </form>
          {isAdmin && <form action={linkJobLead} className="acc-actions" style={{ marginTop: "1rem" }}><H name="jobId" />
            <label style={{ flex: "1 1 320px" }}><span className="label">Linked lead (sales and estimating)</span>
              <select name="leadId" className="input" defaultValue={job.leadId ?? ""}><option value="">Not linked</option>{leadOpts.map((l) => <option key={l.id} value={l.id}>{l.company || l.leadName} · {l.stage}{l.jobNumber ? ` · job ${l.jobNumber}` : ""}</option>)}</select></label>
            <button className="btn">Save link</button></form>}
          {lead && <p className="acc-muted">Linked to the signed lead. <Link prefetch={false} className="acc-link" href={`/leads/${lead.brand === "DR" ? "dr" : "enp"}/${job.leadId}`}>Open lead</Link></p>}
          {isAdmin && <form action={deleteJob} className="acc-actions" style={{ marginTop: "1.2rem" }}><input type="hidden" name="id" value={job.id} />
            <label><span className="label">Type DELETE to remove this job and all its WIP records</span><input name="confirm" className="input" /></label><button className="tp-del">Delete job</button></form>}
        </section>
      )}
    </div>
  );
}
