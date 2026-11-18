import type { Client } from "@prisma/client";
import { CLIENT_STATUSES, CLIENT_TYPES } from "@/lib/leases";

const F = ({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) => (
  <label className={wide ? "sm:col-span-2 lg:col-span-3" : ""}><span className="label">{label}</span>{children}</label>
);

export default function ClientForm({ client, action, submit, leadId }: { client?: Client | null; action: (fd: FormData) => Promise<void>; submit: string; leadId?: string }) {
  const v = (k: keyof Client) => (client?.[k] ?? "") as string;
  return (
    <form action={action} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {client?.id && <input type="hidden" name="id" value={client.id} />}
      {leadId && <input type="hidden" name="leadId" value={leadId} />}
      <F label="Practice / business name *"><input name="name" className="input" required defaultValue={v("name")} /></F>
      <F label="Type"><select name="type" className="input" defaultValue={v("type")}><option value="">—</option>{CLIENT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></F>
      <F label="Status"><select name="status" className="input" defaultValue={client?.status ?? "Active"}>{CLIENT_STATUSES.map((t) => <option key={t}>{t}</option>)}</select></F>
      <F label="Main contact"><input name="contactName" className="input" defaultValue={v("contactName")} /></F>
      <F label="Their role"><input name="contactRole" className="input" defaultValue={v("contactRole")} placeholder="e.g. Practice owner, Practice manager" /></F>
      <F label="Phone"><input name="phone" className="input" defaultValue={v("phone")} /></F>
      <F label="Email"><input name="email" type="email" className="input" defaultValue={v("email")} /></F>
      <F label="ABN"><input name="abn" className="input" defaultValue={v("abn")} /></F>
      <F label="Website"><input name="website" className="input" defaultValue={v("website")} /></F>
      <F label="Address"><input name="address" className="input" defaultValue={v("address")} /></F>
      <F label="Name in Xero"><input name="xeroContact" className="input" defaultValue={v("xeroContact")} /></F>
      <F label="Notes" wide><textarea name="notes" rows={3} className="input" defaultValue={v("notes")} /></F>
      <div><button className="btn px-6">{submit}</button></div>
    </form>
  );
}
