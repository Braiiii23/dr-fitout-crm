// Server-side ports of the 20 record-level Airtable automations (the monthly statement email lives in lib/statements.ts).
// They run synchronously after every save, inside the same request, so the UI is always consistent.
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./db";
import { brisbaneToday, daysDiff } from "./time";

type Tx = Prisma.TransactionClient | PrismaClient;
const STAGE_RANK_SYNCABLE = { quoting: ["", "New", "Contacted"], contacted: ["", "New"] };
const norm = (s?: string | null) => (s ?? "").trim().toLowerCase();

export async function audit(userEmail: string | null, action: string, entity: string, entityId?: string, detail?: string) {
  await prisma.auditLog.create({ data: { userEmail, action, entity, entityId, detail } });
}

/** 12-month company duplicate check across ENP + DR (Date Received within the past 365 days, Brisbane). */
export async function findCompanyDuplicates(tx: Tx, company: string | null | undefined, excludeLeadId?: string) {
  if (!norm(company)) return [];
  const today = brisbaneToday();
  const leads = await tx.lead.findMany({ where: { brand: { in: ["ENP", "DR"] } }, select: { id: true, brand: true, leadName: true, company: true, dateReceived: true, createdAt: true } });
  return leads.filter((l) => {
    if (l.id === excludeLeadId || norm(l.company) !== norm(company)) return false;
    const d = l.dateReceived ?? l.createdAt.toISOString().slice(0, 10);
    const diff = daysDiff(today, d);
    return diff >= 0 && diff <= 365;
  });
}

/** Setter Call List automations: Registered At stamp, create/link lead (Contacted/Quoting/Appointment Set), stage sync, setter copy.
 *  Also: when status is "Braiden to Connect", enqueue Anita Reminder / Todoist (via reminders.ts). */
export async function runCallAutomations(callId: string) {
  const call = await prisma.$transaction(async (tx) => {
    let call = await tx.callListItem.findUniqueOrThrow({ where: { id: callId } });
    const today = brisbaneToday();
    const brand = call.business === "DR" ? "DR" : "ENP";

    // wflZqywVUOcGujcbv — stamp Registered At (first registration wins)
    if (call.callStatus === "Appointment Set" && !call.registeredAt) {
      call = await tx.callListItem.update({ where: { id: call.id }, data: { registeredAt: new Date() } });
    }

    // wflrroV1cu4uZldel / wflJPUGeMeZXlyhLv — Contacted/Quoting -> create lead if none (skip on duplicate)
    if ((call.callStatus === "Contacted" || call.callStatus === "Quoting") && !call.leadId && !call.addedToCrm) {
      const dups = await findCompanyDuplicates(tx, call.company);
      if (dups.length === 0) {
        const lead = await tx.lead.create({ data: {
          brand, leadName: call.leadName, company: call.company, phone: call.phone, email: call.email,
          stage: "Contacted", leadSource: "Other", dateReceived: today, lastContacted: today,
          setterId: call.setterId, appointmentSetter: call.assignedSetter,
          notes: `Came from the Setter Call List (Call Status Contacted/Quoting). Lead info: ${call.leadInfo ?? ""} | Setter call notes: ${call.callNotes ?? ""}`,
        } });
        call = await tx.callListItem.update({ where: { id: call.id }, data: { addedToCrm: true, leadId: lead.id } });
      } else if (!call.possibleDuplicate) {
        call = await tx.callListItem.update({ where: { id: call.id }, data: { possibleDuplicate: true,
          duplicateNote: `Same company already in the CRM within 12 months, so NO new lead was created. Link this row to the existing lead and the Stage will sync. Matches: ${dupList(dups)}` } });
      }
    }

    // wflo79NEBqwjaGxaB / wfljqJ2hQxHM7C0mE — Appointment Set (+ Appointment) -> create lead (flag, not skip, on duplicate)
    if (call.callStatus === "Appointment Set" && call.appointment && !call.addedToCrm && !call.leadId) {
      const dups = await findCompanyDuplicates(tx, call.company);
      const lead = await tx.lead.create({ data: {
        brand, leadName: call.leadName, company: call.company, phone: call.phone, email: call.email,
        appointment: call.appointment, appointmentSetter: call.assignedSetter, setterId: call.setterId,
        newClient: dups.length === 0, stage: "Contacted", leadSource: "Other", dateReceived: today, lastContacted: today,
        notes: `Came from the Setter Call List (appointment booked by setter). Lead info: ${call.leadInfo ?? ""} | Setter call notes: ${call.callNotes ?? ""}`,
      } });
      call = await tx.callListItem.update({ where: { id: call.id }, data: { addedToCrm: true, leadId: lead.id,
        ...(dups.length ? { possibleDuplicate: true, duplicateNote: `Same company already in the CRM within 12 months, so New Client was unticked (no $150 quote fee unless Braiden overrides). Matches: ${dupList(dups)}` } : {}) } });
    }

    if (call.leadId) await syncLeadFromCall(tx, call.leadId);
    return call;
  });
  // Outside the transaction: Braiden to Connect → Anita/Todoist reminder (deduped). Dynamic import avoids cycle with reminders→audit.
  if (call.callStatus === "Braiden to Connect") {
    try {
      const { enqueueBraidenToConnect } = await import("./reminders");
      await enqueueBraidenToConnect({
        id: call.id,
        leadName: call.leadName,
        company: call.company,
        phone: call.phone,
        email: call.email,
        business: call.business,
        leadId: call.leadId,
        leadInfo: call.leadInfo,
        callNotes: call.callNotes,
        assignedSetter: call.assignedSetter,
      });
    } catch (e) {
      console.error("enqueueBraidenToConnect failed", e);
    }
  }
  return call;
}

