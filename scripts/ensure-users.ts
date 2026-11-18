// Runs on every start. Creates the estimator and accounts logins if they don't exist yet.
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
async function main() {
  await ensure(process.env.ESTIMATOR_EMAIL, process.env.ESTIMATOR_PASSWORD, process.env.ESTIMATOR_NAME || "Justin", "ESTIMATOR");
  await ensure(process.env.ACCOUNTS_EMAIL, process.env.ACCOUNTS_PASSWORD, process.env.ACCOUNTS_NAME || "Accounts", "ACCOUNTS");
}
main().finally(() => prisma.$disconnect());
