import Link from "next/link";
import { requireViewer } from "@/lib/team-view";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { BRANDS, STAGES, brandFromSlug } from "@/lib/constants";
import { fmtAUD } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/time";
import { PageTitle, StageBadge } from "@/components/ui";
import { AutoSubmitSelect } from "@/components/AutoSubmit";
import { moveStage } from "../actions";

export default async function LeadsPage({ params, searchParams }: { params: Promise<{ brand: string }>; searchParams: Promise<Record<string, string>> }) {
  await requireViewer(["ADMIN", "BDM"]);
  const { brand: slug } = await params; const sp = await searchParams;
  const brand = brandFromSlug(slug); if (!brand) notFound();
  const B = BRANDS[brand];
  const view = sp.view === "pipeline" ? "pipeline" : "grid";
  const q = (sp.q ?? "").trim();
  const stage = sp.stage ?? "";
  const leads = await prisma.lead.findMany({
    where: { brand, ...(stage ? { stage } : {}), ...(q ? { OR: [{ leadName: { contains: q } }, { company: { contains: q } }, { email: { contains: q } }, { phone: { contains: q } }, { location: { contains: q } }] } : {}) },
    include: { setter: true }, orderBy: [{ dateReceived: "desc" }, { createdAt: "desc" }],
  });
  const stages = STAGES[brand];
  const signedTotal = leads.filter((l) => l.stage === "Signed").reduce((s, l) => s + (l.contractValue ?? 0), 0);
  const tab = (v: string, label: string) => (
    <Link prefetch={false} href={`?view=${v}${q ? `&q=${encodeURIComponent(q)}` : ""}${stage ? `&stage=${encodeURIComponent(stage)}` : ""}`} className={view === v ? "btn" : "btn-ghost"}>{label}</Link>
  );
  return (
    <div>
      <PageTitle title={B.table} sub={`${leads.length} leads · Signed work ${fmtAUD(signedTotal)}`}>
        {tab("grid", "Grid view")}{tab("pipeline", "Pipeline")}
        <Link prefetch={false} href={`/leads/${slug}/new`} className="btn">+ New lead</Link>
      </PageTitle>
      <form className="mb-4 flex flex-wrap gap-2">
        <input type="hidden" name="view" value={view} />
        <input name="q" defaultValue={q} placeholder="Search name, company, email, phone, address…" className="input max-w-sm" />
        <select name="stage" defaultValue={stage} className="input max-w-[12rem]"><option value="">All stages</option>{stages.map((s) => <option key={s}>{s}</option>)}</select>
        <button className="btn-ghost">Filter</button>
      </form>
      {view === "grid" ? (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead><tr><th>Lead</th><th>Company</th><th>Stage</th><th>Source</th><th>Received</th><th>Next follow-up</th><th>Appointment</th><th>Location</th><th>Quote value</th><th>Contract value</th></tr></thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td><Link prefetch={false} className="font-medium brand-text hover:underline" href={`/leads/${slug}/${l.id}`}>{l.leadName || "(no name)"}</Link><div className="text-xs text-slate-500">{l.phone} {l.email}</div></td>
                  <td>{l.company}</td><td><StageBadge stage={l.stage} /></td><td>{l.leadSource}</td>
                  <td className="whitespace-nowrap">{fmtDate(l.dateReceived)}</td><td className="whitespace-nowrap">{fmtDate(l.nextFollowUp)}</td>
                  <td className="whitespace-nowrap">{fmtDateTime(l.appointment)}</td><td>{l.location}</td>
                  <td>{fmtAUD(l.quoteValue)}</td><td>{fmtAUD(l.contractValue)}</td>
                </tr>))}
              {!leads.length && <tr><td colSpan={10} className="py-8 text-center text-slate-500">No leads match.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {stages.map((s) => { const col = leads.filter((l) => (l.stage ?? "New") === s); return (
            <div key={s} className="pipe-col w-72 shrink-0 rounded-xl bg-slate-100 p-2">
              <div className="mb-2 flex items-center justify-between px-1"><StageBadge stage={s} /><span className="text-xs text-slate-500">{col.length}</span></div>
              <div className="space-y-2">
                {col.map((l) => (
                  <div key={l.id} className="pipe-card rounded-lg bg-white p-3 text-sm shadow-sm">
                    <Link prefetch={false} href={`/leads/${slug}/${l.id}`} className="font-medium brand-text hover:underline">{l.leadName || "(no name)"}</Link>
                    <div className="text-slate-600">{l.company}</div>
                    {l.nextFollowUp && <div className="text-xs text-slate-500">Follow up {fmtDate(l.nextFollowUp)}</div>}
                    {l.contractValue ? <div className="text-xs text-slate-500">{fmtAUD(l.contractValue)}</div> : null}
                    <form action={moveStage} className="mt-2"><input type="hidden" name="id" value={l.id} />
                      <AutoSubmitSelect name="stage" defaultValue={l.stage ?? "New"} className="input py-1 text-xs">{stages.map((x) => <option key={x}>{x}</option>)}</AutoSubmitSelect>
                    </form>
                  </div>
                ))}
              </div>
            </div>); })}
        </div>
      )}
    </div>
  );
}
