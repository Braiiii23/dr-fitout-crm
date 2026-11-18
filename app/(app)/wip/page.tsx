import Link from "next/link";
import { requireViewer } from "@/lib/team-view";
import { requireUser } from "@/lib/auth";
import { kickBuildertrendSync } from "@/lib/buildertrend";
import { getBrand } from "@/lib/brand";
import { liveJobs, wipFor, weeklySnapshots, mondayOf } from "@/lib/wip";
import { brisbaneToday } from "@/lib/time";
import PrintButton from "@/components/PrintButton";
import { aud, dmy } from "@/components/WipBits";
import { claimPlan } from "@/lib/claim-timing";

// WIP: the weekly table across live jobs, with what changed since last week.
export default async function WipPage() {
  await requireViewer(["ADMIN", "ACCOUNTS", "PM"]);
  kickBuildertrendSync();
  const brand = await getBrand();
  const today = brisbaneToday();
  const jobs = (await liveJobs(brand)).map((j) => ({ id: j.id, j, w: wipFor(j, today) }));
  const prev = await weeklySnapshots(jobs, today);
  const t = jobs.reduce((a, { j, w }) => ({ contract: a.contract + j.contractValue, claimed: a.claimed + w.claimedEx, received: a.received + w.receivedInc, owed: a.owed + w.owedInc, cost: a.cost + w.costTotal, paid: a.paid + w.paidTotal, owing: a.owing + w.owingKnown, pending: a.pending + w.pendingCost, gp: a.gp + w.forecastGp, cash: a.cash + w.cashPositionEx }), { contract: 0, claimed: 0, received: 0, owed: 0, cost: 0, paid: 0, owing: 0, pending: 0, gp: 0, cash: 0 });
  const delta = (now: number, was?: number) => (was == null || Math.abs(now - was) < 1 ? null : now - was);
  const D = ({ v }: { v: number | null }) => (v == null ? null : <small className={v < 0 ? "wip-down" : "wip-up"}>{v > 0 ? "+" : "−"}{aud(Math.abs(v))}</small>);
  return (
    <div className="wip space-y-5">
      <div className="acc-top">
        <div>
          <h1 className="est-title">WIP · week of {dmy(mondayOf(today))}</h1>
          <p className="est-sub">{jobs.length} live job{jobs.length === 1 ? "" : "s"} · each job against its own costs and claims · ex GST unless marked inc · small figures show the change since last week</p>
        </div>
        <div className="acc-actions no-print"><Link prefetch={false} href="/jobs" className="acc-link">Jobs view</Link><PrintButton label="Print or save as PDF" /></div>
      </div>
      <section className="card acc-pad">
        <div className="overflow-x-auto">
          <table className="table wip-table">
            <thead><tr><th>Job</th><th>Contract</th><th>Claimed</th><th>Received (inc)</th><th>Owed to us (inc)</th><th>Costs</th><th>Paid</th><th>Owing (known)</th><th>Pending</th><th>Forecast GP</th><th>Cash position</th><th>Next claim</th><th>Needs action</th></tr></thead>
            <tbody>
              {jobs.map(({ j, w }) => { const p = prev.get(j.id); return (
                <tr key={j.id} data-brand={j.brand}>
                  <td><Link prefetch={false} href={`/jobs/${j.id}`} className="jc-name">{j.name}</Link><small className="acc-muted" style={{ display: "block" }}>{j.jobNumber ? `Job ${j.jobNumber} · ` : ""}{j.brand === "DR" ? "DR Fitout" : "ENP"} · {Math.round(w.progress * 100)}%{w.daysLate ? ` · ${w.daysLate}d late` : ""}</small></td>
                  <td>{aud(j.contractValue)}</td>
                  <td>{aud(w.claimedEx)}<small className="acc-muted" style={{ display: "block" }}>{w.claimedPct}%</small><D v={delta(w.claimedEx, p?.claimedEx)} /></td>
                  <td>{aud(w.receivedInc)}<D v={delta(w.receivedInc, p?.receivedInc)} /></td>
                  <td className={w.claims.some((c) => c.overdueDays > 0) ? "acc-bad-text" : w.owedInc > 0 ? "acc-warn-text" : ""}>{aud(w.owedInc)}</td>
                  <td>{aud(w.costTotal)}<D v={delta(w.costTotal, p?.costTotal)} /></td>
                  <td>{aud(w.paidTotal)}<D v={delta(w.paidTotal, p?.paidTotal)} /></td>
                  <td>{aud(w.owingKnown)}</td>
                  <td>{w.pendingCount ? <>{aud(w.pendingCost)}<small className="acc-muted" style={{ display: "block" }}>{w.pendingCount} trades</small></> : "—"}</td>
                  <td>{aud(w.forecastGp)}<small className="acc-muted" style={{ display: "block" }}>{w.forecastGpPct.toFixed(1)}%</small><D v={delta(w.forecastGp, p?.forecastGp)} /></td>
                  <td className={w.cashPositionEx < 0 ? "acc-bad-text" : ""}>{aud(w.cashPositionEx)}</td>
                  <td>{(() => { const n = claimPlan(j, today).find((x) => x.state !== "issued"); return n ? <>{aud(n.amountInc)}<small className={n.state === "ready" ? "acc-bad-text" : "acc-muted"}>Claim {n.seq} · {n.state === "ready" ? "ready now" : n.issueOn ? dmy(n.issueOn) : "no date"}</small></> : "—"; })()}</td>
                  <td>{w.flags.length ? <ul className="wip-mini">{w.flags.slice(0, 3).map((f) => <li key={f.text} className={f.level}>{f.text}</li>)}{w.flags.length > 3 && <li>+{w.flags.length - 3} more</li>}</ul> : <span className="acc-good-text">On track</span>}</td>
                </tr>
              ); })}
            </tbody>
            <tfoot><tr className="acc-pl-total"><td>All live jobs</td><td>{aud(t.contract)}</td><td>{aud(t.claimed)}</td><td>{aud(t.received)}</td><td>{aud(t.owed)}</td><td>{aud(t.cost)}</td><td>{aud(t.paid)}</td><td>{aud(t.owing)}</td><td>{aud(t.pending)}</td><td>{aud(t.gp)}</td><td>{aud(t.cash)}</td><td /><td /></tr></tfoot>
          </table>
        </div>
        <p className="acc-muted" style={{ marginTop: ".6rem" }}>Owing only counts trades where we know what&apos;s been paid; the rest are Pending, not $0. Forecast GP = contract − the larger of each trade&apos;s cost and what&apos;s been paid. Cash position = cash received (ex GST) − paid out on the job.</p>
      </section>
    </div>
  );
}
