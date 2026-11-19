import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { requireViewer } from "@/lib/team-view";
import EstimateSheet from "@/components/EstimateSheet";
import type { SheetLine } from "@/lib/estimate-sheet";

// The estimate workbook in the app (MB summary + a tab per band), like the GROK Proposal Base Template.
export default async function SheetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  await requireViewer(["ADMIN", "ESTIMATOR", "ACCOUNTS", "BDM", "PM"]);
  const { id } = await params; const sp = await searchParams;
  const viewer = await getUser();
  const job = await prisma.lead.findUnique({ where: { id }, select: { id: true, brand: true, company: true, leadName: true, location: true, sizeSqm: true, quoteValue: true, estMarginPct: true, estimateLines: { orderBy: { sortOrder: "asc" } } } });
  if (!job || (job.brand !== "DR" && job.brand !== "ENP")) notFound();
  const settings = await prisma.accountsSettings.findUnique({ where: { id: "settings" }, select: { estMarginPct: true } });
  const canEdit = !!viewer && ["ADMIN", "ESTIMATOR", "ACCOUNTS"].includes(viewer.role);
  return (
    <div className="est space-y-4" data-brand={job.brand}>
      <div className="flex flex-wrap items-center gap-3 no-print">
        <Link prefetch={false} href={`/estimating/${job.id}`} className="est-open" style={{ marginLeft: 0 }}>← Trade pack</Link>
        <Link prefetch={false} href={`/estimating/${job.id}/proposal`} className="est-open">Proposal →</Link>
        <a href={`/estimating/${job.id}/sheet/xlsx`} className="est-open">Download Excel</a>
      </div>
      <header>
        <div className="est-k">Estimate sheet</div>
        <h1 className="est-title">{job.company || job.leadName || "Job"}</h1>
        <p className="est-sub">{[job.location, job.sizeSqm ? `${job.sizeSqm} m²` : null].filter(Boolean).join(" · ")}</p>
      </header>
      {sp.msg && <div className="acc-notice" role="status">{sp.msg}</div>}
      <EstimateSheet leadId={job.id} initial={job.estimateLines as SheetLine[]} marginPct={job.estMarginPct} defaultMargin={settings?.estMarginPct ?? 35} canEdit={canEdit} quoteValue={job.quoteValue} />
    </div>
  );
}
