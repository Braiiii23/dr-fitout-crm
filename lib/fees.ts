// Setter fee engine — identical for ENP and DR. Ported 1:1 from the Airtable formulas
// (see leadardo-export/schema.json). Pure functions so they are easy to test.
import { currentBrisbaneMonth, daysDiff, previousBrisbaneMonth } from "./time";
import { round2 } from "./money";

export type FeeInput = {
  setterId?: string | null;
  quoteIssued?: boolean; quoteValue?: number | null; quoteIssuedDate?: string | null; newClient?: boolean;
  grossProfit?: number | null; contractValue?: number | null; setterWinNo?: number | null;
  depositClearedDate?: string | null; claim50PaidDate?: string | null; holdbackReleasedDate?: string | null;
  cancelled?: boolean; cancelledDate?: string | null;
  // legacy v1
  appointmentSetter?: string | null; quotedSetter150?: boolean; stage?: string | null;
};
export type Fees = {
  setterFeeLegacy: number; setterQuoteFeeLegacy: number; setterSignedFeeLegacy: number;
  quoteFeeV2: number; winBonusTotal: number; bonusEarnedToDate: number; bonusPayableNow: number;
  bonusHeldBack: number; clawback: number; payableThisMonth: number; setterNetEarned: number;
  payMonth: string; withinClawbackWindow: boolean;
};

const ym = (d?: string | null) => (d ? d.slice(0, 7) : "");

/** Sum fee events (quote / deposit / claim50 / holdback / clawback) dated in a Brisbane YYYY-MM. */
function feeEventsInMonth(
  l: FeeInput,
  month: string,
  parts: { quoteFeeV2: number; winBonusTotal: number; bonusEarnedToDate: number; clawback: number; big: boolean },
): number {
  let n = 0;
  if (ym(l.quoteIssuedDate) === month) n += parts.quoteFeeV2;
  if (ym(l.depositClearedDate) === month) n += round2(parts.winBonusTotal * (parts.big ? 0.5 : 1) * 0.75);
  if (ym(l.claim50PaidDate) === month) n += parts.big ? round2(parts.winBonusTotal * 0.375) : 0;
  if (ym(l.holdbackReleasedDate) === month) n += parts.clawback < 0 ? 0 : round2(parts.bonusEarnedToDate * 0.25);
  if (ym(l.cancelledDate) === month) n += parts.clawback;
  return round2(n);
}

export function computeFees(l: FeeInput, now: Date = new Date()): Fees {
  const hasSetter = !!l.setterId;
  const gp = l.grossProfit ?? 0;
  const cv = l.contractValue ?? 0;
  const big = cv >= 500000;

  // Legacy v1 fields (kept for parity)
  const setterQuoteFeeLegacy = l.appointmentSetter && l.quotedSetter150 ? 150 : 0;
  const setterSignedFeeLegacy = l.appointmentSetter && l.stage === "Signed" ? Math.round(gp * 0.06) : 0;
  const setterFeeLegacy = l.appointmentSetter ? (l.quotedSetter150 ? 150 : 0) + (l.stage === "Signed" ? Math.round(gp * 0.06) : 0) : 0;

  // Setter Quote Fee v2
  const quoteFeeV2 = l.quoteIssued && (l.quoteValue ?? 0) >= 25000 && l.newClient && hasSetter ? 150 : 0;

  // Win Bonus Total: 6% GP (7.5% when Setter Win # > 6), min $500, max $15k
  const winBonusTotal = hasSetter && l.depositClearedDate && gp > 0
    ? Math.min(15000, Math.max(500, gp * ((l.setterWinNo ?? 0) > 6 ? 0.075 : 0.06))) : 0;

  // $500k+ jobs: 50% at deposit, remaining 50% once 50% Claim Paid Date set
  const bonusEarnedToDate = big ? winBonusTotal * (l.claim50PaidDate ? 1 : 0.5) : winBonusTotal;
  const bonusPayableNow = round2(bonusEarnedToDate * 0.75);

  const withinClawbackWindow = !!(l.cancelled && l.cancelledDate && l.depositClearedDate && daysDiff(l.cancelledDate, l.depositClearedDate) <= 90);
  const bonusHeldBack = l.holdbackReleasedDate || withinClawbackWindow ? 0 : round2(bonusEarnedToDate * 0.25);
  const clawback = withinClawbackWindow ? -round2(bonusEarnedToDate * (l.holdbackReleasedDate ? 1 : 0.75)) : 0;

  // Payable This Month = events dated in the PREVIOUS calendar month (Brisbane)
  const pm = previousBrisbaneMonth(now);
  const parts = { quoteFeeV2, winBonusTotal, bonusEarnedToDate, clawback, big };
  const payableThisMonth = feeEventsInMonth(l, pm, parts);

  const setterNetEarned = round2(quoteFeeV2 + bonusPayableNow + (l.holdbackReleasedDate ? round2(bonusEarnedToDate * 0.25) : 0) + clawback);

  return { setterFeeLegacy, setterQuoteFeeLegacy, setterSignedFeeLegacy, quoteFeeV2, winBonusTotal: round2(winBonusTotal),
    bonusEarnedToDate: round2(bonusEarnedToDate), bonusPayableNow, bonusHeldBack, clawback, payableThisMonth, setterNetEarned, payMonth: pm, withinClawbackWindow };
}

