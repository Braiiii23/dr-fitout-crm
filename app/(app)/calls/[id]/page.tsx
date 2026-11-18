import Link from "next/link";
import { requireViewer } from "@/lib/team-view";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { CALL_STATUSES } from "@/lib/constants";
import { fmtDateTime, toLocalInput } from "@/lib/time";
import { Flash, PageTitle, StatusBadge } from "@/components/ui";
import ConfirmButton from "@/components/ConfirmButton";
import { bookSlotAction, deleteCall, releaseSlotAction, setReferral, updateCall } from "../actions";

export default async function CallAdmin({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  await requireViewer(["ADMIN", "BDM"]);
  const { id } = await params; const sp = await searchParams;
  const c = await prisma.callListItem.findUnique({ where: { id }, include: { setter: true, lead: true, slot: true, referredLeads: true } });
  if (!c) notFound();
  const [setters, leads, slots] = await Promise.all([
    prisma.setter.findMany({ orderBy: { name: "asc" } }),
    prisma.lead.findMany({ where: { brand: c.business }, orderBy: { leadName: "asc" }, select: { id: true, leadName: true, company: true } }),
    prisma.freeSlot.findMany({ where: { status: "Free", start: { gt: new Date() } }, orderBy: { start: "asc" } }),
  ]);
  const allLeads = await prisma.lead.findMany({ where: { brand: { in: ["ENP", "DR"] } }, orderBy: { leadName: "asc" }, select: { id: true, leadName: true, company: true, brand: true, referredByCallId: true } });
  const self = `/calls/${c.id}`;
  const own = c.registeredAt && c.appointment ? (c.registeredAt < c.appointment ? "✅ Valid" : "❌ Invalid") : "—";
  const T = ({ k, label, v, type = "text" }: { k: string; label: string; v?: string | null; type?: string }) => (<div><label className="label">{label}</label><input name={k} type={type} defaultValue={v ?? ""} className="input" /></div>);
  return (
    <div className="max-w-5xl">
      <PageTitle title={c.leadName ?? "Call"} sub={`${c.company ?? ""}${c.externalId ? ` · Airtable ${c.externalId}` : ""}`}><StatusBadge status={c.callStatus} /><Link prefetch={false} href="/calls" className="btn-ghost">← Call List</Link></PageTitle>
      <Flash msg={sp.msg} /><Flash msg={sp.err} kind="err" />
      {c.possibleDuplicate && <div className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">⚠ <b>Possible duplicate.</b> {c.duplicateNote}</div>}
      <form action={updateCall} className="card mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <input type="hidden" name="id" value={c.id} /><input type="hidden" name="_back" value={self} />
        <T k="leadName" label="Lead Name" v={c.leadName} /><T k="company" label="Company" v={c.company} /><T k="phone" label="Phone" v={c.phone} />
        <T k="email" label="Email" v={c.email} type="email" />
        <div><label className="label">Business</label><select name="business" defaultValue={c.business} className="input"><option value="ENP">ENP Fitouts</option><option value="DR">DR Fitout</option></select></div>
        <div><label className="label">Setter (account)</label><select name="setterId" defaultValue={c.setterId ?? ""} className="input"><option value="">— Unassigned —</option>{setters.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><label className="label">Call Status {!c.setterId && "🔒"}</label><select name="callStatus" defaultValue={c.callStatus} className="input">{CALL_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>{!c.setterId && <p className="mt-1 text-xs text-slate-500">Locked until a setter is assigned.</p>}</div>
        <T k="attempts" label="Attempts" v={String(c.attempts)} type="number" /><T k="lastCalled" label="Last Called" v={c.lastCalled} type="date" />
        <div><label className="label">Appointment (Brisbane)</label><input name="appointment" type="datetime-local" defaultValue={toLocalInput(c.appointment)} className="input" /></div>
        <T k="assignedSetter" label="Assigned Setter (legacy text)" v={c.assignedSetter} />
        <div><label className="label">Linked {c.business === "DR" ? "DR Fitout" : "ENP"} lead</label><select name="leadId" defaultValue={c.leadId ?? ""} className="input"><option value="">— none —</option>{leads.map((l) => <option key={l.id} value={l.id}>{l.leadName} · {l.company}</option>)}</select></div>
        <div className="flex items-center gap-4 sm:col-span-2 lg:col-span-3">
          <input type="hidden" name="_has_addedToCrm" value="1" /><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="addedToCrm" defaultChecked={c.addedToCrm} /> Added to CRM</label>
          <input type="hidden" name="_has_possibleDuplicate" value="1" /><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="possibleDuplicate" defaultChecked={c.possibleDuplicate} /> Possible Duplicate</label>
          <span className="text-sm">Registered At: {fmtDateTime(c.registeredAt) || "—"} · Ownership: {own}</span>
        </div>
        <div className="sm:col-span-2 lg:col-span-3"><label className="label">Lead Info / Why call</label><textarea name="leadInfo" rows={5} defaultValue={c.leadInfo ?? ""} className="input" /></div>
        <div className="sm:col-span-2 lg:col-span-3"><label className="label">Call Notes</label><textarea name="callNotes" rows={3} defaultValue={c.callNotes ?? ""} className="input" /></div>
        <div className="sm:col-span-2 lg:col-span-3"><label className="label">Duplicate Note</label><textarea name="duplicateNote" rows={2} defaultValue={c.duplicateNote ?? ""} className="input" /></div>
        <div><button className="btn">Save (runs automations)</button></div>
      </form>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card text-sm">
          <h2 className="mb-2 font-semibold brand-text">Book a Slot</h2>
          {c.slot ? (<div className="space-y-2"><div>Booked: <b>{c.slot.label}</b></div><form action={releaseSlotAction}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="_back" value={self} /><button className="btn-ghost">Release slot</button></form></div>)
          : !c.setterId ? <p className="text-slate-500">Assign a setter first.</p> : (
            <form action={bookSlotAction} className="space-y-2"><input type="hidden" name="id" value={c.id} /><input type="hidden" name="_back" value={self} />
              <select name="slotId" className="input" required defaultValue=""><option value="" disabled>Choose…</option>{slots.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
              <label className="flex items-center gap-2"><input type="checkbox" name="setStatus" defaultChecked /> Set Call Status to Appointment Set</label><button className="btn">Book</button></form>)}
        </div>
        <div className="card text-sm">
          <h2 className="mb-2 font-semibold brand-text">Referrals from this contact</h2>
          {c.referredLeads.map((l) => <div key={l.id}>{l.leadName} · {l.company}</div>)}
          <form action={setReferral} className="mt-2 flex gap-2"><input type="hidden" name="callId" value={c.id} /><input type="hidden" name="_back" value={self} />
            <select name="leadId" className="input" required defaultValue=""><option value="" disabled>Mark a lead as referred by this contact…</option>{allLeads.filter((l) => l.referredByCallId !== c.id).map((l) => <option key={l.id} value={l.id}>{l.brand === "DR" ? "DR" : "ENP"} · {l.leadName} · {l.company}</option>)}</select><button className="btn-ghost">Link</button></form>
          <p className="mt-1 text-xs text-slate-500">If within 12 months and the lead is a New Client, the referrer&apos;s setter is copied onto the lead.</p>
        </div>
      </div>
      <form action={deleteCall} className="mt-4"><input type="hidden" name="id" value={c.id} /><ConfirmButton className="btn-danger" message="Delete this call-list row?">Delete row</ConfirmButton></form>
    </div>
  );
}
