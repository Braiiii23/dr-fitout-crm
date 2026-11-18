"use server";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { BRAIDEN_EMAIL, requireUser, isBraiden } from "@/lib/auth";
import { audit } from "@/lib/automations";

const ROLES = ["ADMIN", "CEO", "BDM", "PM", "FOREMAN", "ESTIMATOR", "ACCOUNTS", "TEAM"];
export async function saveUser(fd: FormData) {
  const u = await requireUser(["ADMIN"]);
  if (!isBraiden(u)) redirect("/myday?err=Only+the+admin+can+manage+users");
  const id = String(fd.get("id") || "");
  const email = String(fd.get("email") || "").trim().toLowerCase();
  const name = String(fd.get("name") || "").trim();
  let role = ROLES.includes(String(fd.get("role"))) ? String(fd.get("role")) : "TEAM";
  const password = String(fd.get("password") || "");
  // Setter records are no longer used in the DR Fitout CRM; keep whatever link an old account had.
  const setterId: string | null = id ? (await prisma.user.findUnique({ where: { id }, select: { setterId: true } }))?.setterId ?? null : null;
  // Only Braiden's own account may be ADMIN
  if (role === "ADMIN" && email !== BRAIDEN_EMAIL) redirect("/users?err=Only+Braiden+can+be+Admin+—+use+CEO+or+Team");
  if (email === BRAIDEN_EMAIL) role = "ADMIN";
  if (id === u.id && role !== "ADMIN" && !(u.isCeo && role === "CEO")) redirect("/users?err=You+can't+remove+your+own+admin+role");
  if (setterId) await prisma.user.updateMany({ where: { setterId, NOT: id ? { id } : undefined }, data: { setterId: null } });
  if (id) {
    await prisma.user.update({ where: { id }, data: { email, name, role, setterId, active: fd.get("active") === "on", ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) } });
  } else {
    if (password.length < 10) redirect("/users?err=Password+must+be+at+least+10+characters");
    if (role === "ADMIN") redirect("/users?err=Only+Braiden+can+be+Admin");
    await prisma.user.create({ data: { email, name, role, setterId, passwordHash: await bcrypt.hash(password, 10) } });
  }
  await audit(u.email, id ? "update" : "create", "User", email);
  redirect("/users?msg=Saved");
}

/** What the team login may view besides the operational pages (finance and pay are off by default). */
export async function saveTeamView(fd: FormData) {
  const u = await requireUser(["ADMIN"]);
  if (u.email.toLowerCase() !== "braiden@enpfitouts.com.au") return;
  const { setTeamView } = await import("@/lib/team-view");
  await setTeamView({ accounts: fd.get("accounts") === "on", setterPay: false });
  await audit(u.email, "team view access", "User", undefined, `accounts=${fd.get("accounts") === "on"}, setterPay=${fd.get("setterPay") === "on"}`);
  revalidatePath("/users");
}
