import "server-only";
import { prisma } from "./db";

/** Dropdown choices for the lease form: DR clients and DR leads. */
export async function leaseOptions() {
  const [clients, leads] = await Promise.all([
    prisma.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.lead.findMany({ where: { brand: "DR", cancelled: false }, orderBy: { createdAt: "desc" }, select: { id: true, leadName: true, company: true, stage: true } }),
  ]);
  return {
    clients: clients.map((c) => ({ id: c.id, label: c.name })),
    leads: leads.map((l) => ({ id: l.id, label: `${l.company || l.leadName || "Unnamed"}${l.company && l.leadName ? ` (${l.leadName})` : ""}${l.stage ? ` · ${l.stage}` : ""}` })),
  };
}
