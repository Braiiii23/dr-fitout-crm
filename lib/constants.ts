export const BRANDS = {
  ENP: { key: "ENP", slug: "enp", name: "ENP Fitouts", table: "ENP Leads", color: "#c8102e", accent: "#f2a900" },
  DR: { key: "DR", slug: "dr", name: "DR Fitout", table: "DR Fitout Leads", color: "#5b2a86", accent: "#a46be0" },
  CONSULTING: { key: "CONSULTING", slug: "consulting", name: "Consulting", table: "Consulting Leads", color: "#4b5563", accent: "#d1d5db" },
} as const;
export type BrandKey = keyof typeof BRANDS;
export const brandFromSlug = (s: string): BrandKey | null =>
  (Object.values(BRANDS).find((b) => b.slug === s)?.key as BrandKey) ?? null;

export const STAGES: Record<BrandKey, string[]> = {
  ENP: ["New", "Contacted", "Quoting", "Signed", "Lost", "Stay in Touch"],
  DR: ["New", "Contacted", "Potential Leases", "Quoting", "Signed", "Lost", "Stay in Touch"],
  CONSULTING: ["New", "Contacted", "Signed", "Lost", "Stay in Touch"],
};
export const LEAD_SOURCES = ["Kehoe Studio", "Researched", "Referral", "Direct enquiry", "Lead bot", "Other"];
export const MARKETING_CHANNELS = ["Website", "Instagram", "Organic", "Google", "Email"];
export const CALL_STATUSES = ["To Call", "No Answer", "Call Back", "Not Interested", "Appointment Set", "Wrong Number", "Braiden to Connect", "Quoting", "Contacted"];
/** Call List "Business" choice. Stored ENP | DR; shown as brand name. */
export const BUSINESSES = [
  { value: "ENP", label: "ENP Fitouts" },
  { value: "DR", label: "DR Fitout" },
];
export const SETTER_STATUSES = ["Active", "Inactive"];
export const ROLES = ["ADMIN", "TEAM", "SETTER", "ESTIMATOR", "ACCOUNTS"] as const;
export type Role = (typeof ROLES)[number];

export const STAGE_COLOURS: Record<string, string> = {
  New: "bg-zinc-100 text-zinc-800", Contacted: "bg-amber-100 text-amber-900", Quoting: "bg-red-50 text-red-800",
  Signed: "bg-green-100 text-green-800", Lost: "bg-gray-200 text-gray-700", "Stay in Touch": "bg-stone-100 text-stone-700",
  "Potential Leases": "bg-purple-100 text-purple-900",
};
export const CALL_STATUS_COLOURS: Record<string, string> = {
  "To Call": "bg-gray-100 text-gray-800", "No Answer": "bg-yellow-100 text-yellow-800", "Call Back": "bg-orange-100 text-orange-800",
  "Not Interested": "bg-red-100 text-red-800", "Appointment Set": "bg-green-100 text-green-800", "Wrong Number": "bg-gray-200 text-gray-600",
  "Braiden to Connect": "bg-zinc-800 text-white", Quoting: "bg-purple-100 text-purple-900", Contacted: "bg-amber-50 text-amber-900",
};

export const CONTACT_TYPES = [
  { key: "DESIGNER", label: "Designers" },
  { key: "LEASING_AGENT", label: "Leasing agents" },
  { key: "LANDLORD", label: "Landlords" },
  { key: "CLIENT", label: "Clients" },
  { key: "TRADE", label: "Trades" },
] as const;
export const CONTACT_TYPE_KEYS: string[] = CONTACT_TYPES.map((t) => t.key);
