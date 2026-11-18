import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireViewer } from "@/lib/team-view";
import { CALL_STATUSES } from "@/lib/constants";
import ActionForm from "@/components/ActionForm";
import SetterCallRow from "@/components/SetterCallRow";
import { addSetterCall } from "./actions";

// A setter's call list (what they see on My Calls), for Braiden to see and work.
export default async function SetterCalls({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const me = await requireViewer(["ADMIN"], "setterPay");
  const canEdit = me.role === "ADMIN";
  const sp = await searchParams;
  const setters = await prisma.setter.findMany({ where: { status: "Active" }, select: { id: true, name: true, _count: { select: { calls: true } } }, orderBy: { name: "asc" } });
  const pick = setters.find((s) => s.id === sp.setter) ?? setters.find((s) => /jessie/i.test(s.name)) ?? setters[0];
  if (!pick) return <div className="card est-empty">No active setters.</div>;
  const q = (sp.q ?? "").trim(), status = sp.status === "HIGH" ? "HIGH" : sp.status && CALL_STATUSES.includes(sp.status) ? sp.status : null;
  const all = await prisma.callListItem.findMany({ where: { setterId: pick.id }, orderBy: [{ updatedAt: "desc" }] });
  const counts = Object.fromEntries(CALL_STATUSES.map((s) => [s, all.filter((c) => c.callStatus === s).length]));
  const qq = q.toLowerCase();
  const highN = all.filter((c) => c.priority === "High" && !["Not Interested", "Wrong Number"].includes(c.callStatus)).length;
  const shown = all.filter((c) => (!status || (status === "HIGH" ? c.priority === "High" : c.callStatus === status)) && (!q || [c.leadName, c.company, c.phone, c.email].some((v) => v?.toLowerCase().includes(qq))));
  // To-call first, then call-backs, then the rest; booked and dead ones last.
  const rank = (s: string) => ({ "To Call": 0, "Call Back": 1, "No Answer": 2, "Braiden to Connect": 3, "Contacted": 4, "Quoting": 5, "Appointment Set": 6, "Not Interested": 7, "Wrong Number": 8 } as Record<string, number>)[s] ?? 5;
  const pr = (p: string) => (p === "High" ? 0 : p === "Low" ? 2 : 1);
  // Priority first (High → Normal → Low), then by where the call is up to.
  shown.sort((a, b) => pr(a.priority) - pr(b.priority) || rank(a.callStatus) - rank(b.callStatus));
  const href = (extra: Record<string, string | null>) => `/setters/calls?${new URLSearchParams(Object.entries({ setter: pick.id, ...(status ? { status } : {}), ...(q ? { q } : {}), ...extra }).filter(([, v]) => v) as [string, string][])}`;
  return (
    <div className="space-y-5">
      <div><h1 className="est-title">Setters&apos; call lists</h1><p className="est-sub">{pick.name}&apos;s calls, exactly as they appear on their My Calls. {canEdit ? "Changes here run the same automations as when they make them." : ""}</p></div>
      <nav className="md-people" aria-label="Setter">{setters.map((s) => <Link prefetch={false} key={s.id} href={`/setters/calls?setter=${s.id}`} className={`dir-tab ${s.id === pick.id ? "dir-tab-on" : ""}`}>{s.name} <span>{s._count.calls}</span></Link>)}</nav>
      <section className="card acc-pad">
        <div className="sc-filters">
          <Link prefetch={false} href={href({ status: null })} className={`dir-tab ${!status ? "dir-tab-on" : ""}`}>All <span>{all.length}</span></Link>
          {highN > 0 && <Link prefetch={false} href={href({ status: "HIGH" })} className={`dir-tab sc-high-tab ${status === "HIGH" ? "dir-tab-on" : ""}`}>High priority <span>{highN}</span></Link>}
          {CALL_STATUSES.filter((s) => counts[s]).map((s) => <Link prefetch={false} key={s} href={href({ status: s })} className={`dir-tab ${status === s ? "dir-tab-on" : ""}`}>{s} <span>{counts[s]}</span></Link>)}
          <form className="sc-search" action="/setters/calls"><input type="hidden" name="setter" value={pick.id} />{status && <input type="hidden" name="status" value={status} />}<input name="q" defaultValue={q} className="input" placeholder="Search name, company, phone" aria-label="Search calls" /><button className="btn">Search</button></form>
        </div>
        {canEdit && <details className="tp-add-scope"><summary className="acc-link">+ Add a call to {pick.name.split(" ")[0]}&apos;s list</summary>
          <ActionForm action={addSetterCall} className="ev-form" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
            <input type="hidden" name="setterId" value={pick.id} />
            <label><span className="label">Name *</span><input name="leadName" className="input" required /></label>
            <label><span className="label">Company</span><input name="company" className="input" /></label>
            <label><span className="label">Phone</span><input name="phone" className="input" /></label>
            <label><span className="label">Email</span><input name="email" type="email" className="input" /></label>
            <label><span className="label">Business</span><select name="business" className="input"><option value="ENP">ENP Fitouts</option><option value="DR">DR Fitout</option></select></label>
            <label><span className="label">Priority</span><select name="priority" className="input" defaultValue="Normal"><option>High</option><option>Normal</option><option>Low</option></select></label>
            <label className="ev-wide"><span className="label">Lead info</span><input name="leadInfo" className="input" /></label>
            <div className="ev-actions"><button className="btn">Add call</button></div>
          </ActionForm></details>}
        {shown.length ? <ul className="sc-list">{shown.map((c) => <SetterCallRow key={c.id} c={{ ...c, appointment: c.appointment ? c.appointment.toISOString() : null }} statuses={CALL_STATUSES} setters={setters.map((s) => ({ id: s.id, name: s.name }))} readOnly={!canEdit} />)}</ul>
          : <p className="acc-muted">No calls{status === "HIGH" ? " marked high priority" : status ? ` with status ${status}` : ""}{q ? ` matching “${q}”` : ""}.</p>}
      </section>
    </div>
  );
}
