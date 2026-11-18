import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireViewer } from "@/lib/team-view";
import { fmtAUD } from "@/lib/money";
import { fmtDate, brisbaneToday } from "@/lib/time";
import { Flash, PageTitle, StageBadge } from "@/components/ui";
import ConfirmButton from "@/components/ConfirmButton";
import ClientForm from "@/components/ClientForm";
import { LEASE_STATUS_COLOURS, expiryOf, inDays, keyDates, urgency } from "@/lib/leases";
import { deleteClient, linkToClient, updateClient } from "../actions";

const EDITORS = ["ADMIN", "BDM", "PM", "ACCOUNTS"];

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const u = await requireViewer(["ADMIN", "BDM", "PM", "ACCOUNTS"]);
  const canEdit = EDITORS.includes(u.role);
  const { id } = await params; const sp = await searchParams;
  const c = await prisma.client.findUnique({
    where: { id },
    include: {
      leads: { orderBy: { createdAt: "desc" }, select: { id: true, leadName: true, company: true, stage: true, quoteValue: true, contractValue: true, nextFollowUp: true } },
      jobs: { orderBy: { createdAt: "desc" }, select: { id: true, name: true, jobNumber: true, status: true, contractValue: true, finishDate: true } },
      leases: { orderBy: { updatedAt: "desc" } },
    },
  });
  if (!c) notFound();
  const [freeLeads, freeJobs] = canEdit ? await Promise.all([
    prisma.lead.findMany({ where: { brand: "DR", clientId: null }, orderBy: { createdAt: "desc" }, select: { id: true, leadName: true, company: true } }),
    prisma.job.findMany({ where: { brand: "DR", clientId: null }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, jobNumber: true } }),
  ]) : [[], []];
  const today = brisbaneToday();
  const signed = c.jobs.reduce((a, j) => a + (j.contractValue ?? 0), 0);
  const quoting = c.leads.filter((l) => l.stage === "Quoting").reduce((a, l) => a + (l.quoteValue ?? 0), 0);
  const Link2 = ({ kind, targetId }: { kind: string; targetId: string }) => canEdit ? (
    <form action={linkToClient} className="inline"><input type="hidden" name="clientId" value={c.id} /><input type="hidden" name="kind" value={kind} /><input type="hidden" name="targetId" value={targetId} /><input type="hidden" name="unlink" value="1" /><button className="text-xs admin-muted underline" title="Unlink from this client">unlink</button></form>
  ) : null;

  return (
    <div className="space-y-4">
      <PageTitle title={c.name} sub={[c.type, c.contactName, c.phone, c.email].filter(Boolean).join(" · ")}>
        <span className={`badge self-center client-s-${c.status.toLowerCase()}`}>{c.status}</span>
        <Link prefetch={false} href="/clients" className="btn-ghost">← Clients</Link>
      </PageTitle>
      <Flash msg={sp.msg} />

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="dash-kpi"><div className="kpi-label">Leads</div><div className="kpi-value">{c.leads.length}</div></div>
        <div className="dash-kpi"><div className="kpi-label">Quoting</div><div className="kpi-value">{fmtAUD(quoting) || "$0"}</div></div>
        <div className="dash-kpi"><div className="kpi-label">Signed jobs</div><div className="kpi-value">{fmtAUD(signed) || "$0"}</div></div>
        <div className="dash-kpi"><div className="kpi-label">Leases</div><div className="kpi-value">{c.leases.length}</div></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="dash-panel">
          <div className="mb-2 flex items-center justify-between"><h2 className="mb-0">Leases</h2>{canEdit && <Link prefetch={false} href={`/leases/new?client=${c.id}`} className="btn-ghost text-xs">+ Lease</Link>}</div>
          {c.leases.length ? <ul className="admin-divide divide-y">{c.leases.map((l) => { const next = keyDates(l, today).find((d) => d.days >= 0); return (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div><Link prefetch={false} href={`/leases/${l.id}`} className="font-semibold brand-text underline">{[l.tenancy, l.premises].filter(Boolean).join(", ")}</Link>
                <div className="text-xs admin-muted">{[l.suburb, l.sizeSqm ? `${l.sizeSqm} m²` : "", l.rentPa ? `${fmtAUD(l.rentPa)}/yr` : "", expiryOf(l) ? `expires ${fmtDate(expiryOf(l))}` : ""].filter(Boolean).join(" · ")}</div></div>
              <div className="flex items-center gap-2">{next && <span className={`lease-chip ${urgency(next.days)}`}>{next.label} · {inDays(next.days)}</span>}<span className={`badge ${LEASE_STATUS_COLOURS[l.status] ?? ""}`}>{l.status}</span></div>
            </li>); })}</ul> : <p className="text-sm admin-muted">No leases yet.</p>}
        </section>

        <section className="dash-panel">
          <h2 className="mb-2">Leads</h2>
          {c.leads.length ? <ul className="admin-divide divide-y">{c.leads.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div><Link prefetch={false} href={`/leads/dr/${l.id}`} className="font-semibold brand-text underline">{l.leadName || l.company || "(no name)"}</Link>
                <div className="text-xs admin-muted">{[l.quoteValue ? `quote ${fmtAUD(l.quoteValue)}` : "", l.contractValue ? `signed ${fmtAUD(l.contractValue)}` : "", l.nextFollowUp ? `follow up ${fmtDate(l.nextFollowUp)}` : ""].filter(Boolean).join(" · ")}</div></div>
              <div className="flex items-center gap-2"><StageBadge stage={l.stage} /><Link2 kind="lead" targetId={l.id} /></div>
            </li>))}</ul> : <p className="text-sm admin-muted">No leads linked.</p>}
          {canEdit && freeLeads.length > 0 && <form action={linkToClient} className="mt-3 flex gap-2"><input type="hidden" name="clientId" value={c.id} /><input type="hidden" name="kind" value="lead" />
            <select name="targetId" className="input" defaultValue=""><option value="">Link a lead…</option>{freeLeads.map((l) => <option key={l.id} value={l.id}>{[l.company, l.leadName].filter(Boolean).join(" · ")}</option>)}</select><button className="btn-ghost">Link</button></form>}
        </section>

        <section className="dash-panel lg:col-span-2">
          <h2 className="mb-2">Jobs</h2>
          {c.jobs.length ? <ul className="admin-divide divide-y">{c.jobs.map((j) => (
            <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div><Link prefetch={false} href={`/jobs/${j.id}`} className="font-semibold brand-text underline">{j.name}</Link><div className="text-xs admin-muted">{[j.jobNumber ? `Job ${j.jobNumber}` : "", j.status, j.finishDate ? `handover ${fmtDate(j.finishDate)}` : ""].filter(Boolean).join(" · ")}</div></div>
              <div className="flex items-center gap-2"><b>{fmtAUD(j.contractValue)}</b><Link2 kind="job" targetId={j.id} /></div>
            </li>))}</ul> : <p className="text-sm admin-muted">No jobs linked.</p>}
          {canEdit && freeJobs.length > 0 && <form action={linkToClient} className="mt-3 flex max-w-xl gap-2"><input type="hidden" name="clientId" value={c.id} /><input type="hidden" name="kind" value="job" />
            <select name="targetId" className="input" defaultValue=""><option value="">Link a job…</option>{freeJobs.map((j) => <option key={j.id} value={j.id}>{j.name}{j.jobNumber ? ` · ${j.jobNumber}` : ""}</option>)}</select><button className="btn-ghost">Link</button></form>}
        </section>
      </div>

      {canEdit ? (
        <details className="dash-panel" open={!c.contactName && !c.phone}>
          <summary className="cursor-pointer font-semibold brand-text">Edit client details</summary>
          <div className="mt-3"><ClientForm client={c} action={updateClient} submit="Save client" /></div>
        </details>
      ) : (c.notes && <div className="card whitespace-pre-wrap text-sm">{c.notes}</div>)}
      {u.role === "ADMIN" && <form action={deleteClient}><input type="hidden" name="id" value={c.id} /><ConfirmButton className="btn-danger" message="Delete this client? Its leads, jobs and leases are kept, just unlinked.">Delete client</ConfirmButton></form>}
    </div>
  );
}
