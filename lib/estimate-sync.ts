import "server-only";
import { prisma } from "./db";
import { AI_EST } from "./estimating";
import { summarise, type SheetLine } from "./estimate-sheet";

/** The sheet's band costs go into the trade pack as "AI estimate" prices (cost side). Real quotes then follow the higher/lower rule. */
export async function syncTradePack(leadId: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { estMarginPct: true, estimateLines: true } });
  if (!lead) return null;
  const settings = await prisma.accountsSettings.findUnique({ where: { id: "settings" }, select: { estMarginPct: true } });
  const s = summarise(lead.estimateLines as SheetLine[], lead.estMarginPct ?? settings?.estMarginPct ?? 35);
  await prisma.$transaction([
    prisma.tradeQuote.deleteMany({ where: { leadId, status: AI_EST } }),
    prisma.tradeQuote.createMany({ data: s.bands.map((b) => ({ leadId, trade: b.band, company: "DR estimate (sheet)", scope: `${b.lines} line${b.lines === 1 ? "" : "s"} on the estimate sheet${b.provisional ? " · provisional sum" : ""}`, price: Math.round(b.cost * 100) / 100, status: AI_EST })) }),
  ]);
  return s;
}
