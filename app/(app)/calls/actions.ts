"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser, type CurrentUser } from "@/lib/auth";
import { CALL_STATUSES } from "@/lib/constants";
import { brisbaneToday, fromLocalInput } from "@/lib/time";
import { EDITABLE, canEdit } from "@/lib/calls-acl";
import { audit, bookSlot, releaseSlot, runCallAutomations } from "@/lib/automations";

const back = (fd: FormData, fallback: string, q: string): never => {
  const b = String(fd.get("_back") || fallback);
  const path = b.startsWith("/") ? b.split("?")[0] : fallback;
  redirect(`${path}?${q}`);
};
const enc = encodeURIComponent;

async function ensureSetter(u: CurrentUser) {
  if (u.setterId) return u.setterId;
  const s = await prisma.setter.create({ data: { name: u.name, email: u.email, status: "Active", notes: "Created automatically when this user first claimed a call." } });
  await prisma.user.update({ where: { id: u.id }, data: { setterId: s.id } });
  return s.id;
}

function parseCallFields(fd: FormData, allowed: string[]) {
  const d: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k === "addedToCrm" || k === "possibleDuplicate") { if (fd.has(`_has_${k}`)) d[k] = fd.get(k) === "on"; continue; }
    if (!fd.has(k)) continue;
    const v = String(fd.get(k) ?? "").trim();
    if (k === "attempts") d[k] = v === "" ? 0 : Math.max(0, parseInt(v, 10) || 0);
    else if (k === "appointment") d[k] = fromLocalInput(v);
    else if (k === "callStatus") { if (CALL_STATUSES.includes(v)) d[k] = v; }
    else if (k === "business") d[k] = v === "DR" ? "DR" : "ENP";
    else d[k] = v === "" ? null : v;
  }
  return d;
}

export async function updateCall(fd: FormData) {
  const u = await requireUser();
  const id = String(fd.get("id"));
  const call = await prisma.callListItem.findUniqueOrThrow({ where: { id } });
  if (!canEdit(u, call)) back(fd, "/team", "err=" + enc("You can only edit calls assigned to you. Claim it first."));
  const data = parseCallFields(fd, EDITABLE[u.role]);
  if (u.role === "ADMIN") {
    if (fd.has("setterId")) { const s = String(fd.get("setterId") || ""); data.setterId = s || null; if (s && s !== call.setterId) data.claimedAt = new Date(); }
    if (fd.has("leadId")) data.leadId = String(fd.get("leadId") || "") || null;
  }
  const finalSetter = (data.setterId !== undefined ? data.setterId : call.setterId) as string | null;
  if (data.callStatus && data.callStatus !== call.callStatus && !finalSetter)
    back(fd, "/calls", "err=" + enc("Call Status is locked until the row is assigned to a setter."));
  await prisma.callListItem.update({ where: { id }, data });
  await runCallAutomations(id);
  await audit(u.email, "update", "CallListItem", id, JSON.stringify(Object.keys(data)));
  revalidatePath("/team"); revalidatePath("/portal"); revalidatePath("/calls");
  back(fd, "/portal", "msg=" + enc("Saved."));
}

export async function quickStatus(fd: FormData) {
  const u = await requireUser();
  const id = String(fd.get("id")); const status = String(fd.get("callStatus"));
  const call = await prisma.callListItem.findUniqueOrThrow({ where: { id } });
  if (!canEdit(u, call)) back(fd, "/team", "err=" + enc("You can only update calls assigned to you."));
  if (!call.setterId) back(fd, "/team", "err=" + enc("Call Status is locked until the row is assigned. Claim it first."));
  if (!CALL_STATUSES.includes(status)) back(fd, "/team", "err=bad+status");
  await prisma.callListItem.update({ where: { id }, data: { callStatus: status } });
  const after = await runCallAutomations(id);
  await audit(u.email, `status → ${status}`, "CallListItem", id);
  revalidatePath("/team"); revalidatePath("/portal"); revalidatePath("/calls");
  const note = status === "Appointment Set" && !after.appointment ? " Now book a slot to set the Appointment." : after.addedToCrm && !call.addedToCrm ? " Lead added to the CRM." : after.possibleDuplicate && !call.possibleDuplicate ? " Flagged as a possible duplicate for Braiden." : "";
  back(fd, "/team", "msg=" + enc(`Status set to ${status}.${note}`));
}

export async function logAttempt(fd: FormData) {
  const u = await requireUser();
  const id = String(fd.get("id"));
  const call = await prisma.callListItem.findUniqueOrThrow({ where: { id } });
  if (!canEdit(u, call) || !call.setterId) back(fd, "/portal", "err=" + enc("Claim the call first."));
  await prisma.callListItem.update({ where: { id }, data: { attempts: { increment: 1 }, lastCalled: brisbaneToday() } });
  revalidatePath("/portal"); revalidatePath("/team");
  back(fd, "/portal", "msg=" + enc("Call attempt logged."));
}

