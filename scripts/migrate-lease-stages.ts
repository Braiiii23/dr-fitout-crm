// Runs on every start: moves any lease still on a first-version status onto the new stages
// (Enquiring → Concept proposing → Sign). Safe to re-run.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const MAP: Record<string, string> = {
  Prospect: "Enquiring", Negotiating: "Concept proposing", "Heads of agreement": "Concept proposing",
  Signed: "Sign", Current: "Sign", Expired: "Sign", Lost: "Enquiring",
};
async function main() {
  for (const [from, to] of Object.entries(MAP)) {
    const r = await prisma.lease.updateMany({ where: { status: from }, data: { status: to } });
    if (r.count) console.log(`Leases: ${r.count} moved from "${from}" to "${to}"`);
  }
}
main().catch((e) => console.error("lease stage migration skipped:", e.message)).finally(() => prisma.$disconnect());
