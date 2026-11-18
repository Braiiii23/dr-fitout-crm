import { prisma } from "@/lib/db";
import { setterSummaries, statementEmail } from "@/lib/statements";
import { fmtDateTime } from "@/lib/time";
import { queueStatements } from "@/app/(app)/statements/actions";

const aud = (n: number) => `$${Math.round(n).toLocaleString("en-AU")}`;

/** Setter pay (was the Statements page): what each setter is owed on the 1st, and their statements. */
export default async function SetterPay() {
  const sums = (await setterSummaries()).filter((s) => s.setter.status === "Active");
  const outbox = await prisma.emailLog.findMany({ where: { subject: { contains: "setter statement" } }, orderBy: { createdAt: "desc" }, take: 10 });
  const t = sums.reduce((a, { roll }) => ({ owed: a.owed + roll.owedThisMonth, held: a.held + roll.totalHeldBack, out: a.out + roll.outstanding }), { owed: 0, held: 0, out: 0 });
  return (
    <section id="setter-pay" className="card acc-pad">
      <div className="acc-head"><h2 className="est-h2">Setter pay</h2><span className="acc-muted">Owed this month is paid on the 1st (25% held back until the job pays). {aud(t.owed)} to pay · {aud(t.out)} outstanding in total.</span></div>
      {sums.length ? (
        <div className="overflow-x-auto"><table className="table jc-table">
          <thead><tr><th>Setter</th><th>Owed this month</th><th>Held back</th><th>Earned</th><th>Paid</th><th>Outstanding</th><th>Wins</th><th>Appts</th><th>Paid quotes</th><th>Win rate</th></tr></thead>
          <tbody>{sums.map(({ setter, roll }) => (
            <tr key={setter.id}>
              <td><b>{setter.name}</b>{setter.email && <small className="acc-muted" style={{ display: "block" }}>{setter.email}</small>}</td>
              <td><b>{aud(roll.owedThisMonth)}</b></td><td>{aud(roll.totalHeldBack)}</td><td>{aud(roll.totalEarned)}</td><td>{aud(roll.totalPaid)}</td>
              <td className={roll.outstanding > 0 ? "acc-warn-text" : ""}>{aud(roll.outstanding)}</td>
              <td>{roll.totalWins}</td><td>{roll.totalAppts}</td><td>{roll.totalPaidQuotes}</td><td>{roll.winRate || "—"}</td>
            </tr>))}</tbody>
          <tfoot><tr className="acc-pl-total"><td>Total</td><td>{aud(t.owed)}</td><td>{aud(t.held)}</td><td /><td /><td>{aud(t.out)}</td><td colSpan={4} /></tr></tfoot>
        </table></div>
      ) : <p className="acc-muted">No active setters.</p>}
      <details style={{ marginTop: ".7rem" }}><summary className="acc-link">Each setter&apos;s statement</summary>
        <div className="sp-statements">{sums.filter((s) => s.setter.email).map(({ setter, roll }) => { const e = statementEmail(setter.name, roll); return (
          <div key={setter.id} className="sp-statement"><div className="acc-muted">To: {setter.email}</div><b>{e.subject}</b><pre>{e.body}</pre></div>); })}</div>
      </details>
      <div className="acc-actions" style={{ marginTop: ".6rem" }}>
        <form action={queueStatements}><button className="btn">Write this month&apos;s statements</button></form>
        <span className="acc-muted">Statements are saved to the outbox{outbox.length ? `; last written ${fmtDateTime(outbox[0].createdAt)}` : ""}. Emailing starts once an email service is connected.</span>
      </div>
    </section>
  );
}
