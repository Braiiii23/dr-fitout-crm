// Runs on every start: moves any old single lease → concept link into the lease's list of concepts.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
(async () => {
  const old = await prisma.lease.findMany({ where: { conceptId: { not: null } }, select: { id: true, conceptId: true } });
  for (const l of old) await prisma.lease.update({ where: { id: l.id }, data: { concepts: { connect: { id: l.conceptId! } }, conceptId: null } });
  if (old.length) console.log(`Moved ${old.length} lease concept link(s) into the concepts list`);
  await prisma.$disconnect();
})();
