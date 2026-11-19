import { readFile } from "fs/promises";
import { join } from "path";
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, ShadingType, TabStopType, ImageRun, BorderStyle } from "docx";
import { getUser } from "@/lib/auth";
import { canOpen, type AnyRole } from "@/lib/access";
import { buildProposal, aud } from "@/lib/proposal";

export const dynamic = "force-dynamic";
const FONT = "Arial";
const run = (text: string, o: { bold?: boolean; size?: number; color?: string } = {}) => new TextRun({ text, font: FONT, size: o.size ?? 21, bold: o.bold, color: o.color });
const para = (text: string, o: { bold?: boolean; size?: number; after?: number } = {}) => new Paragraph({ spacing: { after: o.after ?? 80 }, children: [run(text, o)] });
/** Grey heading bar with the section price right-aligned on a tab stop (proposal format). */
const bar = (left: string, right = "") => new Paragraph({
  shading: { type: ShadingType.CLEAR, color: "auto", fill: "E5E5E5" }, spacing: { before: 240, after: 100 },
  tabStops: [{ type: TabStopType.RIGHT, position: 9600 }], children: [run(left, { bold: true, size: 22 }), ...(right ? [run(`\t${right}`, { bold: true, size: 22 })] : [])],
});
const item = (no: string, text: string) => new Paragraph({ spacing: { after: 60 }, indent: { left: 720, hanging: 720 }, children: [run(`${no}\t${text}`)], tabStops: [{ type: TabStopType.LEFT, position: 720 }] });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u || !canOpen(u.role as AnyRole, "/estimating")) return new Response("Not allowed", { status: 403 });
  const { id } = await params;
  const p = await buildProposal(id);
  if (!p) return new Response("Not found", { status: 404 });
  const i = p.info;
  const logo = await readFile(join(process.cwd(), "public/brand/dr-logo-dark.png")).catch(() => null);
  const cell = (text: string, head: boolean) => new TableCell({
    width: { size: head ? 35 : 65, type: WidthType.PERCENTAGE },
    shading: head ? { type: ShadingType.CLEAR, color: "auto", fill: "5B2A86" } : undefined,
    children: [new Paragraph({ children: [run(text, { bold: head, color: head ? "FFFFFF" : undefined, size: 19 })] })],
  });
  const info = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: ([["COST ESTIMATE", i.title], ["BUSINESS NAME", i.businessName], ["CUSTOMER CONTACT #", i.contact], ["CUSTOMER EMAIL", i.email], ["ABN", i.abn], ["BUSINESS ADDRESS", i.businessAddress], ["PROJECT ADDRESS", i.projectAddress], ["SALES CONTACT", i.salesContact], ["DATE ISSUED", i.dateIssued], ["EXPIRY DATE", i.expiry]] as [string, string][])
      .map(([k, v]) => new TableRow({ children: [cell(k, true), cell(v || "", false)] })),
  });
  const n = p.sections.length;
  const children = [
    ...(logo ? [new Paragraph({ spacing: { after: 240 }, children: [new ImageRun({ type: "png", data: logo, transformation: { width: 210, height: 47 } })] })] : []),
    info,
    ...p.sections.flatMap((s) => [bar(`${s.no}.  ${s.band} scope of works${s.provisional ? " – Provisional Sum" : ""}`, aud(s.price)), ...s.items.map((t, k) => item(`${s.no}.${k + 1}.`, t))]),
    bar("Price summary"),
    ...p.sections.map((s) => new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: 9600 }], spacing: { after: 40 }, children: [run(`${s.no}. ${s.band}${s.provisional ? " (Provisional Sum)" : ""}\t${aud(s.price)}`)] })),
    new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: 9600 }], border: { top: { style: BorderStyle.SINGLE, size: 8, color: "111111" } }, spacing: { before: 80, after: 40 }, children: [run(`Total ex GST\t${aud(p.summary.sell)}`, { bold: true })] }),
    new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: 9600 }], spacing: { after: 40 }, children: [run(`GST (10%)\t${aud(p.summary.gst)}`)] }),
    new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: 9600 }], spacing: { after: 80 }, children: [run(`Total inc GST\t${aud(p.summary.total)}`, { bold: true })] }),
    ...(i.notes ? [para(i.notes)] : []),
    bar(`${n + 1}.  Exclusions`),
    ...p.exclusions.map((t, k) => item(`${n + 1}.${k + 1}.`, t)),
    para("This quotation is subject to a site inspection. Any other works not specifically listed in this quotation are excluded."),
    ...(p.assumptions.length ? [bar("Assumptions"), ...p.assumptions.map((t) => new Paragraph({ bullet: { level: 0 }, children: [run(t)] }))] : []),
    para("ESTIMATED START DATE: TBA", { bold: true, after: 0 }), para("ESTIMATED COMPLETION DATE: TBA", { bold: true }),
    new Paragraph({ alignment: AlignmentType.LEFT, spacing: { before: 120, after: 160 }, border: { top: { style: BorderStyle.SINGLE, size: 12, color: "111111" }, bottom: { style: BorderStyle.SINGLE, size: 12, color: "111111" } }, children: [run(`Total Exc. GST: ${aud(p.summary.sell)} + GST`, { bold: true, size: 24 })] }),
    para("PAYMENT SCHEDULE:", { bold: true }), para(p.payment),
    para("Should you wish to engage DR Fitout, please sign and date this acceptance page, and review and initial all pages in this document. On receipt of the signed document we will provide a deposit invoice (payable immediately) and schedule construction of your project."),
    para("We would like to thank you for choosing DR Fitout."), para("Yours faithfully,", { after: 360 }),
    para("Signed: ______________________    Name: ______________________    Date: __________", { after: 240 }),
    new Paragraph({ pageBreakBefore: true, children: [run("Terms and Conditions", { bold: true, size: 26 })] }),
    ...p.terms.flatMap((t, k) => [para(`${k + 1}. ${t.h}`, { bold: true, size: 19 }), ...t.p.map((x) => para(x, { size: 17, after: 40 }))]),
  ];
  const doc = new Document({ styles: { default: { document: { run: { font: FONT, size: 21 } } } }, sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } }, children }] });
  const buf = await Packer.toBuffer(doc);
  const file = `${(i.businessName || i.title).replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "Job"}_Proposal_v1.docx`;
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Content-Disposition": `attachment; filename="${file}"` } });
}