export async function claimCall(fd: FormData) {
  const u = await requireUser(["ADMIN", "TEAM", "BDM"]);
  const id = String(fd.get("id"));
  const setterId = await ensureSetter(u);
  const res = await prisma.callListItem.updateMany({ where: { id, setterId: null }, data: { setterId, assignedSetter: u.name.split(" ")[0], claimedAt: new Date() } });
  if (res.count !== 1) back(fd, "/team", "err=" + enc("Someone else has already claimed that call."));
  await audit(u.email, "claim", "CallListItem", id);
  revalidatePath("/team");
  back(fd, "/team", "msg=" + enc("Claimed — it's yours."));
}

export async function unclaimCall(fd: FormData) {
  const u = await requireUser(["ADMIN", "TEAM", "BDM"]);
  const id = String(fd.get("id"));
  const call = await prisma.callListItem.findUniqueOrThrow({ where: { id } });
  if (u.role !== "ADMIN" && call.setterId !== u.setterId) back(fd, "/team", "err=" + enc("You can only release your own calls."));
  if (call.addedToCrm || call.registeredAt) back(fd, "/team", "err=" + enc("This call is already registered to the setter (ownership). Ask Braiden to reassign."));
  await prisma.callListItem.update({ where: { id }, data: { setterId: null, assignedSetter: null, claimedAt: null } });
  await audit(u.email, "unclaim", "CallListItem", id);
  revalidatePath("/team");
  back(fd, "/team", "msg=" + enc("Released."));
}

export async function bookSlotAction(fd: FormData) {
  const u = await requireUser();
  const id = String(fd.get("id")); const slotId = String(fd.get("slotId") || "");
  const call = await prisma.callListItem.findUniqueOrThrow({ where: { id } });
  if (!canEdit(u, call) || !call.setterId) back(fd, "/portal", "err=" + enc("Only the assigned setter can book this call."));
  if (!slotId) back(fd, "/portal", "err=" + enc("Pick a slot."));
  try { await bookSlot(id, slotId, fd.get("setStatus") === "on"); }
  catch (e) { back(fd, "/portal", "err=" + enc((e as Error).message)); }
  await audit(u.email, "book slot", "CallListItem", id, slotId);
  revalidatePath("/portal"); revalidatePath("/slots"); revalidatePath("/team");
  back(fd, "/portal", "msg=" + enc("Booked. Appointment set and slot marked Booked."));
}

export async function releaseSlotAction(fd: FormData) {
  const u = await requireUser();
  const id = String(fd.get("id"));
  const call = await prisma.callListItem.findUniqueOrThrow({ where: { id } });
  if (!canEdit(u, call)) back(fd, "/portal", "err=not+allowed");
  await releaseSlot(id);
  await audit(u.email, "release slot", "CallListItem", id);
  revalidatePath("/slots");
  back(fd, "/portal", "msg=" + enc("Slot released (the appointment time is kept on the row — clear it if cancelled)."));
}

export async function createCall(fd: FormData) {
  const u = await requireUser(["ADMIN", "TEAM", "BDM"]);
  const data = parseCallFields(fd, ["leadName", "company", "phone", "email", "business", "leadInfo", "callNotes"]);
  let setterId: string | null = null;
  if (u.role === "ADMIN") setterId = String(fd.get("setterId") || "") || null;
  else if (fd.get("claim") === "on") setterId = await ensureSetter(u);
  const c = await prisma.callListItem.create({ data: { ...data, setterId, claimedAt: setterId ? new Date() : null, callStatus: "To Call" } as never });
  await audit(u.email, "create", "CallListItem", c.id);
  redirect(u.role === "ADMIN" ? `/calls/${c.id}?msg=Created` : "/team?msg=Added");
}

export async function deleteCall(fd: FormData) {
  const u = await requireUser(["ADMIN", "BDM"]);
  const id = String(fd.get("id"));
  await releaseSlot(id);
  await prisma.lead.updateMany({ where: { referredByCallId: id }, data: { referredByCallId: null } });
  await prisma.callListItem.delete({ where: { id } });
  await audit(u.email, "delete", "CallListItem", id);
  redirect("/calls?msg=Deleted");
}

export async function setReferral(fd: FormData) {
  const u = await requireUser(["ADMIN", "BDM"]);
  const leadId = String(fd.get("leadId")); const callId = String(fd.get("callId") || "") || null;
  await prisma.lead.update({ where: { id: leadId }, data: { referredByCallId: callId } });
  await audit(u.email, "set referral", "Lead", leadId, callId ?? "");
  back(fd, "/calls", "msg=" + enc("Referral link saved."));
}
