import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireViewer } from "@/lib/team-view";
import { fmtAUD } from "@/lib/money";
import { Flash, PageTitle } from "@/components/ui";
import { CLIENT_STATUSES, CLIENT_TYPES, OPEN_LEASE } from "@/lib/leases";
import { clientsFromLeads } from "./actions";

const EDITORS = ["ADMIN", "BDM", "PM", "ACCOUNTS"];

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const u = await requireViewer(["ADMIN", "BDM", "PM", "ACCOUNTS"]);
  const canEdit = EDITORS.includes(u.role);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const type = CLIENT_TYPES.includes(sp.type) ? sp.type : "";
  const status = CLIENT_STATUSES.includes(sp.status) ? sp.status : "";
  const [clients, unlinked] = await Promise.all([
    prisma.client.findMany({
      where: { ...(type ? { type } : {}), ...(status ? { status } : {}), ...(q ? { OR: [{ name: { contains: q } }, { contactName: { contains: q } }, { email: { contains: q } }, { phone: { contains: q } }, { address: { contains: q } }] } : {}) },
      include: { leads: { select: { stage: true, quoteValue: true } }, jobs: { select: { contractValue: true, status: true } }, leases: { select: { status: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.lead.count({ where: { brand: "DR", clientId: null, cancelled: false, company: { not: null } } }),
  ]);
  const total = clients.length;
  const active = clients.filter((c) => c.status === "Active").length;
  const signed = clients.reduce((s, c) => s + c.jobs.reduce((a, j) => a + (j.contractValue ?? 0), 0), 0);
  const qs = (o: Record<string, string>) => `/clients?${new URLSearchParams(Object.fromEntries(Object.entries({ q, type, status, ...o }).filter(([, v]) => v)))}`;

  return (
    <div className="space-y-4">
      <PageTitle title="Clients" sub="DR Fitout practices: their leads, jobs and leases in one place.">
        {canEdit && unlinked > 0 && (u.role === "ADMIN" || u.role === "BDM") && <form action={clientsFromLeads}><button className="btn-ghost" title="Makes a client for each DR lead company that isn't linked yet">Create from {unlinked} lead{unlinked === 1 ? "" : "s"}</button></form>}
        {canEdit && <Link prefetch={false} href="/clients/new" className="btn">+ New client</Link>}
      </PageTitle>
      <Flash msg={sp.msg} /><Flash msg={sp.err} kind="err" />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="dash-kpi"><div className="kpi-label">Clients</div><div className="kpi-value">{total}</div></div>
        <div className="dash-kpi"><div className="kpi-label">Active</div><div className="kpi-value">{active}</div></div>
        <div className="dash-kpi"><div className="kpi-label">Signed job value</div><div className="kpi-value">{fmtAUD(signed) || "$0"}</div><div className="text-xs admin-muted">Linked jobs, ex GST</div></div>
      </div>

      <form className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={q} placeholder="Search name, contact, email, phone, address…" className="input max-w-md" />
        <select name="type" defaultValue={type} className="input max-w-[12rem]"><option value="">All types</option>{CLIENT_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
        <select name="status" defaultValue={status} className="input max-w-[10rem]"><option value="">Any status</option>{CLIENT_STATUSES.map((t) => <option key={t}>{t}</option>)}</select>
        <button className="btn-ghost">Filter</button>
        {(q || type || status) && <Link prefetch={false} href="/clients" className="text-sm admin-muted underline">Clear</Link>}
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead><tr><th>Client</th><th>Type</th><th>Status</th><th>Contact</th><th>Leads</th><th>Jobs</th><th>Open leases</th><th>Signed value</th></tr></thead>
          <tbody>
            {clients.map((c) => { const val = c.jobs.reduce((a, j) => a + (j.contractValue ?? 0), 0); return (
              <tr key={c.id}>
                <td><Link prefetch={false} href={`/clients/${c.id}`} className="font-medium brand-text hover:underline">{c.name}</Link>{c.address && <div className="text-xs admin-muted">{c.address}</div>}</td>
                <td>{c.type}</td>
                <td><span className={`badge client-s-${c.status.toLowerCase()}`}>{c.status}</span></td>
                <td>{c.contactName}<div className="text-xs admin-muted">{[c.phone, c.email].filter(Boolean).join(" · ")}</div></td>
                <td>{c.leads.length || ""}</td><td>{c.jobs.length || ""}</td>
                <td>{c.leases.filter((l) => OPEN_LEASE.includes(l.status)).length || ""}</td>
                <td>{fmtAUD(val || null)}</td>
              </tr>); })}
            {!clients.length && <tr><td colSpan={8} className="py-8 text-center admin-muted">{q || type || status ? "No clients match." : "No clients yet. Add one, or create them from your DR leads."}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
