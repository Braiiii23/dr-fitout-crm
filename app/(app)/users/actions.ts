"use server";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser, isBraiden } from "@/lib/auth";
import { audit } from "@/lib/automations";

const ROLES = ["ADMIN", "CEO", "BDM", "PM", "FOREMAN", "ESTIMATOR", "ACCOUNTS", "TEAM"];
const ADMIN_ROLES = ["ADMIN", "CEO"];
const back = (k: "msg" | "err", t: string): never => redirect(`/users?${k}=${encodeURIComponent(t)}`);

/** Add or change a login. Any Admin can do this. The login name can be a username (e.g. "phi") or an email address. */
export async function saveUser(fd: FormData) {
  const u = await requireUser(["ADMIN"]);
  if (!isBraiden(u)) back("err", "Only an Admin can manage users.");
  const id = String(fd.get("id") || "");
  const login = String(fd.get("email") || "").trim().toLowerCase();
  const name = String(fd.get("name") || "").trim();
  const role = ROLES.includes(String(fd.get("role"))) ? String(fd.get("role")) : "TEAM";
  const password = String(fd.get("password") || "");
  const active = id ? fd.get("active") === "on" : true;
  if (!/^[a-z0-9][a-z0-9._@+-]{1,99}$/.test(login)) back("err", "Username: 2–100 characters, letters, numbers and . _ - @ only (no spaces). An email address works too.");
  if (!name) back("err", "Add the person's name.");
  if (password && password.length < 8) back("err", "Passwords need at least 8 characters.");
  if (!id && !password) back("err", "Set a password for the new user.");
  const clash = await prisma.user.findUnique({ where: { email: login } });
  if (clash && clash.id !== id) back("err", `"${login}" is already used by ${clash.name}. Pick another username.`);

  if (id) {
    const before = await prisma.user.findUnique({ where: { id } });
    if (!before) back("err", "That user no longer exists.");
    // Never lock everyone out: you can't take away your own admin, and there must always be an active Admin.
    if (id === u.id && (!ADMIN_ROLES.includes(role) || !active)) back("err", "You can't remove your own admin access or switch yourself off. Ask another Admin.");
    if (ADMIN_ROLES.includes(before!.role) && (!ADMIN_ROLES.includes(role) || !active)) {
      const others = await prisma.user.count({ where: { id: { not: id }, active: true, role: { in: ADMIN_ROLES } } });
      if (!others) back("err", "There must always be at least one active Admin.");
    }
    await prisma.user.update({ where: { id }, data: { email: login, name, role, active, ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) } });
    await audit(u.email, password ? "update + password" : "update", "User", login);
    back("msg", `Saved ${name}${password ? " (new password set)" : ""}.`);
  }
  await prisma.user.create({ data: { email: login, name, role, passwordHash: await bcrypt.hash(password, 10) } });
  await audit(u.email, "create", "User", login);
  back("msg", `Added ${name}. They sign in with "${login}" and the password you set.`);
}

/** What the team login may view besides the operational pages (finance and pay are off by default). */
export async function saveTeamView(fd: FormData) {
  const u = await requireUser(["ADMIN"]);
  const { setTeamView } = await import("@/lib/team-view");
  await setTeamView({ accounts: fd.get("accounts") === "on", setterPay: false });
  await audit(u.email, "team view access", "User", undefined, `accounts=${fd.get("accounts") === "on"}, setterPay=${fd.get("setterPay") === "on"}`);
  revalidatePath("/users");
}

