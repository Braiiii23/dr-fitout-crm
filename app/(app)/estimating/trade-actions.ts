"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/automations";
import { brisbaneToday } from "@/lib/time";
import { TRADE_STATUSES } from "@/lib/estimating";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const money = (v: string) => { const n = Number(v.replace(/[$,\s]/g, "")); return v === "" || !Number.isFinite(n) || n < 0 ? null : n; };
const safeLink = (v: string) => (/^https?:\/\/\S+$/i.test(v) ? v : null);
const status = (v: string) => ((TRADE_STATUSES as readonly string[]).includes(v) ? v : "Requested");

async function jobOk(leadId: string) {
  const l = await prisma.lead.findUnique({ where: { id: leadId }, select: { brand: true } });
  return !!l && (l.brand === "ENP" || l.brand === "DR");
}

export async function addTradeQuote(fd: FormData) {
  const u = await requireUser(["ADMIN", "ESTIMATOR", "ACCOUNTS"]);
  const leadId = str(fd, "leadId"); const trade = str(fd, "trade");
  if (!leadId || !trade || !(await jobOk(leadId))) return;
  const st = status(str(fd, "status"));
  const q = await prisma.tradeQuote.create({
    data: {
      leadId, trade, company: str(fd, "company") || null, scope: str(fd, "scope") || null, price: money(str(fd, "price")),
      status: st, link: safeLink(str(fd, "link")), receivedDate: st === "Received" || st === "Accepted" ? brisbaneToday() : null,
    },
  });
  await audit(u.email, "trade quote added", "Lead", leadId, `${trade} ${q.company ?? ""}`.trim());
  revalidatePath(`/estimating/${leadId}`); revalidatePath("/estimating");
}

export async function updateTradeQuote(fd: FormData) {
  const u = await requireUser(["ADMIN", "ESTIMATOR", "ACCOUNTS"]);
  const id = str(fd, "id");
  const q = id ? await prisma.tradeQuote.findUnique({ where: { id } }) : null;
  if (!q) return;
  const st = status(str(fd, "status"));
  // Only one accepted quote per trade on a job.
  if (st === "Accepted") await prisma.tradeQuote.updateMany({ where: { leadId: q.leadId, trade: str(fd, "trade") || q.trade, status: "Accepted", NOT: { id } }, data: { status: "Received" } });
  await prisma.tradeQuote.update({
    where: { id },
    data: {
      trade: str(fd, "trade") || q.trade, company: str(fd, "company") || null, scope: str(fd, "scope") || null,
      price: money(str(fd, "price")), status: st, link: safeLink(str(fd, "link")),
      receivedDate: (st === "Received" || st === "Accepted") ? (q.receivedDate ?? brisbaneToday()) : q.receivedDate,
    },
  });
  await audit(u.email, "trade quote updated", "Lead", q.leadId, q.trade);
  revalidatePath(`/estimating/${q.leadId}`); revalidatePath("/estimating");
}

export async function deleteTradeQuote(fd: FormData) {
  const u = await requireUser(["ADMIN", "ESTIMATOR", "ACCOUNTS"]);
  const id = str(fd, "id");
  const q = id ? await prisma.tradeQuote.findUnique({ where: { id } }) : null;
  if (!q) return;
  await prisma.tradeQuote.delete({ where: { id } });
  await audit(u.email, "trade quote deleted", "Lead", q.leadId, `${q.trade} ${q.company ?? ""}`.trim());
  revalidatePath(`/estimating/${q.leadId}`); revalidatePath("/estimating");
}
