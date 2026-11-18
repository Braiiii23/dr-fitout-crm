import type { Lead, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  BRAND_LABEL, BRAND_SLUG, TEST_ROW, appUrl, attachmentsJson, bool, compact, dateOnly, dateTime, normBrand, num, parseAttachments, pick, str,
  type Brand,
} from "@/lib/internal-api";

export function isSignedLead(l: Pick<Lead, "stage" | "signedDate" | "cancelled" | "company" | "leadName">) {
  if (l.cancelled) return false;
  if (TEST_ROW.test(l.company || "") || TEST_ROW.test(l.leadName || "")) return false;
  return /signed/i.test(l.stage || "") || !!(l.signedDate && l.signedDate.trim());
}

export function leadOut(l: Lead & { setter?: { name: string } | null }, base = appUrl()) {
  const brand = l.brand as Brand;
  return {
    id: l.id,
    externalId: l.externalId,
    brand: l.brand,
    brandLabel: BRAND_LABEL[brand] ?? l.brand,
    leadName: l.leadName,
    company: l.company,
    stage: l.stage,
    contractValue: l.contractValue,
    signedDate: l.signedDate,
    quoteValue: l.quoteValue,
    quoteIssued: l.quoteIssued,
    notes: l.notes,
    attachments: parseAttachments(l.attachments),
    leadSource: l.leadSource,
    nextFollowUp: l.nextFollowUp,
    jobNumber: l.jobNumber,
    setterId: l.setterId,
    setterName: l.setter?.name ?? l.appointmentSetter ?? null,
    phone: l.phone,
    email: l.email,
    cancelled: l.cancelled,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
    crmUrl: `${base}/leads/${BRAND_SLUG[brand] ?? "enp"}/${l.id}`,
  };
}

/** Map an API / Airtable-ish lead payload to Prisma Lead columns. Unknown keys are ignored. */
export function mapLeadInput(o: Record<string, unknown>) {
  const p = (...k: string[]) => pick(o, ...k);
  const rawBrand = p("brand", "Brand", "business", "Business", "table");
  const brand = rawBrand === undefined ? undefined : normBrand(rawBrand);
  const data = compact({
    leadName: str(p("leadName", "Lead Name", "name", "Name")),
    company: str(p("company", "Company")),
    role: str(p("role", "Role")),
    phone: str(p("phone", "Phone")),
    email: str(p("email", "Email")),
    stage: str(p("stage", "Stage")),
    leadSource: str(p("leadSource", "Lead Source")),
    dateReceived: dateOnly(p("dateReceived", "Date Received")),
    location: str(p("location", "Location")),
    projectType: str(p("projectType", "Project Type")),
    sizeSqm: num(p("sizeSqm", "Size (sqm)", "Size sqm", "Size")),
    budget: str(p("budget", "Budget")),
    timeframe: str(p("timeframe", "Timeframe")),
    notes: str(p("notes", "Notes")),
    attachments: attachmentsJson(p("attachments", "Attachments")),
    appointmentSetter: str(p("appointmentSetter", "Appointment Setter")),
    contractValue: num(p("contractValue", "Contract Value")),
    signedDate: dateOnly(p("signedDate", "Signed Date")),
    quotedDate: dateOnly(p("quotedDate", "Quoted Date")),
    quoteIssued: bool(p("quoteIssued", "Quote Issued")),
    quoteValue: num(p("quoteValue", "Quote Value")),
    quoteIssuedDate: dateOnly(p("quoteIssuedDate", "Quote Issued Date")),
    newClient: bool(p("newClient", "New Client")),
    grossProfit: num(p("grossProfit", "Gross Profit")),
    nextFollowUp: dateOnly(p("nextFollowUp", "Next Follow Up", "Next Follow-Up")),
    jobNumber: str(p("jobNumber", "Job Number", "Job #")),
    cancelled: bool(p("cancelled", "Cancelled")),
    marketingChannel: str(p("marketingChannel", "Marketing Channel")),
    appointment: dateTime(p("appointment", "Appointment")),
  });
  return { brand, rawBrand, data, setterId: str(p("setterId")) };
}

/** Resolve setterId: explicit id (or Setter.externalId), else exact case-insensitive name match on appointmentSetter. */
export async function resolveSetterId(setterId: string | null | undefined, appointmentSetter: string | null | undefined) {
  if (setterId) {
    const s = await prisma.setter.findFirst({ where: { OR: [{ id: setterId }, { externalId: setterId }] }, select: { id: true } });
    return s?.id ?? undefined;
  }
  if (appointmentSetter) {
    const all = await prisma.setter.findMany({ select: { id: true, name: true } });
    const hit = all.find((s) => s.name.trim().toLowerCase() === appointmentSetter.trim().toLowerCase());
    return hit?.id;
  }
  return undefined;
}

export type LeadWrite = Prisma.LeadUncheckedCreateInput;
