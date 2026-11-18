import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Flash, PageTitle } from "@/components/ui";
import { CLIENT_TYPES } from "@/lib/leases";
import { parseFiles, parseRooms, roomsTotal } from "@/lib/concepts";
import { importPackage } from "./actions";
import PendingButton from "@/components/PendingButton";

const EDITORS = ["ADMIN", "BDM", "PM", "ESTIMATOR"];

export default async function ConceptsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const u = await requireUser(["ADMIN", "BDM", "PM", "ESTIMATOR", "ACCOUNTS", "FOREMAN"]);
  const canEdit = EDITORS.includes(u.role);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim(); const type = CLIENT_TYPES.includes(sp.type) ? sp.type : "";
  const archived = sp.archived === "1";
  const concepts = await prisma.concept.findMany({
    where: { ...(type ? { practiceType: type } : {}), ...(archived ? {} : { status: { not: "Archived" } }), ...(q ? { OR: [{ name: { contains: q } }, { description: { contains: q } }, { tags: { contains: q } }] } : {}) },
    include: { _count: { select: { fits: true } } }, orderBy: { updatedAt: "desc" },
  });
  const href = (o: Record<string, string>) => `/concepts?${new URLSearchParams(Object.fromEntries(Object.entries({ q, type, ...(archived ? { archived: "1" } : {}), ...o }).filter(([, v]) => v)))}`;
  return (
    <div className="space-y-4">
      <PageTitle title="Concepts" sub="Our concept designs: room schedules, design intent, renders and plans. Fit any of them to a tenancy from a lease.">
        {canEdit && <Link prefetch={false} href="/concepts/new" className="btn">+ New concept</Link>}
      </PageTitle>
      <Flash msg={sp.msg} /><Flash msg={sp.err} kind="err" />
      {canEdit && (
        <form action={importPackage} className="dash-panel flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] flex-1"><h2 className="mb-0">Import a concept package</h2><p className="text-xs admin-muted">Upload the A3 concept package PDF. Claude reads the design narrative, key design moves, room schedule and finishes, and keeps the floor plan page for fitting to tenancies.</p></div>
          <label><span className="label">Package PDF</span><input type="file" name="package" accept=".pdf" required className="input" /></label>
          <PendingButton pending="Reading the package… (up to 2 minutes)">Import</PendingButton>
        </form>
      )}
      <form className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={q} placeholder="Search name, intent, tags…" className="input max-w-md" />
        {type && <input type="hidden" name="type" value={type} />}
        <button className="btn-ghost">Search</button>
        <Link prefetch={false} href={href({ archived: archived ? "" : "1" })} className="text-sm admin-muted underline">{archived ? "Hide archived" : "Show archived"}</Link>
      </form>
      <nav className="flex flex-wrap gap-2">
        <Link prefetch={false} href={href({ type: "" })} className={`lease-tab ${!type ? "is-on" : ""}`}>All types</Link>
        {CLIENT_TYPES.map((t) => <Link prefetch={false} key={t} href={href({ type: t })} className={`lease-tab ${type === t ? "is-on" : ""}`}>{t}</Link>)}
      </nav>
      {concepts.length ? (
        <div className="concept-grid">
          {concepts.map((c) => {
            const files = parseFiles(c.files); const img = files.find((f) => (f.type ?? "").startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(f.name));
            const rooms = parseRooms(c.rooms);
            return (
              <Link prefetch={false} key={c.id} href={`/concepts/${c.id}`} className="concept-card">
                <div className="concept-thumb">{/* eslint-disable-next-line @next/next/no-img-element */}{img ? <img src={`/files/${img.id}`} alt="" loading="lazy" /> : <span>{c.practiceType ?? "Concept"}</span>}</div>
                <div className="p-3">
                  <div className="flex items-start justify-between gap-2"><b>{c.name}</b>{c.status !== "Ready" && <span className="badge lease-s-enq">{c.status}</span>}</div>
                  <div className="text-xs admin-muted">{[c.practiceType, c.minSqm || c.maxSqm ? `${c.minSqm ?? "?"}–${c.maxSqm ?? "?"} m²` : "", rooms.length ? `${rooms.reduce((a, r) => a + r.qty, 0)} rooms · ${Math.round(roomsTotal(rooms))} m²` : ""].filter(Boolean).join(" · ")}</div>
                  {c.tags && <div className="mt-1 text-xs">{c.tags}</div>}
                  <div className="mt-1 text-xs admin-muted">{files.length} file{files.length === 1 ? "" : "s"} · used in {c._count.fits} fit{c._count.fits === 1 ? "" : "s"}</div>
                </div>
              </Link>
            );
          })}
        </div>
      ) : <div className="card text-sm admin-muted">{q || type ? "No concepts match." : "No concepts yet. Add your first one with its room schedule and a few images."}</div>}
    </div>
  );
}
