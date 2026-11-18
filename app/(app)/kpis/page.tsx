import { prisma } from "@/lib/db";
import { requireUser, type Role } from "@/lib/auth";
import { kpiViews, ensureKpis, METRICS, type KpiView } from "@/lib/myday";
import { ROLE_LABEL, type AnyRole } from "@/lib/access";
import { colourFor } from "@/components/MyDayBits";
import KpiFields from "@/components/KpiFields";
import { setKpiFor, setKpiForRole, removeKpi } from "./actions";

const fmt = (k: { unit: string | null }, n: number) => (k.unit === "%" ? `${Math.round(n)}%` : k.unit === "$" ? `$${Math.round(n).toLocaleString("en-AU")}` : `${Math.round(n * 10) / 10}${k.unit ? ` ${k.unit}` : ""}`);
const ROLE_ORDER: AnyRole[] = ["ADMIN", "CEO", "PM", "FOREMAN", "ESTIMATOR", "ACCOUNTS", "SETTER", "TEAM"];

// Everyone's KPIs in one place: set, change or remove them, for one person or a whole role.
export default async function KpisPage() {
  await requireUser(["ADMIN"]);
  const users = await prisma.user.findMany({ where: { active: true }, select: { id: true, email: true, name: true, role: true, setterId: true }, orderBy: { name: "asc" } });
  const people = await Promise.all(users.map(async (u) => {
    const cu = { ...u, role: u.role as Role };
    await ensureKpis(cu);
    return { ...u, kpis: await kpiViews(cu) };
  }));
  people.sort((a, b) => ROLE_ORDER.indexOf(a.role as AnyRole) - ROLE_ORDER.indexOf(b.role as AnyRole) || a.name.localeCompare(b.name));
  return (
    <div className="myday space-y-5">
      <div>
        <h1 className="est-title">KPIs</h1>
        <p className="est-sub">Set KPIs for anyone. Type what you want to measure and the CRM works out how to track it (calls, meetings booked, quotes sent, signed work, claims invoiced, labour hours and more); anything it can&apos;t count becomes logged by hand on that person&apos;s My Day. KPIs set here are locked for the person.</p>
      </div>

      <section className="card acc-pad">
        <h2 className="est-h2" style={{ marginTop: 0 }}>Set a KPI for a whole role</h2>
        <form action={setKpiForRole} className="ev-form" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
          <label><span className="label">For</span><select name="role" className="input" defaultValue="SETTER"><option value="ALL">Everyone</option>{ROLE_ORDER.filter((r) => r !== "ADMIN").map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
          <KpiFields />
          <div className="ev-actions"><button className="btn">Set for everyone in that role</button></div>
        </form>
        <p className="acc-muted">Anyone who already has a KPI with the same name gets it updated instead of a second one.</p>
      </section>

      <div className="kp-grid">{people.map((p) => (
        <section key={p.id} className="card acc-pad kp-person">
          <div className="kp-head"><b style={{ color: colourFor(p.email) }}>{p.name}</b><span className="acc-muted">{ROLE_LABEL[(p.role as AnyRole)] ?? p.role}</span></div>
          {p.kpis.length === 0 && <p className="acc-muted">No KPIs yet.</p>}
          <ul className="kp-list">{p.kpis.map((k) => <KpiRow key={k.id} k={k} userId={p.id} />)}</ul>
          <details className="tp-add-scope"><summary className="acc-link">+ Add a KPI for {p.name.split(" ")[0]}</summary>
            <form action={setKpiFor} className="ev-form"><input type="hidden" name="userId" value={p.id} /><KpiFields /><div className="ev-actions"><button className="btn">Add KPI</button></div></form>
          </details>
        </section>
      ))}</div>
    </div>
  );
}

function KpiRow({ k, userId }: { k: KpiView & { setBy?: string | null }; userId: string }) {
  const fill = Math.min(100, k.pct * 100), marker = k.percent ? Math.min(100, k.target) : Math.min(100, (k.paceTarget / k.target) * 100);
  return (
    <li className={`kp-row ${k.status}`}>
      <div className="kp-row-top"><b>{k.name}</b><span className={`kpi-status ${k.status}`}>{k.status === "ahead" ? "Ahead" : k.status === "on" ? "On pace" : "Behind"}</span></div>
      <div className="kp-nums">{k.percent ? `${fmt(k, k.actual)} (target ${fmt(k, k.target)}) ${k.label}` : `${fmt(k, k.actual)} of ${fmt(k, k.target)} ${k.label}`}{k.note ? ` · ${k.note}` : ""}</div>
      <div className="kpi-track"><div className="kpi-fill" style={{ width: `${fill}%` }} /><i style={{ left: `${marker}%` }} /></div>
      <div className="kp-foot"><span className="acc-muted">{k.source === "manual" ? "Logged by hand" : `Tracked automatically: ${METRICS[k.source]?.label ?? k.source}`}</span>
        <details className="kpi-edit"><summary className="acc-link">Change</summary>
          <form action={setKpiFor} className="ev-form"><input type="hidden" name="userId" value={userId} /><input type="hidden" name="id" value={k.id} /><KpiFields k={k} /><div className="ev-actions"><button className="btn">Save</button></div></form>
          <form action={removeKpi}><input type="hidden" name="id" value={k.id} /><button className="tp-del">Remove KPI</button></form>
        </details>
      </div>
    </li>
  );
}
