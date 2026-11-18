import "server-only";
import { redirect } from "next/navigation";
import { prisma } from "./db";
import { requireUser, type CurrentUser } from "./auth";
import type { Role } from "./auth";

// The team login can view (not change) most pages. Finance and pay pages are off unless Braiden switches them on.
export type TeamView = { accounts: boolean; setterPay: boolean };
const KEY = "team:view";

export async function getTeamView(): Promise<TeamView> {
  const r = await prisma.integrationSetting.findUnique({ where: { key: KEY } });
  return { accounts: false, setterPay: false, ...(r ? JSON.parse(r.value) : {}) };
}
export async function setTeamView(v: TeamView) {
  await prisma.integrationSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: JSON.stringify(v) }, update: { value: JSON.stringify(v) } });
}

/** Page guard: the listed roles, plus the team login as a viewer (optionally only if that area is switched on). */
export async function requireViewer(roles: Role[], area?: keyof TeamView): Promise<CurrentUser> {
  // The team login, and estimating / PMs / the foreman, can also look at these pages (view only).
  const u = await requireUser([...roles, "TEAM", "ESTIMATOR", "PM", "FOREMAN"]);
  if (u.role === "TEAM" && area && !(await getTeamView())[area]) redirect("/directory");
  return u;
}
export const isViewer = (u: CurrentUser) => u.role === "TEAM";
