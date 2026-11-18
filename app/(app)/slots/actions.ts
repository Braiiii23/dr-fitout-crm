"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { fromLocalInput, slotLabel } from "@/lib/time";
import { audit } from "@/lib/automations";

export async function addSlot(fd: FormData) {
  const u = await requireUser(["ADMIN", "BDM"]);
  const start = fromLocalInput(String(fd.get("start") || ""));
  const mins = Number(fd.get("minutes") || 60);
  if (!start) redirect("/slots?err=Pick+a+start+time");
  const end = new Date(start.getTime() + mins * 60000);
  const clash = await prisma.freeSlot.findFirst({ where: { start: { lt: end }, end: { gt: start } } });
  if (clash) redirect(`/slots?err=${encodeURIComponent("Overlaps " + clash.label)}`);
  await prisma.freeSlot.create({ data: { start, end, label: slotLabel(start, end) } });
  await audit(u.email, "create", "FreeSlot");
  revalidatePath("/slots"); redirect("/slots?msg=Slot+added");
}

/** Generate 1-hour slots Mon–Fri 8am–4pm Brisbane for a date range, skipping any that overlap existing slots. */
export async function generateSlots(fd: FormData) {
  const u = await requireUser(["ADMIN", "BDM"]);
  const from = String(fd.get("from") || ""); const to = String(fd.get("to") || "");
  const firstHour = Number(fd.get("firstHour") || 8); const lastHour = Number(fd.get("lastHour") || 16);
  if (!from || !to || to < from) redirect("/slots?err=Pick+a+valid+date+range");
  let made = 0;
  for (let d = new Date(from + "T00:00:00Z"); d <= new Date(to + "T00:00:00Z") && made < 500; d = new Date(d.getTime() + 86400000)) {
    const dow = d.getUTCDay(); if (dow === 0 || dow === 6) continue;
    for (let h = firstHour; h < lastHour; h++) {
      const start = new Date(d.getTime() + (h - 10) * 3600000); // Brisbane = UTC+10
      const end = new Date(start.getTime() + 3600000);
      if (start < new Date()) continue;
      const clash = await prisma.freeSlot.findFirst({ where: { start: { lt: end }, end: { gt: start } } });
      if (clash) continue;
      await prisma.freeSlot.create({ data: { start, end, label: slotLabel(start, end) } }); made++;
    }
  }
  await audit(u.email, `generate ${made}`, "FreeSlot");
  revalidatePath("/slots"); redirect(`/slots?msg=${made}+slots+added`);
}

export async function setSlotStatus(fd: FormData) {
  await requireUser(["ADMIN", "BDM"]);
  const id = String(fd.get("id")); const status = String(fd.get("status")) === "Booked" ? "Booked" : "Free";
  await prisma.freeSlot.update({ where: { id }, data: { status } });
  revalidatePath("/slots"); redirect("/slots?msg=Updated");
}

export async function deleteSlot(fd: FormData) {
  const u = await requireUser(["ADMIN", "BDM"]);
  const id = String(fd.get("id"));
  const n = await prisma.callListItem.count({ where: { slotId: id } });
  if (n) redirect("/slots?err=Slot+has+a+booking+—+release+it+first");
  await prisma.freeSlot.delete({ where: { id } });
  await audit(u.email, "delete", "FreeSlot", id);
  revalidatePath("/slots"); redirect("/slots?msg=Deleted");
}
