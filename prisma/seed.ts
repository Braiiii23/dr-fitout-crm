// One-time import of the Airtable JSON export (../enp-leads-rebuild/data) using field-id-map.json.
// Airtable record ids are preserved in `externalId` and used to remap links.
// Safe to re-run: records are upserted by externalId.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();
const DATA = process.env.SEED_DATA_DIR || path.resolve(__dirname, "../../enp-leads-rebuild/data");

function load(file: string) {
  const s = fs.readFileSync(path.join(DATA, file), "utf8");
  // Some exports are wrapped in tool markers — keep only the JSON object.
  return JSON.parse(s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1));
}
const fieldMap: Record<string, { name: string; fields: Record<string, { name: string; type: string }> }> = load("field-id-map.json");

type Rec = { id: string; createdTime: string; f: Record<string, any> };
function records(file: string, tableId: string): Rec[] {
  const d = load(file);
  const fm = fieldMap[tableId].fields;
  return d.records.map((r: any) => {
    const f: Record<string, any> = {};
    for (const [fid, v] of Object.entries(r.cellValuesByFieldId)) { const meta = fm[fid]; if (meta) f[meta.name] = v; }
    return { id: r.id, createdTime: r.createdTime, f };
  });
}
const sel = (v: any): string | null => (v && typeof v === "object" && "name" in v ? String(v.name).trim() : typeof v === "string" ? v.trim() : null);
const txt = (v: any): string | null => (v === undefined || v === null || v === "" ? null : String(v));
const num = (v: any): number | null => (typeof v === "number" ? v : v ? Number(v) : null);
const bool = (v: any) => v === true;
const dt = (v: any): Date | null => (v ? new Date(v) : null);
const links = (v: any): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : x.id)) : v?.linkedRecordIds ?? []);
const stage = (v: any) => { const s = sel(v); return s === "Potential Leases" ? "Potential Leases" : s; };

