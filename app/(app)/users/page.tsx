import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Flash, PageTitle } from "@/components/ui";
import { saveUser, saveTeamView } from "./actions";
import { ROLE_LABEL, ROLE_ABOUT } from "@/lib/access";
import { getTeamView } from "@/lib/team-view";

const STAFF_ROLES = ["CEO", "BDM", "PM", "FOREMAN", "ESTIMATOR", "ACCOUNTS", "TEAM"] as const;

export default async function Users({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireUser(["ADMIN"]);
  const sp = await searchParams;
  const tv = await getTeamView();
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  const Row = ({ u }: { u?: (typeof users)[number] }) => (
    <form action={saveUser} className="grid items-end gap-2 border-t p-3 first:border-0 md:grid-cols-[1.2fr_1.5fr_1fr_1fr_auto_auto]">
      <input type="hidden" name="id" value={u?.id ?? ""} />
      <div><label className="label">Name</label><input name="name" defaultValue={u?.name} className="input" required /></div>
      <div><label className="label">Email</label><input name="email" type="email" defaultValue={u?.email} className="input" required /></div>
      <div><label className="label">Role</label>{u?.email?.toLowerCase() === "braiden@enpfitouts.com.au" ? (<><input type="hidden" name="role" value="ADMIN" /><div className="input bg-slate-50">Admin</div></>) : (<select name="role" defaultValue={u?.role === "ADMIN" ? "TEAM" : (u?.role ?? "TEAM")} className="input">{STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>)}</div>
      <div><label className="label">{u ? "New password" : "Password"}</label><input name="password" type="password" minLength={u ? 0 : 10} placeholder={u ? "leave blank to keep" : "min 10 chars"} className="input" autoComplete="new-password" /></div>
      <label className="flex items-center gap-1 pb-2 text-sm">{u ? <><input type="checkbox" name="active" defaultChecked={u.active} /> Active</> : null}</label>
      <button className="btn">{u ? "Save" : "Add user"}</button>
    </form>
  );
  return (
    <div>
      <PageTitle title="Users & access" sub="Admin only: logins and what each person can open. Team: Directory plus view-only access to the other pages." />
      <Flash msg={sp.msg} /><Flash msg={sp.err} kind="err" />
      <div className="card p-0">{users.map((u) => <Row key={u.id} u={u} />)}</div>
      <h2 className="mb-2 mt-6 font-semibold brand-text">What each role can do</h2>
      <div className="card text-sm roles-guide">
        {STAFF_ROLES.map((r) => <p key={r}><b>{ROLE_LABEL[r]}:</b> {ROLE_ABOUT[r]} Everyone also gets My Day and the team calendar.</p>)}
      </div>
      <h2 className="mb-2 mt-6 font-semibold brand-text">Team login: view-only access</h2>
      <form action={saveTeamView} className="card space-y-2 text-sm">
        <p>The team login (team@) can <b>view</b> Dashboard, Leads, Jobs, WIP, Estimating, Leases and Clients, and works the Directory. It can&apos;t change anything on the other pages. It never sees Users, the Xero or BuilderTrend connections, or settings.</p>
        <label className="flex items-center gap-2"><input type="checkbox" name="accounts" defaultChecked={tv.accounts} /> Also let the team view <b>Accounts</b> (bank balances, profit, who owes us, the finance report)</label>
        <button className="btn">Save team access</button>
      </form>
      <h2 className="mb-2 mt-6 font-semibold brand-text">Add a user</h2>
      <div className="card p-0"><Row /></div>
    </div>
  );
}
