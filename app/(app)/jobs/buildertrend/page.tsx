import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getFeedUrl, getState } from "@/lib/buildertrend";
import { fmtDateTime } from "@/lib/time";
import { dmy } from "@/components/WipBits";
import { saveBtLink, btSyncNow, btLinkJob } from "../bt-actions";

// Connect BuilderTrend's schedule (calendar feed) so live jobs and timelines come in automatically.
export default async function BuilderTrendPage() {
  await requireUser(["ADMIN", "PM"]);
  const url = await getFeedUrl();
  const s = await getState();
  const jobs = await prisma.job.findMany({ where: { status: { not: "Complete" } }, select: { id: true, name: true, btJobName: true }, orderBy: { name: "asc" } });
  const masked = url ? url.replace(/(\/\/[^/]+\/).*(.{6})$/, "$1…$2") : null;
  return (
    <div className="wip space-y-5">
      <div><Link prefetch={false} href="/jobs" className="acc-link">All jobs</Link></div>
      <h1 className="est-title">BuilderTrend schedule</h1>
      <p className="est-sub">BuilderTrend has no public API, but it can share its Schedule as a calendar link. The CRM reads that link every 30 minutes: each job&apos;s schedule items become its program, and jobs in BuilderTrend that aren&apos;t in the CRM yet are listed below. Read-only: nothing is changed in BuilderTrend.</p>

      <section className="card acc-pad">
        <h2 className="est-h2" style={{ marginTop: 0 }}>Calendar link</h2>
        {url ? <p>Connected: <code>{masked}</code>{s.lastSync ? <> · last read {fmtDateTime(new Date(s.lastSync))}</> : null}</p> : <p className="acc-muted">Not connected yet.</p>}
        {s.error && <div className="acc-notice acc-bad" role="alert">{s.error}</div>}
        {url && !s.error && <p className="acc-muted">{s.events} schedule items read · {s.matched} matched to CRM jobs · {s.unmatchedJobs.length} BuilderTrend job{s.unmatchedJobs.length === 1 ? "" : "s"} not linked yet.</p>}
        <form action={saveBtLink} className="acc-actions">
          <label style={{ flex: "1 1 420px" }}><span className="label">{url ? "Replace the link" : "Paste BuilderTrend's calendar (iCal) link"}</span><input name="url" className="input" placeholder="https://… or webcal://…" autoComplete="off" /></label>
          <button className="btn">{url ? "Save new link" : "Connect"}</button>
        </form>
        {url && <div className="acc-actions" style={{ marginTop: ".6rem" }}>
          <form action={btSyncNow}><button className="btn">Read it now</button></form>
          <form action={saveBtLink}><input type="hidden" name="url" value="" /><button className="tp-del">Disconnect</button></form>
        </div>}
        <details style={{ marginTop: ".8rem" }}><summary className="acc-link">Where to find the link in BuilderTrend</summary>
          <ol className="acc-muted" style={{ paddingLeft: "1.2rem" }}>
            <li>On a computer, open BuilderTrend and go to your settings (Project Management / calendar sync).</li>
            <li>Choose the Apple / iCal calendar option for Schedule Items. It gives you a link (often starting with webcal:// or https://).</li>
            <li>Copy that link and paste it above. Use a login that can see every live job (for example Josh&apos;s or an admin login), so all schedules are included.</li>
          </ol>
          <p className="acc-muted">Treat the link like a password: anyone with it can see the schedule. If it ever gets out, reset it in BuilderTrend and paste the new one here.</p>
        </details>
      </section>

      {s.unmatchedJobs.length > 0 && (
        <section className="card acc-pad">
          <div className="acc-head"><h2 className="est-h2">BuilderTrend jobs not linked yet</h2><span className="acc-muted">Link each one to its CRM job, or create a new job from it.</span></div>
          <div className="overflow-x-auto"><table className="acc-pl">
            <thead><tr><th>BuilderTrend job</th><th>Items</th><th>Dates</th><th>Link to</th></tr></thead>
            <tbody>{s.unmatchedJobs.map((u) => (
              <tr key={u.name}><td><b>{u.name}</b></td><td>{u.count}</td><td>{dmy(u.first)} to {dmy(u.last)}</td>
                <td><form action={btLinkJob} className="acc-actions">
                  <input type="hidden" name="btName" value={u.name} /><input type="hidden" name="first" value={u.first} /><input type="hidden" name="last" value={u.last} />
                  <select name="jobId" className="input" defaultValue="" aria-label={`Link ${u.name}`}><option value="" disabled>Choose…</option><option value="new">Create a new job</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.name}{j.btJobName ? ` (now: ${j.btJobName})` : ""}</option>)}</select>
                  <select name="brand" className="input" aria-label="Brand for a new job"><option value="ENP">ENP</option><option value="DR">DR Fitout</option></select>
                  <button className="btn">Link</button>
                </form></td></tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
    </div>
  );
}