function dupList(d: { brand: string; leadName: string | null; company: string | null; dateReceived: string | null }[]) {
  return d.map((x) => `${x.brand === "DR" ? "DR Fitout" : "ENP"}: ${x.leadName ?? "?"} (${x.company}, received ${x.dateReceived ?? "?"})`).join("; ");
}

/** Lead-side automations: stage sync (forward only), copy setter, referral setter, Quoted tick/dates. */
export async function syncLeadFromCall(tx: Tx, leadId: string) {
  const lead = await tx.lead.findUnique({ where: { id: leadId }, include: { calls: true, referredByCall: true } });
  if (!lead) return;
  const data: Prisma.LeadUpdateInput = {};
  let stage = lead.stage ?? "";
  const statuses = lead.calls.map((c) => c.callStatus);

  // Stage Sync Target (forward only). Signed / Lost / Stay in Touch / Potential Leases are never overwritten.
  if (lead.brand !== "CONSULTING") {
    if (statuses.includes("Quoting") && STAGE_RANK_SYNCABLE.quoting.includes(stage)) stage = "Quoting";
    else if (statuses.includes("Contacted") && STAGE_RANK_SYNCABLE.contacted.includes(stage)) stage = "Contacted";
    if (stage !== (lead.stage ?? "")) data.stage = stage;
  }

  // Needs Setter Copy — own call-list row has a setter, lead Setter empty
  let setterId = lead.setterId;
  if (!setterId) {
    const withSetter = lead.calls.find((c) => c.setterId);
    if (withSetter) { setterId = withSetter.setterId; data.setter = { connect: { id: setterId! } }; }
  }
  // Referral Setter Eligible — referral within 12 months of referrer's appointment/registration, referrer has a setter, New Client
  if (!setterId && lead.referredByCall?.setterId && lead.newClient) {
    const ref = lead.referredByCall;
    const base = ref.appointment ?? ref.registeredAt;
    if (base) {
      const d = daysDiff(lead.dateReceived ?? lead.createdAt.toISOString(), base.toISOString());
      if (d >= -1 && d <= 365) { setterId = ref.setterId; data.setter = { connect: { id: setterId! } }; }
    }
  }
  // Appointment copied from booking if the lead has none yet
  if (!lead.appointment) {
    const a = lead.calls.find((c) => c.appointment)?.appointment;
    if (a) data.appointment = a;
  }
  Object.assign(data, stageSideEffects(lead.brand, stage, lead));
  if (Object.keys(data).length) await tx.lead.update({ where: { id: lead.id }, data });
}

