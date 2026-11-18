"use server";
import { autoNotice } from "@/lib/notices";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { BRANDS, STAGES, type BrandKey } from "@/lib/constants";
import { parseLeadForm } from "@/lib/fields";
import { fromLocalInput } from "@/lib/time";
import { audit, runLeadAutomations, stageSideEffects, recomputeWinNumbers } from "@/lib/automations";
import { fillGpOnSign } from "@/lib/job-estimate";
import { ensureJobForLead } from "@/lib/job-from-lead";

export async function saveLead(fd: FormData) {
  const u = await requireUser(["ADMIN", "BDM"]);
  const brand = String(fd.get("_brand")) as BrandKey;
  if (!BRANDS[brand]) throw new Error("Bad brand");
  const id = String(fd.get("_id") || "");
  const data = parseLeadForm(fd, brand, (v) => fromLocalInput(v)) as Record<string, unknown>;
  if (data.stage && !STAGES[brand].includes(String(data.stage))) data.stage = null;
  const setterId = data.setterId as string | null | undefined; delete data.setterId;
  const rel = setterId === undefined ? {} : setterId ? { setter: { connect: { id: setterId } } } : { setter: { disconnect: true } };
  let leadId = id;
  const prevStage = id ? (await prisma.lead.findUnique({ where: { id }, select: { stage: true } }))?.stage ?? null : null;
  if (id) {
    await prisma.lead.update({ where: { id }, data: { ...data, ...rel } });
  } else {
    const l = await prisma.lead.create({ data: { ...data, brand, ...(setterId ? { setter: { connect: { id: setterId } } } : {}) } as never });
    leadId = l.id;
  }
  const l = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
  const side = stageSideEffects(brand, l.stage, l);
  if (Object.keys(side).length) await prisma.lead.update({ where: { id: leadId }, data: side });
  await runLeadAutomations(leadId);
  await fillGpOnSign(leadId, u.email);
  await ensureJobForLead(leadId);
  await audit(u.email, id ? "update" : "create", "Lead", leadId);
  await leadNotice(leadId, prevStage, u.name);
  revalidatePath(`/leads/${BRANDS[brand].slug}`);
  redirect(`/leads/${BRANDS[brand].slug}/${leadId}?saved=1`);
}

export async function moveStage(fd: FormData) {
  const u = await requireUser(["ADMIN", "BDM"]);
  const id = String(fd.get("id")); const stage = String(fd.get("stage"));
  const l = await prisma.lead.findUniqueOrThrow({ where: { id } });
  if (!STAGES[l.brand as BrandKey].includes(stage)) return;
  await prisma.lead.update({ where: { id }, data: { stage, ...stageSideEffects(l.brand, stage, l) } });
  await fillGpOnSign(id, u.email);
  await ensureJobForLead(id);
  await audit(u.email, `stage → ${stage}`, "Lead", id);
  await leadNotice(id, l.stage, u.name);
  revalidatePath(`/leads/${BRANDS[l.brand as BrandKey].slug}`);
}

export async function deleteLead(fd: FormData) {
  const u = await requireUser(["ADMIN", "BDM"]);
  const id = String(fd.get("id"));
  const l = await prisma.lead.findUniqueOrThrow({ where: { id } });
  await prisma.callListItem.updateMany({ where: { leadId: id }, data: { leadId: null } });
  await prisma.lead.delete({ where: { id } });
  await audit(u.email, "delete", "Lead", id, `${l.leadName} / ${l.company}`);
  redirect(`/leads/${BRANDS[l.brand as BrandKey].slug}`);
}


/** Post signed work and quotes going out to the My Day notice board. */
async function leadNotice(id: string, prevStage: string | null, by: string) {
  const l = await prisma.lead.findUnique({ where: { id } });
  if (!l || l.stage === prevStage) return;
  const who = l.company || l.leadName || "A lead";
  const $ = (n?: number | null) => (n ? ` · $${Math.round(n).toLocaleString("en-AU")} ex GST` : "");
  if (l.stage === "Signed") await autoNotice("Win", `Signed: ${who}${l.category ? ` (${l.category})` : ""}${$(l.contractValue)}. Moved by ${by}.`, `/leads/dr/${id}`, "Open lead");
  else if (l.stage === "Quoting") await autoNotice("Progress", `${who} moved to Quoting${l.category ? ` (${l.category})` : ""}. Moved by ${by}.`, `/leads/dr/${id}`, "Open lead");
}
