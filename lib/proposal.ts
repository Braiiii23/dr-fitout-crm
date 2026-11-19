import "server-only";
import { prisma } from "./db";
import { summarise, parseProposal, PAYMENT_TERMS, STANDARD_EXCLUSIONS, type SheetLine, type ProposalInfo } from "./estimate-sheet";
import TERMS from "./proposal-terms.json";

export type Proposal = Awaited<ReturnType<typeof buildProposal>>;
const today = () => new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date());
export const aud = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The client proposal, built from the estimate sheet (Maroochy / Proposal.docx layout). Section prices are sell ex GST. */
export async function buildProposal(leadId: string) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { estimateLines: { orderBy: { sortOrder: "asc" } } } });
  if (!lead) return null;
  const settings = await prisma.accountsSettings.findUnique({ where: { id: "settings" }, select: { estMarginPct: true } });
  const sum = summarise(lead.estimateLines as SheetLine[], lead.estMarginPct ?? settings?.estMarginPct ?? 35);
  const saved = parseProposal(lead.estProposal);
  const info: Required<Omit<ProposalInfo, "exclusions" | "assumptions" | "notes">> & { notes: string } = {
    title: saved.title || [lead.company || lead.leadName, lead.projectType].filter(Boolean).join(" – ") || "Fitout",
    businessName: saved.businessName || lead.company || "", contact: saved.contact || [lead.leadName, lead.phone].filter(Boolean).join(" – "),
    email: saved.email || lead.email || "", abn: saved.abn || "", businessAddress: saved.businessAddress || "", projectAddress: saved.projectAddress || lead.location || "",
    salesContact: saved.salesContact || "TBC", dateIssued: saved.dateIssued || today(), expiry: saved.expiry || "7 days from the date issued", notes: saved.notes || "",
  };
  const sections = sum.bands.map((b, i) => ({
    no: i + 1, band: b.band, price: b.sell, provisional: b.provisional,
    items: lead.estimateLines.filter((l) => l.band === b.band).map((l) => {
      const text = (l.clientText || "").trim() || (b.band === "Preliminaries" ? `Allowance for ${l.item.charAt(0).toLowerCase()}${l.item.slice(1)}` : `Supply and install ${l.item}`);
      return l.provisional && !b.provisional && !/^provisional sum/i.test(text) ? `Provisional sum: ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
    }),
  }));
  const exclusions = [...(saved.exclusions?.length ? saved.exclusions : []), ...STANDARD_EXCLUSIONS.filter((x) => !(saved.exclusions ?? []).includes(x))];
  return { lead: { id: lead.id, brand: lead.brand }, info, sections, summary: { sell: sum.sell, gst: sum.gst, total: sum.total }, exclusions, assumptions: saved.assumptions ?? [], payment: PAYMENT_TERMS, terms: TERMS as { h: string; p: string[] }[], empty: sum.bands.length === 0 };
}