async function main() {
  const T = { ENP: "tblLV7P9TbWcdBxe6", CONS: "tblpgOao38z0mfnE5", DR: "tblUmbZKLnAfzYJJF", CALL: "tblRnqNKk6TPte49K", SET: "tblxPURyoBnjFsLn0", SLOT: "tblg4HGoLLyKKj5RE" };

  // 1. Setters
  const setterIds: Record<string, string> = {};
  for (const r of records("setters.json", T.SET)) {
    const data = { name: (txt(r.f["Name"]) ?? "Unnamed").trim(), email: txt(r.f["Email"]), phone: txt(r.f["Phone"]), status: sel(r.f["Status"]) ?? "Active",
      startDate: txt(r.f["Start Date"]), notes: txt(r.f["Notes"]), abn: txt(r.f["ABN"]), createdAt: new Date(r.createdTime) };
    const s = await prisma.setter.upsert({ where: { externalId: r.id }, create: { externalId: r.id, ...data }, update: data });
    setterIds[r.id] = s.id;
  }

  // 2. Free slots
  const slotIds: Record<string, string> = {};
  for (const r of records("free-slots.json", T.SLOT)) {
    const start = dt(r.f["Start"])!; let end = dt(r.f["End"]) ?? new Date(start.getTime() + 3600e3);
    if (end <= start) end = new Date(start.getTime() + 3600e3); // fix zero-length slots from the export
    const data = { label: txt(r.f["Slot"]) ?? "", start, end, status: sel(r.f["Status"]) ?? "Free", createdAt: new Date(r.createdTime) };
    const s = await prisma.freeSlot.upsert({ where: { externalId: r.id }, create: { externalId: r.id, ...data }, update: data });
    slotIds[r.id] = s.id;
  }

  // 3. Leads (ENP, DR, Consulting)
  const leadIds: Record<string, string> = {};
  const pendingReferral: { leadId: string; callExt: string }[] = [];
  const leadSets: [string, string, "ENP" | "DR" | "CONSULTING"][] = [["enp-leads.json", T.ENP, "ENP"], ["dr-leads.json", T.DR, "DR"], ["consulting-leads.json", T.CONS, "CONSULTING"]];
  for (const [file, tid, brand] of leadSets) {
    for (const r of records(file, tid)) {
      const f = r.f;
      const setterExt = links(f["Setter"])[0];
      const data = {
        brand, leadName: txt(f["Lead Name"]), company: txt(f["Company"]), role: txt(f["Role"]), phone: txt(f["Phone"]), email: txt(f["Email"]),
        stage: stage(f["Stage"]), leadSource: sel(f["Lead Source"]), dateReceived: txt(f["Date Received"]), location: txt(f["Location / Site Address"]),
        projectType: txt(f["Project Type"]), sizeSqm: num(f["Size (sqm)"]), budget: txt(f["Budget"]), timeframe: txt(f["Timeframe"]),
        tenancyStatus: txt(f["Tenancy Status"]), lookingFor: txt(f["What They're Looking For"]), sourceLink: txt(f["Source Link"]),
        lastContacted: txt(f["Last Contacted"]), nextFollowUp: txt(f["Next Follow-up"]), notes: txt(f["My Notes"]),
        attachments: f["Attachments"] ? JSON.stringify(f["Attachments"].map((a: any) => ({ url: a.url, filename: a.filename }))) : null,
        appointmentSetter: txt(f["Appointment Setter"]), quotedSetter150: bool(f["Quoted (Setter $150)"]), grossProfit: num(f["Gross Profit"]),
        setterFeePaid: bool(f["Setter Fee Paid"]), appointment: dt(f["Appointment"]), marketingChannel: sel(f["Marketing Channel"]),
        quotedDate: txt(f["Quoted Date"]), signedDate: txt(f["Signed Date"]), contractValue: num(f["Contract Value (ex GST)"]),
        setterId: setterExt ? setterIds[setterExt] ?? null : null, quoteIssued: bool(f["Quote Issued"]), quoteValue: num(f["Quote Value ex GST"]),
        quoteIssuedDate: txt(f["Quote Issued Date"]), newClient: bool(f["New Client"]), depositClearedDate: txt(f["Deposit Cleared Date"]),
        claim50PaidDate: txt(f["50% Claim Paid Date"]), cancelled: bool(f["Cancelled"]), cancelledDate: txt(f["Cancelled Date"]),
        appointmentHeld: bool(f["Appointment Held"]), jobNumber: txt(f["Job Number (Buildertrend/Procore)"]), braidenWillQuote: bool(f["Braiden Will Quote"]),
        setterWinNo: num(f["Setter Win #"]), holdbackReleasedDate: txt(f["Holdback Released Date"]), potentialLeases: txt(f["Potential Leases"]),
        createdAt: new Date(r.createdTime),
      };
      const l = await prisma.lead.upsert({ where: { externalId: r.id }, create: { externalId: r.id, ...data }, update: data });
      leadIds[r.id] = l.id;
      const ref = links(f["Referred By (Call List)"])[0];
      if (ref) pendingReferral.push({ leadId: l.id, callExt: ref });
    }
  }

  // 4. Setter Call List
  const callIds: Record<string, string> = {};
  for (const r of records("setter-call-list.json", T.CALL)) {
    const f = r.f;
    const setterExt = links(f["Setter"])[0];
    const leadExt = links(f["ENP Lead"])[0] ?? links(f["DR Lead"])[0];
    const slotExt = links(f["Book a Slot"])[0];
    const business = sel(f["Business"]) === "DR Fitouts" ? "DR" : "ENP";
    const data = {
      leadName: txt(f["Lead Name"]), company: txt(f["Company"]), phone: txt(f["Phone"]), email: txt(f["Email"]), business,
      leadInfo: txt(f["Lead Info / Why call"]), assignedSetter: txt(f["Assigned Setter"]), setterId: setterExt ? setterIds[setterExt] ?? null : null,
      callStatus: sel(f["Call Status"]) ?? "To Call", attempts: num(f["Attempts"]) ?? 0, appointment: dt(f["Appointment"]), lastCalled: txt(f["Last Called"]),
      callNotes: txt(f["Call Notes"]), addedToCrm: bool(f["Added to CRM"]), leadId: leadExt ? leadIds[leadExt] ?? null : null,
      slotId: slotExt ? slotIds[slotExt] ?? null : null, registeredAt: dt(f["Registered At"]), possibleDuplicate: bool(f["Possible Duplicate"]),
      duplicateNote: txt(f["Duplicate Note"]), createdAt: new Date(f["Date Added"] ?? r.createdTime),
    };
    const c = await prisma.callListItem.upsert({ where: { externalId: r.id }, create: { externalId: r.id, ...data }, update: data });
    callIds[r.id] = c.id;
  }
  // Map legacy free-text "Assigned Setter" to a Setter account where the row has no Setter link (claim-by-account improvement)
  const allSetters = await prisma.setter.findMany();
  for (const c of await prisma.callListItem.findMany({ where: { setterId: null, assignedSetter: { not: null } } })) {
    const first = c.assignedSetter!.trim().toLowerCase();
    const match = allSetters.filter((s) => s.name.trim().toLowerCase().split(" ")[0] === first);
    if (match.length === 1) await prisma.callListItem.update({ where: { id: c.id }, data: { setterId: match[0].id } });
  }
  for (const p of pendingReferral) if (callIds[p.callExt]) await prisma.lead.update({ where: { id: p.leadId }, data: { referredByCallId: callIds[p.callExt] } });

  // 5. Demo users (passwords from .env — never hard-coded)
  const users = [
    { email: process.env.ADMIN_EMAIL, pw: process.env.ADMIN_PASSWORD, name: "Braiden Millard", role: "ADMIN", setterExt: "rec7roncnHSd0tRAM" },
    { email: process.env.SETTER_EMAIL, pw: process.env.SETTER_PASSWORD, name: "Jessie Lee", role: "SETTER", setterExt: "recjcReWCBgKqk2g2" },
    { email: process.env.TEAM_EMAIL, pw: process.env.TEAM_PASSWORD, name: "ENP Team (demo)", role: "TEAM", setterExt: null },
  ];
  for (const u of users) {
    if (!u.email || !u.pw) { console.warn("Skipping user with missing email/password env:", u.role); continue; }
    const email = u.email.toLowerCase();
    let setterId = u.setterExt ? setterIds[u.setterExt] ?? null : null;
    if (!setterId) setterId = (await prisma.setter.findFirst({ where: { email } }))?.id ?? null;
    if (u.role === "TEAM" && !setterId) setterId = (await prisma.setter.create({ data: { name: u.name, email, status: "Active", notes: "Internal team account (demo)" } })).id;
    const passwordHash = await bcrypt.hash(u.pw, 10);
    await prisma.user.upsert({ where: { email }, create: { email, name: u.name, role: u.role, passwordHash, setterId }, update: { name: u.name, role: u.role, passwordHash, setterId } });
  }

  const counts = { setters: await prisma.setter.count(), slots: await prisma.freeSlot.count(), enp: await prisma.lead.count({ where: { brand: "ENP" } }),
    dr: await prisma.lead.count({ where: { brand: "DR" } }), consulting: await prisma.lead.count({ where: { brand: "CONSULTING" } }), calls: await prisma.callListItem.count(), users: await prisma.user.count() };
  console.log("Seed complete:", counts);
}
main().finally(() => prisma.$disconnect());
