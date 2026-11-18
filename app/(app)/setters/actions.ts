"use server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/automations";
export async function saveSetter(fd: FormData) {
  const u = await requireUser(["ADMIN", "BDM"]);
  const id = String(fd.get("id") || "");
  const g = (k: string) => { const v = String(fd.get(k) ?? "").trim(); return v === "" ? null : v; };
  const data = { name: g("name") ?? "Unnamed", email: g("email"), phone: g("phone"), status: g("status") === "Inactive" ? "Inactive" : "Active", startDate: g("startDate"), notes: g("notes"), abn: g("abn") };
  const s = id ? await prisma.setter.update({ where: { id }, data }) : await prisma.setter.create({ data });
  await audit(u.email, id ? "update" : "create", "Setter", s.id);
  redirect(`/setters/${s.id}?msg=Saved`);
}
