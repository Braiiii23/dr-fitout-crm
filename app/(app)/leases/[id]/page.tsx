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
import { LEASE_STATUS_COLOURS, expiryOf, inDays, keyDates, perSqm, stageOf, urgency } from "@/lib/leases";
import { chooseFit, deleteLease, removeLeaseFile, runFit, setLeaseClient, setLeaseConcept, setLeaseFileKind, updateLease, uploadLeaseFiles } from "../actions";
import { AutoSubmitSelect } from "@/components/AutoSubmit";
import PendingButton from "@/components/PendingButton";
import FitPlan from "@/components/FitPlan";
import { LEASE_FILE_KINDS, parseFiles, parseFit, parseRooms, roomsTotal } from "@/lib/concepts";
import { fmtDateTime } from "@/lib/time";
import { aiConfig } from "@/lib/ai";

const EDITORS = ["ADMIN", "BDM", "PM", "ACCOUNTS"];

export default async function LeasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const u = await requireViewer(["ADMIN", "BDM", "PM", "ACCOUNTS"]);
  const canEdit = EDITORS.includes(u.role);
  const { id } = await params; const sp = await searchParams;
  const lease = await prisma.lease.findUnique({ where: { id }, include: { client: true, concept: { select: { id: true, name: true, practiceType: true } }, lead: { select: { id: true, leadName: true, company: true, stage: true } } } });
  if (!lease) notFound();
  lease.status = stageOf(lease.status);
  const { clients, leads } = await leaseOptions();
  const files = parseFiles(lease.files);
  const floorPlan = files.find((f) => f.kind === "floor plan");
  const [concepts, fits] = await Promise.all([
    prisma.concept.findMany({ where: { status: { not: "Archived" } }, orderBy: { name: "asc" }, select: { id: true, name: true, practiceType: true, minSqm: true, maxSqm: true, rooms: true } }),
    prisma.conceptFit.findMany({ where: { leaseId: id }, orderBy: { createdAt: "desc" }, include: { concept: { select: { id: true, name: true } } } }),
  ]);
  const shown = fits.find((f) => f.id === sp.fit) ?? fits.find((f) => f.chosen) ?? fits[0];
  const shownR = shown ? parseFit(shown.result) : null;
  const aiReady = !!aiConfig();
  // Concepts that suit this size come first.
  const suits = (c: { minSqm: number | null; maxSqm: number | null }) => !lease.sizeSqm || ((c.minSqm ?? 0) <= lease.sizeSqm && lease.sizeSqm <= (c.maxSqm ?? Infinity));
  const conceptOpts = [...concepts].sort((a, b) => Number(suits(b)) - Number(suits(a)));
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
      <Flash msg={sp.msg} /><Flash msg={sp.err} kind="err" />
      <section id="concept" className={`dash-panel mb-4 ${lease.status === "Concept proposing" ? "concept-panel-on" : ""}`}>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div><h2 className="mb-0">Concept design</h2><p className="text-xs admin-muted">Pick one of our concepts and the AI fits it to this tenancy&apos;s floor plan: a test-fit layout, room schedule and what to check. A starting point for the designer, not a drawing to build from.</p></div>
          {fits.length > 1 && <nav className="flex flex-wrap gap-1">{fits.map((f, i) => <Link prefetch={false} key={f.id} href={`/leases/${lease.id}?fit=${f.id}#concept`} className={`lease-tab ${shown?.id === f.id ? "is-on" : ""}`}>{f.chosen ? "★ " : ""}{f.concept.name} <span>{fits.length - i}</span></Link>)}</nav>}
        </div>
        {canEdit && (
          !floorPlan ? <p className="text-sm">First upload the tenancy floor plan in <a href="#files" className="brand-text underline">Files</a> below (PDF, PNG or JPG) and set it as “floor plan”.</p>
          : !concepts.length ? <p className="text-sm">No concepts yet. <Link prefetch={false} className="brand-text underline" href="/concepts/new">Add a concept</Link> first.</p>
          : (
            <form action={runFit} className="concept-run">
              <input type="hidden" name="id" value={lease.id} />
              <label><span className="label">Concept</span><select name="conceptId" className="input" required defaultValue={lease.conceptId ?? ""}>
                <option value="" disabled>Choose a concept…</option>
                {conceptOpts.map((c) => { const r = parseRooms(c.rooms); return <option key={c.id} value={c.id}>{c.name}{c.practiceType ? ` · ${c.practiceType}` : ""}{c.minSqm || c.maxSqm ? ` · ${c.minSqm ?? "?"}–${c.maxSqm ?? "?"} m²` : ""}{r.length ? ` · ${Math.round(roomsTotal(r))} m² rooms` : ""}{suits(c) ? "" : " (size outside its range)"}</option>; })}
              </select></label>
              <label><span className="label">Anything to change? (optional)</span><input name="brief" className="input" placeholder="e.g. 5 consult rooms not 6, add a procedure room, keep the existing kitchenette" /></label>
              <div className="self-end"><PendingButton pending="Designing… (up to a minute)">{fits.length ? "Fit another concept" : "Fit concept to this tenancy"}</PendingButton></div>
              <p className="text-xs admin-muted sm:col-span-3">Uses floor plan: <a className="underline" href={`/files/${floorPlan.id}`} target="_blank" rel="noreferrer">{floorPlan.name}</a>.{lease.status === "Enquiring" ? " The lease moves to Concept proposing." : ""}{aiReady ? "" : " ⚠ Claude isn't set up yet: add ANTHROPIC_API_KEY on the server."}</p>
            </form>
          )
        )}
        {shown && (shown.status === "error" ? <p className="mt-3 text-sm acc-bad-text">That fit didn&apos;t work: {shown.error}</p> : shownR && (
          <div className="concept-result mt-4">
            <div>
              <FitPlan r={shownR} />
              {floorPlan && <p className="mt-2 text-xs admin-muted">Compare with the <a className="underline" href={`/files/${floorPlan.id}`} target="_blank" rel="noreferrer">original floor plan</a>.</p>}
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`badge ${shownR.verdict === "Fits" ? "lease-s-sign" : shownR.verdict === "Tight" ? "lease-s-concept" : "fit-bad"}`}>{shownR.verdict ?? "Test fit"}</span>
                <b>{shown.concept.name}</b>{shown.chosen && <span className="badge lease-s-sign">★ Proposing</span>}
                <span className="text-xs admin-muted">{fmtDateTime(shown.createdAt)} · {shown.createdBy}</span>
              </div>
              {shownR.summary && <p>{shownR.summary}</p>}
              <div className="acc-line"><span>Tenancy (as read by the AI)</span><b>{shownR.tenancy?.areaSqm ? `${shownR.tenancy.areaSqm} m²` : "?"}{shownR.tenancy?.widthM ? ` · ${shownR.tenancy.widthM} × ${shownR.tenancy.depthM} m` : ""}</b></div>
              <div className="acc-line"><span>Rooms / circulation</span><b>{shownR.usedSqm ? `${Math.round(shownR.usedSqm)} m²` : "?"}{shownR.circulationPct != null ? ` · ${Math.round(shownR.circulationPct)}% circulation` : ""}</b></div>
              {shown.brief && <p className="text-xs admin-muted">Asked for: {shown.brief}</p>}
              {[["What changed from the concept", shownR.changes], ["Check before going further", shownR.checks], ["Assumptions", shownR.assumptions]].map(([h, list]) => (list as string[] | undefined)?.length ? (
                <div key={h as string}><h3 className="lease-h2 mb-1">{h as string}</h3><ul className="list-disc space-y-0.5 pl-5">{(list as string[]).map((x, i) => <li key={i}>{x}</li>)}</ul></div>) : null)}
              {shownR.schedule?.length ? <details><summary className="cursor-pointer font-semibold">Room schedule ({shownR.schedule.length})</summary><table className="table mt-2"><tbody>{shownR.schedule.map((r, i) => <tr key={i}><td>{r.qty ?? 1} ×</td><td>{r.name}{r.vsConcept && <div className="text-xs admin-muted">{r.vsConcept}</div>}</td><td className="text-right">{r.areaSqm ? `${r.areaSqm} m²` : ""}</td></tr>)}</tbody></table></details> : null}
              {canEdit && !shown.chosen && <form action={chooseFit}><input type="hidden" name="id" value={lease.id} /><input type="hidden" name="fitId" value={shown.id} /><button className="btn-ghost">★ Use this one for the proposal</button></form>}
            </div>
          </div>
        ))}
      </section>

      <section id="files" className="dash-panel mb-4">
        <h2 className="mb-2">Files</h2>
        {files.length ? <ul className="admin-divide divide-y text-sm">{files.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span><a href={`/files/${f.id}`} target="_blank" rel="noreferrer" className="brand-text underline">{f.name}</a> <span className="admin-muted text-xs">· added {f.added}</span></span>
            {canEdit ? <span className="flex items-center gap-2">
              <form action={setLeaseFileKind}><input type="hidden" name="id" value={lease.id} /><input type="hidden" name="fileId" value={f.id} /><AutoSubmitSelect name="kind" defaultValue={f.kind} className="input lease-client-select" aria-label="File kind">{LEASE_FILE_KINDS.map((k) => <option key={k}>{k}</option>)}</AutoSubmitSelect></form>
              <form action={removeLeaseFile}><input type="hidden" name="id" value={lease.id} /><input type="hidden" name="fileId" value={f.id} /><button className="text-xs admin-muted underline">remove</button></form>
            </span> : <span className="badge lease-s-enq">{f.kind}</span>}
          </li>))}</ul> : <p className="text-sm admin-muted">No files yet.</p>}
        {canEdit && (
          <form action={uploadLeaseFiles} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={lease.id} />
            <label><span className="label">Upload</span><input type="file" name="files" multiple required accept=".pdf,.png,.jpg,.jpeg,.webp,.dwg,.dxf,.docx" className="input" /></label>
            <label><span className="label">What is it?</span><select name="kind" className="input" defaultValue={floorPlan ? "lease" : "floor plan"}>{LEASE_FILE_KINDS.map((k) => <option key={k}>{k}</option>)}</select></label>
            <PendingButton pending="Uploading…" className="btn-ghost">Upload</PendingButton>
          </form>
        )}
      </section>

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
            <h2 className="lease-h2">Concept</h2>
            {lease.concept ? <p><Link prefetch={false} className="brand-text underline" href={`/concepts/${lease.concept.id}`}>{lease.concept.name}</Link>{lease.concept.practiceType && <span className="admin-muted"> · {lease.concept.practiceType}</span>}</p> : <p className="admin-muted">No concept linked yet.</p>}
            {canEdit && (
              <form action={setLeaseConcept} className="mt-2 space-y-2">
                <input type="hidden" name="id" value={lease.id} /><input type="hidden" name="_back" value={`/leases/${lease.id}`} />
                <select name="conceptId" className="input" defaultValue={lease.conceptId ?? ""} aria-label="Concept"><option value="">— no concept —</option>{concepts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                <button className="btn-ghost w-full justify-center">{lease.conceptId ? "Change concept" : "Link concept"}</button>
              </form>
            )}
            <p className="mt-2 text-xs admin-muted">Starring an AI fit (★ Use this one) links its concept too.</p>
          </div>
          <div className="card text-sm">
            <h2 className="lease-h2">Linked</h2>
            {lease.client ? <p>Client: <Link prefetch={false} className="brand-text underline" href={`/clients/${lease.client.id}`}>{lease.client.name}</Link></p> : <p className="admin-muted">No client linked.</p>}
            {canEdit && (
              <form action={setLeaseClient} className="mt-2 space-y-2">
                <input type="hidden" name="id" value={lease.id} /><input type="hidden" name="_back" value={`/leases/${lease.id}`} />
                <select name="clientId" className="input" defaultValue={lease.clientId ?? ""} aria-label="Client"><option value="">— no client —</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
                <input name="newClientName" className="input" placeholder="…or type a new client name" />
                <button className="btn-ghost w-full justify-center">{lease.clientId ? "Change client" : "Link client"}</button>
              </form>
            )}
            {lease.lead ? <p className="mt-1">Lead: <Link prefetch={false} className="brand-text underline" href={`/leads/dr/${lease.lead.id}`}>{lease.lead.company || lease.lead.leadName}</Link> <span className="admin-muted">· {lease.lead.stage}</span></p> : <p className="admin-muted mt-1">No lead linked.</p>}
          </div>
          {u.role === "ADMIN" && <form action={deleteLease} className="card"><input type="hidden" name="id" value={lease.id} /><ConfirmButton className="btn-danger" message="Delete this lease permanently?">Delete lease</ConfirmButton></form>}
        </aside>
      </div>
    </div>
  );
}
