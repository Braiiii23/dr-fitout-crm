// One-off: set the Accounts gross margin goal from GROSS_MARGIN_GOAL (start.sh runs it once per value).
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const v = Number(process.env.GROSS_MARGIN_GOAL);
  if (!Number.isFinite(v) || v <= 0 || v >= 100) return;
  await prisma.accountsSettings.upsert({ where: { id: "settings" }, create: { id: "settings", grossMarginGoal: v }, update: { grossMarginGoal: v } });
  console.log(`Gross margin goal set to ${v}%`);
}
main().finally(() => prisma.$disconnect());
