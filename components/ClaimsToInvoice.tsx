import { prisma } from "@/lib/db";
import { brisbaneToday } from "@/lib/time";
import { claimPlan } from "@/lib/claim-timing";
import { runClaimNotices } from "@/lib/claim-notify";
import { markClaimInvoiced } from "@/app/(app)/accounts/claim-actions";

const aud = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dm = (iso?: string | null) => (iso ? `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}` : "—");

/** Accounts: claims to invoice now and in the next fortnight, worked out from each live job's program. */
export default async function ClaimsToInvoice() {
  await runClaimNotices().catch(() => 0);
  const today = brisbaneToday();
  const s = await prisma.accountsSettings.findUnique({ where: { id: "settings" } });
  const terms = s?.claimTermsDays ?? 10;
  const horizon = new Date(Date.parse(today + "T00:00:00Z") + Math.max(14, s?.claimNoticeDays ?? 3) * 86400000).toISOString().slice(0, 10);
  const jobs = await prisma.job.findMany({ where: { status: "Live" }, include: { claims: true, tasks: true } });
  const rows = jobs.flatMap((j) => claimPlan(j, today, terms, s?.claimNoticeDays ?? 3).filter((p) => p.state !== "issued" && p.issueOn && p.issueOn <= horizon).map((p) => ({ j, p, claim: j.claims.find((c) => c.id === p.claimId)! })))
    .sort((a, b) => a.p.issueOn!.localeCompare(b.p.issueOn!));
  const unknown = jobs.flatMap((j) => claimPlan(j, today, terms).filter((p) => p.state === "unknown").map((p) => ({ j, p })));
  if (!rows.length && !unknown.length) return null;
  const ready = rows.filter((r) => r.p.issueOn! <= today);
  return (
    <section className="card acc-pad">
      <div className="acc-head"><h2 className="est-h2">Claims to invoice</h2><span className="acc-muted">Worked out from each job&apos;s build program: a claim is ready once its milestone tasks finish. Accounts is notified {s?.claimNoticeDays ?? 3} days ahead and on the day. Showing the next {Math.max(14, s?.claimNoticeDays ?? 3)} days.</span></div>
      {ready.length > 0 && <div className="acc-notice acc-bad" role="alert" style={{ marginBottom: ".8rem" }}><b>{ready.length} claim{ready.length === 1 ? "" : "s"} ready to invoice now</b>: {aud(ready.reduce((t, r) => t + r.p.amountInc, 0))} inc GST.</div>}
      {rows.length > 0 && <div className="overflow-x-auto"><table className="table wip-rows">
        <thead><tr><th>Issue on</th><th>Job</th><th>Claim</th><th>Amount inc GST</th><th>Why</th><th>Invoice it</th></tr></thead>
        <tbody>{rows.map(({ j, p, claim }) => (
          <tr key={p.claimId} className={p.issueOn! <= today ? "is-bad" : ""}>
            <td><b>{p.issueOn! <= today ? (p.issueOn! < today ? `Overdue (${dm(p.issueOn)})` : "Today") : dm(p.issueOn)}</b></td>
            <td>{j.name}<small className="acc-muted" style={{ display: "block" }}>{j.jobNumber ? `Job ${j.jobNumber}` : ""}{j.xeroTracking ? ` · ${j.xeroTracking}` : ""}</small></td>
            <td>Claim {p.seq}: {p.name}<small className="acc-muted" style={{ display: "block" }}>{p.pct}% · {aud(p.amount)} ex GST</small></td>
            <td><b>{aud(p.amountInc)}</b></td>
            <td><small>{p.basis}</small>{p.tasks.length > 0 && <small className="acc-muted" style={{ display: "block" }}>{p.tasks.slice(0, 4).map((t) => `${t.name} ${t.done ? "✓" : dm(t.finish)}`).join(" · ")}</small>}</td>
            <td><details className="tp-edit"><summary>Mark invoiced</summary>
              <form action={markClaimInvoiced} className="tp-form"><input type="hidden" name="claimId" value={p.claimId} />
                <label><span className="label">Invoice number</span><input name="invoiceNumber" className="input" defaultValue={claim.invoiceNumber ?? ""} /></label>
                <label><span className="label">Invoice date</span><input name="invoicedDate" type="date" className="input" defaultValue={today} /></label>
                <label><span className="label">Due</span><input name="dueDate" type="date" className="input" defaultValue={new Date(Date.parse(today + "T00:00:00Z") + terms * 86400000).toISOString().slice(0, 10)} /></label>
                <div className="tp-form-actions"><button className="btn">Save</button></div></form></details></td>
          </tr>))}</tbody></table></div>}
      {unknown.length > 0 && <p className="acc-muted" style={{ marginTop: ".6rem" }}>No date yet (no milestone tasks linked): {unknown.slice(0, 6).map(({ j, p }) => `${j.name} claim ${p.seq}`).join(", ")}{unknown.length > 6 ? "…" : ""}. Link tasks to these claims on the job&apos;s Program tab, or set an issue date on the claim.</p>}
    </section>
  );
}
