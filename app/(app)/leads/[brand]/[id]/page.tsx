import Link from "next/link";
import { requireViewer } from "@/lib/team-view";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { BRANDS, brandFromSlug } from "@/lib/constants";
import { Flash, PageTitle, StageBadge } from "@/components/ui";
import LeadForm from "@/components/LeadForm";
import ConfirmButton from "@/components/ConfirmButton";
import { deleteLead, saveLead } from "../../actions";

export default async function LeadPage({ params, searchParams }: { params: Promise<{ brand: string; id: string }>; searchParams: Promise<Record<string, string>> }) {
  await requireViewer(["ADMIN", "BDM"]);
  const { brand: slug, id } = await params; const sp = await searchParams;
  const brand = brandFromSlug(slug); if (!brand) notFound();
  const lead = await prisma.lead.findUnique({ where: { id }, include: { client: { select: { id: true, name: true } }, leases: { select: { id: true, premises: true, tenancy: true, status: true } } } });
  if (!lead || lead.brand !== brand) notFound();
  const setters = await prisma.setter.findMany({ orderBy: { name: "asc" } });
  const attachments: { url: string; filename: string; kind?: string; added?: string }[] = (() => { try { return lead.attachments ? JSON.parse(lead.attachments) : []; } catch { return []; } })();
  return (
    <div>
      <PageTitle title={lead.leadName || "(no name)"} sub={`${BRANDS[brand].table} · ${lead.company ?? ""}${lead.externalId ? ` · Airtable ${lead.externalId}` : ""}`}>
        <StageBadge stage={lead.stage} />
        <Link prefetch={false} href={`/leads/${slug}`} className="btn-ghost">← Back</Link>
      </PageTitle>
      <Flash msg={sp.saved ? "Saved." : undefined} />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <LeadForm brand={brand} lead={lead} setters={setters} action={saveLead} />
        <aside className="space-y-4">
          <div className="card text-sm">
            <h2 className="mb-2 font-semibold brand-text">Client &amp; leases</h2>
            {lead.client ? <p>Client: <Link prefetch={false} className="brand-text underline" href={`/clients/${lead.client.id}`}>{lead.client.name}</Link></p>
              : <p className="admin-muted">Not linked to a client. <Link prefetch={false} className="brand-text underline" href={`/clients/new?lead=${lead.id}`}>Make client from this lead</Link></p>}
            {lead.leases.map((l) => <p key={l.id} className="mt-1">Lease: <Link prefetch={false} className="brand-text underline" href={`/leases/${l.id}`}>{[l.tenancy, l.premises].filter(Boolean).join(", ")}</Link> <span className="admin-muted">· {l.status}</span></p>)}
            <p className="mt-2"><Link prefetch={false} className="btn-ghost text-xs" href={`/leases/new?lead=${lead.id}${lead.client ? `&client=${lead.client.id}` : ""}`}>+ Lease for this lead</Link></p>
          </div>
          {attachments.length > 0 && <div className="card text-sm"><h2 className="mb-2 font-semibold brand-text">Quotes, plans and files</h2>{attachments.map((a) => <div key={a.url}><a className="underline" href={a.url} target="_blank" rel="noreferrer">{a.filename}</a>{a.kind && a.kind !== "other" ? <span className="text-xs text-slate-500"> · {a.kind}</span> : null}{a.added ? <span className="text-xs text-slate-500"> · added {a.added}</span> : null}</div>)}</div>}
          <form action={deleteLead} className="card"><input type="hidden" name="id" value={lead.id} /><ConfirmButton className="btn-danger" message="Delete this lead permanently?">Delete lead</ConfirmButton></form>
        </aside>
      </div>
    </div>
  );
}
