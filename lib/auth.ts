import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./db";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "./session";
import { homeFor as accessHome, type AnyRole } from "./access";

export type Role = SessionPayload["role"];
export type CurrentUser = { id: string; email: string; name: string; role: Role; setterId: string | null; isCeo?: boolean };

/** The original owner login (used as a default owner for imported tasks and availability). */
export const BRAIDEN_EMAIL = "braiden@enpfitouts.com.au";

/** Full control (users, settings, connections): any Admin or CEO login. */
export function isBraiden(u: { role?: string; email: string; isCeo?: boolean }) {
  return !!u.isCeo || u.role === "ADMIN" || u.role === "CEO";
}

/** Effective role: CEO works as Admin; everything else as stored. */
export function effectiveRole(u: { email: string; role: Role }): Role {
  return u.role;
}

/** Reads the session cookie AND re-checks the user in the DB (so deactivation / role changes apply immediately). */
export async function getUser(): Promise<CurrentUser | null> {
  const jar = await cookies();
  const s = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!s) return null;
  const u = await prisma.user.findUnique({ where: { id: s.uid } });
  if (!u || !u.active) return null;
  // A CEO login works exactly like Braiden's admin login everywhere.
  if (u.role === "CEO") return { id: u.id, email: u.email, name: u.name, role: "ADMIN", setterId: u.setterId, isCeo: true };
  const role = effectiveRole({ email: u.email, role: u.role as Role });
  return { id: u.id, email: u.email, name: u.name, role, setterId: u.setterId };
}
export async function requireUser(roles?: Role[]): Promise<CurrentUser> {
  const u = await getUser();
  if (!u) redirect("/login");
  if (roles && !roles.includes(u.role)) redirect(homeFor(u.role));
  return u;
}
export function homeFor(role: Role) {
  return accessHome(role as AnyRole);
}

export const isAdmin = (u: CurrentUser) => u.role === "ADMIN";
