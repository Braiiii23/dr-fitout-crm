import { prisma } from "./db";
import { setterRollups } from "./fees";
import { fmtAUD } from "./money";
import { previousBrisbaneMonth } from "./time";

export async function setterSummaries(now = new Date()) {
  const setters = await prisma.setter.findMany({ include: { leads: true, user: { select: { id: true } }, calls: { select: { id: true } } }, orderBy: { name: "asc" } });
  return setters.map((s) => ({ setter: s, roll: setterRollups(s.leads, now), callCount: s.calls.length }));
}

/** Monthly statement (wfloB56ZAFc1g9Inf) — 1st of month, 8am Brisbane. Sending is stubbed: messages go to the EmailLog outbox. */
export function statementEmail(name: string, r: ReturnType<typeof setterRollups>, now = new Date()) {
  const [y, m] = previousBrisbaneMonth(now).split("-").map(Number);
  const month = new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
  const subject = `Your setter statement — ${month}`;
  const body = [
    `Hi ${name.trim().split(" ")[0]},`, "", `Here is your statement for work dated in ${month} (paid on the 1st).`, "",
    `Owed this month: ${fmtAUD(r.owedThisMonth)}`, `Held back (25% holdback): ${fmtAUD(r.totalHeldBack)}`,
    `Total earned: ${fmtAUD(r.totalEarned)}`, `Total paid: ${fmtAUD(r.totalPaid)}`, `Outstanding: ${fmtAUD(r.outstanding)}`, "",
    `Wins: ${r.totalWins} · Appointments held: ${r.totalAppts} · Paid quotes: ${r.totalPaidQuotes} · Win rate: ${r.winRate || "n/a"}`, "",
    "Thanks,", "Braiden — ENP Fitouts / DR Fitout",
  ].join("\n");
  return { subject, body };
}

export async function runMonthlyStatements(sentBy: string) {
  const sums = await setterSummaries();
  let n = 0;
  for (const { setter, roll } of sums) {
    if (setter.status !== "Active" || !setter.email) continue;
    const { subject, body } = statementEmail(setter.name, roll);
    await prisma.emailLog.create({ data: { to: setter.email, subject, body, status: `stubbed (queued by ${sentBy})` } });
    n++;
  }
  return n;
}
