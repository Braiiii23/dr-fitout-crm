"use server";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { runMonthlyStatements } from "@/lib/statements";
import { audit } from "@/lib/automations";
export async function queueStatements() {
  const u = await requireUser(["ADMIN", "BDM", "ACCOUNTS"]);
  const n = await runMonthlyStatements(u.email);
  await audit(u.email, `queued ${n} statements`, "EmailLog");
  redirect(`/accounts?msg=${n}+setter+statement(s)+written+to+the+outbox#setter-pay`);
}
