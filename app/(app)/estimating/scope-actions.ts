"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/automations";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
async function jobOk(leadId: string) {
  const l = await prisma.lead.findUnique({ where: { id: leadId }, select: { brand: true } });
  return !!l && (l.brand === "ENP" || l.brand === "DR");
}
const done = (leadId: string) => { revalidatePath(`/estimating/${leadId}`); revalidatePath("/estimating"); };

/** Add one or many scope lines (one per line of the text box) under a trade. */
export async function addScopeItems(fd: FormData) {
  const u = await requireUser(["ADMIN", "ESTIMATOR", "ACCOUNTS"]);
  const leadId = str(fd, "leadId"); const trade = str(fd, "trade");
  const lines = str(fd, "description").split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-–•*]|\d+[.)])\s+/, "").trim()).filter(Boolean);
  if (!leadId || !trade || !lines.length || !(await jobOk(leadId))) return;
  const last = await prisma.scopeItem.findFirst({ where: { leadId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  let n = (last?.sortOrder ?? 0) + 1;
  const byClient = fd.get("byClient") === "on";
  await prisma.scopeItem.createMany({ data: lines.map((description) => ({ leadId, trade, description, byClient, sortOrder: n++ })) });
  await audit(u.email, "scope items added", "Lead", leadId, `${trade} ×${lines.length}`);
  done(leadId);
}

export async function updateScopeItem(fd: FormData) {
  const u = await requireUser(["ADMIN", "ESTIMATOR", "ACCOUNTS"]);
  const id = str(fd, "id");
  const it = id ? await prisma.scopeItem.findUnique({ where: { id } }) : null;
  if (!it) return;
  await prisma.scopeItem.update({
    where: { id },
    data: { trade: str(fd, "trade") || it.trade, description: str(fd, "description") || it.description, byClient: fd.get("byClient") === "on" },
  });
  await audit(u.email, "scope item updated", "Lead", it.leadId, it.description.slice(0, 60));
  done(it.leadId);
}

export async function deleteScopeItem(fd: FormData) {
  const u = await requireUser(["ADMIN", "ESTIMATOR", "ACCOUNTS"]);
  const id = str(fd, "id");
  const it = id ? await prisma.scopeItem.findUnique({ where: { id } }) : null;
  if (!it) return;
  await prisma.scopeItem.delete({ where: { id } });
  await audit(u.email, "scope item deleted", "Lead", it.leadId, it.description.slice(0, 60));
  done(it.leadId);
}
