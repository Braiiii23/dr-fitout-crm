// The estimate sheet: rows per band, the MB-style summary, and keeping the trade pack in step.
import { BANDS, AT_COST_BANDS, DEFAULT_MARGIN_PCT, AI_EST } from "./estimating";

export const SOURCES = ["JUSTIN", "QUOTE", "PAST JOB", "XERO", "ESTIMATE"] as const;
export type SheetLine = { id?: string; band: string; item: string; clientText: string | null; qty: number; unit: string | null; supplyRate: number; installRate: number; source: string; sourceNote: string | null; provisional: boolean; sortOrder: number };

/** Round up to the next 10 cents (ENP rule). */
export const up10c = (n: number) => Math.ceil(Math.round(n * 1000) / 100) / 10;
export const lineCost = (l: Pick<SheetLine, "qty" | "supplyRate" | "installRate">) => (Number(l.qty) || 0) * ((Number(l.supplyRate) || 0) + (Number(l.installRate) || 0));
export const atCost = (band: string) => AT_COST_BANDS.includes(band);

/** Band totals like the MB tab: cost, margin, sell (rounded up to 10c), effective margin. */
export function summarise(lines: SheetLine[], marginPct: number = DEFAULT_MARGIN_PCT) {
  const bandNames = [...BANDS, ...[...new Set(lines.map((l) => l.band))].filter((b) => !BANDS.includes(b))];
  const bands = bandNames.map((band) => {
    const ls = lines.filter((l) => l.band === band);
    const cost = ls.reduce((s, l) => s + lineCost(l), 0);
    const margin = atCost(band) ? 0 : cost * marginPct / 100;
    const sell = up10c(cost + margin);
    return { band, lines: ls.length, cost, margin, sell, atCost: atCost(band), provisional: ls.length > 0 && ls.every((l) => l.provisional), estimateLines: ls.filter((l) => l.source === "ESTIMATE").length };
  }).filter((b) => b.lines > 0);
  const cost = bands.reduce((s, b) => s + b.cost, 0);
  const sell = Math.round(bands.reduce((s, b) => s + b.sell, 0) * 100) / 100;
  const gst = Math.round(sell * 10) / 100;
  return { bands, cost, sell, margin: sell - cost, marginPct, effectivePct: cost > 0 ? (sell - cost) / cost * 100 : 0, gpPct: sell > 0 ? (sell - cost) / sell * 100 : 0, gst, total: Math.round((sell + gst) * 100) / 100 };
}

export type ProposalInfo = {
  title?: string; businessName?: string; contact?: string; email?: string; abn?: string; businessAddress?: string; projectAddress?: string;
  salesContact?: string; dateIssued?: string; expiry?: string; exclusions?: string[]; assumptions?: string[]; notes?: string;
};
export const parseProposal = (s?: string | null): ProposalInfo => { try { const v = s ? JSON.parse(s) : {}; return v && typeof v === "object" ? v : {}; } catch { return {}; } };

export const PAYMENT_TERMS = "A 30% deposit is required on acceptance of this quotation. A 30% progress payment is due as works progress, a further 35% progress payment is due at DR Fitout's discretion, and the remaining 5% is due on completion. No retention. Invoices are payable within 7 days. If a progress payment is not made, works on site will stop until the outstanding sum has been paid. A payment schedule will be sent in line with the works programme.";
export const STANDARD_EXCLUSIONS = [
  "Furniture, equipment and appliances unless listed above",
  "Authority fees and charges unless listed above",
  "Works outside normal hours (weekdays 6:30am to 3:30pm) unless listed above",
  "Rectification of existing building defects or non-compliant base-build services",
  "Asbestos or hazardous material removal",
  "Variations after set-out are charged at $500 per variation plus the cost of the work",
  "This quotation is valid for 7 days",
];
export { AI_EST };
