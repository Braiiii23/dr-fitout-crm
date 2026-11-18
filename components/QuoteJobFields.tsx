import { LEAD_SOURCES } from "@/lib/constants";

type V = { brand?: string | null; company?: string | null; leadName?: string | null; phone?: string | null; email?: string | null; location?: string | null; projectType?: string | null; sizeSqm?: number | null; budget?: string | null; timeframe?: string | null; lookingFor?: string | null; sourceLink?: string | null };

/** The job details Justin (and Braiden) can add and edit on the estimating side. */
export default function QuoteJobFields({ v = {}, isNew = false }: { v?: V; isNew?: boolean }) {
  const F = ({ name, label, wide, ...rest }: { name: keyof V; label: string; wide?: boolean } & React.InputHTMLAttributes<HTMLInputElement>) => (
    <label className={wide ? "tp-wide" : undefined}><span className="label">{label}</span><input name={name} className="input" defaultValue={(v[name] as string | number | null | undefined) ?? ""} {...rest} /></label>
  );
  return (<>
    <label><span className="label">Brand</span><select name="brand" className="input" defaultValue={v.brand === "DR" ? "DR" : "ENP"}><option value="ENP">ENP Fitouts</option><option value="DR">DR Fitout</option></select></label>
    <F name="company" label="Company / business" />
    <F name="leadName" label="Contact name" />
    <F name="phone" label="Phone" inputMode="tel" />
    <F name="email" label="Email" type="email" />
    <F name="location" label="Location / site" />
    <F name="projectType" label="Project type" placeholder="e.g. Café fit-out" />
    <F name="sizeSqm" label="Size (m²)" inputMode="decimal" />
    <F name="budget" label="Budget" placeholder="e.g. $150k–$250k" />
    <F name="timeframe" label="Timeframe" />
    <F name="sourceLink" label="Plans / documents link" type="url" placeholder="https://" wide />
    <label className="tp-wide"><span className="label">What the client wants</span><textarea name="lookingFor" className="input" rows={3} defaultValue={v.lookingFor ?? ""} /></label>
    {isNew && <>
      <label><span className="label">Priority</span><select name="estPriority" className="input" defaultValue="Normal"><option>High</option><option>Normal</option><option>Low</option></select></label>
      <label><span className="label">Prelim quote due</span><input name="estPrelimDue" type="date" className="input" /></label>
      <label><span className="label">Final quote due</span><input name="estFinalDue" type="date" className="input" /></label>
      <label><span className="label">How they came to us</span><select name="leadSource" className="input" defaultValue="Direct enquiry">{LEAD_SOURCES.map((s) => <option key={s}>{s}</option>)}</select></label>
      <label className="tp-check"><input type="checkbox" name="plansReceived" /> Plans already received</label>
      <label className="tp-check"><input type="checkbox" name="allowDuplicate" /> Add anyway if the company is already in the CRM</label>
    </>}
  </>);
}
