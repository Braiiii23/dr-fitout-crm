"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { NOTICE_CATEGORIES } from "@/lib/notices";

const txt = (fd: FormData, k: string, max = 4000) => String(fd.get(k) ?? "").trim().slice(0, max);
/** Only in-app links (e.g. /leases/abc), so a notice can't point people off-site. */
const safeLink = (v: string) => (/^\/[A-Za-z0-9/_?=&#.%-]*$/.test(v) ? v : null);

export async function postNotice(fd: FormData) {
  const u = await requireUser();
  const body = txt(fd, "body");
  if (!body) return;
  const category = NOTICE_CATEGORIES.includes(txt(fd, "category")) ? txt(fd, "category") : "Update";
  await prisma.notice.create({ data: { authorId: u.id, authorName: u.name, category, body, link: safeLink(txt(fd, "link", 300)), pinned: u.role === "ADMIN" && fd.get("pinned") === "on" } });
  revalidatePath("/myday");
}

export async function replyNotice(fd: FormData) {
  const u = await requireUser();
  const body = txt(fd, "body", 2000); const noticeId = txt(fd, "noticeId", 40);
  if (!body || !noticeId) return;
  await prisma.noticeReply.create({ data: { noticeId, authorId: u.id, authorName: u.name, body } });
  await prisma.notice.update({ where: { id: noticeId }, data: { updatedAt: new Date() } });
  revalidatePath("/myday");
}

/** Admin pins / unpins. */
export async function pinNotice(fd: FormData) {
  await requireUser(["ADMIN"]);
  const id = txt(fd, "id", 40);
  const n = await prisma.notice.findUnique({ where: { id } });
  if (n) await prisma.notice.update({ where: { id }, data: { pinned: !n.pinned } });
  revalidatePath("/myday");
}

/** Take a notice down: its author, or the admin. */
export async function removeNotice(fd: FormData) {
  const u = await requireUser();
  const id = txt(fd, "id", 40);
  const n = await prisma.notice.findUnique({ where: { id } });
  if (!n || !(u.role === "ADMIN" || (n.authorId && n.authorId === u.id))) return;
  await prisma.notice.delete({ where: { id } });
  revalidatePath("/myday");
}
