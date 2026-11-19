import { fmtAUD } from "@/lib/money";
import { fmtDateTime } from "@/lib/time";
import PendingButton from "@/components/PendingButton";
import type { AiEstimate } from "@/lib/estimate-ai";
import type { StoredFile } from "@/lib/concepts";
import { uploadEstFiles, removeEstFile, runEstimate, applyEstimate, saveRateNotes } from "@/app/(app)/estimating/ai-actions";

type Props = {
  id: string; canEdit: boolean; isAdminOrEstimator: boolean;
  files: StoredFile[]; brief: string | null; est: AiEstimate | null; estAt: Date | null;
  concepts: { id: string; name: string }[]; defaultConceptId: string | null; rateNotes: string | null; quoteValue: number | null;
};

const KIND_LABEL: Record<string, string> = { plans: "Plans", photo: "Site photo", other: "Other" };

/** Claude prices the job from plans, photos, concept, brief and DR Fitout's past costs, then fills the trade pack on request. */
export default function AiEstimatePanel(p: Props) {
  const e = p.est;
  return (
    <section id="ai-estimate" className="card ai-est no-print">
      <div className="tp-summary-top">
        <div>
          <div className="est-k">AI estimate</div>
          <h2 className="est-h2" style={{ margin: 0 }}>Let Claude price this job</h2>
          <p className="est-hint">Upload the plans and site photos, pick the concept, add a brief. Claude measures what it can, prices each trade from DR Fitout&apos;s past jobs (Brisbane market rates where there&apos;s no history), and writes the scope. Nothing changes in the trade pack until you press <b>Use this estimate</b>.</p>
        </div>
      </div>

      <div className="ai-est-grid">
        <div>
          <h3 className="ai-est-h3">Plans &amp; photos ({p.files.length})</h3>
          {p.files.length ? (
            <ul className="ai-est-files">{p.files.map((f) => (
              <li key={f.id}>
                <a href={`/files/${f.id}`} target="_blank" rel="noopener noreferrer" className="underline">{f.name}</a> <span className="admin-muted">· {KIND_LABEL[f.kind] ?? f.kind}</span>
                {p.canEdit && <form action={removeEstFile}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="fileId" value={f.id} /><button className="lease-unlink" aria-label={`Remove ${f.name}`} title="Remove">×</button></form>}
              </li>))}</ul>
          ) : <p className="admin-muted text-sm">Nothing uploaded yet. Plans make the estimate much more accurate.</p>}
          {p.canEdit && (
            <form action={uploadEstFiles} className="ai-est-upload">
              <input type="hidden" name="id" value={p.id} />
              <label><span className="label">Files (PDF, JPG, PNG)</span><input type="file" name="files" multiple accept=".pdf,.png,.jpg,.jpeg,.webp" className="input" required /></label>
              <label><span className="label">They are</span><select name="kind" className="input" defaultValue="plans"><option value="plans">Plans / drawings</option><option value="photo">Site photos</option><option value="other">Other</option></select></label>
              <div className="self-end"><PendingButton pending="Uploading…" className="btn-ghost">Upload</PendingButton></div>
            </form>
          )}
        </div>

        {p.canEdit && (
          <form action={runEstimate} className="ai-est-run">
            <input type="hidden" name="id" value={p.id} />
            <h3 className="ai-est-h3">Estimate</h3>
            <label><span className="label">Concept</span>
              <select name="conceptId" className="input" defaultValue={p.defaultConceptId ?? ""}>
                <option value="">No concept: work from the plans and brief</option>
                {p.concepts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            <label><span className="label">Brief: what the client wants, spec level, anything to include or leave out</span>
              <textarea name="brief" rows={4} className="input" defaultValue={p.brief ?? ""} placeholder="e.g. 6 consult rooms, 1 procedure room, mid-high spec, reuse existing ceiling and A/C, client supplies furniture" /></label>
            <PendingButton pending="Estimating… (up to 3 minutes, keep this page open)">{e ? "Estimate again" : "Estimate this job"}</PendingButton>
          </form>
        )}
      </div>

      {e && (
        <div className="ai-est-result">
          <div className="ai-est-top">
            <div><div className="est-k">Trade costs</div><div className="est-big">{fmtAUD(e.tradeTotal ?? 0)}</div></div>
            <div><div className="est-k">+ other costs</div><div className="ai-est-num">{fmtAUD(e.otherCosts.amount)}</div></div>
            <div><div className="est-k">+ contingency</div><div className="ai-est-num">{e.contingencyPct}%</div></div>
            <div><div className="est-k">Job cost</div><div className="ai-est-num"><b>{fmtAUD(e.cost ?? 0)}</b></div></div>
            <div><div className="est-k">Sell at {e.gpGoal}% GP</div><div className="ai-est-num"><b>{fmtAUD(e.suggestedSell ?? 0)}</b></div></div>
            <div><div className="est-k">Confidence</div><div className={`ai-est-conf ai-est-conf-${e.confidence.toLowerCase()}`}>{e.confidence}</div></div>
          </div>
          <p className="text-sm">{e.summary}</p>
          <p className="text-xs admin-muted">
            Prices: {e.pricingBasis} · Learned from {e.pastJobsUsed ?? 0} past DR job{e.pastJobsUsed === 1 ? "" : "s"}{e.areaSqm ? ` · ${e.areaSqm} m²` : ""}{e.conceptName ? ` · Concept: ${e.conceptName}` : ""}
            {p.estAt ? ` · Estimated ${fmtDateTime(p.estAt)}${e.by ? ` by ${e.by}` : ""}` : ""}
            {e.inputs?.length ? ` · Read: ${e.inputs.join(", ")}` : ""}
          </p>

          <div className="overflow-x-auto">
            <table className="table tp-table ai-est-table">
              <thead><tr><th>Trade</th><th>What&apos;s priced</th><th className="tp-price">Price ex GST</th></tr></thead>
              <tbody>{e.trades.map((t) => (
                <tr key={t.trade}>
                  <td><b>{t.trade}</b></td>
                  <td>
                    <details><summary>{t.scope || `${t.lines.length} items`}</summary>
                      <table className="ai-est-lines"><tbody>{t.lines.map((l, i) => (
                        <tr key={i}><td>{l.item}</td><td className="tp-price">{l.qty} {l.unit}</td><td className="tp-price">@ {fmtAUD(l.rate)}</td><td className="tp-price">{fmtAUD(Math.round(l.amount))}</td></tr>))}</tbody></table>
                      {t.basis && <p className="text-xs admin-muted">Basis: {t.basis}</p>}
                    </details>
                  </td>
                  <td className="tp-price">{fmtAUD(t.amount)}</td>
                </tr>))}
                {e.otherCosts.amount > 0 && <tr><td><b>Other costs</b></td><td>{e.otherCosts.items.map((i) => `${i.item} ${fmtAUD(Math.round(i.amount))}`).join(" · ")}</td><td className="tp-price">{fmtAUD(e.otherCosts.amount)}</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="ai-est-lists">
            {e.assumptions.length > 0 && <div><h3 className="ai-est-h3">Assumptions</h3><ul>{e.assumptions.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
            {e.checks.length > 0 && <div><h3 className="ai-est-h3">Check before quoting</h3><ul>{e.checks.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
            {e.exclusions.length > 0 && <div><h3 className="ai-est-h3">Exclusions</h3><ul>{e.exclusions.map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
          </div>
          <details className="text-sm"><summary className="acc-link">Scope of works Claude wrote ({e.scope.length} lines)</summary>
            <ul className="ai-est-scope">{e.scope.map((s, i) => <li key={i}><span className="admin-muted">{s.trade}:</span> {s.description}{s.byClient ? " (by client)" : ""}</li>)}</ul>
          </details>

          {p.canEdit && (
            <form action={applyEstimate} className="ai-est-use">
              <input type="hidden" name="id" value={p.id} />
              <label className="ai-est-check"><input type="checkbox" name="setQuote" defaultChecked={!p.quoteValue} /> Also set the quote amount to {fmtAUD(e.suggestedSell ?? 0)} ({e.gpGoal}% GP){p.quoteValue ? `, replacing ${fmtAUD(p.quoteValue)}` : ""}</label>
              <PendingButton pending="Filling the trade pack…">{e.appliedAt ? "Use this estimate again" : "Use this estimate"}</PendingButton>
              <p className="text-xs admin-muted" style={{ flexBasis: "100%" }}>
                {e.appliedAt ? `Used ${fmtDateTime(new Date(e.appliedAt))}${e.appliedBy ? ` by ${e.appliedBy}` : ""}. ` : ""}
                Adds each trade as an &ldquo;AI estimate&rdquo; price (replacing earlier AI prices) and the new scope lines. A real quote marked Received or Accepted takes over that trade automatically. Other costs and contingency are only filled if they&apos;re empty.
              </p>
            </form>
          )}
        </div>
      )}

      {p.isAdminOrEstimator && (
        <details className="ai-est-rates" id="house-rates">
          <summary className="acc-link">House rates &amp; rules Claude uses for every estimate{p.rateNotes ? "" : " (none yet)"}</summary>
          <form action={saveRateNotes} className="mt-2 space-y-2">
            <input type="hidden" name="id" value={p.id} />
            <textarea name="estRateNotes" rows={8} className="input" defaultValue={p.rateNotes ?? ""} placeholder={"e.g.\nPlasterboard partition to ceiling, 2 sides + insulation: $145/m²\nGP consult room joinery (base + overhead): $4,800 each\nSupervision: $2,800/week; typical GP clinic program 8-10 weeks\nAlways allow acoustic insulation to consult room walls\nUse 5% contingency on concept-only estimates"} />
            <button className="btn-ghost">Save house rates</button>
          </form>
        </details>
      )}
    </section>
  );
}
