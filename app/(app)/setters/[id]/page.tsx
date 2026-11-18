import Link from "next/link";
import { requireViewer } from "@/lib/team-view";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { computeFees, setterRollups } from "@/lib/fees";
import { fmtAUD } from "@/lib/money";
import { Flash, PageTitle, StageBadge } from "@/components/ui";
import { saveSetter } from "../actions";

export default async function SetterPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  await requireViewer(["ADMIN", "BDM"], "setterPay");
  const { id } = await params; const sp = await searchParams;
  const s = id === "new" ? null : await prisma.setter.findUnique({ where: { id }, include: { leads: true, user: true, calls: { select: { id: true } } } });
  if (id !== "new" && !s) notFound();
  const r = s ? setterRollups(s.leads) : null;
  const F = ({ k, label, type = "text" }: { k: string; label: string; type?: string }) => (<div><label className="label">{label}</label><input name={k} type={type} defaultValue={(s as unknown as Record<string, string>)?.[k] ?? ""} className="input" /></div>);
  return (
    <div className="max-w-5xl">
      <PageTitle title={s?.name ?? "New setter"} sub={s?.user ? `Portal login: ${s.user.email}` : "No portal login linked (Users page)"}><Link prefetch={false} href="/setters" className="btn-ghost">← Setters</Link></PageTitle>
      <Flash msg={sp.msg} />
      <form action={saveSetter} className="card mb-4 grid gap-3 sm:grid-cols-3">
        <input type="hidden" name="id" value={s?.id ?? ""} />
        <F k="name" label="Name" /><F k="email" label="Email" type="email" /><F k="phone" label="Phone" />
        <div><label className="label">Status</label><select name="status" defaultValue={s?.status ?? "Active"} className="input"><option>Active</option><option>Inactive</option></select></div>
        <F k="startDate" label="Start Date" type="date" /><F k="abn" label="ABN" />
        <div className="sm:col-span-3"><label className="label">Notes</label><textarea name="notes" rows={3} defaultValue={s?.notes ?? ""} className="input" /></div>
        <div><button className="btn">Save</button></div>
      </form>
      {s && r && (<>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[["Owed this month", fmtAUD(r.owedThisMonth)], ["Held back", fmtAUD(r.totalHeldBack)], ["Earned", fmtAUD(r.totalEarned)], ["Outstanding", fmtAUD(r.outstanding)], ["Wins", r.totalWins], ["Appts held", r.totalAppts], ["Paid quotes", r.totalPaidQuotes], ["Win rate", r.winRate || "—"]].map(([k, v]) => (
            <div key={String(k)} className="card"><div className="text-xs uppercase text-slate-500">{k}</div><div className="text-lg font-semibold">{v}</div></div>))}
        </div>
        <div className="card overflow-x-auto p-0"><table className="table"><thead><tr><th>Lead</th><th>Brand</th><th>Stage</th><th>Quote fee v2</th><th>Win bonus</th><th>Payable this month</th><th>Held back</th><th>Net earned</th><th>Paid?</th></tr></thead>
          <tbody>{s.leads.map((l) => { const f = computeFees(l); return (<tr key={l.id}><td><Link prefetch={false} className="brand-text underline" href={`/leads/${l.brand === "CONSULTING" ? "consulting" : l.brand.toLowerCase()}/${l.id}`}>{l.leadName}</Link> <span className="text-xs text-slate-500">{l.company}</span></td><td>{l.brand === "DR" ? "DR Fitout" : l.brand === "ENP" ? "ENP Fitouts" : "Consulting"}</td><td><StageBadge stage={l.stage} /></td><td>{fmtAUD(f.quoteFeeV2)}</td><td>{fmtAUD(f.winBonusTotal)}</td><td>{fmtAUD(f.payableThisMonth)}</td><td>{fmtAUD(f.bonusHeldBack)}</td><td>{fmtAUD(f.setterNetEarned)}</td><td>{l.setterFeePaid ? "✓" : ""}</td></tr>); })}</tbody></table></div>
      </>)}
    </div>
  );
}
