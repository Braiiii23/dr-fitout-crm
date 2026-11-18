import { METRICS } from "@/lib/myday";

/** KPI name, target, period and how it's measured. "Work it out" picks the measure from the name. */
export default function KpiFields({ k }: { k?: { name: string; target: number; period: string; source: string; unit: string | null } }) {
  return (<>
    <label className="ev-wide"><span className="label">KPI</span><input name="name" className="input" defaultValue={k?.name ?? ""} placeholder="e.g. Calls made, Quotes sent, Quotes on time, Site visits" required /></label>
    <label><span className="label">Target</span><input name="target" inputMode="decimal" className="input" defaultValue={k?.target ?? ""} placeholder="e.g. 40, or 95 for 95%" required /></label>
    <label><span className="label">Per</span><select name="period" className="input" defaultValue={k?.period ?? "week"}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></select></label>
    <label className="ev-wide"><span className="label">How it&apos;s tracked</span><select name="source" className="input" defaultValue={k ? k.source : "auto"}>
      <option value="auto">Work it out from the KPI&apos;s name</option>
      {Object.entries(METRICS).map(([key, m]) => <option key={key} value={key}>{key === "manual" ? "Logged by hand (the person adds their numbers)" : `Automatically: ${m.label}`}</option>)}
    </select></label>
    <label><span className="label">Unit (optional)</span><input name="unit" className="input" defaultValue={k?.unit ?? ""} placeholder="visits, $, or % for a percentage" /></label>
  </>);
}
