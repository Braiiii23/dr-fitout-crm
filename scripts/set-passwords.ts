// Sets the three login passwords from .env without re-importing any data.
// Use when the database came from another machine and its passwords are unknown.
// Run: npm run set-passwords
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const accounts = [
  [process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD],
  [process.env.SETTER_EMAIL, process.env.SETTER_PASSWORD],
  [process.env.TEAM_EMAIL, process.env.TEAM_PASSWORD],
] as const;

async function main() {
  for (const [email, pw] of accounts) {
    if (!email || !pw || pw === "CHANGE_ME") {
      console.log(`Skipped ${email ?? "(no email)"}: set a real password in .env first`);
      continue;
    }
    const passwordHash = await bcrypt.hash(pw, 12);
    const r = await prisma.user.updateMany({ where: { email: email.toLowerCase() }, data: { passwordHash } });
    console.log(r.count ? `Password set for ${email}` : `No user found for ${email}`);
  }
}
main().finally(() => prisma.$disconnect());
