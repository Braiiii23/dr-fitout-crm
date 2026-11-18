import type { Concept } from "@prisma/client";
import { CONCEPT_FILE_KINDS, CONCEPT_STATUSES, parseRooms, roomsToText } from "@/lib/concepts";
import { CLIENT_TYPES } from "@/lib/leases";

const F = ({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) => (
  <label className={wide ? "sm:col-span-2 lg:col-span-3" : ""}><span className="label">{label}</span>{children}</label>
);

export default function ConceptForm({ c, action, submit }: { c?: Concept | null; action: (fd: FormData) => Promise<void>; submit: string }) {
  const v = (k: keyof Concept) => (c?.[k] ?? "") as string | number;
  return (
    <form action={action} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {c && <input type="hidden" name="id" value={c.id} />}
      <F label="Concept name *"><input name="name" className="input" required defaultValue={v("name")} placeholder="e.g. 6-room GP · warm timber" /></F>
      <F label="Practice type"><select name="practiceType" className="input" defaultValue={v("practiceType")}><option value="">—</option>{CLIENT_TYPES.map((t) => <option key={t}>{t}</option>)}</select></F>
      <F label="Status"><select name="status" className="input" defaultValue={c?.status ?? "Ready"}>{CONCEPT_STATUSES.map((t) => <option key={t}>{t}</option>)}</select></F>
      <F label="Suits from (sqm)"><input name="minSqm" className="input" inputMode="decimal" defaultValue={v("minSqm")} /></F>
      <F label="Suits up to (sqm)"><input name="maxSqm" className="input" inputMode="decimal" defaultValue={v("maxSqm")} /></F>
      <F label="Tags"><input name="tags" className="input" defaultValue={v("tags")} placeholder="e.g. timber, skin clinic, corner tenancy" /></F>
      <F label="Design intent: how the plan works, look and feel" wide><textarea name="description" rows={4} className="input" defaultValue={v("description")} placeholder="e.g. Reception faces the entry with a curved timber desk; consult rooms run down one side with natural light; treatment and sterilising share a wet wall…" /></F>
      <F label="Room schedule (one per line: 6 x Consult room 12 sqm - notes)" wide><textarea name="roomsText" rows={8} className="input font-mono text-sm" defaultValue={roomsToText(parseRooms(c?.rooms))} placeholder={"1 x Reception 10 sqm\n1 x Waiting 25 sqm - 12 seats\n6 x Consult room 12 sqm\n1 x Treatment room 16 sqm - 2 beds\n1 x Sterilising 6 sqm\n1 x Accessible WC 5.5 sqm\n1 x Staff room 12 sqm"} /></F>
      <F label="Finishes" wide><textarea name="finishes" rows={2} className="input" defaultValue={v("finishes")} placeholder="Joinery, flooring, lighting, colours…" /></F>
      <F label="Add images or plans (PDF, PNG, JPG)"><input type="file" name="files" multiple accept=".pdf,.png,.jpg,.jpeg,.webp" className="input" /></F>
      <F label="These files are"><select name="fileKind" className="input" defaultValue="image">{CONCEPT_FILE_KINDS.map((k) => <option key={k} value={k}>{k === "plan" ? "plan (used by the AI)" : k}</option>)}</select></F>
      <div className="self-end"><button className="btn px-6">{submit}</button></div>
    </form>
  );
}
