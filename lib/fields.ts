// Field metadata drives the lead forms and grids — add/rename fields here (plus prisma/schema.prisma) to customise.
import { LEAD_SOURCES, MARKETING_CHANNELS, STAGES, type BrandKey } from "./constants";

export type FieldType = "text" | "textarea" | "number" | "int" | "money" | "date" | "datetime" | "checkbox" | "select" | "url" | "email" | "phone" | "setter";
export type FieldDef = { key: string; label: string; type: FieldType; options?: string[] | ((b: BrandKey) => string[]); brands?: BrandKey[]; financial?: boolean; help?: string };
export type FieldGroup = { title: string; brands?: BrandKey[]; financial?: boolean; fields: FieldDef[] };

const PIPE: BrandKey[] = ["ENP", "DR"];
export const LEAD_GROUPS: FieldGroup[] = [
  { title: "Contact", fields: [
    { key: "leadName", label: "Lead Name", type: "text" }, { key: "company", label: "Company", type: "text" },
    { key: "role", label: "Role", type: "text" }, { key: "phone", label: "Phone", type: "phone" }, { key: "email", label: "Email", type: "email" },
  ] },
  { title: "Pipeline", fields: [
    { key: "stage", label: "Stage", type: "select", options: (b) => STAGES[b] },
    { key: "leadSource", label: "Lead Source", type: "select", options: LEAD_SOURCES },
    { key: "marketingChannel", label: "Marketing Channel", type: "select", options: MARKETING_CHANNELS },
    { key: "dateReceived", label: "Date Received", type: "date" }, { key: "lastContacted", label: "Last Contacted", type: "date" },
    { key: "nextFollowUp", label: "Next Follow-up", type: "date" }, { key: "appointment", label: "Appointment", type: "datetime" },
    { key: "appointmentHeld", label: "Appointment Held", type: "checkbox", brands: PIPE },
    { key: "braidenWillQuote", label: "Braiden Will Quote", type: "checkbox", brands: PIPE },
    { key: "quotedDate", label: "Quoted Date", type: "date", brands: PIPE }, { key: "signedDate", label: "Signed Date", type: "date", brands: PIPE },
    { key: "jobNumber", label: "Job Number (Buildertrend/Procore)", type: "text", brands: PIPE },
  ] },
  { title: "Project", fields: [
    { key: "location", label: "Location / Site Address", type: "text" }, { key: "projectType", label: "Project Type", type: "text" },
    { key: "sizeSqm", label: "Size (sqm)", type: "number" }, { key: "budget", label: "Budget", type: "text", financial: true },
    { key: "timeframe", label: "Timeframe", type: "text" }, { key: "tenancyStatus", label: "Tenancy Status", type: "text" },
    { key: "lookingFor", label: "What They're Looking For", type: "textarea" }, { key: "sourceLink", label: "Source Link", type: "url" },
    { key: "potentialLeases", label: "Potential Leases", type: "textarea", brands: ["DR"] },
  ] },
  { title: "Money", financial: true, fields: [
    { key: "contractValue", label: "Contract Value (ex GST)", type: "money" },
    { key: "grossProfit", label: "Gross Profit", type: "money", brands: PIPE },
    { key: "quoteIssued", label: "Quote Issued", type: "checkbox", brands: PIPE },
    { key: "quoteValue", label: "Quote Value ex GST", type: "money", brands: PIPE },
    { key: "quoteIssuedDate", label: "Quote Issued Date", type: "date", brands: PIPE },
  ] },
  { title: "Setter pay", brands: PIPE, financial: true, fields: [
    { key: "setterId", label: "Setter", type: "setter" },
    { key: "appointmentSetter", label: "Appointment Setter (legacy text)", type: "text" },
    { key: "newClient", label: "New Client", type: "checkbox", help: "Required for the $150 quote fee" },
    { key: "quotedSetter150", label: "Quoted (Setter $150) — legacy", type: "checkbox" },
    { key: "depositClearedDate", label: "Deposit Cleared Date", type: "date" },
    { key: "claim50PaidDate", label: "50% Claim Paid Date", type: "date", help: "$500k+ jobs: second bonus tranche" },
    { key: "setterWinNo", label: "Setter Win #", type: "int", help: "7th win onwards pays 7.5%" },
    { key: "holdbackReleasedDate", label: "Holdback Released Date", type: "date" },
    { key: "cancelled", label: "Cancelled", type: "checkbox" }, { key: "cancelledDate", label: "Cancelled Date", type: "date" },
    { key: "setterFeePaid", label: "Setter Fee Paid", type: "checkbox" },
  ] },
  { title: "Notes", fields: [{ key: "notes", label: "My Notes", type: "textarea" }] },
];

export const fieldsFor = (brand: BrandKey) =>
  LEAD_GROUPS.filter((g) => !g.brands || g.brands.includes(brand))
    .map((g) => ({ ...g, fields: g.fields.filter((f) => !f.brands || f.brands.includes(brand)) }))
    .filter((g) => g.fields.length);

/** Convert submitted FormData into a Prisma update object using the field metadata. */
export function parseLeadForm(fd: FormData, brand: BrandKey, fromLocalInput: (v: string) => Date | null) {
  const out: Record<string, unknown> = {};
  for (const g of fieldsFor(brand)) for (const f of g.fields) {
    const raw = fd.get(f.key);
    if (f.type === "checkbox") { out[f.key] = raw === "on"; continue; }
    if (raw === null) continue;
    const v = String(raw).trim();
    switch (f.type) {
      case "number": case "money": out[f.key] = v === "" ? null : Number(v.replace(/[$,\s]/g, "")); break;
      case "int": out[f.key] = v === "" ? null : parseInt(v, 10); break;
      case "datetime": out[f.key] = fromLocalInput(v); break;
      case "setter": out[f.key] = v === "" ? null : v; break;
      default: out[f.key] = v === "" ? null : v;
    }
  }
  return out;
}
