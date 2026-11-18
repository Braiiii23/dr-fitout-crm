"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/automations";
import { saveFile } from "@/lib/files";
import { CONCEPT_FILE_KINDS, CONCEPT_STATUSES, parseFiles, roomsFromText } from "@/lib/concepts";

const EDITORS = ["ADMIN", "BDM", "PM", "ESTIMATOR"] as const;
const enc = encodeURIComponent;
const txt = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? "").trim(); return v || null; };
const num = (fd: FormData, k: string) => { const v = Number(String(fd.get(k) ?? "").replace(/[,\s]/g, "")); return String(fd.get(k) ?? "").trim() && Number.isFinite(v) ? v : null; };

function parse(fd: FormData) {
  return {
    name: txt(fd, "name") ?? "Untitled concept", practiceType: txt(fd, "practiceType"),
    status: CONCEPT_STATUSES.includes(String(fd.get("status"))) ? String(fd.get("status")) : "Ready",
    minSqm: num(fd, "minSqm"), maxSqm: num(fd, "maxSqm"), description: txt(fd, "description"), finishes: txt(fd, "finishes"), tags: txt(fd, "tags"),
    rooms: JSON.stringify(roomsFromText(String(fd.get("roomsText") ?? ""))),
  };
}

/** Files picked in the form (images, plans) are stored and added to the concept. */
async function filesFrom(fd: FormData, existing: string | null) {
  const list = parseFiles(existing);
  const kind = CONCEPT_FILE_KINDS.includes(String(fd.get("fileKind"))) ? String(fd.get("fileKind")) : "image";
  for (const f of fd.getAll("files")) {
    if (!(f instanceof File) || !f.size) continue;
    const saved = await saveFile(f.name, Buffer.from(await f.arrayBuffer()));
    list.push({ id: saved.id, name: f.name, kind, added: new Date().toISOString().slice(0, 10), type: f.type });
  }
  return JSON.stringify(list);
}

export async function createConcept(fd: FormData) {
  const u = await requireUser([...EDITORS]);
  let id = "";
  try {
    const c = await prisma.concept.create({ data: { ...parse(fd), files: await filesFrom(fd, null), createdBy: u.name } });
    id = c.id; await audit(u.email, "create", "Concept", c.id, c.name);
  } catch (e) { redirect(`/concepts/new?err=${enc((e as Error).message)}`); }
  revalidatePath("/concepts");
  redirect(`/concepts/${id}?msg=${enc("Concept saved.")}`);
}

export async function updateConcept(fd: FormData) {
  const u = await requireUser([...EDITORS]);
  const id = String(fd.get("id"));
  const cur = await prisma.concept.findUniqueOrThrow({ where: { id } });
  try { await prisma.concept.update({ where: { id }, data: { ...parse(fd), files: await filesFrom(fd, cur.files) } }); }
  catch (e) { redirect(`/concepts/${id}?err=${enc((e as Error).message)}`); }
  await audit(u.email, "update", "Concept", id);
  revalidatePath("/concepts"); revalidatePath(`/concepts/${id}`);
  redirect(`/concepts/${id}?msg=${enc("Saved.")}`);
}

/** Take a file off the concept (the stored copy is kept, nothing is deleted from disk). */
export async function removeConceptFile(fd: FormData) {
  const u = await requireUser([...EDITORS]);
  const id = String(fd.get("id")); const fileId = String(fd.get("fileId"));
  const cur = await prisma.concept.findUniqueOrThrow({ where: { id } });
  await prisma.concept.update({ where: { id }, data: { files: JSON.stringify(parseFiles(cur.files).filter((f) => f.id !== fileId)) } });
  await audit(u.email, "remove file", "Concept", id, fileId);
  revalidatePath(`/concepts/${id}`);
}

export async function deleteConcept(fd: FormData) {
  const u = await requireUser(["ADMIN"]);
  const id = String(fd.get("id"));
  const c = await prisma.concept.delete({ where: { id } });
  await audit(u.email, "delete", "Concept", id, c.name);
  revalidatePath("/concepts");
  redirect(`/concepts?msg=${enc(`Deleted ${c.name}.`)}`);
}
