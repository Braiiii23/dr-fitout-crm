"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/automations";
import { parseLeaseForm } from "@/lib/leases";

const EDITORS = ["ADMIN", "BDM", "PM", "ACCOUNTS"] as const;
const enc = encodeURIComponent;

export async function createLease(fd: FormData) {
  const u = await requireUser([...EDITORS]);
  const data = parseLeaseForm(fd);
  // A lease added from a lead takes the lead's client when it has one.
  if (!data.clientId && data.leadId) data.clientId = (await prisma.lead.findUnique({ where: { id: data.leadId }, select: { clientId: true } }))?.clientId ?? null;
  const l = await prisma.lease.create({ data });
  await audit(u.email, "create", "Lease", l.id, l.premises);
  revalidatePath("/leases"); revalidatePath("/dashboard");
  if (l.clientId) revalidatePath(`/clients/${l.clientId}`);
  redirect(`/leases/${l.id}?msg=${enc("Lease added.")}`);
}

export async function updateLease(fd: FormData) {
  const u = await requireUser([...EDITORS]);
  const id = String(fd.get("id"));
  const l = await prisma.lease.update({ where: { id }, data: parseLeaseForm(fd) });
  await audit(u.email, "update", "Lease", id);
  revalidatePath("/leases"); revalidatePath(`/leases/${id}`); revalidatePath("/dashboard");
  if (l.clientId) revalidatePath(`/clients/${l.clientId}`);
  redirect(`/leases/${id}?msg=${enc("Saved.")}`);
}

export async function setLeaseStatus(fd: FormData) {
  const u = await requireUser([...EDITORS]);
  const id = String(fd.get("id"));
  const status = String(fd.get("status"));
  await prisma.lease.update({ where: { id }, data: { status } });
  await audit(u.email, "status", "Lease", id, status);
  revalidatePath("/leases"); revalidatePath("/dashboard");
}

export async function deleteLease(fd: FormData) {
  const u = await requireUser(["ADMIN"]);
  const id = String(fd.get("id"));
  const l = await prisma.lease.delete({ where: { id } });
  await audit(u.email, "delete", "Lease", id, l.premises);
  revalidatePath("/leases"); revalidatePath("/dashboard");
  redirect(`/leases?msg=${enc("Lease deleted.")}`);
}
