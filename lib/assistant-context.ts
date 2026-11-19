import "server-only";
import { expiryOf, keyDates } from "./leases";
import { prisma } from "./db";
import type { CurrentUser } from "./auth";
import { accountsView } from "./accounts";
import { jobMoney } from "./job-estimate";
import { estPercent, nextStep, scopeCoverage, summariseTrades } from "./estimating";
import { brisbaneToday } from "./time";

// What the assistant is allowed to know, by login, and what's relevant to the page being viewed.
// Setters and the team login never get money figures; the estimator gets job costs but not company accounts.
const $ = (n: number | null | undefined) => (n == null ? "n/a" : `$${Math.round(n).toLocaleString("en-AU")}`);
const pct = (n: number | null | undefined) => (n == null ? "n/a" : `${n.toFixed(1)}%`);
const clip = (s: string | null | undefined, n = 300) => (s ? (s.length > n ? s.slice(0, n) + "…" : s) : "");

async function accountsContext() {
  const v = await accountsView();
  const I = v.ideal, w = v.work, x = v.insights;
  const lines = [
    `ACCOUNTS (from Xero${v.conn ? `, last synced ${v.conn.lastSyncAt?.toISOString() ?? "never"}` : ": not connected"})`,
    `Cash in bank ${$(v.cashTotal)}; free to spend after tax holding, card and ${$(I.buffer)} buffer: ${$(v.freeToSpend)}. Bank accounts: ${v.bank.map((b) => `${b.name} ${$(b.balance)}${b.kind !== "cash" ? ` (${b.kind})` : ""}`).join("; ")}.`,
    `Running costs ${$(I.runningCosts)}/month (${I.runningFrom}). Break-even turnover ${$(I.breakEven)}/month at the ${I.grossGoal}% gross margin goal.`,
    `Accounts turnover target ${$(I.target)}/month (${I.targetFrom}). Sales goal (signed work) ${$(I.salesGoal)}/month; signed this month ${$(v.signedThisMonth)}.`,
    `Live profit this month (each invoice x its job's GP %, minus running costs to date): invoiced ${$(v.liveThis.income)}, GP ${$(v.liveThis.gp)}, running costs to date ${$(v.liveThis.running)}, net ${$(v.liveThis.net)}; last month live net ${$(v.liveLast.net)}. Xero P&L net this month ${$(v.xeroNet)}.`,
    `This month to date (day ${v.dayOfMonth}/${v.daysInMonth}): income ${$(v.income)}, gross profit ${$(v.gross)} (${pct(v.grossPct)}), net ${$(v.net)}. Last month: income ${$(v.plLast?.income)}, gross ${$(v.plLast?.gross)}, net ${$(v.plLast?.net)}. P&L source: ${v.plSource}.`,
    x.completeMonths ? `Last ${Math.min(6, x.completeMonths)} months: gross margin ${pct(x.grossPct6)}, net margin ${pct(x.netPct6)}, turnover ${$(x.incomeAvg6)}/month average. Clients take ${x.avgDaysToPay != null ? Math.round(x.avgDaysToPay) : "n/a"} days to pay. Monthly: ${x.months.map((mm) => `${mm.month} income ${$(mm.income)} net ${$(mm.net)}`).join("; ")}.` : "",
    `Work on the books: ${w.monthsCovered.toFixed(1)} months of running costs covered (warning level: ${w.level}); ${$(w.securedTotal)} signed work still to invoice, ${$(w.securedGp)} GP still to come; work runs out around ${w.runsOut}. New work needed to get to ${w.aimMonths} months: ${$(w.workNeeded)} (~${Math.ceil(w.jobsNeeded)} jobs, ~${Math.ceil(w.quotesNeeded)} quotes).`,
    `Signed jobs: ${w.securedJobs.map((j) => `${j.name}: signed ${$(j.contract)}, cost ${$(j.cost)}, GP ${$(j.gpTotal)} (${pct(j.gpPct)}, from ${j.from}), left to invoice ${$(j.remaining)}`).join("; ") || "none"}.`,
    `Owed to us ${$(v.recvTotal)}: not due ${$(v.aged.notDue)}, 1-30 days late ${$(v.aged.late1to30)}, 30+ days late ${$(v.aged.late30plus)}. Largest late: ${[...v.staleRecv, ...v.incoming.filter((i) => (i.DueDateString ?? "") < v.today)].slice(0, 8).map((i) => `${i.Contact?.Name} ${i.InvoiceNumber ?? ""} ${$(i.AmountDue)} due ${i.DueDateString?.slice(0, 10)}`).join("; ")}.`,
    `Bills due in 30 days ${$(v.billsDue30)}: ${v.bills.slice(0, 10).map((b) => `${b.Contact?.Name} ${$(b.AmountDue)} due ${b.DueDateString?.slice(0, 10)}`).join("; ")}. Old unpaid bills over ${v.settings.staleDays} days to check in Xero: ${$(v.stalePayTotal)} (${v.stalePay.length}).`,
    `Cash forecast (13 weeks, ${v.securedOnly ? "work already won only" : "assumes turnover continues"}): ${v.weeks.map((wk) => `w/c ${wk.start} ${$(wk.bal)}`).join("; ")}. Lowest ${$(v.low.bal)} w/c ${v.low.start}.`,
    x.topClients.length ? `Biggest clients (12 months): ${x.topClients.map((c) => `${c.name} ${$(c.total)} (${(c.share * 100).toFixed(0)}%)`).join("; ")}.` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

async function estimatingContext(jobId: string | null) {
  if (jobId) {
    const j = await prisma.lead.findUnique({
      where: { id: jobId },
      select: {
        brand: true, stage: true, company: true, leadName: true, location: true, projectType: true, sizeSqm: true, budget: true, timeframe: true, lookingFor: true, notes: true,
        estimatorNotes: true, quoteValue: true, contractValue: true, grossProfit: true, estOtherCosts: true, estContingencyPct: true,
        estPlansAt: true, estScopeAt: true, estExcelAt: true, estRfqAt: true, estPrelimAt: true, estRfqRecAt: true, estProposalAt: true, estSentAt: true,
        tradeQuotes: true, scopeItems: true,
      },
    });
    if (j && (j.brand === "ENP" || j.brand === "DR")) {
      const m = jobMoney(j);
      const cov = scopeCoverage(j.scopeItems, j.tradeQuotes);
      return [
        `JOB BEING VIEWED: ${j.company || j.leadName} (${j.brand}, stage ${j.stage}). ${[j.location, j.projectType, j.sizeSqm ? `${j.sizeSqm} m2` : "", j.budget ? `budget ${j.budget}` : "", j.timeframe].filter(Boolean).join(", ")}.`,
        `Estimating ${estPercent(j)}% done; next step: ${nextStep(j)?.label ?? "all done"}.`,
        `Money: job cost ${$(m.cost)}, ${m.signed ? "signed" : "quote"} ${$(m.sell)}, GP ${$(m.gp)} (${pct(m.gpPct)}), based on ${m.from}${m.from === "estimate" ? (m.final ? " (final)" : " (not final)") : ""}. Other costs ${$(j.estOtherCosts)}, contingency ${j.estContingencyPct ?? 0}%.`,
        `Trade quotes: ${j.tradeQuotes.map((q) => `${q.trade} - ${q.company ?? "?"}: ${q.price != null ? $(q.price) : "no price"} (${q.status}); scope: ${clip(q.scope, 160)}`).join(" | ") || "none"}.`,
        `Scope list: ${cov.rows.map((r) => `${r.item.trade}: ${r.item.description} [${r.coverage}]`).join(" | ") || "none"}.`,
        `What the client wants: ${clip(j.lookingFor, 600)}`, `Braiden's notes: ${clip(j.notes, 800)}`, `Estimator notes: ${clip(j.estimatorNotes, 400)}`,
      ].join("\n");
    }
  }
  const rows = await prisma.lead.findMany({
    where: { brand: "DR", cancelled: false, stage: { in: ["Quoting", "Signed"] } },
    select: {
      id: true, stage: true, company: true, leadName: true, quoteValue: true, contractValue: true, grossProfit: true, estOtherCosts: true, estContingencyPct: true, signedDate: true,
      estPlansAt: true, estScopeAt: true, estExcelAt: true, estRfqAt: true, estPrelimAt: true, estRfqRecAt: true, estProposalAt: true, estSentAt: true,
      tradeQuotes: { select: { trade: true, price: true, status: true } }, scopeItems: { select: { trade: true, byClient: true } },
    },
    orderBy: { updatedAt: "desc" }, take: 40,
  });
  return "ESTIMATING BOARD:\n" + rows.map((r) => {
    const m = jobMoney(r); const t = summariseTrades(r.tradeQuotes);
    return `${r.company || r.leadName} (${r.stage}${r.signedDate ? ` ${r.signedDate}` : ""}): ${estPercent(r)}% estimated, next ${nextStep(r)?.label ?? "done"}; cost ${$(m.cost)}, ${m.signed ? "signed" : "quote"} ${$(m.sell)}, GP ${pct(m.gpPct)} (${m.from}); trades priced ${t.tradesCovered}, waiting ${t.requested}`;
  }).join("\n");
}

async function leadsContext() {
  const leads = await prisma.lead.findMany({
    where: { cancelled: false },
    select: { brand: true, stage: true, company: true, leadName: true, nextFollowUp: true, quoteValue: true, contractValue: true, leadSource: true, createdAt: true },
    orderBy: { updatedAt: "desc" }, take: 80,
  });
  const today = brisbaneToday();
  const counts: Record<string, number> = {};
  for (const l of leads) counts[`${l.brand} ${l.stage ?? "No stage"}`] = (counts[`${l.brand} ${l.stage ?? "No stage"}`] ?? 0) + 1;
  return [
    `LEADS: ${Object.entries(counts).map(([k, n]) => `${k}: ${n}`).join("; ")}.`,
    `Follow-ups due: ${leads.filter((l) => l.nextFollowUp && l.nextFollowUp <= today && !["Signed", "Lost"].includes(l.stage ?? "")).map((l) => `${l.company || l.leadName} (${l.nextFollowUp})`).join("; ") || "none"}.`,
    `Recent leads: ${leads.slice(0, 30).map((l) => `${l.company || l.leadName} [${l.brand} ${l.stage}${l.quoteValue ? ` quote ${$(l.quoteValue)}` : ""}${l.contractValue ? ` contract ${$(l.contractValue)}` : ""}]`).join("; ")}.`,
  ].join("\n");
}

async function setterContext(u: CurrentUser) {
  if (!u.setterId) return "CALLS: this login has no setter record.";
  const calls = await prisma.callListItem.findMany({
    where: { setterId: u.setterId },
    select: { leadName: true, company: true, business: true, callStatus: true, attempts: true, lastCalled: true, appointment: true, callNotes: true },
    orderBy: { updatedAt: "desc" }, take: 60,
  });
  return "MY CALLS:\n" + calls.map((c) => `${c.leadName} (${c.company ?? ""}, ${c.business}): ${c.callStatus}, ${c.attempts} attempts${c.appointment ? `, appointment ${c.appointment.toISOString()}` : ""}${c.callNotes ? `; notes: ${clip(c.callNotes, 120)}` : ""}`).join("\n");
}

async function teamContext() {
  const calls = await prisma.callListItem.findMany({ select: { leadName: true, company: true, contactType: true, callStatus: true }, take: 120 });
  return "TEAM DIRECTORY / CALL LIST:\n" + calls.map((c) => `${c.leadName} (${c.company ?? ""}) ${c.contactType ?? ""} ${c.callStatus}`).join("\n");
}

export async function assistantContext(u: CurrentUser, path: string) {
  const parts: string[] = [`Today is ${brisbaneToday()} (Brisbane). User: ${u.name}, role ${u.role}. Page: ${path}.`];
  const jobId = /^\/estimating\/([A-Za-z0-9]+)/.exec(path)?.[1] ?? null;
  if (u.role === "SETTER") parts.push(await setterContext(u));
  else if (u.role === "TEAM") parts.push(await teamContext());
  else if (u.role === "ESTIMATOR") parts.push(await estimatingContext(jobId));
  else if (u.role === "BDM") { parts.push(await leadsContext()); if (path.startsWith("/estimating")) parts.push(await estimatingContext(jobId)); }
  else if (u.role === "PM") parts.push(await estimatingContext(jobId));
  else if (u.role === "FOREMAN") parts.push(await estimatingContext(jobId));
  else if (u.role === "ACCOUNTS") {
    parts.push(path.startsWith("/estimating") ? await estimatingContext(jobId) : await accountsContext());
    if (!path.startsWith("/estimating")) parts.push(await estimatingContext(null));
  } else if (u.role === "ADMIN") {
    if (path.startsWith("/estimating")) parts.push(await estimatingContext(jobId));
    if (path.startsWith("/accounts") || path.startsWith("/dashboard")) parts.push(await accountsContext());
    if (!path.startsWith("/accounts")) parts.push(await leadsContext());
  }
  if (["ADMIN", "BDM", "PM", "ACCOUNTS"].includes(u.role) && /^\/(leases|clients|concepts|dashboard|calendar|myday)/.test(path)) parts.push(await leasesContext());
  return parts.join("\n\n").slice(0, 24000);
}

/** Leases and clients: status, money and the next key date for each open lease. */
async function leasesContext() {
  const leases = await prisma.lease.findMany({ include: { client: { select: { name: true } }, concept: { select: { name: true } } }, orderBy: { updatedAt: "desc" }, take: 80 });
  const clients = await prisma.client.findMany({ select: { name: true, type: true, status: true, _count: { select: { leads: true, jobs: true, leases: true } } }, orderBy: { name: "asc" }, take: 120 });
  const today = brisbaneToday();
  const L = leases.map((l) => {
    const next = keyDates(l, today).find((d) => d.days >= 0);
    return `- ${[l.tenancy, l.premises, l.suburb].filter(Boolean).join(", ")} | ${l.status} | client ${l.client?.name ?? "—"} | concept ${l.concept?.name ?? "—"} | ${l.sizeSqm ?? "?"} sqm | rent ${l.rentPa ?? "?"}/yr, outgoings ${l.outgoingsPa ?? "?"}/yr | incentive ${l.incentive ?? 0} | expiry ${expiryOf(l) ?? "?"}${next ? ` | next: ${next.label} ${next.date}` : ""}`;
  });
  const concepts = await prisma.concept.findMany({ where: { status: { not: "Archived" } }, select: { name: true, practiceType: true, minSqm: true, maxSqm: true, rooms: true, tags: true }, orderBy: { name: "asc" } });
  const K = concepts.map((c) => { let n = 0; try { n = (JSON.parse(c.rooms ?? "[]") as { qty?: number }[]).reduce((a, r) => a + (r.qty ?? 1), 0); } catch {} return `- ${c.name} (${c.practiceType ?? "?"}, suits ${c.minSqm ?? "?"}–${c.maxSqm ?? "?"} m², ${n} rooms)${c.tags ? ` · ${c.tags}` : ""}`; });
  const C = clients.map((c) => `- ${c.name} (${c.type ?? "type ?"}, ${c.status}): ${c._count.leads} leads, ${c._count.jobs} jobs, ${c._count.leases} leases`);
  return `LEASES (${leases.length}):\n${L.join("\n") || "none"}\n\nCLIENTS (${clients.length}):\n${C.join("\n") || "none"}\n\nCONCEPT LIBRARY (${concepts.length}):\n${K.join("\n") || "none"}`;
}
