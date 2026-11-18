"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit, runCallAutomations } from "@/lib/automations";
import { CALL_STATUSES } from "@/lib/constants";

// Braiden (or CEO) working a setter's call list. Same automations as when the setter changes a call.
const s = (fd: FormData, k: string, max = 300) => { const v = String(fd.get(k) ?? "").trim(); return v ? v.slice(0, max) : null; };
const refresh = () => { revalidatePath("/setters/calls"); revalidatePath("/portal"); revalidatePath("/team"); };

export async function saveSetterCall(fd: FormData) {
  const u = await requireUser(["ADMIN"]);
  const id = s(fd, "id"); if (!id) return;
  const call = await prisma.callListItem.findUnique({ where: { id } }); if (!call) return;
  const data: Record<string, unknown> = {};
  for (const k of ["leadName", "company", "phone", "email"] as const) if (fd.has(k)) data[k] = s(fd, k);
  if (fd.has("callNotes")) data.callNotes = s(fd, "callNotes", 5000);
  if (fd.has("lastCalled")) { const v = s(fd, "lastCalled"); data.lastCalled = v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }
  if (fd.has("attempts")) { const n = Number(fd.get("attempts")); if (Number.isInteger(n) && n >= 0) data.attempts = n; }
  if (fd.has("callStatus")) { const st = s(fd, "callStatus"); if (st && CALL_STATUSES.includes(st)) data.callStatus = st; }
  if (fd.has("priority")) { const p = s(fd, "priority"); if (p && ["High", "Normal", "Low"].includes(p)) data.priority = p; }
  if (fd.has("business")) data.business = fd.get("business") === "DR" ? "DR" : "ENP";
  if (fd.has("setterId")) {
    const sid = s(fd, "setterId");
    const setter = sid ? await prisma.setter.findUnique({ where: { id: sid }, select: { id: true, name: true } }) : null;
    data.setterId = setter?.id ?? null; data.assignedSetter = setter?.name ?? null;
    if (setter && setter.id !== call.setterId) data.claimedAt = new Date();
  }
  // A logged outcome counts as a call: +1 attempt and today's date, unless set by hand in the same save.
  if (fd.get("logAttempt") === "on") { data.attempts = (call.attempts ?? 0) + 1; data.lastCalled = new Date(Date.now() + 10 * 3600000).toISOString().slice(0, 10); }
  await prisma.callListItem.update({ where: { id }, data });
  await runCallAutomations(id);
  await audit(u.email, data.callStatus && data.callStatus !== call.callStatus ? `status → ${data.callStatus}` : "update", "CallListItem", id, Object.keys(data).join(", "));
  refresh();
}

export async function addSetterCall(fd: FormData) {
  const u = await requireUser(["ADMIN"]);
  const setterId = s(fd, "setterId"); const leadName = s(fd, "leadName");
  if (!setterId || !leadName) return;
  const setter = await prisma.setter.findUnique({ where: { id: setterId }, select: { id: true, name: true } }); if (!setter) return;
  const c = await prisma.callListItem.create({ data: {
    leadName, company: s(fd, "company"), phone: s(fd, "phone"), email: s(fd, "email"), business: fd.get("business") === "DR" ? "DR" : "ENP",
    leadInfo: s(fd, "leadInfo", 2000), contactType: "CLIENT", priority: ["High", "Normal", "Low"].includes(String(fd.get("priority"))) ? String(fd.get("priority")) : "Normal", callStatus: "To Call", setterId: setter.id, assignedSetter: setter.name, claimedAt: new Date(),
  } });
  await runCallAutomations(c.id);
  await audit(u.email, "create", "CallListItem", c.id, `for ${setter.name}`);
  refresh();
}
