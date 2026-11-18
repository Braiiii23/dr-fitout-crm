import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
(async () => {
  const j = await db.user.findUnique({ where: { email: process.env.SETTER_EMAIL! } });
  console.log("jessie calls", await db.callListItem.count({ where: { setterId: j!.setterId! } }), "total calls", await db.callListItem.count());
  console.log("leads", await db.lead.groupBy({ by: ["brand"], _count: true }));
  console.log("slots", await db.freeSlot.groupBy({ by: ["status"], _count: true }));
  console.log("dups flagged", await db.callListItem.count({ where: { possibleDuplicate: true } }));
})();
