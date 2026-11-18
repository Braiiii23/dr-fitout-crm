import "server-only";
import { prisma } from "./db";

export const NOTICE_CATEGORIES = ["Update", "Progress", "Win", "Heads up", "Site"];

/** The CRM posts progress to the My Day notice board (stage moves, signed work, concept fits). Never throws. */
export async function autoNotice(category: string, body: string, link?: string, linkLabel?: string) {
  try {
    // Don't repeat the same automatic notice within an hour (e.g. a stage flicked back and forth).
    const recent = await prisma.notice.findFirst({ where: { auto: true, body, createdAt: { gte: new Date(Date.now() - 3600000) } } });
    if (recent) return;
    await prisma.notice.create({ data: { authorName: "DR Fitout CRM", category, body: body.slice(0, 2000), link: link ?? null, linkLabel: linkLabel ?? null, auto: true } });
  } catch { /* the board is nice-to-have: never block the real save */ }
}
