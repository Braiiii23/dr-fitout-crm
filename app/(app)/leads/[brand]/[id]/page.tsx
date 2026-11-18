import Link from "next/link";
import { requireViewer } from "@/lib/team-view";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { BRANDS, brandFromSlug } from "@/lib/constants";
import { computeFees } from "@/lib/fees";
import { fmtAUD } from "@/lib/money";
import { fmtDateTime } from "@/lib/time";
import { Flash, PageTitle, StageBadge, StatusBadge } from "@/components/ui";
import LeadForm from "@/components/LeadForm";
import ConfirmButton from "@/components/ConfirmButton";
import { deleteLead, saveLead } from "../../actions";

export default async function LeadPage({ params, searchParams }: { params: Promise<{ brand: string; id: string }>; searchParams: Promise<Record<string, string>> }) {
  await requireViewer(["ADMIN", "BDM"]);
  const { brand: slug, id } = await params; const sp = await searchParams;
  const brand = brandFromSlug(slug); if (!brand) notFound();
  const lead = await prisma.lead.findUnique({ where: { id }, include: { calls: { include: { setter: true } }, referredByCall: true, setter: true } });
  if (!lead || lead.brand !== brand) notFound();
  const setters = await prisma.setter.findMany({ orderBy: { name: "asc" } });
  const f = computeFees(lead);
  const attachments: { url: string; filename: string; kind?: string; added?: string }[] = (() => { try { return lead.attachments ? JSON.parse(lead.attachments) : []; } catch { return []; } })();
  const row = (label: string, v: number, strong = false) => (<div className="flex justify-between py-1"><span className="text-slate-600">{label}</span><span className={strong ? "font-semibold" : ""}>{fmtAUD(v)}</span></div>);
  return (
    <div>
      <PageTitle title={lead.leadName || "(no name)"} sub={`${BRANDS[brand].table} · ${lead.company ?? ""}${lead.externalId ? ` · Airtable ${lead.externalId}` : ""}`}>
        <StageBadge stage={lead.stage} />
        <Link prefetch={false} href={`/leads/${slug}`} className="btn-ghost">← Back</Link>
      </PageTitle>
      <Flash msg={sp.saved ? "Saved. Automations applied (stage dates, setter copy)." : undefined} />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <LeadForm brand={brand} lead={lead} setters={setters} action={saveLead} />
        <aside className="space-y-4">
          {brand !== "CONSULTING" && (
            <div className="card text-sm">
              <h2 className="mb-2 font-semibold brand-text">Setter pay (calculated)</h2>
              {row("Setter Quote Fee v2", f.quoteFeeV2)}{row("Win Bonus Total", f.winBonusTotal)}{row("Bonus Earned To Date", f.bonusEarnedToDate)}
              {row("Bonus Payable Now (75%)", f.bonusPayableNow)}{row("Bonus Held Back (25%)", f.bonusHeldBack)}{row("Clawback", f.clawback)}
              <hr className="my-2" />{row(`Payable This Month (events in ${f.payMonth})`, f.payableThisMonth, true)}{row("Setter Net Earned", f.setterNetEarned, true)}
              <details className="mt-2 text-xs text-slate-500"><summary>Legacy v1 fields</summary>{row("Setter Fee", f.setterFeeLegacy)}{row("Setter Quote Fee", f.setterQuoteFeeLegacy)}{row("Setter Signed Fee", f.setterSignedFeeLegacy)}</details>
            </div>
          )}
          <div className="card text-sm">
            <h2 className="mb-2 font-semibold brand-text">Setter Call List</h2>
            {lead.calls.length ? lead.calls.map((c) => (
              <div key={c.id} className="border-t py-2 first:border-0"><Link prefetch={false} href={`/calls/${c.id}`} className="brand-text hover:underline">{c.leadName}</Link> <StatusBadge status={c.callStatus} />
                <div className="text-xs text-slate-500">{c.setter?.name ?? "Unassigned"} · {fmtDateTime(c.appointment)}</div>
                {c.possibleDuplicate && <div className="text-xs text-amber-700">⚠ {c.duplicateNote}</div>}</div>
            )) : <p className="text-slate-500">Not linked to a call-list row.</p>}
            {lead.referredByCall && <p className="mt-2 text-xs">Referred by call-list row: <Link prefetch={false} className="brand-text underline" href={`/calls/${lead.referredByCall.id}`}>{lead.referredByCall.leadName}</Link></p>}
          </div>
          {attachments.length > 0 && <div className="card text-sm"><h2 className="mb-2 font-semibold brand-text">Quotes, plans and files</h2>{attachments.map((a) => <div key={a.url}><a className="underline" href={a.url} target="_blank" rel="noreferrer">{a.filename}</a>{a.kind && a.kind !== "other" ? <span className="text-xs text-slate-500"> · {a.kind}</span> : null}{a.added ? <span className="text-xs text-slate-500"> · added {a.added}</span> : null}</div>)}</div>}
          <form action={deleteLead} className="card"><input type="hidden" name="id" value={lead.id} /><ConfirmButton className="btn-danger" message="Delete this lead permanently?">Delete lead</ConfirmButton></form>
        </aside>
      </div>
    </div>
  );
}
