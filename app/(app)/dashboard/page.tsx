import Link from "next/link";
import { requireViewer } from "@/lib/team-view";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getBrand } from "@/lib/brand";
import { BRANDS, STAGES, type BrandKey } from "@/lib/constants";
import { OPEN_LEASE, PRE_SIGN, inDays, keyDates, urgency } from "@/lib/leases";
import { fmtAUD } from "@/lib/money";
import { brisbaneToday, fmtDate, fmtDateTime } from "@/lib/time";
import { StageBadge } from "@/components/ui";
import { AdminAssistantChat } from "@/components/AdminAssistantChat";
import { SignedCelebration } from "@/components/Celebrate";
import { RemindButton } from "@/components/RemindButton";
import { EstimatingPanel } from "@/components/EstimatingPanel";

export default async function Dashboard() {
  const u = await requireViewer(["ADMIN", "BDM"]);
  const brand = await getBrand();
  const [leads, leases, clientCount, upcoming] = await Promise.all([
    prisma.lead.findMany({ where: { brand: "DR" } }),
    prisma.lease.findMany({ where: { status: { in: OPEN_LEASE } }, include: { client: { select: { name: true } } } }),
    prisma.client.count({ where: { status: "Active" } }),
    prisma.lead.findMany({ where: { brand: "DR", appointment: { gte: new Date() } }, orderBy: { appointment: "asc" }, take: 8 }),
  ]);
  // Monthly signed-work target for DR Fitout. Set MONTHLY_TARGET on the server to change it.
  const MONTHLY_TARGET = Number(process.env.MONTHLY_TARGET) > 0 ? Number(process.env.MONTHLY_TARGET) : 1_000_000;
  const targetShort = MONTHLY_TARGET >= 1_000_000 ? `$${+(MONTHLY_TARGET / 1_000_000).toFixed(2)}M` : `$${Math.round(MONTHLY_TARGET / 1000)}k`;
  const today = brisbaneToday();
  const monthKey = today.slice(0, 7);
  const signedAll = leads.filter((l) => l.stage === "Signed").reduce((s, l) => s + (l.contractValue ?? 0), 0);
  const signedThisMonth = leads
    .filter((l) => l.stage === "Signed" && (l.signedDate ?? "").startsWith(monthKey))
    .reduce((s, l) => s + (l.contractValue ?? 0), 0);
  const stillToGo = Math.max(0, MONTHLY_TARGET - signedThisMonth);
  const hit = signedThisMonth >= MONTHLY_TARGET;
  const followUps = leads.filter((l) => l.nextFollowUp && l.nextFollowUp <= today && !["Signed", "Lost"].includes(l.stage ?? "")).slice(0, 10);
  const leaseDates = leases.flatMap((l) => keyDates(l, today).map((d) => ({ ...d, l }))).filter((d) => d.days >= -14 && d.days <= 180).sort((a, b) => a.date.localeCompare(b.date));
  const leaseSoon = leaseDates.filter((d) => d.days >= 0 && d.days <= 90).length;
  const negotiating = leases.filter((l) => PRE_SIGN.includes(l.status)).length;
  const pct = Math.min(100, (signedThisMonth / MONTHLY_TARGET) * 100);
  const [y, m] = monthKey.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dayNum = Number(today.slice(8, 10));
  const daysLeft = Math.max(0, lastDay - dayNum + 1);
  const monthLabel = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", month: "long", year: "numeric" }).format(new Date());
  const brandLabel = "DR Fitout";
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
            <div className="text-[11px] font-semibold uppercase tracking-wide text-white/70">{targetShort} monthly target · {monthLabel}</div>
            <div className="mt-0.5 text-3xl font-extrabold">{hit ? "Target hit" : fmtAUD(stillToGo)}</div>
            <div className="text-xs text-white/70">{hit ? `Signed this month cleared ${targetShort}` : "Still to go (ex GST)"}</div>
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
            <div className="mt-1 text-xs text-white/70">{pct.toFixed(1)}% of {fmtAUD(MONTHLY_TARGET)}</div>
          </div>
        </div>
      </section>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="dash-kpi sm:col-span-2">
          <div className="kpi-label">Signed-work pace · DR Fitout</div>
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
          <div className="kpi-label">Lease key dates · next 90 days</div>
          <div className="kpi-value">{leaseSoon}</div>
          <Link prefetch={false} href="/leases" className="text-xs brand-text underline">{negotiating} lease{negotiating === 1 ? "" : "s"} before signing</Link>
        </div>
        <div className="dash-kpi">
          <div className="kpi-label">Active clients</div>
          <div className="kpi-value">{clientCount}</div>
          <Link prefetch={false} href="/clients" className="text-xs brand-text underline">Clients</Link>
        </div>
      </div>

      <AdminAssistantChat name={first} brand={brand} />

      <EstimatingPanel leads={leads} brand={brand} />

      <section className="dash-panel mb-4">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="mb-0">Quoting · due &amp; chase-ups</h2>
            <p className="text-xs text-slate-500">Remind me queues a reminder for the chase-up.</p>
          </div>
          <span className="text-xs font-semibold text-slate-500">{quoting.length} open</span>
        </div>
        {quoting.length ? (
          <ul className="admin-divide divide-y divide-slate-100">
            {quoting.map((l) => {
              const due = l.nextFollowUp || l.quotedDate;
              const overdue = due && due < today;
              return (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <Link prefetch={false} href={`/leads/${BRANDS[l.brand as BrandKey].slug}/${l.id}`} className="font-semibold brand-text underline">
                      {l.leadName ?? "—"}
                    </Link>
                    <span className="text-slate-600"> · {l.company ?? "—"}</span>
                    <div className="text-xs text-slate-500">
                      {due ? (overdue ? `Overdue ${due}` : `Due ${due}`) : "No follow-up date"}
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

      <Link prefetch={false} href="/leads/dr?view=pipeline" className="dash-panel mb-4 block hover:ring-2 hover:ring-[color:var(--brand)]">
        <div className="mb-2 flex justify-between"><span className="font-semibold">DR Fitout pipeline</span><span className="text-sm text-slate-500">{leads.length} leads</span></div>
        <div className="flex flex-wrap gap-3">{STAGES.DR.map((st) => <span key={st} className="text-sm"><StageBadge stage={st} /> {leads.filter((l) => (l.stage ?? "New") === st).length}</span>)}</div>
      </Link>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="dash-panel text-sm"><div className="mb-2 flex items-center justify-between"><h2 className="mb-0">Lease key dates</h2><Link prefetch={false} href="/leases" className="text-xs brand-text underline">All leases</Link></div>
          {leaseDates.length ? <ul className="lease-dates lease-dates-tight">{leaseDates.slice(0, 8).map((d) => (
            <li key={d.leaseId + d.kind} className={urgency(d.days)}><span className="lease-when"><b>{fmtDate(d.date)}</b><small>{inDays(d.days)}</small></span>
              <span className="min-w-0"><span className="lease-kind">{d.label}</span> · <Link prefetch={false} href={`/leases/${d.leaseId}`} className="brand-text underline">{d.l.client?.name ?? d.l.premises}</Link></span></li>))}</ul>
            : <p className="text-slate-500">Nothing in the next 6 months.</p>}
        </div>
        <div className="dash-panel text-sm"><h2 className="mb-2">Upcoming appointments</h2>{upcoming.length ? upcoming.map((l) => <div key={l.id} className="py-1"><Link prefetch={false} href={`/leads/dr/${l.id}`} className="brand-text underline">{l.leadName}</Link> · {l.company}<div className="text-xs text-slate-500">{fmtDateTime(l.appointment)}</div></div>) : <p className="text-slate-500">None booked.</p>}</div>
        <div className="dash-panel text-sm"><h2 className="mb-2">Follow-ups due</h2>{followUps.length ? followUps.map((l) => <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-1"><div><Link prefetch={false} href={`/leads/${BRANDS[l.brand as BrandKey].slug}/${l.id}`} className="brand-text underline">{l.leadName}</Link> · {l.company} <span className="text-xs text-slate-500">({l.nextFollowUp})</span></div><RemindButton leadId={l.id} due={l.nextFollowUp} /></div>) : <p className="text-slate-500">Nothing overdue.</p>}</div>
      </div>
    </div>
  );
}
