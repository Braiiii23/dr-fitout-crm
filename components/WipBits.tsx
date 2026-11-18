import type { Wip } from "@/lib/wip";

export const aud = (n: number | null | undefined, cents = false) => n == null ? "—" : (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("en-AU", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dmy = (iso?: string | null) => (iso ? `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}${iso.slice(0, 4) !== new Date().getFullYear().toString() ? ` ${iso.slice(0, 4)}` : ""}` : "—");

/** Contract split into cash received, claimed but unpaid, and still to claim (all ex GST). */
export function MoneyBar({ contract, w }: { contract: number; w: Wip }) {
  const received = Math.min(contract, w.receivedEx), unpaid = Math.max(0, Math.min(contract - received, w.claimedEx - w.receivedEx)), toClaim = Math.max(0, contract - received - unpaid);
  const pc = (x: number) => (contract ? `${(x / contract) * 100}%` : "0%");
  return (
    <div className="wip-money">
      <div className="wip-moneybar" role="img" aria-label={`Paid ${aud(received)}, claimed not paid ${aud(unpaid)}, still to claim ${aud(toClaim)} of ${aud(contract)} ex GST`}>
        <span className="m-paid" style={{ width: pc(received) }} /><span className="m-owed" style={{ width: pc(unpaid) }} /><span className="m-left" style={{ width: pc(toClaim) }} />
      </div>
      <div className="wip-moneykey">
        <span><i className="m-paid" />Paid to us {aud(received)}</span><span><i className="m-owed" />Claimed, not paid {aud(unpaid)}</span><span><i className="m-left" />To claim {aud(toClaim)}</span>
      </div>
    </div>
  );
}

export function ProgressBar({ w }: { w: Wip }) {
  const p = Math.round(w.progress * 100);
  return (
    <div className="wip-prog">
      <div className="wip-prog-top"><b>{p}%</b><span className="acc-muted">{w.progressFrom === "program" ? "through the program" : w.progressFrom === "claims" ? "of claims raised" : "of the way to handover"}{w.nextClaim ? ` · next claim: ${w.nextClaim.name}` : ""}</span></div>
      <div className="wip-progbar"><span style={{ width: `${p}%` }} /></div>
    </div>
  );
}

export function FlagChips({ w, jobId, max = 3 }: { w: Wip; jobId: string; max?: number }) {
  if (!w.flags.length) return <div className="wip-chips"><span className="wip-chip ok">On track</span></div>;
  return (
    <div className="wip-chips">
      {w.flags.slice(0, max).map((f) => <a key={f.text} href={`/jobs/${jobId}?tab=${f.tab}`} className={`wip-chip ${f.level}`}>{f.text}</a>)}
      {w.flags.length > max && <a href={`/jobs/${jobId}`} className="wip-chip more">+{w.flags.length - max} more</a>}
    </div>
  );
}
