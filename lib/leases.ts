// DR Fitout clients & leases: choices, form parsing and the key-date logic shared by the pages and the dashboard.
import type { Lease } from "@prisma/client";
import { brisbaneToday, daysDiff } from "./time";

export const CLIENT_TYPES = ["GP clinic", "Dental", "Physio", "Specialist", "Allied health", "Pharmacy", "Imaging", "Day surgery", "Vet", "Other"];
export const CLIENT_STATUSES = ["Prospect", "Active", "Past"];
export const LEASE_STATUSES = ["Prospect", "Negotiating", "Heads of agreement", "Signed", "Current", "Expired", "Lost"];
export const REVIEW_TYPES = ["Fixed 3%", "Fixed 4%", "CPI", "Market", "Other"];
/** Leases still worth watching (key dates shown on the dashboard). */
export const OPEN_LEASE = ["Prospect", "Negotiating", "Heads of agreement", "Signed", "Current"];

export const LEASE_STATUS_COLOURS: Record<string, string> = {
  Prospect: "lease-s-prospect", Negotiating: "lease-s-neg", "Heads of agreement": "lease-s-hoa",
  Signed: "lease-s-signed", Current: "lease-s-current", Expired: "lease-s-expired", Lost: "lease-s-lost",
};

const txt = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? "").trim(); return v === "" ? null : v; };
const num = (fd: FormData, k: string) => { const v = txt(fd, k); if (v == null) return null; const n = Number(v.replace(/[$,\s]/g, "")); return Number.isFinite(n) ? n : null; };
const date = (fd: FormData, k: string) => { const v = txt(fd, k); return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; };
const pick = (v: string | null, list: string[], fallback: string) => (v && list.includes(v) ? v : fallback);

export function parseClientForm(fd: FormData) {
  const name = txt(fd, "name");
  return {
    name: name ?? "Unnamed client",
    type: txt(fd, "type"), status: pick(txt(fd, "status"), CLIENT_STATUSES, "Active"),
    contactName: txt(fd, "contactName"), contactRole: txt(fd, "contactRole"), phone: txt(fd, "phone"), email: txt(fd, "email"),
    abn: txt(fd, "abn"), address: txt(fd, "address"), website: txt(fd, "website"), xeroContact: txt(fd, "xeroContact"), notes: txt(fd, "notes"),
  };
}

export function parseLeaseForm(fd: FormData) {
  return {
    clientId: txt(fd, "clientId"), leadId: txt(fd, "leadId"),
    premises: txt(fd, "premises") ?? "Address to come", tenancy: txt(fd, "tenancy"), suburb: txt(fd, "suburb"), centre: txt(fd, "centre"),
    sizeSqm: num(fd, "sizeSqm"), status: pick(txt(fd, "status"), LEASE_STATUSES, "Prospect"),
    landlord: txt(fd, "landlord"), landlordContact: txt(fd, "landlordContact"), leasingAgent: txt(fd, "leasingAgent"), agentContact: txt(fd, "agentContact"),
    commencementDate: date(fd, "commencementDate"), expiryDate: date(fd, "expiryDate"), termYears: num(fd, "termYears"), options: txt(fd, "options"),
    optionNoticeDate: date(fd, "optionNoticeDate"), rentPa: num(fd, "rentPa"), outgoingsPa: num(fd, "outgoingsPa"),
    reviewType: txt(fd, "reviewType"), nextReviewDate: date(fd, "nextReviewDate"), incentive: num(fd, "incentive"), rentFreeMonths: num(fd, "rentFreeMonths"),
    permittedUse: txt(fd, "permittedUse"), makeGood: txt(fd, "makeGood"), notes: txt(fd, "notes"),
  };
}

/** Expiry worked out from commencement + term when it wasn't typed in. */
export function expiryOf(l: Pick<Lease, "expiryDate" | "commencementDate" | "termYears">): string | null {
  if (l.expiryDate) return l.expiryDate;
  if (!l.commencementDate || !l.termYears) return null;
  const [y, m, d] = l.commencementDate.split("-").map(Number);
  const months = Math.round(l.termYears * 12);
  const end = new Date(Date.UTC(y, m - 1 + months, d - 1));
  return end.toISOString().slice(0, 10);
}

export type KeyDate = { leaseId: string; label: string; date: string; days: number; kind: "option" | "expiry" | "review" | "start" };
/** Upcoming key dates for one lease (option notice, review, expiry, commencement), soonest first. */
export function keyDates(l: Lease, today = brisbaneToday()): KeyDate[] {
  const out: KeyDate[] = [];
  const add = (label: string, d: string | null, kind: KeyDate["kind"]) => { if (d) out.push({ leaseId: l.id, label, date: d, days: daysDiff(d, today), kind }); };
  add("Option notice due", l.optionNoticeDate, "option");
  add("Rent review", l.nextReviewDate, "review");
  add("Lease expires", expiryOf(l), "expiry");
  if (l.status !== "Current") add("Commences", l.commencementDate, "start");
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** How urgent a key date is: overdue, within 90 days, within 12 months, or later. */
export const urgency = (days: number) => (days < 0 ? "is-past" : days <= 90 ? "is-soon" : days <= 365 ? "is-year" : "is-later");
export const inDays = (days: number) => (days === 0 ? "today" : days < 0 ? `${-days}d ago` : days < 60 ? `in ${days}d` : `in ${Math.round(days / 30.4)} mo`);

/** Gross occupancy cost per sqm per year. */
export const perSqm = (l: Pick<Lease, "rentPa" | "outgoingsPa" | "sizeSqm">) =>
  l.sizeSqm && (l.rentPa || l.outgoingsPa) ? ((l.rentPa ?? 0) + (l.outgoingsPa ?? 0)) / l.sizeSqm : null;
