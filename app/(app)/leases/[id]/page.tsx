import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireViewer } from "@/lib/team-view";
import { fmtAUD } from "@/lib/money";
import { fmtDate, brisbaneToday } from "@/lib/time";
import { Flash, PageTitle } from "@/components/ui";
import ConfirmButton from "@/components/ConfirmButton";
import LeaseForm from "@/components/LeaseForm";
import { leaseOptions } from "@/lib/lease-options";
import { LEASE_STATUS_COLOURS, expiryOf, inDays, keyDates, perSqm, urgency } from "@/lib/leases";
import { deleteLease, updateLease } from "../actions";

const EDITORS = ["ADMIN", "BDM", "PM", "ACCOUNTS"];

export default async function LeasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const u = await requireViewer(["ADMIN", "BDM", "PM", "ACCOUNTS"]);
  const canEdit = EDITORS.includes(u.role);
  const { id } = await params; const sp = await searchParams;
  const lease = await prisma.lease.findUnique({ where: { id }, include: { client: true, lead: { select: { id: true, leadName: true, company: true, stage: true } } } });
  if (!lease) notFound();
  const { clients, leads } = await leaseOptions();
  const dates = keyDates(lease, brisbaneToday());
  const ps = perSqm(lease);
  const gross = (lease.rentPa ?? 0) + (lease.outgoingsPa ?? 0);
  const row = (k: string, v: React.ReactNode) => (v === "" || v == null ? null : <div className="acc-line"><span>{k}</span><b>{v}</b></div>);

  return (
    <div>
      <PageTitle title={[lease.tenancy, lease.premises].filter(Boolean).join(", ")} sub={[lease.centre, lease.suburb, lease.client?.name].filter(Boolean).join(" · ") || "Lease"}>
        <span className={`badge self-center ${LEASE_STATUS_COLOURS[lease.status] ?? ""}`}>{lease.status}</span>
        <Link prefetch={false} href="/leases" className="btn-ghost">← Leases</Link>
      </PageTitle>
      <Flash msg={sp.msg} />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div>
          {canEdit ? <LeaseForm lease={lease} clients={clients} leads={leads} action={updateLease} submit="Save lease" /> : (
            <div className="card text-sm">
              {row("Landlord", lease.landlord)}{row("Leasing agent", lease.leasingAgent)}{row("Size", lease.sizeSqm ? `${lease.sizeSqm} m²` : "")}
              {row("Commencement", fmtDate(lease.commencementDate))}{row("Term", lease.termYears ? `${lease.termYears} years${lease.options ? ` + ${lease.options}` : ""}` : "")}
              {row("Expiry", fmtDate(expiryOf(lease)))}{row("Permitted use", lease.permittedUse)}{row("Make good", lease.makeGood)}
              {lease.notes && <p className="mt-3 whitespace-pre-wrap">{lease.notes}</p>}
            </div>
          )}
        </div>
        <aside className="space-y-4">
          <div className="card text-sm">
            <h2 className="lease-h2">Key dates</h2>
            {dates.length ? <ul className="lease-dates lease-dates-tight">{dates.map((d) => (
              <li key={d.kind} className={urgency(d.days)}><span className="lease-when"><b>{fmtDate(d.date)}</b><small>{inDays(d.days)}</small></span><span className="lease-kind">{d.label}</span></li>
            ))}</ul> : <p className="admin-muted">No dates yet.</p>}
          </div>
          <div className="card text-sm">
            <h2 className="lease-h2">Occupancy cost</h2>
            {row("Base rent / yr", fmtAUD(lease.rentPa))}{row("Outgoings / yr", fmtAUD(lease.outgoingsPa))}
            {row("Gross / yr", gross ? fmtAUD(gross) : "")}{row("Gross / month", gross ? fmtAUD(Math.round(gross / 12)) : "")}
            {row("Gross $/sqm", ps ? fmtAUD(Math.round(ps)) : "")}{row("Reviews", lease.reviewType)}
            {row("Fitout incentive", fmtAUD(lease.incentive))}{row("Rent-free", lease.rentFreeMonths ? `${lease.rentFreeMonths} months` : "")}
            {!gross && !lease.incentive && <p className="admin-muted">Add rent and outgoings to see the occupancy cost.</p>}
          </div>
          <div className="card text-sm">
            <h2 className="lease-h2">Linked</h2>
            {lease.client ? <p>Client: <Link prefetch={false} className="brand-text underline" href={`/clients/${lease.client.id}`}>{lease.client.name}</Link></p> : <p className="admin-muted">No client linked.</p>}
            {lease.lead ? <p className="mt-1">Lead: <Link prefetch={false} className="brand-text underline" href={`/leads/dr/${lease.lead.id}`}>{lease.lead.company || lease.lead.leadName}</Link> <span className="admin-muted">· {lease.lead.stage}</span></p> : <p className="admin-muted mt-1">No lead linked.</p>}
          </div>
          {u.role === "ADMIN" && <form action={deleteLease} className="card"><input type="hidden" name="id" value={lease.id} /><ConfirmButton className="btn-danger" message="Delete this lease permanently?">Delete lease</ConfirmButton></form>}
        </aside>
      </div>
    </div>
  );
}