export type SetterLeadLite = FeeInput & { brand: string; appointmentHeld?: boolean; setterFeePaid?: boolean };
/** Setters table rollups (Wins, Appts Held, Paid Quotes, Owed This Month, Held Back, Earned, Paid, Outstanding, Win Rate). */
export function setterRollups(leads: SetterLeadLite[], now: Date = new Date()) {
  const r = { winsENP: 0, winsDR: 0, apptsENP: 0, apptsDR: 0, paidQuotesENP: 0, paidQuotesDR: 0, owedENP: 0, owedDR: 0, heldENP: 0, heldDR: 0, earnedENP: 0, earnedDR: 0, paidENP: 0, paidDR: 0 };
  for (const l of leads) {
    if (l.brand !== "ENP" && l.brand !== "DR") continue;
    const k = l.brand as "ENP" | "DR";
    const f = computeFees(l, now);
    if (l.depositClearedDate) r[`wins${k}`]++;
    if (l.appointmentHeld) r[`appts${k}`]++;
    if (f.quoteFeeV2 > 0) r[`paidQuotes${k}`]++;
    r[`owed${k}`] += f.payableThisMonth;
    r[`held${k}`] += f.bonusHeldBack;
    r[`earned${k}`] += f.setterNetEarned;
    if (l.setterFeePaid) r[`paid${k}`] += f.setterNetEarned;
  }
  const totalWins = r.winsENP + r.winsDR, totalAppts = r.apptsENP + r.apptsDR;
  const totalEarned = round2(r.earnedENP + r.earnedDR), totalPaid = round2(r.paidENP + r.paidDR);
  return { ...r, totalWins, totalAppts, totalPaidQuotes: r.paidQuotesENP + r.paidQuotesDR,
    owedThisMonth: round2(r.owedENP + r.owedDR), totalHeldBack: round2(r.heldENP + r.heldDR), totalEarned, totalPaid,
    outstanding: round2(totalEarned - totalPaid), winRate: totalAppts > 0 ? `${Math.round((totalWins / totalAppts) * 1000) / 10}%` : "" };
}

/**
 * Net setter earnings for the current Brisbane calendar month only.
 * Sums the same fee events as payableThisMonth, but dated in the CURRENT YYYY-MM
 * (quote issued, deposit cleared, claim 50%, holdback release, clawback) — not all-time rollups.
 */
export function netEarnedThisMonth(leads: SetterLeadLite[], now: Date = new Date()): number {
  const month = currentBrisbaneMonth(now);
  let total = 0;
  for (const l of leads) {
    if (l.brand !== "ENP" && l.brand !== "DR") continue;
    const f = computeFees(l, now);
    const big = (l.contractValue ?? 0) >= 500000;
    total += feeEventsInMonth(l, month, {
      quoteFeeV2: f.quoteFeeV2,
      winBonusTotal: f.winBonusTotal,
      bonusEarnedToDate: f.bonusEarnedToDate,
      clawback: f.clawback,
      big,
    });
  }
  return round2(total);
}

/** Monthly target shown on the setter portal earnings meter. */
export const SETTER_MONTHLY_TARGET = 10_000;
