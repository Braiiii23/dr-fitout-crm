import Link from "next/link";
import { requireViewer } from "@/lib/team-view";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getBrand } from "@/lib/brand";
import { BRANDS, STAGES, type BrandKey } from "@/lib/constants";
import { computeFees } from "@/lib/fees";
import { fmtAUD } from "@/lib/money";
import { brisbaneToday, fmtDateTime, previousBrisbaneMonth } from "@/lib/time";
import { StageBadge } from "@/components/ui";
import { AdminAssistantChat } from "@/components/AdminAssistantChat";
import { SignedCelebration } from "@/components/Celebrate";
import { RemindButton } from "@/components/RemindButton";
import { EstimatingPanel } from "@/components/EstimatingPanel";

export default async function Dashboard() {
  const u = await requireViewer(["ADMIN", "BDM"]);
  const brand = await getBrand();
  const [leads, calls, upcoming, freeSlots, braidenConnect] = await Promise.all([
    prisma.lead.findMany(),
    prisma.callListItem.groupBy({ by: ["callStatus"], _count: true }),
    prisma.callListItem.findMany({ where: { appointment: { gte: new Date() } }, orderBy: { appointment: "asc" }, take: 8, include: { setter: true } }),
    prisma.freeSlot.count({ where: { status: "Free", start: { gt: new Date() } } }),
    prisma.reminderRequest.findMany({ where: { source: "braiden-to-connect", status: { in: ["pending", "todoist"] } }, orderBy: { createdAt: "desc" }, take: 12 }),
  ]);
  const MONTHLY_TARGET = 1_000_000;
  const today = brisbaneToday();
  const monthKey = today.slice(0, 7);
  const signedAll = leads.filter((l) => l.stage === "Signed").reduce((s, l) => s + (l.contractValue ?? 0), 0);
  const signedThisMonth = leads
    .filter((l) => l.stage === "Signed" && (l.signedDate ?? "").startsWith(monthKey))
    .reduce((s, l) => s + (l.contractValue ?? 0), 0);
  const stillToGo = Math.max(0, MONTHLY_TARGET - signedThisMonth);
  const hit = signedThisMonth >= MONTHLY_TARGET;
  const payable = leads.filter((l) => l.brand !== "CONSULTING").reduce((s, l) => s + computeFees(l).payableThisMonth, 0);
  const followUps = leads.filter((l) => l.nextFollowUp && l.nextFollowUp <= today && !["Signed", "Lost"].includes(l.stage ?? "")).slice(0, 10);
  const dups = await prisma.callListItem.count({ where: { possibleDuplicate: true } });
  const pct = Math.min(100, (signedThisMonth / MONTHLY_TARGET) * 100);
  const [y, m] = monthKey.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dayNum = Number(today.slice(8, 10));
  const daysLeft = Math.max(0, lastDay - dayNum + 1);
  const monthLabel = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", month: "long", year: "numeric" }).format(new Date());
  const brandLabel = brand === "DR" ? "DR Fitout" : brand === "ENP" ? "ENP Fitouts" : "ENP + DR Fitout";
  const first = u.name.split(" ")[0];

  // Recent Signed (today or last 7 Brisbane calendar days) for celebration
  const weekAgo = (() => {
    const [yy, mm, dd] = today.split("-").map(Number);
    const d = new Date(Date.UTC(yy, mm - 1, dd - 7));
    return d.toISOString().slice(0, 10);
  })();
  const recentSigned = leads
    .filter((l) => l.stage === "Signed" && l.signedDate && l.signedDate >= weekAgo)
    .sort((a, b) => (b.signedDate ?? "").localeCompare(a.signedDate ?? ""))
    .slice(0, 8)
    .map((l) => ({
      id: l.id,
      name: l.leadName ?? "Signed job",
      company: l.company,
      signedDate: l.signedDate,
      brand: l.brand,
    }));

  // Quoting jobs with due / follow-up
  const quoting = leads
    .filter((l) => (l.stage ?? "") === "Quoting")
    .sort((a, b) => (a.nextFollowUp ?? a.quotedDate ?? "9999").localeCompare(b.nextFollowUp ?? b.quotedDate ?? "9999"))
    .slice(0, 12);

  return (
    <div>
      <SignedCelebration items={recentSigned} />

      <section className="dash-hero mb-4">
        <div className="dash-eyebrow">{brandLabel} · Capability dashboard</div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight">G&apos;day {first}</h1>
        <p className="dash-sub mt-1">
          Brisbane {new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", dateStyle: "full" }).format(new Date())}
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-white/70">$1M monthly target · {monthLabel}</div>
            <div className="mt-0.5 text-3xl font-extrabold">{hit ? "Target hit" : fmtAUD(stillToGo)}</div>
            <div className="text-xs text-white/70">{hit ? "Signed this month cleared $1M" : "Still to go (ex GST)"}</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-white/70">Signed this month</div>
            <div className="mt-0.5 text-2xl font-bold">{fmtAUD(signedThisMonth)}</div>
            <div className="text-xs text-white/70">All-time signed {fmtAUD(signedAll)}</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-white/70">Countdown</div>
            <div className="mt-0.5 text-2xl font-bold">{daysLeft} day{daysLeft === 1 ? "" : "s"} left</div>
            <div className="mt-2 dash-progress bg-white/25"><div style={{ width: `${pct}%`, background: "#fff" }} /></div>
            <div className="mt-1 text-xs text-white/70">{pct.toFixed(1)}% of $1,000,000</div>
          </div>
        </div>
      </section>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="dash-kpi sm:col-span-2">
          <div className="kpi-label">Signed-work pace · ENP + DR Fitout + Consulting</div>
          <div className="mt-1 flex flex-wrap items-end gap-x-6 gap-y-1">
            <div>
              <div className="text-xs admin-muted">Still to go</div>
              <div className={`kpi-value ${hit ? "!text-emerald-600" : ""}`}>{hit ? "Target hit" : fmtAUD(stillToGo)}</div>
            </div>
            <div>
              <div className="text-xs admin-muted">Signed this month</div>
              <div className="text-xl font-semibold text-slate-900">{fmtAUD(signedThisMonth)}</div>
            </div>
          </div>
          <div className="mt-2 dash-progress"><div style={{ width: `${pct}%` }} /></div>
        </div>
        <div className="dash-kpi">
          <div className="kpi-label">Setter pay due on the 1st ({previousBrisbaneMonth()})</div>
          <div className="kpi-value">{fmtAUD(payable)}</div>
          <Link prefetch={false} href="/setters" className="text-xs brand-text underline">Setters</Link>
        </div>
        <div className="dash-kpi">
          <div className="kpi-label">Free slots ahead</div>
          <div className="kpi-value">{freeSlots}</div>
          <Link prefetch={false} href="/calendar#availability" className="text-xs brand-text underline">Booking availability</Link>
          {dups > 0 && <div className="mt-1 text-xs text-amber-700"><Link prefetch={false} href="/calls?dup=1" className="underline">⚠ {dups} possible duplicate(s)</Link></div>}
        </div>
      </div>

      <AdminAssistantChat name={first} brand={brand} />

      <EstimatingPanel leads={leads} brand={brand} />

      {braidenConnect.length > 0 && (
        <section className="dash-panel mb-4" style={{ borderTopColor: "#1c1c1e" }}>
          <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="mb-0">Braiden to Connect</h2>
              <p className="text-xs text-slate-500">Queued for Anita Reminder / Todoist when status hits Braiden to Connect.</p>
            </div>
            <span className="text-xs font-semibold text-slate-500">{braidenConnect.filter((r) => r.status === "pending").length} pending</span>
          </div>
          <ul className="admin-divide divide-y divide-slate-100">
            {braidenConnect.map((r) => (
              <li key={r.id} className="py-2 text-sm">
                <div className="font-semibold">{r.title}</div>
                <div className="text-xs text-slate-500 whitespace-pre-wrap">{r.description}</div>
                <div className="mt-1 text-[11px] text-slate-400">
                  {r.status === "todoist" ? `Todoist ${r.todoistTaskId ?? "ok"}` : "Pending Anita"} · call {r.callId ?? "—"} · lead {r.leadId ?? "—"}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="dash-panel mb-4">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="mb-0">Quoting · due &amp; chase-ups</h2>
            <p className="text-xs text-slate-500">Remind me queues Anita Reminder / Todoist (DR Fitout spelling singular).</p>
          </div>
          <span className="text-xs font-semibold text-slate-500">{quoting.length} open</span>
        </div>
        {quoting.length ? (
          <ul className="admin-divide divide-y divide-slate-100">
            {quoting.map((l) => {
              const due = l.nextFollowUp || l.quotedDate;
              const overdue = due && due < today;
              const brandName = l.brand === "DR" ? "DR Fitout" : l.brand === "CONSULTING" ? "Consulting" : "ENP";
              return (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <Link prefetch={false} href={`/leads/${BRANDS[l.brand as BrandKey].slug}/${l.id}`} className="font-semibold brand-text underline">
                      {l.leadName ?? "—"}
                    </Link>
                    <span className="text-slate-600"> · {l.company ?? "—"}</span>
                    <div className="text-xs text-slate-500">
                      {brandName} · {due ? (overdue ? `Overdue ${due}` : `Due ${due}`) : "No follow-up date"}
                      {l.quotedDate ? ` · quoted ${l.quotedDate}` : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <RemindButton leadId={l.id} kind="chase" due={due || "tomorrow"} />
                    <RemindButton leadId={l.id} kind="quote" due={due || "tomorrow"} label="Remind me · quote due" />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">No jobs in Quoting right now.</p>
        )}
      </section>

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        {(Object.keys(BRANDS) as BrandKey[]).map((b) => {
          const bl = leads.filter((l) => l.brand === b);
          return (
            <Link prefetch={false} key={b} href={`/leads/${BRANDS[b].slug}?view=pipeline`} className="dash-panel block hover:ring-2 hover:ring-[color:var(--brand)]" style={{ borderTopColor: BRANDS[b].color }}>
              <div className="mb-2 flex justify-between"><span className="font-semibold">{BRANDS[b].table}</span><span className="text-sm text-slate-500">{bl.length}</span></div>
              <div className="flex flex-wrap gap-2">{STAGES[b].map((s) => <span key={s} className="text-sm"><StageBadge stage={s} /> {bl.filter((l) => (l.stage ?? "New") === s).length}</span>)}</div>
            </Link>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="dash-panel text-sm"><h2 className="mb-2">Call list</h2>{calls.sort((a, b) => b._count - a._count).map((c) => <div key={c.callStatus} className="flex justify-between py-0.5"><span>{c.callStatus}</span><span>{c._count}</span></div>)}</div>
        <div className="dash-panel text-sm"><h2 className="mb-2">Upcoming appointments</h2>{upcoming.length ? upcoming.map((c) => <div key={c.id} className="py-1"><Link prefetch={false} href={`/calls/${c.id}`} className="brand-text underline">{c.leadName}</Link> · {c.company}<div className="text-xs text-slate-500">{fmtDateTime(c.appointment)} · {c.setter?.name}</div></div>) : <p className="text-slate-500">None booked.</p>}</div>
        <div className="dash-panel text-sm"><h2 className="mb-2">Follow-ups due</h2>{followUps.length ? followUps.map((l) => <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-1"><div><Link prefetch={false} href={`/leads/${BRANDS[l.brand as BrandKey].slug}/${l.id}`} className="brand-text underline">{l.leadName}</Link> · {l.company} <span className="text-xs text-slate-500">({l.nextFollowUp})</span></div><RemindButton leadId={l.id} due={l.nextFollowUp} /></div>) : <p className="text-slate-500">Nothing overdue.</p>}</div>
      </div>
    </div>
  );
}
