// Seeds Hecho Robina (job 898 / HECH002) from Justin's WIP example as at Fri 6 Nov 2026.
// Safe to run more than once: it does nothing if job 898 already exists. Run: npm run seed:wip
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  if (await prisma.job.findFirst({ where: { jobNumber: "898" } })) { console.log("Hecho Robina (898) already exists, nothing to do."); return; }
  const contract = 640574.88;
  const job = await prisma.job.create({
    data: {
      brand: "ENP", name: "Hecho En Mexico Robina", jobNumber: "898", xeroTracking: "HECH002", client: "Hecho En Mexico Robina Pty Ltd",
      contractValue: contract, status: "Live", startDate: "2026-10-19", finishDate: "2026-12-11", pm: "Josh", source: "seed",
      notes: "Seeded from Justin's WIP example (6 Nov 2026). Signed split 30/30/20/15/5. Never mix with Hecho West End 824 / HECH001.",
    },
  });

  // Claims: this job's signed split, 30/30/20/15/5.
  const claims: [number, string, number, string, string | null, string, string | null, string | null, number, string | null][] = [
    [1, "Deposit", 30, "Before start", "INV-2192", "Authorised", "2026-09-25", "2026-09-29", 195000, "Payments 2/3/5/9/11/30 Oct. $16,389.71 inc still owing."],
    [2, "Sheeting complete", 30, "Once sheeting is finished", "INV-2193", "Authorised", "2026-11-03", "2026-11-13", 0, "Authorised 3 Nov, unpaid."],
    [3, "Joinery and finishes (1)", 20, "Near joinery and finishes", "INV-2194", "Draft", null, null, 0, null],
    [4, "Joinery and finishes (2)", 15, "Near joinery and finishes (later)", "INV-2195", "Draft", null, null, 0, null],
    [5, "Handover", 5, "Last week before handover / certifications", "INV-2196", "Draft", null, null, 0, null],
  ];
  let allocated = 0;
  for (const [seq, name, pct, hook, inv, status, invoicedDate, dueDate, receivedInc, notes] of claims) {
    // The last claim takes the remainder so the schedule adds up to the contract to the cent.
    const amount = seq === claims.length ? Math.round((contract - allocated) * 100) / 100 : Math.round(contract * pct) / 100;
    allocated += amount;
    await prisma.jobClaim.create({ data: { jobId: job.id, seq, name, pct, amount, hook, invoiceNumber: inv, status, invoicedDate, dueDate, receivedInc, notes, source: "seed" } });
  }

  // Trades: Costs / Paid (null = Pending). New construction's paid comes from the linked labour and Bunnings receipt.
  const lines: [string, number, number | null, string, string | null][] = [
    ["New construction", 57223.56, null, "Quoted", "Allowance note $78,110.16 is estimate-only, not used as Costs. Paid = labour + Bunnings (linked)."],
    ["Flooring (Prestige)", 7882, null, "Quoted", null], ["Tiling (Spectra)", 20555, null, "Quoted", null], ["Painting (m3)", 15368, null, "Quoted", null],
    ["Plastering", 14905, null, "Quoted", "Guestimate note on source page; note only."],
    ["Joinery (Interlocked)", 94500, 35330.03, "Quoted", "Paid = Interlocked INV0500."],
    ["Shopfront (TJ)", 19206.65, null, "Quoted", null], ["CCTV (Willers)", 6280, null, "Quoted", null],
    ["Stone (Beyond / Made of Stone)", 25999.01, null, "Quoted", null], ["Glazing (T&E)", 1350, null, "Quoted", null],
    ["Stainless (MAG)", 65692, 24396, "Quoted", "Paid = MAG INV2899."], ["Plumbing (PBS)", 40203.68, null, "Provisional", null],
    ["Electrical (CNC)", 37000, null, "Provisional", null], ["Waterproofing", 2200, null, "Quoted", null], ["Signage (Lumad)", 1000, null, "Provisional", null],
    ["HVAC (Tom)", 9500, null, "Quoted", null], ["Render", 17257, null, "Quoted", "Known quote; payment unknown."], ["Structural", 2200, null, "Quoted", null],
    ["Silicone", 1100, null, "Quoted", null], ["Rubbish", 2000, null, "Quoted", null], ["Parking", 1500.12, null, "Quoted", null],
    ["Builders clean", 2000, null, "Quoted", null], ["Building approval", 2500, 2181, "Quoted", "Paid = BA INV239882."],
    ["QLeave", 2000, 4052, "Quoted", "Over the $2,000 allowance."],
  ];
  const ids: Record<string, string> = {};
  let sort = 0;
  for (const [trade, cost, paid, costStatus, notes] of lines) {
    const l = await prisma.jobCostLine.create({ data: { jobId: job.id, trade, cost, paid, costStatus, notes, sort: sort++, source: "seed" } });
    ids[trade] = l.id;
  }

  // Interlocked INV0509: authorised, owing, due 12 Nov, not yet mapped to a claim.
  await prisma.jobBill.create({ data: { jobId: job.id, costLineId: ids["Joinery (Interlocked)"], supplier: "Interlocked", invoiceNumber: "INV0509", amount: 35330.03, status: "Authorised", dueDate: "2026-11-12", claimSeq: null, source: "seed" } });

  // BuilderTrend Time Clock, 23 Oct to 6 Nov 2026 (all pending approval), by person at ordinary rates.
  const labour: [string, number, number, string | null][] = [
    ["Khodi Mcdonald", 21.5833, 40.49, null], ["Rishad Sabatino", 17.6833, 27.5, null],
    ["Tukimaka Fuapau (Maks)", 15.4833, 33.67, "Includes 3.90 OT costed at ordinary rate"], ["Byeonguk Kang (Bryan)", 9.8667, 31, null],
  ];
  for (const [person, hours, rate, notes] of labour) {
    await prisma.jobLabour.create({ data: { jobId: job.id, costLineId: ids["New construction"], date: "2026-11-06", person, hours, rate, approved: false, notes: notes ?? "Time Clock 23 Oct to 6 Nov 2026", source: "seed" } });
  }
  await prisma.jobMaterial.create({ data: { jobId: job.id, costLineId: ids["New construction"], date: "2026-11-03", supplier: "Bunnings", description: "HECH002-tagged purchase", amount: 19.33, source: "seed" } });

  // Josh's program (BuilderTrend export, 15 Oct 2026), with the working claim mapping.
  const tasks: [string, string, string, number | null][] = [
    ["Framing", "2026-10-19", "2026-10-23", null], ["Bracing", "2026-10-23", "2026-10-23", null], ["Bi-fold door measure", "2026-10-26", "2026-10-26", null],
    ["Cabinetry Measure", "2026-10-26", "2026-10-26", null], ["CCTV rough in", "2026-10-26", "2026-10-27", null], ["Electrical rough in", "2026-10-26", "2026-10-28", null],
    ["Plumbing Rough in", "2026-10-26", "2026-10-27", null], ["Rough in AC", "2026-10-26", "2026-10-26", null], ["Canopy Install", "2026-11-02", "2026-11-03", null],
    ["Archway install", "2026-11-04", "2026-11-04", null], ["Sheeting", "2026-11-04", "2026-11-05", 2], ["Setting", "2026-11-06", "2026-11-11", null],
    ["AC cut out", "2026-11-10", "2026-11-10", null], ["Electrical cut out", "2026-11-10", "2026-11-10", null], ["Cabinetry install for waterproofing", "2026-11-11", "2026-11-11", null],
    ["Glazing measure", "2026-11-12", "2026-11-12", null], ["Waterproofing", "2026-11-12", "2026-11-12", null], ["Vinyl floor Install", "2026-11-13", "2026-11-16", null],
    ["Tiling", "2026-11-17", "2026-11-19", null], ["Bi-fold door install", "2026-11-20", "2026-11-20", null], ["Cabinetry install", "2026-11-20", "2026-11-26", 3],
    ["Install cladding", "2026-11-20", "2026-11-24", 3], ["Protection", "2026-11-20", "2026-11-20", null], ["Stainless install", "2026-11-20", "2026-11-26", 3],
    ["Stone install", "2026-11-20", "2026-11-20", 3], ["Install breezeblocks", "2026-11-25", "2026-11-26", null], ["Glazing install", "2026-11-26", "2026-11-26", null],
    ["Render", "2026-11-27", "2026-11-30", 4], ["Venetian Plaster", "2026-11-27", "2026-11-30", 4], ["Painting", "2026-12-01", "2026-12-03", 4],
    ["Plumbing fitoff", "2026-12-03", "2026-12-07", 4], ["Signage (INSTALL ONLY)", "2026-12-03", "2026-12-04", null], ["AC fit off", "2026-12-04", "2026-12-04", 4],
    ["CCTV fit off", "2026-12-04", "2026-12-04", null], ["Electrical fitoff", "2026-12-04", "2026-12-09", 4], ["Equipment delivery", "2026-12-04", "2026-12-04", null],
    ["Defects and Skirting", "2026-12-08", "2026-12-09", 5], ["Full site clean", "2026-12-09", "2026-12-09", 5], ["Silicone", "2026-12-10", "2026-12-10", 5], ["Final Clean", "2026-12-11", "2026-12-11", 5],
  ];
  for (const [name, start, finish, claimSeq] of tasks) await prisma.jobTask.create({ data: { jobId: job.id, name, start, finish, claimSeq, source: "seed" } });
  console.log(`Seeded Hecho Robina (898): ${claims.length} claims, ${lines.length} trades, ${labour.length} labour rows, ${tasks.length} program tasks.`);
}
main().finally(() => prisma.$disconnect());
