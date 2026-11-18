import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { CALL_STATUSES } from "@/lib/constants";
import { SAFE_CALL_SELECT, canEdit } from "@/lib/calls-acl";
import { fmtDateTime } from "@/lib/time";
import { BusinessBadge, Flash, PageTitle, StatusBadge } from "@/components/ui";
import { bookSlotAction, releaseSlotAction, updateCall } from "../../calls/actions";

export default async function PortalCall({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const u = await requireUser();
  const { id } = await params; const sp = await searchParams;
  const c = await prisma.callListItem.findUnique({ where: { id }, select: { ...SAFE_CALL_SELECT, slot: { select: { id: true, label: true, start: true } } } });
  if (!c || !canEdit(u, c)) notFound(); // setters cannot even see rows that are not theirs
  await (await import("@/lib/availability")).syncAvailability();
  const slots = await prisma.freeSlot.findMany({ where: { status: "Free", start: { gt: new Date() } }, orderBy: { start: "asc" }, select: { id: true, label: true, start: true } });
  const self = `/portal/${c.id}`;
  return (
    <div className="max-w-3xl">
      <PageTitle title={c.leadName ?? "Call"} sub={c.company ?? ""}><BusinessBadge b={c.business} /><StatusBadge status={c.callStatus} /><Link prefetch={false} href={sp.back === "/team" ? "/team" : "/portal"} className="btn-ghost">← Back</Link></PageTitle>
      <Flash msg={sp.msg} /><Flash msg={sp.err} kind="err" />
      <div className="card mb-4 text-sm">
        <div className="flex flex-wrap gap-4">{c.phone && <a className="brand-text underline" href={`tel:${c.phone.replace(/\s/g, "")}`}>📞 {c.phone}</a>}{c.email && <a className="brand-text underline" href={`mailto:${c.email}`}>{c.email}</a>}</div>
        {c.leadInfo && <p className="mt-3 whitespace-pre-wrap text-slate-700">{c.leadInfo}</p>}
      </div>
      <form action={updateCall} className="card mb-4 grid gap-3 sm:grid-cols-3">
        <input type="hidden" name="id" value={c.id} /><input type="hidden" name="_back" value={self} />
        <div><label className="label">Call Status</label><select name="callStatus" defaultValue={c.callStatus} className="input">{CALL_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div><label className="label">Attempts</label><input name="attempts" type="number" min={0} defaultValue={c.attempts} className="input" /></div>
        <div><label className="label">Last Called</label><input name="lastCalled" type="date" defaultValue={c.lastCalled ?? ""} className="input" /></div>
        <div className="sm:col-span-3"><label className="label">Call Notes</label><textarea name="callNotes" rows={5} defaultValue={c.callNotes ?? ""} className="input" /></div>
        <div><button className="btn">Save</button></div>
      </form>
      <div className="card">
        <h2 className="mb-2 font-semibold brand-text">Book a slot with Braiden</h2>
        {c.slot ? (
          <div className="flex flex-wrap items-center gap-3 text-sm"><span>Booked: <b>{c.slot.label}</b> ({fmtDateTime(c.slot.start)})</span>
            <form action={releaseSlotAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="_back" value={self} /><button className="btn-ghost text-xs">Release slot</button></form></div>
        ) : (
          <form action={bookSlotAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={c.id} /><input type="hidden" name="_back" value={self} />
            <div className="min-w-64 flex-1"><label className="label">Free slots (Brisbane time)</label>
              <select name="slotId" className="input" required defaultValue=""><option value="" disabled>Choose a time…</option>{slots.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="setStatus" defaultChecked /> Set Call Status to Appointment Set</label>
            <button className="btn">Book</button>
          </form>
        )}
        {!slots.length && !c.slot && <p className="mt-2 text-sm text-slate-500">No free slots right now — ask Braiden to add more.</p>}
        {c.appointment && <p className="mt-2 text-sm">Appointment: <b>{fmtDateTime(c.appointment)}</b></p>}
      </div>
    </div>
  );
}
