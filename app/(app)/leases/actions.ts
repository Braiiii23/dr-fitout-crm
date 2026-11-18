"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/automations";
import { LEASE_STATUSES, parseLeaseForm } from "@/lib/leases";
import { LEASE_FILE_KINDS, parseFiles } from "@/lib/concepts";
import { saveFile } from "@/lib/files";
import { runConceptFit } from "@/lib/concept-fit";

const EDITORS = ["ADMIN", "BDM", "PM", "ACCOUNTS"] as const;

/** "…or add a new client": make the client (or reuse one with the same name) and return its id. */
async function newClientFrom(fd: FormData): Promise<string | null> {
  const name = String(fd.get("newClientName") ?? "").trim();
  if (!name) return null;
  const same = (await prisma.client.findMany({ select: { id: true, name: true } })).find((c) => c.name.trim().toLowerCase() === name.toLowerCase());
  return same?.id ?? (await prisma.client.create({ data: { name, status: "Prospect" } })).id;
}
const enc = encodeURIComponent;

export async function createLease(fd: FormData) {
  const u = await requireUser([...EDITORS]);
  const data = parseLeaseForm(fd);
  data.clientId = (await newClientFrom(fd)) ?? data.clientId;
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
  const data = parseLeaseForm(fd);
  data.clientId = (await newClientFrom(fd)) ?? data.clientId;
  const l = await prisma.lease.update({ where: { id }, data });
  await audit(u.email, "update", "Lease", id);
  revalidatePath("/leases"); revalidatePath(`/leases/${id}`); revalidatePath("/dashboard");
  if (l.clientId) revalidatePath(`/clients/${l.clientId}`);
  redirect(`/leases/${id}?msg=${enc("Saved.")}`);
}

export async function setLeaseStatus(fd: FormData) {
  const u = await requireUser([...EDITORS]);
  const id = String(fd.get("id"));
  const status = String(fd.get("status"));
  if (!LEASE_STATUSES.includes(status)) return;
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

/** Link a lease to a client (or unlink it), from the lease list, the lease page or the client page. */
export async function setLeaseClient(fd: FormData) {
  const u = await requireUser([...EDITORS]);
  const id = String(fd.get("id") ?? "");
  if (!id) return;
  const before = await prisma.lease.findUnique({ where: { id }, select: { clientId: true } });
  const clientId = (await newClientFrom(fd)) ?? (String(fd.get("clientId") ?? "") || null);
  await prisma.lease.update({ where: { id }, data: { clientId } });
  await audit(u.email, clientId ? "link client" : "unlink client", "Lease", id, clientId ?? "");
  revalidatePath("/leases"); revalidatePath(`/leases/${id}`); revalidatePath("/clients"); revalidatePath("/dashboard");
  for (const c of [before?.clientId, clientId]) if (c) revalidatePath(`/clients/${c}`);
  const back = String(fd.get("_back") ?? "");
  if (back.startsWith("/")) redirect(`${back}${back.includes("?") ? "&" : "?"}msg=${enc(clientId ? "Client linked." : "Client unlinked.")}`);
}

// ---------- Lease files (lease documents, tenancy floor plans) ----------
export async function uploadLeaseFiles(fd: FormData) {
  const u = await requireUser([...EDITORS]);
  const id = String(fd.get("id"));
  const kind = LEASE_FILE_KINDS.includes(String(fd.get("kind"))) ? String(fd.get("kind")) : "other";
  const cur = await prisma.lease.findUniqueOrThrow({ where: { id } });
  const list = parseFiles(cur.files);
  try {
    for (const f of fd.getAll("files")) {
      if (!(f instanceof File) || !f.size) continue;
      const saved = await saveFile(f.name, Buffer.from(await f.arrayBuffer()));
      list.push({ id: saved.id, name: f.name, kind, added: new Date().toISOString().slice(0, 10), type: f.type });
    }
  } catch (e) { redirect(`/leases/${id}?err=${enc((e as Error).message)}`); }
  await prisma.lease.update({ where: { id }, data: { files: JSON.stringify(list) } });
  await audit(u.email, "upload", "Lease", id, kind);
  revalidatePath(`/leases/${id}`);
  redirect(`/leases/${id}?msg=${enc("Uploaded.")}#files`);
}

export async function setLeaseFileKind(fd: FormData) {
  await requireUser([...EDITORS]);
  const id = String(fd.get("id")); const fileId = String(fd.get("fileId")); const kind = String(fd.get("kind"));
  if (!LEASE_FILE_KINDS.includes(kind)) return;
  const cur = await prisma.lease.findUniqueOrThrow({ where: { id } });
  await prisma.lease.update({ where: { id }, data: { files: JSON.stringify(parseFiles(cur.files).map((f) => (f.id === fileId ? { ...f, kind } : f))) } });
  revalidatePath(`/leases/${id}`);
}

export async function removeLeaseFile(fd: FormData) {
  const u = await requireUser([...EDITORS]);
  const id = String(fd.get("id")); const fileId = String(fd.get("fileId"));
  const cur = await prisma.lease.findUniqueOrThrow({ where: { id } });
  await prisma.lease.update({ where: { id }, data: { files: JSON.stringify(parseFiles(cur.files).filter((f) => f.id !== fileId)) } });
  await audit(u.email, "remove file", "Lease", id, fileId);
  revalidatePath(`/leases/${id}`);
}

// ---------- AI concept fit ----------
/** Ask the AI to fit the chosen concept to this tenancy's floor plan. Moves the lease to Concept proposing if it was Enquiring. */
export async function runFit(fd: FormData) {
  const u = await requireUser([...EDITORS]);
  const id = String(fd.get("id")); const conceptId = String(fd.get("conceptId") ?? "");
  if (!conceptId) redirect(`/leases/${id}?err=${enc("Pick a concept first.")}#concept`);
  let fitId = ""; let err = "";
  try {
    const fit = await runConceptFit(id, conceptId, String(fd.get("brief") ?? "").trim().slice(0, 2000), u.name);
    fitId = fit.id; if (fit.status === "error") err = fit.error ?? "The AI couldn't make a fit.";
    await prisma.lease.updateMany({ where: { id, status: "Enquiring" }, data: { status: "Concept proposing" } });
    await audit(u.email, "concept fit", "Lease", id, `${conceptId} → ${fit.status}`);
  } catch (e) { err = (e as Error).message; }
  revalidatePath(`/leases/${id}`); revalidatePath("/leases");
  redirect(`/leases/${id}?${err ? `err=${enc(err)}` : `msg=${enc("Concept fitted. Check it over below.")}`}${fitId ? `&fit=${fitId}` : ""}#concept`);
}

/** Mark the fit we're proposing to the client (only one per lease). */
export async function chooseFit(fd: FormData) {
  const u = await requireUser([...EDITORS]);
  const id = String(fd.get("id")); const fitId = String(fd.get("fitId"));
  await prisma.conceptFit.updateMany({ where: { leaseId: id }, data: { chosen: false } });
  await prisma.conceptFit.update({ where: { id: fitId }, data: { chosen: true } });
  await audit(u.email, "choose concept fit", "Lease", id, fitId);
  revalidatePath(`/leases/${id}`);
  redirect(`/leases/${id}?fit=${fitId}&msg=${enc("Marked as the concept we're proposing.")}#concept`);
}
