"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/automations";
import { parseClientForm } from "@/lib/leases";

const EDITORS = ["ADMIN", "BDM", "PM", "ACCOUNTS"] as const;
const enc = encodeURIComponent;

export async function createClient(fd: FormData) {
  const u = await requireUser([...EDITORS]);
  const c = await prisma.client.create({ data: parseClientForm(fd) });
  // Optionally link a lead straight away (e.g. "Make client from lead").
  const leadId = String(fd.get("leadId") ?? "");
  if (leadId) await prisma.lead.update({ where: { id: leadId }, data: { clientId: c.id } }).catch(() => null);
  await audit(u.email, "create", "Client", c.id, c.name);
  revalidatePath("/clients");
  redirect(`/clients/${c.id}?msg=${enc("Client added.")}`);
}

export async function updateClient(fd: FormData) {
  const u = await requireUser([...EDITORS]);
  const id = String(fd.get("id"));
  await prisma.client.update({ where: { id }, data: parseClientForm(fd) });
  await audit(u.email, "update", "Client", id);
  revalidatePath("/clients"); revalidatePath(`/clients/${id}`);
  redirect(`/clients/${id}?msg=${enc("Saved.")}`);
}

export async function deleteClient(fd: FormData) {
  const u = await requireUser(["ADMIN"]);
  const id = String(fd.get("id"));
  const c = await prisma.client.delete({ where: { id } });
  await audit(u.email, "delete", "Client", id, c.name);
  revalidatePath("/clients");
  redirect(`/clients?msg=${enc(`Deleted ${c.name}. Its leads, jobs and leases were kept.`)}`);
}

/** Link (or unlink) a lead or job to this client. */
export async function linkToClient(fd: FormData) {
  const u = await requireUser([...EDITORS]);
  const clientId = String(fd.get("clientId"));
  const kind = String(fd.get("kind"));
  const targetId = String(fd.get("targetId") ?? "");
  const unlink = fd.get("unlink") === "1";
  if (!targetId) redirect(`/clients/${clientId}`);
  const data = { clientId: unlink ? null : clientId };
  if (kind === "lead") await prisma.lead.update({ where: { id: targetId }, data });
  else if (kind === "job") await prisma.job.update({ where: { id: targetId }, data });
  await audit(u.email, unlink ? "unlink" : "link", "Client", clientId, `${kind} ${targetId}`);
  revalidatePath(`/clients/${clientId}`);
  redirect(`/clients/${clientId}?msg=${enc(unlink ? "Unlinked." : "Linked.")}`);
}

/** One-click set-up: make a client for every DR lead company not linked yet, and link jobs whose client name matches. */
export async function clientsFromLeads() {
  const u = await requireUser(["ADMIN", "BDM"]);
  const [clients, leads, jobs] = await Promise.all([
    prisma.client.findMany({ select: { id: true, name: true } }),
    prisma.lead.findMany({ where: { brand: "DR", clientId: null, cancelled: false }, select: { id: true, company: true, leadName: true, phone: true, email: true, role: true, location: true, stage: true } }),
    prisma.job.findMany({ where: { brand: "DR", clientId: null }, select: { id: true, client: true } }),
  ]);
  const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const byName = new Map(clients.map((c) => [key(c.name), c.id]));
  let made = 0, linked = 0;
  for (const l of leads) {
    const name = (l.company || "").trim();
    if (!name) continue;
    let id = byName.get(key(name));
    if (!id) {
      const c = await prisma.client.create({ data: { name, status: l.stage === "Signed" ? "Active" : "Prospect", contactName: l.leadName, contactRole: l.role, phone: l.phone, email: l.email, address: l.location } });
      id = c.id; byName.set(key(name), id); made++;
    }
    await prisma.lead.update({ where: { id: l.id }, data: { clientId: id } }); linked++;
  }
  for (const j of jobs) {
    const id = j.client ? byName.get(key(j.client)) : undefined;
    if (id) { await prisma.job.update({ where: { id: j.id }, data: { clientId: id } }); linked++; }
  }
  await audit(u.email, "import", "Client", undefined, `${made} made, ${linked} linked`);
  revalidatePath("/clients");
  redirect(`/clients?msg=${enc(`${made} client${made === 1 ? "" : "s"} added, ${linked} lead/job link${linked === 1 ? "" : "s"} made.`)}`);
}
