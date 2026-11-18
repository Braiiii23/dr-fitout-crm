import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageTitle } from "@/components/ui";
import { createCall } from "../actions";
export default async function NewCall() {
  await requireUser(["ADMIN", "BDM"]);
  const setters = await prisma.setter.findMany({ where: { status: "Active" }, orderBy: { name: "asc" } });
  return (
    <div className="max-w-3xl"><PageTitle title="New call-list row" />
      <form action={createCall} className="card grid gap-3 sm:grid-cols-2">
        <input name="leadName" placeholder="Lead name" className="input" required /><input name="company" placeholder="Company" className="input" />
        <input name="phone" placeholder="Phone" className="input" /><input name="email" type="email" placeholder="Email" className="input" />
        <select name="business" className="input"><option value="ENP">ENP Fitouts</option><option value="DR">DR Fitout</option></select>
        <select name="setterId" className="input" defaultValue=""><option value="">— Unassigned (team can claim) —</option>{setters.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <textarea name="leadInfo" rows={4} placeholder="Lead info / why call" className="input sm:col-span-2" />
        <textarea name="callNotes" rows={2} placeholder="Call notes" className="input sm:col-span-2" />
        <div><button className="btn">Create</button></div>
      </form>
    </div>
  );
}
