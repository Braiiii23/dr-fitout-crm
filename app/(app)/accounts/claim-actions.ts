"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/automations";

/** Accounts marks a claim as invoiced: it becomes Authorised with the invoice number, date and due date. */
export async function markClaimInvoiced(fd: FormData) {
  const u = await requireUser(["ADMIN", "ACCOUNTS"]);
  const id = String(fd.get("claimId") ?? "");
  const d = (k: string) => { const v = String(fd.get(k) ?? ""); return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; };
  const inv = String(fd.get("invoiceNumber") ?? "").trim().slice(0, 40) || null;
  const claim = await prisma.jobClaim.findUnique({ where: { id } });
  if (!claim) return;
  await prisma.jobClaim.update({ where: { id }, data: { status: "Authorised", invoiceNumber: inv ?? claim.invoiceNumber, invoicedDate: d("invoicedDate") ?? new Date().toISOString().slice(0, 10), dueDate: d("dueDate") ?? claim.dueDate } });
  await prisma.claimNotice.updateMany({ where: { claimId: id, seenAt: null }, data: { seenAt: new Date() } });
  await audit(u.email, "claim invoiced", "Job", claim.jobId, `claim ${claim.seq} ${inv ?? ""}`);
  revalidatePath("/accounts"); revalidatePath(`/jobs/${claim.jobId}`); revalidatePath("/jobs"); revalidatePath("/wip");
}

export async function dismissNotice(fd: FormData) {
  await requireUser(["ADMIN", "ACCOUNTS"]);
  const id = String(fd.get("id") ?? "");
  await prisma.claimNotice.updateMany({ where: { id }, data: { seenAt: new Date() } });
  revalidatePath("/accounts");
}
