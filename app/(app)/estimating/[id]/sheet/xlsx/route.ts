import ExcelJS from "exceljs";
import { prisma } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { canOpen, type AnyRole } from "@/lib/access";
import { BANDS, AT_COST_BANDS } from "@/lib/estimating";

export const dynamic = "force-dynamic";

/** The estimate sheet as an Excel workbook: MB summary with one margin cell, and a tab per band. Everything is a live formula. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u || !canOpen(u.role as AnyRole, "/estimating")) return new Response("Not allowed", { status: 403 });
  const { id } = await params;
  const job = await prisma.lead.findUnique({ where: { id }, select: { brand: true, company: true, leadName: true, location: true, sizeSqm: true, estMarginPct: true, estimateLines: { orderBy: { sortOrder: "asc" } } } });
  if (!job || (job.brand !== "DR" && job.brand !== "ENP")) return new Response("Not found", { status: 404 });
  const settings = await prisma.accountsSettings.findUnique({ where: { id: "settings" }, select: { estMarginPct: true } });
  const margin = (job.estMarginPct ?? settings?.estMarginPct ?? 35) / 100;
  const title = job.company || job.leadName || "Job";

  const wb = new ExcelJS.Workbook(); wb.creator = "DR Fitout CRM";
  const money = '"$"#,##0.00';
  const head = (ws: ExcelJS.Worksheet, row: number) => { ws.getRow(row).font = { bold: true, color: { argb: "FFFFFFFF" } }; ws.getRow(row).eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5B2A86" } }; }); };
  const mb = wb.addWorksheet("MB");
  const used = [...BANDS, ...[...new Set(job.estimateLines.map((l) => l.band))].filter((b) => !BANDS.includes(b))].filter((b) => job.estimateLines.some((l) => l.band === b));
  const tabName = (b: string) => b.replace(/[\\/?*[\]:]/g, " ").slice(0, 31).toUpperCase();
  const SRC: Record<string, string> = { ESTIMATE: "FFFDE68A", JUSTIN: "FFBFDBFE", QUOTE: "FFBBF7D0", "PAST JOB": "FFDDD6FE", XERO: "FFA5F3FC" };

  for (const band of used) {
    const ws = wb.addWorksheet(tabName(band));
    ws.columns = [{ width: 48 }, { width: 9 }, { width: 8 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 14 }, { width: 11 }, { width: 6 }, { width: 50 }, { width: 50 }];
    ws.addRow([band.toUpperCase()]).font = { bold: true, size: 14 };
    ws.addRow(["Item", "Qty", "Unit", "Supply $/unit", "Install $/unit", "S&I $/unit", "Cost", "Source", "PS", "Source / working", "Proposal wording"]); head(ws, 2);
    const lines = job.estimateLines.filter((l) => l.band === band);
    lines.forEach((l, i) => {
      const r = i + 3;
      const row = ws.addRow([l.item, l.qty, l.unit ?? "", l.supplyRate, l.installRate, { formula: `D${r}+E${r}` }, { formula: `B${r}*F${r}` }, l.source, l.provisional ? "PS" : "", l.sourceNote ?? "", l.clientText ?? ""]);
      row.getCell(8).fill = { type: "pattern", pattern: "solid", fgColor: { argb: SRC[l.source] ?? "FFFFFFFF" } };
      if (l.provisional) row.font = { color: { argb: "FFB91C1C" } };
    });
    for (let k = 0; k < 5; k++) { const r = lines.length + 3 + k; ws.addRow(["", null, "", null, null, { formula: `D${r}+E${r}` }, { formula: `B${r}*F${r}` }]); } // spare formula rows
    const last = lines.length + 7;
    const tot = ws.addRow(["TOTAL (cost, ex GST)", null, null, null, null, null, { formula: `SUM(G3:G${last})` }]); tot.font = { bold: true };
    [4, 5, 6, 7].forEach((c) => (ws.getColumn(c).numFmt = money));
    ws.views = [{ state: "frozen", ySplit: 2 }];
    (ws as unknown as { _totalRow: number })._totalRow = tot.number;
  }

  mb.columns = [{ width: 34 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 14 }];
  mb.addRow([`${title} — estimate`]).font = { bold: true, size: 14 };
  mb.addRow(["Project address", job.location ?? ""]);
  mb.addRow(["Total area (m²)", job.sizeSqm ?? ""]);
  const mRow = mb.addRow(["Profit margin (on cost)", margin]); mRow.getCell(2).numFmt = "0%"; mRow.getCell(2).font = { bold: true, color: { argb: "FF7C3AED" } };
  mb.addRow(["", "Master margin: change it here and every band updates. Preliminaries and Miscellaneous are at cost."]);
  mb.addRow([]);
  mb.addRow(["Category", "Cost", "Margin", "Sell ex GST", "Effective margin"]); head(mb, 7);
  const first = 8;
  used.forEach((band, i) => {
    const r = first + i; const ws = wb.getWorksheet(tabName(band))!; const tr = (ws as unknown as { _totalRow: number })._totalRow;
    mb.addRow([band.toUpperCase(), { formula: `'${tabName(band)}'!G${tr}` }, { formula: AT_COST_BANDS.includes(band) ? "0" : `B${r}*$B$4` }, { formula: `ROUNDUP(B${r}+C${r},1)` }, { formula: `IF(B${r}=0,"",C${r}/B${r})` }]);
  });
  const lastBand = first + used.length - 1;
  const t = mb.addRow(["TOTAL ex GST", { formula: `SUM(B${first}:B${lastBand})` }, { formula: `SUM(C${first}:C${lastBand})` }, { formula: `SUM(D${first}:D${lastBand})` }, { formula: `IF(B${lastBand + 1}=0,"",C${lastBand + 1}/B${lastBand + 1})` }]); t.font = { bold: true };
  mb.addRow(["GST (10%)", null, null, { formula: `D${t.number}*0.1` }]);
  mb.addRow(["TOTAL inc GST", null, null, { formula: `D${t.number}+D${t.number + 1}` }]).font = { bold: true };
  [2, 3, 4].forEach((c) => (mb.getColumn(c).numFmt = money)); mb.getColumn(5).numFmt = "0.0%"; mRow.getCell(2).numFmt = "0%";

  const buf = await wb.xlsx.writeBuffer();
  const file = `${title.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") || "Job"}_Estimate.xlsx`;
  return new Response(buf as ArrayBuffer, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${file}"` } });
}
