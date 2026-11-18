// Runs on every start. Keeps the team login on TEAM_EMAIL, and creates the estimator and accounts logins if they don't exist yet.
// Never changes an existing account, so passwords changed in the app are kept.
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
async function ensure(email: string | undefined, pw: string | undefined, name: string, role: string) {
  const e = email?.trim().toLowerCase();
  if (!e || !pw) return;
  if (await prisma.user.findUnique({ where: { email: e } })) return;
  await prisma.user.create({ data: { email: e, name, role, passwordHash: await bcrypt.hash(pw, 12) } });
  console.log(`Created ${role.toLowerCase()} login for ${e}`);
}
/** The shared team login follows TEAM_EMAIL: if no account has that email yet, the one team login is renamed to it (password kept). */
async function teamEmail() {
  const e = process.env.TEAM_EMAIL?.trim().toLowerCase();
  if (!e || (await prisma.user.findUnique({ where: { email: e } }))) return;
  const teams = await prisma.user.findMany({ where: { role: "TEAM" } });
  if (teams.length !== 1) return;
  await prisma.user.update({ where: { id: teams[0].id }, data: { email: e, name: "DR Fitout Team" } });
  console.log(`Team login is now ${e} (was ${teams[0].email})`);
}
async function main() {
  await teamEmail();
  await ensure(process.env.ESTIMATOR_EMAIL, process.env.ESTIMATOR_PASSWORD, process.env.ESTIMATOR_NAME || "Justin", "ESTIMATOR");
  await ensure(process.env.ACCOUNTS_EMAIL, process.env.ACCOUNTS_PASSWORD, process.env.ACCOUNTS_NAME || "Accounts", "ACCOUNTS");
}
main().finally(() => prisma.$disconnect());
