import Link from "next/link";
import { requireViewer } from "@/lib/team-view";
import { requireUser } from "@/lib/auth";
import { fmtAUD } from "@/lib/money";
import { previousBrisbaneMonth } from "@/lib/time";
import { setterSummaries } from "@/lib/statements";
import { Flash, PageTitle } from "@/components/ui";
import { recomputeWins } from "../leads/actions";

export default async function Setters({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireViewer(["ADMIN", "BDM"], "setterPay");
  const sp = await searchParams;
  const rows = await setterSummaries();
  return (
    <div>
      <PageTitle title="Setters" sub={`Pay rollups across ENP + DR. "Owed This Month" = events dated ${previousBrisbaneMonth()} (Brisbane), paid on the 1st.`}>
        <form action={recomputeWins}><button className="btn-ghost" title="Number each setter's wins by Deposit Cleared Date">Renumber Setter Win #</button></form>
        <Link prefetch={false} href="/setters/new" className="btn">+ New setter</Link>
      </PageTitle>
      <Flash msg={sp.msg} />
      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead><tr><th>Name</th><th>Status</th><th>Email</th><th>Login</th><th>Calls</th><th>Wins</th><th>Appts held</th><th>Paid quotes</th><th>Win rate</th><th>Owed this month</th><th>Held back</th><th>Earned</th><th>Paid</th><th>Outstanding</th></tr></thead>
          <tbody>{rows.map(({ setter: s, roll: r, callCount }) => (
            <tr key={s.id}><td><Link prefetch={false} className="font-medium brand-text hover:underline" href={`/setters/${s.id}`}>{s.name}</Link> <Link prefetch={false} className="text-xs underline opacity-80" href={`/setters/calls?setter=${s.id}`}>call list</Link></td><td>{s.status}</td><td>{s.email}</td>
              <td className="text-xs">{s.user ? "✓" : ""}</td><td>{callCount}</td><td>{r.totalWins}</td><td>{r.totalAppts}</td><td>{r.totalPaidQuotes}</td><td>{r.winRate}</td>
              <td className="font-semibold">{fmtAUD(r.owedThisMonth)}</td><td>{fmtAUD(r.totalHeldBack)}</td><td>{fmtAUD(r.totalEarned)}</td><td>{fmtAUD(r.totalPaid)}</td><td>{fmtAUD(r.outstanding)}</td></tr>))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