/** Quoting/Signed tick Quoted (Setter $150) + stamp Quoted Date; Signed stamps Signed Date. Never untick. */
export function stageSideEffects(brand: string, stage: string | null | undefined, lead: { quotedSetter150: boolean; quotedDate: string | null; signedDate: string | null }) {
  const out: { quotedSetter150?: boolean; quotedDate?: string; signedDate?: string } = {};
  if (stage === "Quoting" || stage === "Signed") {
    if (brand !== "CONSULTING" && !lead.quotedSetter150) out.quotedSetter150 = true;
    if (!lead.quotedDate) out.quotedDate = brisbaneToday();
  }
  if (stage === "Signed" && !lead.signedDate) out.signedDate = brisbaneToday();
  return out;
}

export async function runLeadAutomations(leadId: string) {
  await prisma.$transaction(async (tx) => syncLeadFromCall(tx, leadId));
}

/** wflTnyY2OEVxieZF2 — book a Free Slot: only if still Free (double-booking guard). Sets Appointment, marks Booked. */
export async function bookSlot(callId: string, slotId: string, alsoSetStatus: boolean) {
  const res = await prisma.$transaction(async (tx) => {
    const slot = await tx.freeSlot.findUnique({ where: { id: slotId }, include: { bookings: true } });
    if (!slot) throw new Error("Slot not found");
    const claimed = await tx.freeSlot.updateMany({ where: { id: slotId, status: "Free" }, data: { status: "Booked" } });
    if (claimed.count !== 1) throw new Error("Sorry, that slot has just been booked. Please pick another.");
    const call = await tx.callListItem.findUniqueOrThrow({ where: { id: callId } });
    if (call.slotId && call.slotId !== slotId) await tx.freeSlot.update({ where: { id: call.slotId }, data: { status: "Free" } });
    await tx.callListItem.update({ where: { id: callId }, data: { slotId, appointment: slot.start, ...(alsoSetStatus ? { callStatus: "Appointment Set" } : {}) } });
    return slot;
  });
  await runCallAutomations(callId);
  // Bookable times are rebuilt from Braiden's calendar (the new meeting blocks the times around it).
  await (await import("./availability")).syncAvailability().catch(() => undefined);
  return res;
}

export async function releaseSlot(callId: string) {
  await prisma.$transaction(async (tx) => {
    const call = await tx.callListItem.findUniqueOrThrow({ where: { id: callId } });
    if (call.slotId) {
      const others = await tx.callListItem.count({ where: { slotId: call.slotId, NOT: { id: callId } } });
      if (others === 0) await tx.freeSlot.update({ where: { id: call.slotId }, data: { status: "Free" } });
      await tx.callListItem.update({ where: { id: callId }, data: { slotId: null } });
    }
  });
  await (await import("./availability")).syncAvailability().catch(() => undefined);
}

/** Optional helper for the monthly routine: number each setter's wins (by Deposit Cleared Date) to set Setter Win #. */
export async function recomputeWinNumbers() {
  const leads = await prisma.lead.findMany({ where: { brand: { in: ["ENP", "DR"] }, setterId: { not: null }, depositClearedDate: { not: null } }, orderBy: [{ depositClearedDate: "asc" }, { createdAt: "asc" }] });
  const counter: Record<string, number> = {};
  for (const l of leads) {
    const n = (counter[l.setterId!] = (counter[l.setterId!] ?? 0) + 1);
    if (l.setterWinNo !== n) await prisma.lead.update({ where: { id: l.id }, data: { setterWinNo: n } });
  }
  return leads.length;
}
