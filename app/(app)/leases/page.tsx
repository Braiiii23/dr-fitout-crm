import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireViewer } from "@/lib/team-view";
import { fmtAUD } from "@/lib/money";
import { fmtDate, brisbaneToday } from "@/lib/time";
import { Flash, PageTitle } from "@/components/ui";
import { AutoSubmitSelect } from "@/components/AutoSubmit";
import { LEASE_STAGE_HELP, LEASE_STATUSES, LEASE_STATUS_COLOURS, OPEN_LEASE, PRE_SIGN, expiryOf, inDays, keyDates, perSqm, stageOf, urgency } from "@/lib/leases";
import { setLeaseClient, setLeaseStatus } from "./actions";

const EDITORS = ["ADMIN", "BDM", "PM", "ACCOUNTS"];

export default async function LeasesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const u = await requireViewer(["ADMIN", "BDM", "PM", "ACCOUNTS"]);
  const canEdit = EDITORS.includes(u.role);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const view = sp.view === "list" ? "list" : "board";
  const status = LEASE_STATUSES.includes(sp.status) ? sp.status : "all";
  const [raw, clients] = await Promise.all([
    prisma.lease.findMany({ include: { client: { select: { id: true, name: true } }, concept: { select: { id: true, name: true } } }, orderBy: { updatedAt: "desc" } }),
    prisma.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  // Older records may still carry a first-version status: show them under the matching new stage.
  const all = raw.map((l) => ({ ...l, status: stageOf(l.status) }));
  const today = brisbaneToday();
  const open = all.filter((l) => OPEN_LEASE.includes(l.status));
  const match = (l: (typeof all)[number]) => !q || [l.premises, l.tenancy, l.suburb, l.centre, l.landlord, l.leasingAgent, l.client?.name].some((x) => x?.toLowerCase().includes(q.toLowerCase()));
  const rows = all.filter((l) => status === "all" || l.status === status).filter(match);
  const dates = open.flatMap((l) => keyDates(l, today)).filter((d) => d.days >= -30 && d.days <= 365).sort((a, b) => a.date.localeCompare(b.date));
  const byId = new Map(all.map((l) => [l.id, l]));
  const soon = dates.filter((d) => d.days >= 0 && d.days <= 90).length;
  const rentRoll = all.filter((l) => l.status === "Sign").reduce((s, l) => s + (l.rentPa ?? 0), 0);
  const inNeg = all.filter((l) => PRE_SIGN.includes(l.status));
  const incentives = inNeg.reduce((s, l) => s + (l.incentive ?? 0), 0);
  const tab = (v: string, label: string, n: number) => (
    <Link prefetch={false} href={`/leases?${new URLSearchParams({ view, status: v, ...(q ? { q } : {}) })}`} className={`lease-tab ${status === v ? "is-on" : ""}`}>{label} <span>{n}</span></Link>
  );

  return (
    <div className="space-y-4">
      <PageTitle title="Leases" sub="Tenancies we're securing for clients, and the ones they hold. Key dates feed the dashboard.">
        <Link prefetch={false} href={`/leases?view=board${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={view === "board" ? "btn" : "btn-ghost"}>Stages</Link>
        <Link prefetch={false} href={`/leases?view=list${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={view === "list" ? "btn" : "btn-ghost"}>List</Link>
        {canEdit && <Link prefetch={false} href="/leases/new" className="btn">+ New lease</Link>}
      </PageTitle>
      <Flash msg={sp.msg} /><Flash msg={sp.err} kind="err" />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="dash-kpi"><div className="kpi-label">Leases</div><div className="kpi-value">{open.length}</div><div className="text-xs admin-muted">{LEASE_STATUSES.map((s) => `${all.filter((l) => l.status === s).length} ${s.toLowerCase()}`).join(" · ")}</div></div>
        <div className="dash-kpi"><div className="kpi-label">Before signing</div><div className="kpi-value">{inNeg.length}</div><div className="text-xs admin-muted">{fmtAUD(incentives) || "$0"} fitout incentives in play</div></div>
        <div className="dash-kpi"><div className="kpi-label">Key dates · next 90 days</div><div className="kpi-value">{soon}</div><div className="text-xs admin-muted">Options, reviews, expiries, starts</div></div>
        <div className="dash-kpi"><div className="kpi-label">Rent roll (signed)</div><div className="kpi-value">{fmtAUD(rentRoll) || "$0"}</div><div className="text-xs admin-muted">Base rent per year, ex GST</div></div>
      </div>

      <section className="dash-panel">
        <div className="mb-2 flex items-end justify-between gap-2"><h2 className="mb-0">Key dates · next 12 months</h2><span className="text-xs admin-muted">Overdue items stay here for 30 days</span></div>
        {dates.length ? (
          <ul className="lease-dates">
            {dates.slice(0, 16).map((d) => { const l = byId.get(d.leaseId)!; return (
              <li key={d.leaseId + d.kind} className={urgency(d.days)}>
                <span className="lease-when"><b>{fmtDate(d.date)}</b><small>{inDays(d.days)}</small></span>
                <span className="min-w-0"><span className="lease-kind">{d.label}</span> · <Link prefetch={false} className="brand-text underline" href={`/leases/${l.id}`}>{[l.tenancy, l.premises].filter(Boolean).join(", ")}</Link>{l.client && <span className="admin-muted"> · {l.client.name}</span>}</span>
              </li>); })}
          </ul>
        ) : <p className="text-sm admin-muted">No key dates in the next 12 months. Add option, review and expiry dates to leases and they show up here.</p>}
      </section>

      <form className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="view" value={view} />
        <input type="hidden" name="status" value={status} />
        <input name="q" defaultValue={q} placeholder="Search address, centre, landlord, agent, client…" className="input max-w-md" />
        <button className="btn-ghost">Search</button>
      </form>
      <nav className="flex flex-wrap gap-2">
        {tab("all", "All", all.filter(match).length)}
        {LEASE_STATUSES.map((s) => tab(s, s, all.filter((l) => l.status === s).filter(match).length))}
      </nav>

      {view === "board" ? (
        <div className="lease-board">
          {LEASE_STATUSES.filter((st) => status === "all" || st === status).map((st) => { const col = all.filter((l) => l.status === st).filter(match); return (
            <section key={st} className="lease-col">
              <header><span className={`badge ${LEASE_STATUS_COLOURS[st]}`}>{st}</span><span className="admin-muted text-xs">{col.length}</span></header>
              <p className="lease-col-help">{LEASE_STAGE_HELP[st]}</p>
              {col.map((l) => { const next = keyDates(l, today).find((d) => d.days >= 0); return (
                <article key={l.id} className="lease-card">
                  <Link prefetch={false} href={`/leases/${l.id}`} className="font-semibold brand-text hover:underline">{[l.tenancy, l.premises].filter(Boolean).join(", ")}</Link>
                  <div className="text-xs admin-muted">{[l.centre, l.suburb, l.sizeSqm ? `${l.sizeSqm} m²` : "", l.rentPa ? `${fmtAUD(l.rentPa)}/yr` : ""].filter(Boolean).join(" · ")}</div>
                  {next && <span className={`lease-chip mt-1 ${urgency(next.days)}`}>{next.label} · {inDays(next.days)}</span>}
                  {l.concept ? <Link prefetch={false} href={`/concepts/${l.concept.id}`} className="text-xs hover:underline">Concept: <b>{l.concept.name}</b></Link>
                    : l.status === "Concept proposing" && <Link prefetch={false} href={`/leases/${l.id}#concept`} className="text-xs brand-text underline">Pick a concept →</Link>}
                  {canEdit ? (<div className="lease-card-edit">
                    <ClientPicker leaseId={l.id} clientId={l.clientId} clients={clients} />
                    <form action={setLeaseStatus}><input type="hidden" name="id" value={l.id} />
                      <AutoSubmitSelect name="status" defaultValue={l.status} aria-label="Stage" className={`lease-status-select ${LEASE_STATUS_COLOURS[l.status] ?? ""}`}>{LEASE_STATUSES.map((x) => <option key={x}>{x}</option>)}</AutoSubmitSelect>
                    </form>
                  </div>) : <div className="text-sm">{l.client?.name ?? <span className="admin-muted">No client</span>}</div>}
                </article>); })}
              {!col.length && <p className="text-sm admin-muted">Nothing here.</p>}
            </section>); })}
        </div>
      ) : (
      <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead><tr><th>Premises</th><th>Client</th><th>Concept</th><th>Stage</th><th>Size</th><th>Rent / yr</th><th>Gross $/sqm</th><th>Term</th><th>Expiry</th><th>Next key date</th></tr></thead>
            <tbody>
              {rows.map((l) => { const next = keyDates(l, today).find((d) => d.days >= 0); const ps = perSqm(l); const exp = expiryOf(l); return (
                <tr key={l.id}>
                  <td><Link prefetch={false} href={`/leases/${l.id}`} className="font-medium brand-text hover:underline">{l.premises}</Link><div className="text-xs admin-muted">{[l.tenancy, l.centre, l.suburb].filter(Boolean).join(" · ")}</div></td>
                  <td>{canEdit ? <ClientPicker leaseId={l.id} clientId={l.clientId} clients={clients} /> : l.client ? <Link prefetch={false} href={`/clients/${l.client.id}`} className="hover:underline">{l.client.name}</Link> : <span className="admin-muted">—</span>}</td>
                <td>{l.concept ? <Link prefetch={false} href={`/concepts/${l.concept.id}`} className="hover:underline">{l.concept.name}</Link> : <span className="admin-muted">—</span>}</td>
                  <td>{canEdit ? (
                    <form action={setLeaseStatus}><input type="hidden" name="id" value={l.id} />
                      <AutoSubmitSelect name="status" defaultValue={l.status} className={`lease-status-select ${LEASE_STATUS_COLOURS[l.status] ?? ""}`}>{LEASE_STATUSES.map((s) => <option key={s}>{s}</option>)}</AutoSubmitSelect>
                    </form>) : <span className={`badge ${LEASE_STATUS_COLOURS[l.status] ?? ""}`}>{l.status}</span>}</td>
                  <td className="whitespace-nowrap">{l.sizeSqm ? `${l.sizeSqm} m²` : ""}</td>
                  <td>{fmtAUD(l.rentPa)}</td>
                  <td>{ps ? fmtAUD(Math.round(ps)) : ""}</td>
                  <td className="whitespace-nowrap">{l.termYears ? `${l.termYears} yr` : ""}{l.options ? <div className="text-xs admin-muted">+ {l.options}</div> : null}</td>
                  <td className="whitespace-nowrap">{fmtDate(exp)}</td>
                  <td className="whitespace-nowrap">{next ? <span className={`lease-chip ${urgency(next.days)}`}>{next.label} · {inDays(next.days)}</span> : <span className="admin-muted">—</span>}</td>
                </tr>); })}
              {!rows.length && <tr><td colSpan={10} className="py-8 text-center admin-muted">{all.length ? "No leases match." : "No leases yet. Add the first one with + New lease."}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Pick the client for a lease right in the list (saves on change). */
function ClientPicker({ leaseId, clientId, clients }: { leaseId: string; clientId: string | null; clients: { id: string; name: string }[] }) {
  return (
    <form action={setLeaseClient}><input type="hidden" name="id" value={leaseId} />
      <AutoSubmitSelect name="clientId" defaultValue={clientId ?? ""} aria-label="Client" className="input lease-client-select">
        <option value="">— link a client —</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </AutoSubmitSelect>
    </form>
  );
}
