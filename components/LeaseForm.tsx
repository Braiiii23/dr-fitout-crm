import type { Lease } from "@prisma/client";
import { LEASE_STATUSES, REVIEW_TYPES } from "@/lib/leases";

type Opt = { id: string; label: string };
const F = ({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) => (
  <label className={wide ? "sm:col-span-2 lg:col-span-3" : ""}><span className="label">{label}</span>{children}</label>
);

/** The full lease form (new and edit). */
export default function LeaseForm({ lease, clients, leads, defaults, action, submit }: {
  lease?: Lease | null; clients: Opt[]; leads: Opt[]; defaults?: { clientId?: string; leadId?: string };
  action: (fd: FormData) => Promise<void>; submit: string;
}) {
  const v = (k: keyof Lease) => (lease?.[k] ?? "") as string | number;
  return (
    <form action={action} className="space-y-4">
      {lease && <input type="hidden" name="id" value={lease.id} />}
      <section className="card">
        <h2 className="lease-h2">Premises</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <F label="Street address *"><input name="premises" className="input" required defaultValue={v("premises")} placeholder="e.g. 120 Logan Rd" /></F>
          <F label="Shop / suite / level"><input name="tenancy" className="input" defaultValue={v("tenancy")} placeholder="e.g. Suite 4, Level 1" /></F>
          <F label="Suburb"><input name="suburb" className="input" defaultValue={v("suburb")} /></F>
          <F label="Centre / building"><input name="centre" className="input" defaultValue={v("centre")} /></F>
          <F label="Size (sqm)"><input name="sizeSqm" className="input" inputMode="decimal" defaultValue={v("sizeSqm")} /></F>
          <F label="Status"><select name="status" className="input" defaultValue={(lease?.status ?? "Prospect")}>{LEASE_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></F>
          <F label="Client"><select name="clientId" className="input" defaultValue={lease?.clientId ?? defaults?.clientId ?? ""}><option value="">— none —</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></F>
          <F label="From lead"><select name="leadId" className="input" defaultValue={lease?.leadId ?? defaults?.leadId ?? ""}><option value="">— none —</option>{leads.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></F>
          <F label="Permitted use"><input name="permittedUse" className="input" defaultValue={v("permittedUse")} placeholder="e.g. Medical centre" /></F>
        </div>
      </section>
      <section className="card">
        <h2 className="lease-h2">Landlord &amp; agent</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <F label="Landlord"><input name="landlord" className="input" defaultValue={v("landlord")} /></F>
          <F label="Landlord contact"><input name="landlordContact" className="input" defaultValue={v("landlordContact")} placeholder="Name, phone or email" /></F>
          <F label="Leasing agent"><input name="leasingAgent" className="input" defaultValue={v("leasingAgent")} /></F>
          <F label="Agent contact"><input name="agentContact" className="input" defaultValue={v("agentContact")} /></F>
        </div>
      </section>
      <section className="card">
        <h2 className="lease-h2">Term &amp; key dates</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <F label="Commencement"><input type="date" name="commencementDate" className="input" defaultValue={v("commencementDate")} /></F>
          <F label="Term (years)"><input name="termYears" className="input" inputMode="decimal" defaultValue={v("termYears")} /></F>
          <F label="Expiry (blank = worked out from term)"><input type="date" name="expiryDate" className="input" defaultValue={v("expiryDate")} /></F>
          <F label="Options"><input name="options" className="input" defaultValue={v("options")} placeholder="e.g. 5 + 5" /></F>
          <F label="Option notice by"><input type="date" name="optionNoticeDate" className="input" defaultValue={v("optionNoticeDate")} /></F>
          <F label="Next rent review"><input type="date" name="nextReviewDate" className="input" defaultValue={v("nextReviewDate")} /></F>
        </div>
      </section>
      <section className="card">
        <h2 className="lease-h2">Money (ex GST)</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <F label="Base rent $ / year"><input name="rentPa" className="input" inputMode="decimal" defaultValue={v("rentPa")} /></F>
          <F label="Outgoings $ / year"><input name="outgoingsPa" className="input" inputMode="decimal" defaultValue={v("outgoingsPa")} /></F>
          <F label="Review type"><select name="reviewType" className="input" defaultValue={lease?.reviewType ?? ""}><option value="">—</option>{REVIEW_TYPES.map((s) => <option key={s}>{s}</option>)}</select></F>
          <F label="Fitout incentive $"><input name="incentive" className="input" inputMode="decimal" defaultValue={v("incentive")} /></F>
          <F label="Rent-free months"><input name="rentFreeMonths" className="input" inputMode="decimal" defaultValue={v("rentFreeMonths")} /></F>
          <F label="Make good"><input name="makeGood" className="input" defaultValue={v("makeGood")} placeholder="e.g. Return to base build" /></F>
          <F label="Notes" wide><textarea name="notes" rows={3} className="input" defaultValue={v("notes")} /></F>
        </div>
      </section>
      <button className="btn px-6">{submit}</button>
    </form>
  );
}
