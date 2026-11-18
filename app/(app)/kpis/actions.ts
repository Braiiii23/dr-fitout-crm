"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/automations";
import { METRICS, guessMetric } from "@/lib/myday";

// Braiden (or the CEO) sets KPIs for anyone. KPIs set here are locked for the person (they can still log entries).
const s = (fd: FormData, k: string, max = 80) => { const v = String(fd.get(k) ?? "").trim(); return v ? v.slice(0, max) : null; };
function kpiData(fd: FormData) {
  const name = s(fd, "name") ?? "KPI";
  const target = Number(String(fd.get("target") ?? "").replace(/[$,\s]/g, ""));
  const picked = s(fd, "source");
  const source = picked && METRICS[picked] ? picked : guessMetric(name);
  const period = ["day", "week", "month"].includes(s(fd, "period") ?? "") ? s(fd, "period")! : "week";
  return { name, target: Number.isFinite(target) && target > 0 ? target : 1, period, source, unit: s(fd, "unit", 20) ?? (METRICS[source]?.unit || null) };
}
const refresh = () => { revalidatePath("/kpis"); revalidatePath("/myday"); };

export async function setKpiFor(fd: FormData) {
  const me = await requireUser(["ADMIN"]);
  const userId = s(fd, "userId"); const id = s(fd, "id"); if (!userId) return;
  const data = { ...kpiData(fd), setBy: me.name };
  if (id) await prisma.kpi.updateMany({ where: { id, userId }, data });
  else await prisma.kpi.create({ data: { ...data, userId, sort: await prisma.kpi.count({ where: { userId } }) } });
  await audit(me.email, id ? "kpi changed" : "kpi set", "Kpi", userId, `${data.name}: ${data.target}/${data.period} (${data.source})`);
  refresh();
}

/** Give everyone in a role (or everyone) the same KPI. Anyone who already has a KPI with that name gets it updated. */
export async function setKpiForRole(fd: FormData) {
  const me = await requireUser(["ADMIN"]);
  const role = s(fd, "role"); const data = { ...kpiData(fd), setBy: me.name };
  const users = await prisma.user.findMany({ where: { active: true, ...(role && role !== "ALL" ? { role } : {}) }, select: { id: true } });
  for (const u of users) {
    const existing = await prisma.kpi.findFirst({ where: { userId: u.id, name: data.name } });
    if (existing) await prisma.kpi.update({ where: { id: existing.id }, data });
    else await prisma.kpi.create({ data: { ...data, userId: u.id, sort: await prisma.kpi.count({ where: { userId: u.id } }) } });
  }
  await audit(me.email, "kpi set for role", "Kpi", undefined, `${role}: ${data.name} ${data.target}/${data.period} → ${users.length} people`);
  refresh();
}

export async function removeKpi(fd: FormData) {
  const me = await requireUser(["ADMIN"]);
  const id = s(fd, "id"); if (!id) return;
  await prisma.kpi.deleteMany({ where: { id } });
  await audit(me.email, "kpi removed", "Kpi", id, "");
  refresh();
}
