import Link from "next/link";
import { EST_STEPS, estPercent, nextStep, type EstFields } from "@/lib/estimating";

type Row = EstFields & { id: string; brand: string; leadName: string | null; company: string | null; stage: string | null; cancelled: boolean };

/** Dashboard summary of Justin's estimating: overall %, where quotes are waiting, and each quote's bar. */
export function EstimatingPanel({ leads, brand }: { leads: Row[]; brand: "ENP" | "DR" | "ALL" }) {
  const started = (l: Row) => EST_STEPS.some((s) => !!l[s.key]);
  const active = leads
    .filter((l) => (l.brand === "ENP" || l.brand === "DR") && (brand === "ALL" || l.brand === brand))
    .filter((l) => !l.cancelled && !l.estSentAt && l.stage !== "Signed" && l.stage !== "Lost" && (l.stage === "Quoting" || started(l)))
    .sort((a, b) => estPercent(b) - estPercent(a));
  const overall = active.length ? Math.round(active.reduce((n, l) => n + estPercent(l), 0) / active.length) : 0;
  const waiting = EST_STEPS.map((s) => ({ ...s, n: active.filter((l) => nextStep(l)?.key === s.key).length }));
  const maxW = Math.max(1, ...waiting.map((w) => w.n));
  const shown = active.slice(0, 8);
  return (
    <section className="dash-panel mb-4 est-dash">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="mb-0">Estimating · Justin</h2>
          <p className="text-xs text-slate-500">{active.length} quote{active.length === 1 ? "" : "s"} being estimated</p>
        </div>
        <Link prefetch={false} href="/estimating" className="text-xs brand-text underline">Open estimating board →</Link>
      </div>
      <div className="est-dash-grid">
        <div>
          <div className="est-k">Overall progress</div>
          <div className="est-big">{overall}%</div>
          <div className="est-bar est-bar-lg" role="progressbar" aria-valuenow={overall} aria-valuemin={0} aria-valuemax={100} aria-label="Overall estimating progress"><span style={{ width: `${overall}%` }} /></div>
          <div className="est-k" style={{ marginTop: "1rem" }}>Waiting on</div>
          {waiting.map((w) => (
            <div key={w.key} className="est-wrow">
              <span className="est-wlabel">{w.label}</span>
              <span className="est-wbar"><span style={{ width: `${(w.n / maxW) * 100}%` }} /></span>
              <span className="est-wn">{w.n}</span>
            </div>
          ))}
        </div>
        <div>
          <div className="est-k">Each quote</div>
          {shown.length === 0 && <p className="text-sm text-slate-500">No quotes being estimated.</p>}
          {shown.map((l) => {
            const p = estPercent(l); const nx = nextStep(l);
            return (
              <div key={l.id} className="est-dash-row" data-brand={l.brand}>
                <div className="est-dash-name">
                  <span className="truncate">{l.company || l.leadName || "Unnamed"}</span>
                  <span className="est-dash-next">{nx ? `Next: ${nx.label}` : "All steps done"}</span>
                </div>
                <div className="est-bar"><span style={{ width: `${p}%` }} /></div>
                <span className="est-dash-pct">{p}%</span>
              </div>
            );
          })}
          {active.length > shown.length && <div className="mt-1 text-xs text-slate-500">+ {active.length - shown.length} more on the board</div>}
        </div>
      </div>
    </section>
  );
}
