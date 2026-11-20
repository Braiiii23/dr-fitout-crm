// One-off password reset for ONE login, run on start when RESET_ID has a new value.
// Env: RESET_LOGIN (username / email; if not found, the first Admin login is used), RESET_PASSWORD, RESET_ID.
// Also re-activates the login. Logs the exact username so we know what to sign in with. Never logs the password.
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
async function main() {
  const want = (process.env.RESET_LOGIN ?? "").trim().toLowerCase();
  const pw = process.env.RESET_PASSWORD ?? "";
  if (pw.length < 8) { console.log("Login reset skipped: RESET_PASSWORD missing or too short"); return; }
  const admins = await prisma.user.findMany({ where: { role: { in: ["ADMIN", "CEO"] } }, select: { email: true, name: true, active: true, role: true } });
  console.log(`Admin logins: ${admins.map((a) => `${a.email} (${a.name}${a.active ? "" : ", inactive"})`).join("; ") || "none"}`);
  const u = (want && (await prisma.user.findUnique({ where: { email: want } }))) || (await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } }));
  if (!u) { console.log(`Login reset: no user found for "${want}"`); return; }
  await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(pw, 12), active: true } });
  console.log(`Login reset: new password set for "${u.email}" (${u.name}, ${u.role})`);
}
main().finally(() => prisma.$disconnect());
