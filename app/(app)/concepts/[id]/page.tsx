import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Flash, PageTitle } from "@/components/ui";
import ConfirmButton from "@/components/ConfirmButton";
import ConceptForm from "@/components/ConceptForm";
import { parseFiles, parseFit, parseRooms, roomsTotal } from "@/lib/concepts";
import { fmtDateTime } from "@/lib/time";
import { deleteConcept, removeConceptFile, updateConcept } from "../actions";

const EDITORS = ["ADMIN", "BDM", "PM", "ESTIMATOR"];

export default async function ConceptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const u = await requireUser(["ADMIN", "BDM", "PM", "ESTIMATOR", "ACCOUNTS", "FOREMAN"]);
  const canEdit = EDITORS.includes(u.role);
  const { id } = await params; const sp = await searchParams;
  const c = await prisma.concept.findUnique({ where: { id }, include: { fits: { orderBy: { createdAt: "desc" }, take: 20, include: { lease: { select: { id: true, premises: true, tenancy: true } } } } } });
  if (!c) notFound();
  const files = parseFiles(c.files); const rooms = parseRooms(c.rooms);
  const isImg = (f: { name: string; type?: string }) => (f.type ?? "").startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(f.name);
  return (
    <div className="space-y-4">
      <PageTitle title={c.name} sub={[c.practiceType, c.minSqm || c.maxSqm ? `suits ${c.minSqm ?? "?"}–${c.maxSqm ?? "?"} m²` : "", c.status].filter(Boolean).join(" · ")}>
        <Link prefetch={false} href="/concepts" className="btn-ghost">← Concepts</Link>
      </PageTitle>
      <Flash msg={sp.msg} /><Flash msg={sp.err} kind="err" />
      {files.length > 0 && (
        <section className="concept-gallery">
          {files.map((f) => (
            <figure key={f.id}>
              <a href={`/files/${f.id}`} target="_blank" rel="noreferrer">{/* eslint-disable-next-line @next/next/no-img-element */}{isImg(f) ? <img src={`/files/${f.id}`} alt={f.name} loading="lazy" /> : <span className="concept-doc">PDF<br />{f.name}</span>}</a>
              <figcaption><span>{f.kind}</span>{canEdit && <form action={removeConceptFile}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="fileId" value={f.id} /><button className="text-xs admin-muted underline">remove</button></form>}</figcaption>
            </figure>
          ))}
        </section>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div>{canEdit ? <ConceptForm c={c} action={updateConcept} submit="Save concept" /> : (
          <div className="card space-y-2 text-sm">{c.description && <p className="whitespace-pre-wrap">{c.description}</p>}{c.finishes && <p className="whitespace-pre-wrap"><b>Finishes:</b> {c.finishes}</p>}</div>
        )}</div>
        <aside className="space-y-4">
          <div className="card text-sm">
            <h2 className="lease-h2">Room schedule</h2>
            {rooms.length ? <table className="table concept-rooms"><tbody>{rooms.map((r, i) => <tr key={i}><td>{r.qty} ×</td><td>{r.name}{r.notes && <div className="text-xs admin-muted">{r.notes}</div>}</td><td className="text-right">{r.areaSqm ? `${r.areaSqm} m²` : ""}</td></tr>)}</tbody></table> : <p className="admin-muted">No rooms listed yet.</p>}
            {rooms.length > 0 && <p className="mt-2 font-semibold">{Math.round(roomsTotal(rooms))} m² of rooms <span className="admin-muted font-normal">(+ circulation, usually 20–30%)</span></p>}
          </div>
          <div className="card text-sm">
            <h2 className="lease-h2">Fitted to tenancies</h2>
            {c.fits.length ? <ul className="space-y-1">{c.fits.map((f) => { const r = parseFit(f.result); return (
              <li key={f.id}><Link prefetch={false} className="brand-text underline" href={`/leases/${f.lease.id}?fit=${f.id}#concept`}>{[f.lease.tenancy, f.lease.premises].filter(Boolean).join(", ")}</Link> <span className="admin-muted">· {f.status === "error" ? "failed" : r?.verdict ?? "done"} · {fmtDateTime(f.createdAt)}</span></li>); })}</ul>
              : <p className="admin-muted">Not used yet. Open a lease and fit this concept to its floor plan.</p>}
          </div>
          {u.role === "ADMIN" && <form action={deleteConcept}><input type="hidden" name="id" value={c.id} /><ConfirmButton className="btn-danger" message="Delete this concept and its test fits?">Delete concept</ConfirmButton></form>}
        </aside>
      </div>
    </div>
  );
}
