import Link from "next/link";
import OwnerAvailability from "@/components/OwnerAvailability";
import { mondayOf, bneToday } from "@/lib/myday";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { CALL_STATUSES } from "@/lib/constants";
import { SAFE_CALL_SELECT } from "@/lib/calls-acl";
import { netEarnedThisMonth, SETTER_MONTHLY_TARGET } from "@/lib/fees";
import { currentBrisbaneMonth, fmtDate, fmtDateTime } from "@/lib/time";
import { BusinessBadge, Flash, PageTitle, StatusBadge } from "@/components/ui";
import { AutoSubmitSelect } from "@/components/AutoSubmit";
import { EarningsMeter } from "@/components/EarningsMeter";
import { NetUpCelebration } from "@/components/Celebrate";
import { getBrand } from "@/lib/brand";
import { AssistantChat } from "@/components/AssistantChat";
import { logAttempt, quickStatus } from "../calls/actions";

// Setter Portal → "My Calls": only rows whose Setter is the logged-in user's setter record.
// Braiden (5 Nov 2026): one net-this-month earnings block + $10k counting bar — never lead GP / contract value / budgets on call cards.
const TABS = ["To Call", "No Answer", "Call Back", "Appointment Set", ""];
export default async function Portal({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const tab = sp.tab ?? "To Call";
  if (!u.setterId) return <div className="card">Your account isn&apos;t linked to a setter yet. Ask Braiden to link it on the Users page.</div>;
  const brand = await getBrand();
  const [all, myLeads] = await Promise.all([
    prisma.callListItem.findMany({ where: { setterId: u.setterId, ...(brand === "ALL" ? {} : { business: brand }) }, select: SAFE_CALL_SELECT, orderBy: [{ createdAt: "desc" }] }),
    prisma.lead.findMany({ where: { setterId: u.setterId } }),
  ]);
  const netThisMonth = netEarnedThisMonth(myLeads);
  const monthYm = currentBrisbaneMonth();
  const monthLabel = new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${monthYm}-01T00:00:00Z`));
  // High priority calls first (Braiden sets priority), then newest first as before.
  const prio = (p: string) => (p === "High" ? 0 : p === "Low" ? 2 : 1);
  const rows = (tab ? all.filter((c) => c.callStatus === tab) : all).slice().sort((a, b) => prio(a.priority) - prio(b.priority));
  const count = (t: string) => (t ? all.filter((c) => c.callStatus === t).length : all.length);
  return (
    <div className="team-editable">
      <div className="portal-head">
        <PageTitle title="My Calls" sub={`Hi ${u.name.split(" ")[0]} — ${all.length} ${brand === "ALL" ? "" : (brand === "DR" ? "DR Fitout " : "ENP ")}calls assigned to you · ${count("To Call")} to call · ${count("Call Back")} call-backs`} />
      </div>
      <div className="earnings-strip mb-4">
        <NetUpCelebration net={netThisMonth} />
        <EarningsMeter net={netThisMonth} target={SETTER_MONTHLY_TARGET} monthLabel={monthLabel} />
      </div>
      <AssistantChat name={u.name.split(" ")[0]} brand={brand} />
      <Flash msg={sp.msg} /><Flash msg={sp.err} kind="err" />
      <div className="mb-4"><OwnerAvailability week={/^\d{4}-\d{2}-\d{2}$/.test(sp.week ?? "") ? mondayOf(sp.week) : mondayOf(bneToday())} baseHref="/portal" setterId={u.setterId} /></div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold brand-text">Call queue</h2>
        <nav className="seg">
          {TABS.map((t) => <Link prefetch={false} key={t || "all"} href={`/portal?tab=${encodeURIComponent(t)}`} className={tab === t ? "on" : ""}>{t || "All"}<span className="cnt">{count(t)}</span></Link>)}
        </nav>
      </div>
      <div className="call-grid">
        {rows.map((c) => (
          <div key={c.id} className={`call-card ${c.priority === "High" ? "call-high" : ""}`} data-status={c.callStatus}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-base font-bold text-slate-900">{c.leadName}</div>
                <div className="truncate text-xs text-slate-500">{c.company}</div>
              </div>
              <BusinessBadge b={c.business} />
            </div>
            <div>
              {c.phone && <a className="call-phone tabular-nums" href={`tel:${c.phone.replace(/\s/g, "")}`}>📞 {c.phone}</a>}
              {c.email && <a className="mt-1 block truncate text-xs text-slate-600 underline" href={`mailto:${c.email}`}>{c.email}</a>}
            </div>
            {c.leadInfo && <details className="text-xs"><summary className="cursor-pointer font-semibold text-slate-700">Why call</summary><p className="mt-1 whitespace-pre-wrap text-slate-700">{c.leadInfo}</p></details>}
            {c.possibleDuplicate && <div className="text-xs text-amber-700">⚠ Possible duplicate — Braiden will review.</div>}
            <div className="call-meta">
              <span>{c.attempts} attempt{c.attempts === 1 ? "" : "s"}</span>
              {c.lastCalled && <span>Last {fmtDate(c.lastCalled)}</span>}
              {c.appointment && <span>Appt {fmtDateTime(c.appointment)}</span>}
            </div>
            <div className="mt-auto space-y-2">
              <div className="flex items-center gap-2">{c.priority === "High" && <span className="sc-prio">High priority</span>}<StatusBadge status={c.callStatus} />
                <form action={quickStatus} className="flex-1"><input type="hidden" name="id" value={c.id} /><input type="hidden" name="_back" value="/portal" />
                  <AutoSubmitSelect name="callStatus" defaultValue={c.callStatus} className="input w-full py-1 text-xs">{CALL_STATUSES.map((s) => <option key={s}>{s}</option>)}</AutoSubmitSelect></form>
              </div>
              <div className="flex gap-2">
                <form action={logAttempt} className="flex-1"><input type="hidden" name="id" value={c.id} /><input type="hidden" name="_back" value="/portal" /><button className="btn-ghost w-full py-1 text-xs">+1 attempt</button></form>
                <Link prefetch={false} href={`/portal/${c.id}`} className="btn flex-1 py-1 text-center text-xs">Notes / book</Link>
              </div>
            </div>
          </div>
        ))}
        {!rows.length && <div className="call-card col-span-full items-center justify-center text-slate-500">No calls in this tab — nice work, or try All.</div>}
      </div>
    </div>
  );
}
