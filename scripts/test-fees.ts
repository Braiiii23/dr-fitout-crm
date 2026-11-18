// Fee engine checks against the Airtable formulas. Run: npm run test:fees
import assert from "node:assert/strict";
import { computeFees, netEarnedThisMonth } from "../lib/fees";
import { currentBrisbaneMonth, previousBrisbaneMonth } from "../lib/time";

const now = new Date("2026-11-05T03:00:00Z"); // 1pm Thu 5 Nov 2026 Brisbane
assert.equal(previousBrisbaneMonth(now), "2026-10");
assert.equal(previousBrisbaneMonth(new Date("2026-10-31T15:00:00Z")), "2026-10", "1am 1 Nov Brisbane is already November");
const S = "setter1";
let f;

// Quote fee v2
f = computeFees({ setterId: S, quoteIssued: true, quoteValue: 25000, newClient: true, quoteIssuedDate: "2026-10-12" }, now);
assert.equal(f.quoteFeeV2, 150); assert.equal(f.payableThisMonth, 150);
assert.equal(computeFees({ setterId: S, quoteIssued: true, quoteValue: 24999, newClient: true }, now).quoteFeeV2, 0);
assert.equal(computeFees({ setterId: null, quoteIssued: true, quoteValue: 90000, newClient: true }, now).quoteFeeV2, 0);
assert.equal(computeFees({ setterId: S, quoteIssued: true, quoteValue: 90000, newClient: false }, now).quoteFeeV2, 0);

// Win bonus: 6% GP, min 500, max 15k, 7.5% after 6th win
f = computeFees({ setterId: S, grossProfit: 40000, depositClearedDate: "2026-10-20", setterWinNo: 1 }, now);
assert.equal(f.winBonusTotal, 2400); assert.equal(f.bonusPayableNow, 1800); assert.equal(f.bonusHeldBack, 600); assert.equal(f.payableThisMonth, 1800);
assert.equal(computeFees({ setterId: S, grossProfit: 5000, depositClearedDate: "2026-10-20" }, now).winBonusTotal, 500);
assert.equal(computeFees({ setterId: S, grossProfit: 400000, depositClearedDate: "2026-10-20" }, now).winBonusTotal, 15000);
assert.equal(computeFees({ setterId: S, grossProfit: 40000, depositClearedDate: "2026-10-20", setterWinNo: 7 }, now).winBonusTotal, 3000);
assert.equal(computeFees({ setterId: S, grossProfit: 40000, depositClearedDate: "2026-10-20", setterWinNo: 6 }, now).winBonusTotal, 2400);

// $500k+ split
f = computeFees({ setterId: S, grossProfit: 100000, contractValue: 600000, depositClearedDate: "2026-10-01" }, now);
assert.equal(f.winBonusTotal, 6000); assert.equal(f.bonusEarnedToDate, 3000); assert.equal(f.payableThisMonth, 2250);
f = computeFees({ setterId: S, grossProfit: 100000, contractValue: 600000, depositClearedDate: "2026-08-01", claim50PaidDate: "2026-10-15" }, now);
assert.equal(f.bonusEarnedToDate, 6000); assert.equal(f.payableThisMonth, 2250);

// Holdback release
f = computeFees({ setterId: S, grossProfit: 40000, depositClearedDate: "2026-07-01", holdbackReleasedDate: "2026-10-01" }, now);
assert.equal(f.bonusHeldBack, 0); assert.equal(f.payableThisMonth, 600); assert.equal(f.setterNetEarned, 2400);

// 90-day clawback
f = computeFees({ setterId: S, grossProfit: 40000, depositClearedDate: "2026-09-01", cancelled: true, cancelledDate: "2026-10-10" }, now);
assert.equal(f.clawback, -1800); assert.equal(f.bonusHeldBack, 0); assert.equal(f.payableThisMonth, -1800); assert.equal(f.setterNetEarned, 0);
f = computeFees({ setterId: S, grossProfit: 40000, depositClearedDate: "2026-06-01", holdbackReleasedDate: "2026-08-01", cancelled: true, cancelledDate: "2026-08-20" }, now);
assert.equal(f.clawback, -2400);
f = computeFees({ setterId: S, grossProfit: 40000, depositClearedDate: "2026-01-01", cancelled: true, cancelledDate: "2026-10-10" }, now);
assert.equal(f.clawback, 0, "outside 90 days: no clawback");


assert.equal(currentBrisbaneMonth(now), "2026-11");
// Current-month net (Nov events) — distinct from payableThisMonth (Oct events)
assert.equal(netEarnedThisMonth([
  { brand: "ENP", setterId: S, quoteIssued: true, quoteValue: 30000, newClient: true, quoteIssuedDate: "2026-11-02" },
  { brand: "DR", setterId: S, grossProfit: 40000, depositClearedDate: "2026-11-03", setterWinNo: 1 },
  { brand: "ENP", setterId: S, quoteIssued: true, quoteValue: 30000, newClient: true, quoteIssuedDate: "2026-10-12" }, // prior month — ignore
], now), 1950); // 150 quote + 1800 bonus payable now

console.log("All fee checks passed ✔");
