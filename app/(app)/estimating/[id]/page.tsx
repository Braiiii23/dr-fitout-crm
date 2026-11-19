import Link from "next/link";
import { requireViewer } from "@/lib/team-view";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { BRANDS } from "@/lib/constants";
import { fmtAUD } from "@/lib/money";
import { fmtDate } from "@/lib/time";
import { estPercent, nextStep, summariseTrades, scopeCoverage, COVERAGE_LABEL, TRADES, TRADE_STATUSES, BANDS } from "@/lib/estimating";
import PrintButton from "@/components/PrintButton";
import { addTradeQuote, updateTradeQuote, deleteTradeQuote } from "../trade-actions";
import { addScopeItems, updateScopeItem, deleteScopeItem } from "../scope-actions";
import { saveJobEstimate } from "../actions";
import { quoteToSheet } from "../sheet-actions";
import { jobEstimate } from "@/lib/job-estimate";
import QuoteJobFields from "@/components/QuoteJobFields";
import { updateQuoteDetails } from "../actions";
import { getUser } from "@/lib/auth";
import AiEstimatePanel from "@/components/AiEstimatePanel";
import { parseFiles } from "@/lib/concepts";
import type { AiEstimate } from "@/lib/estimate-ai";

// Trade pack for one job: every trade quote with scope and price, plus a compiled summary
// (accepted quote per trade, otherwise the cheapest received) that can be printed or saved as PDF.
export default async function TradePack({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const added = sp.added === "1";
  await requireViewer(["ADMIN", "ESTIMATOR", "ACCOUNTS", "BDM", "PM"]);
  const { id } = await params;
  const viewer = await getUser();
  const job = await prisma.lead.findUnique({
    where: { id },
    select: {
      id: true, brand: true, leadName: true, company: true, location: true, projectType: true, sizeSqm: true, notes: true, quoteValue: true,
      phone: true, email: true, budget: true, timeframe: true, lookingFor: true, sourceLink: true,
      estOtherCosts: true, estContingencyPct: true, estFiles: true, estBrief: true, aiEstimate: true, aiEstimateAt: true,
      leases: { select: { concepts: { select: { id: true } } } },
      estPlansAt: true, estScopeAt: true, estExcelAt: true, estRfqAt: true, estPrelimAt: true, estRfqRecAt: true, estProposalAt: true, estSentAt: true,
      tradeQuotes: { orderBy: [{ trade: "asc" }, { price: "asc" }] },
      scopeItems: { orderBy: [{ trade: "asc" }, { sortOrder: "asc" }] },
    },
  });
  if (!job || (job.brand !== "ENP" && job.brand !== "DR")) notFound();
  const b = BRANDS[job.brand as "ENP" | "DR"];
  const sum = summariseTrades(job.tradeQuotes);
  const scope = scopeCoverage(job.scopeItems, job.tradeQuotes);
  const est = jobEstimate(job);
  const settings = await prisma.accountsSettings.findUnique({ where: { id: "settings" } });
  const goal = settings?.grossMarginGoal ?? 25;
  const concepts = await prisma.concept.findMany({ where: { status: { not: "Archived" } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  let aiEst: AiEstimate | null = null; try { aiEst = job.aiEstimate ? JSON.parse(job.aiEstimate) : null; } catch { aiEst = null; }
  if (aiEst && !aiEst.trades?.every((t) => t.lines.every((l) => typeof l.source === "string"))) aiEst = null; // made before the estimate sheet: run again
  const canEditEst = !!viewer && ["ADMIN", "ESTIMATOR", "ACCOUNTS"].includes(viewer.role);
  const scopeTrades = [...new Set(scope.rows.map((r) => r.item.trade))];
  const pct = estPercent(job); const nx = nextStep(job);
  const title = job.company || job.leadName || "Job";

  return (
    <div className="est tp space-y-5" data-brand={job.brand}>
      <div className="no-print flex flex-wrap items-center gap-3">
        <Link prefetch={false} href="/estimating" className="est-open" style={{ marginLeft: 0 }}>← Estimating board</Link>
        <Link prefetch={false} href={`/estimating/${job.id}/sheet`} className="est-open">Estimate sheet →</Link>
        <Link prefetch={false} href={`/estimating/${job.id}/proposal`} className="est-open">Proposal →</Link>
      </div>

      <header className="tp-head">
        <div className="min-w-0">
          <div className="est-k">Trade pack · {b.name}</div>
          <h1 className="est-title">{title}</h1>
          <p className="est-sub">{[job.leadName && job.company ? job.leadName : null, job.location, job.projectType, job.sizeSqm ? `${job.sizeSqm} m²` : null].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="tp-prog no-print">
          <div className="est-progress-top"><span className="est-pct">{pct}%</span><span className="est-next">{nx ? `Next: ${nx.label}` : "All steps done"}</span></div>
          <div className="est-bar"><span style={{ width: `${pct}%` }} /></div>
        </div>
      </header>

      {sp.msg && <div className="acc-notice no-print" role="status">{sp.msg}</div>}
      {sp.err && <div className="aw-err no-print" role="alert" style={{ color: "#fca5a5" }}>{sp.err}</div>}
      {added && <div className="acc-notice" role="status">Added to the estimating board. Fill in the trade quotes and scope below.</div>}
      {(viewer?.role === "ESTIMATOR" || viewer?.role === "ADMIN") && (
        <details className="card acc-pad no-print est-editjob">
          <summary className="acc-link">Edit job details</summary>
          <form action={updateQuoteDetails} className="tp-form" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", marginTop: ".8rem" }}>
            <input type="hidden" name="id" value={job.id} />
            <QuoteJobFields v={job} />
            <div className="tp-form-actions"><button className="btn">Save details</button></div>
          </form>
          <p className="acc-muted">Stage, contract value and setter are changed by Braiden.</p>
        </details>
      )}


      <AiEstimatePanel id={job.id} canEdit={canEditEst} isAdminOrEstimator={!!viewer && ["ADMIN", "ESTIMATOR"].includes(viewer.role)}
        files={parseFiles(job.estFiles)} brief={job.estBrief} est={aiEst} estAt={job.aiEstimateAt}
        concepts={concepts} defaultConceptId={aiEst ? concepts.find((c) => c.name === aiEst!.conceptName)?.id ?? null : job.leases.flatMap((l) => l.concepts.map((c) => c.id))[0] ?? null}
        rateNotes={settings?.estRateNotes ?? null} quoteValue={job.quoteValue} />

      {/* Master scope of works */}
      <section className="card tp-scope-card">
        <div className="tp-summary-top">
          <div>
            <div className="est-k">Scope of works · master list</div>
            <div className="tp-cov">
              <span className="tp-cov-big">{scope.total ? `${scope.covered + scope.client}/${scope.total}` : "0"}</span>
              <span>items covered</span>
            </div>
            {scope.total > 0 && (
              <div className="tp-covbar" aria-label="Scope coverage">
                <span className="c-covered" style={{ width: `${(scope.covered / scope.total) * 100}%` }} />
                <span className="c-client" style={{ width: `${(scope.client / scope.total) * 100}%` }} />
                <span className="c-waiting" style={{ width: `${(scope.waiting / scope.total) * 100}%` }} />
              </div>
            )}
            <div className="est-hint">{scope.covered} covered by a trade quote · {scope.client} by client / others · {scope.waiting} waiting on a quote · <b className={scope.missing ? "tp-missing-txt" : ""}>{scope.missing} not quoted</b></div>
          </div>
        </div>
        {scope.total === 0 ? <p className="text-sm opacity-70">No scope items yet. Add the job&apos;s scope below. You can paste a whole list at once.</p> : (
          <div className="tp-scope-groups">
            {scopeTrades.map((t) => {
              const rows = scope.rows.filter((r) => r.item.trade === t);
              return (
                <div key={t} className="tp-sg">
                  <div className="tp-sg-head">{t}</div>
                  <ul className="tp-sg-list">
                    {rows.map(({ item, coverage, by }) => (
                      <li key={item.id} className="tp-si">
                        <div className="tp-si-row">
                          <span className="tp-si-desc">{item.description}</span>
                          <span className={`tp-cov-badge cov-${coverage}`}>{COVERAGE_LABEL[coverage]}{by?.company ? ` · ${by.company}` : ""}</span>
                        </div>
                        <details className="tp-edit no-print" key={`${item.id}-${item.updatedAt.toISOString()}`}>
                          <summary>Edit</summary>
                          <form action={updateScopeItem} className="tp-form tp-form-scope">
                            <input type="hidden" name="id" value={item.id} />
                            <label><span className="label">Trade</span><input name="trade" list="trade-list" className="input" defaultValue={item.trade} required /></label>
                            <label className="tp-wide"><span className="label">Item</span><input name="description" className="input" defaultValue={item.description} required /></label>
                            <label className="tp-check"><input type="checkbox" name="byClient" defaultChecked={item.byClient} /> By client / others</label>
                            <div className="tp-form-actions"><button className="btn">Save</button></div>
                          </form>
                          <form action={deleteScopeItem} className="mt-2"><input type="hidden" name="id" value={item.id} /><button className="tp-del">Delete this item</button></form>
                        </details>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
        <details className="tp-add-scope no-print" open={scope.total === 0}>
          <summary className="btn" style={{ width: "max-content" }}>+ Add scope items</summary>
          <form action={addScopeItems} className="tp-form tp-form-scope">
            <input type="hidden" name="leadId" value={job.id} />
            <label><span className="label">Trade</span><input name="trade" list="trade-list" className="input" required placeholder="e.g. Plumbing" /></label>
            <label className="tp-wide"><span className="label">Items (one per line)</span><textarea name="description" rows={4} className="input" required placeholder={"Single plumbing point for both dog baths\nFloor waste under hose tap\nInstantaneous hot water system"} /></label>
            <label className="tp-check"><input type="checkbox" name="byClient" /> By client / others</label>
            <div className="tp-form-actions"><button className="btn">Add to scope</button></div>
          </form>
        </details>
      </section>

      {/* Compiled summary */}
      <section className="card tp-summary">
        <div className="tp-summary-top">
          <div>
            <div className="est-k">Trade summary (ex GST)</div>
            <div className="est-big">{fmtAUD(sum.total) || "$0.00"}</div>
            <div className="est-hint">{sum.tradesCovered} trade{sum.tradesCovered === 1 ? "" : "s"} priced · {sum.received} quote{sum.received === 1 ? "" : "s"} received · {sum.requested} still waiting</div>
          </div>
          <PrintButton />
        </div>
        {sum.rows.length === 0 ? <p className="text-sm opacity-70">No trade quotes yet. Add the first one below.</p> : (
          <div className="overflow-x-auto">
            <table className="table tp-table">
              <thead><tr><th>Trade</th><th>Company</th><th>Scope</th><th>Price</th><th>Based on</th></tr></thead>
              <tbody>
                {sum.rows.map((r) => (
                  <tr key={r.trade}>
                    <td>{r.trade}</td>
                    <td>{r.counts?.company ?? "—"}</td>
                    <td className="tp-scope">{r.counts?.scope ?? "—"}</td>
                    <td className="tp-price">{r.counts?.price != null ? fmtAUD(r.counts.price) : "—"}</td>
                    <td><span className={`tp-basis tp-basis-${r.basis === "Accepted" ? "acc" : r.basis === "Waiting" ? "wait" : r.basis === "AI estimate" || r.basis.startsWith("Estimate kept") ? "ai" : "low"}`}>{r.basis}{r.waiting ? ` · ${r.waiting} waiting` : ""}</span>{r.basis === "Quote higher than estimate" && canEditEst && r.quotes.some((q) => q.status === "AI estimate") && <form action={quoteToSheet} className="mt-1 no-print"><input type="hidden" name="quoteId" value={r.counts!.id} /><button className="es-add">Put on sheet</button></form>}{r.lowerQuote && <div className="text-xs admin-muted mt-1">Lower quote {fmtAUD(r.lowerQuote.price ?? 0)}{r.lowerQuote.company ? ` from ${r.lowerQuote.company}` : ""}: keep for procurement</div>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={3}>Total</td><td className="tp-price">{fmtAUD(sum.total) || "$0.00"}</td><td /></tr></tfoot>
            </table>
          </div>
        )}
        <p className="tp-foot">Each trade counts its <b>Accepted</b> quote, or the lowest received price. Where the estimate sheet has priced a band, a real quote <b>higher</b> than the estimate replaces it; a <b>lower</b> quote doesn&apos;t (the estimate price stays and the lower quote is kept for procurement). Prices ex GST.</p>
      </section>

      {/* Job cost and gross profit estimate */}
      <section className="card tp-summary">
        <div className="tp-summary-top">
          <div>
            <div className="est-k">Job cost &amp; gross profit estimate</div>
            <div className="est-big" style={{ color: !est.sell ? undefined : est.gpPct >= goal ? "#60a5fa" : "#f2a900" }}>{est.sell ? `${est.gpPct.toFixed(1)}%` : "—"}</div>
            <div className="est-hint">{est.sell ? `${fmtAUD(Math.round(est.gp))} gross profit on a ${fmtAUD(est.sell)} quote · goal ${goal}%` : "Enter the quote amount to see the gross profit"}. Copied to the job&apos;s Gross Profit automatically when it&apos;s marked Signed.</div>
          </div>
        </div>
        <table className="tp-table" style={{ width: "100%", borderCollapse: "collapse", marginBottom: ".9rem" }}>
          <tbody>
            <tr><td>Trades ({est.tradesPriced} priced{est.tradesWaiting ? `, ${est.tradesWaiting} waiting` : ""})</td><td className="tp-price">{fmtAUD(Math.round(est.tradeTotal))}</td></tr>
            <tr><td>Other costs (materials, own labour, site costs, prelims)</td><td className="tp-price">{fmtAUD(Math.round(est.other))}</td></tr>
            <tr><td>Contingency ({est.contPct}%)</td><td className="tp-price">{fmtAUD(Math.round(est.contingency))}</td></tr>
            <tr><td><b>Total job cost</b></td><td className="tp-price">{fmtAUD(Math.round(est.cost))}</td></tr>
            <tr><td><b>Quote amount (sell, ex GST)</b></td><td className="tp-price">{est.sell ? fmtAUD(est.sell) : "—"}</td></tr>
            <tr><td><b>Gross profit</b></td><td className="tp-price">{est.sell ? `${fmtAUD(Math.round(est.gp))} · ${est.gpPct.toFixed(1)}%` : "—"}</td></tr>
          </tbody>
        </table>
        {est.aiEstimated > 0 && <p className="tp-foot" style={{ color: "#c4b5fd" }}>{est.aiEstimated} trade{est.aiEstimated === 1 ? " is" : "s are"} priced from the AI estimate, not a real quote yet.</p>}
        {(est.notQuoted > 0 || est.tradesWaiting > 0) && <p className="tp-foot" style={{ color: "#fbbf24" }}>Not final yet: {est.notQuoted ? `${est.notQuoted} scope item${est.notQuoted === 1 ? "" : "s"} not quoted` : ""}{est.notQuoted && est.tradesWaiting ? " and " : ""}{est.tradesWaiting ? `${est.tradesWaiting} trade quote${est.tradesWaiting === 1 ? "" : "s"} still waiting` : ""}. The cost will rise as these come in.</p>}
        <form action={saveJobEstimate} className="tp-form no-print">
          <input type="hidden" name="id" value={job.id} />
          <label><span className="label">Other costs ex GST</span><input name="estOtherCosts" inputMode="decimal" className="input" defaultValue={job.estOtherCosts ?? ""} placeholder="$0" /></label>
          <label><span className="label">Contingency %</span><input name="estContingencyPct" inputMode="decimal" className="input" defaultValue={job.estContingencyPct ?? ""} placeholder="e.g. 5" /></label>
          <label><span className="label">Quote amount ex GST</span><input name="quoteValue" inputMode="decimal" className="input" defaultValue={job.quoteValue ?? ""} placeholder="$0" /></label>
          <div className="tp-form-actions" style={{ alignSelf: "end" }}><button className="btn">Save estimate</button></div>
        </form>
      </section>

      {/* Every quote, editable */}
      <section className="space-y-3 no-print">
        <h2 className="est-h2">All trade quotes ({job.tradeQuotes.length})</h2>
        {sum.rows.map((r) => (
          <div key={r.trade} className="card tp-trade">
            <div className="tp-trade-head"><b>{r.trade}</b><span className="opacity-70 text-sm">{r.quotes.length} quote{r.quotes.length === 1 ? "" : "s"}</span></div>
            {r.quotes.map((q) => (
              <div key={q.id} className={`tp-q ${r.counts?.id === q.id ? "is-counted" : ""}`}>
                <div className="tp-q-main">
                  <div className="tp-q-top">
                    <span className="tp-q-co">{q.company || "Unnamed trade"}</span>
                    <span className={`tp-status tp-status-${q.status.toLowerCase()}`}>{q.status}</span>
                    <span className="tp-q-price">{q.price != null ? fmtAUD(q.price) : "No price yet"}</span>
                  </div>
                  {q.scope && <p className="tp-q-scope">{q.scope}</p>}
                  <div className="tp-q-meta">
                    {q.receivedDate && <span>Received {fmtDate(q.receivedDate)}</span>}
                    {q.link && <a href={q.link} target="_blank" rel="noopener noreferrer" className="underline">Open quote document</a>}
                    {r.counts?.id === q.id && <span className="tp-counted">✓ Used in summary</span>}
                  </div>
                </div>
                <details className="tp-edit" key={`${q.id}-${q.updatedAt.toISOString()}`}>
                  <summary>Edit</summary>
                  <form action={updateTradeQuote} className="tp-form">
                    <input type="hidden" name="id" value={q.id} />
                    <QuoteFields q={q} />
                    <div className="tp-form-actions"><button className="btn">Save</button></div>
                  </form>
                  <form action={deleteTradeQuote} className="mt-2"><input type="hidden" name="id" value={q.id} /><button className="tp-del">Delete this quote</button></form>
                </details>
              </div>
            ))}
          </div>
        ))}
      </section>

      <section className="card tp-add no-print">
        <h2 className="est-h2" style={{ marginTop: 0 }}>Add a trade quote</h2>
        <form action={addTradeQuote} className="tp-form">
          <input type="hidden" name="leadId" value={job.id} />
          <QuoteFields />
          <div className="tp-form-actions"><button className="btn">Add quote</button></div>
        </form>
      </section>

      <datalist id="trade-list">{[...BANDS, ...TRADES.filter((t) => !BANDS.includes(t))].map((t) => <option key={t} value={t} />)}</datalist>
    </div>
  );
}

function QuoteFields({ q }: { q?: { trade: string; company: string | null; scope: string | null; price: number | null; status: string; link: string | null } }) {
  return (
    <>
      <label><span className="label">Trade</span><input name="trade" list="trade-list" required className="input" defaultValue={q?.trade ?? ""} placeholder="e.g. Electrical" /></label>
      <label><span className="label">Company</span><input name="company" className="input" defaultValue={q?.company ?? ""} placeholder="e.g. Bright Spark Electrical" /></label>
      <label><span className="label">Price ex GST</span><input name="price" inputMode="decimal" className="input" defaultValue={q?.price ?? ""} placeholder="$0" /></label>
      <label><span className="label">Status</span><select name="status" className="input" defaultValue={q?.status ?? "Requested"}>{TRADE_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>
      <label className="tp-wide"><span className="label">Scope</span><textarea name="scope" rows={3} className="input" defaultValue={q?.scope ?? ""} placeholder="What's included / excluded" /></label>
      <label className="tp-wide"><span className="label">Link to their quote (optional)</span><input name="link" type="url" className="input" defaultValue={q?.link ?? ""} placeholder="https://… (OneDrive, Dropbox, email link)" /></label>
    </>
  );
}
