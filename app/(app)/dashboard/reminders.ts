"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createReminder } from "@/lib/reminders";

export async function remindAboutLead(fd: FormData) {
  const u = await requireUser(["ADMIN", "BDM"]);
  const leadId = String(fd.get("leadId") || "");
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { ok: false as const, reply: "Lead not found." };
  const due = String(fd.get("due") || lead.nextFollowUp || lead.quotedDate || "tomorrow");
  const kind = String(fd.get("kind") || "chase");
  const brandLabel = lead.brand === "DR" ? "DR Fitout" : lead.brand === "CONSULTING" ? "Consulting" : "ENP Fitouts";
  const title =
    kind === "quote"
      ? `Quote due — ${lead.leadName ?? lead.company ?? "lead"} (${brandLabel})`
      : `Chase-up — ${lead.leadName ?? lead.company ?? "lead"} (${brandLabel})`;
  const description = [
    lead.company ? `Company: ${lead.company}` : null,
    lead.stage ? `Stage: ${lead.stage}` : null,
    lead.nextFollowUp ? `Next follow-up: ${lead.nextFollowUp}` : null,
    lead.quotedDate ? `Quoted date: ${lead.quotedDate}` : null,
    lead.phone ? `Phone: ${lead.phone}` : null,
    lead.email ? `Email: ${lead.email}` : null,
    "Source: ENP CRM dashboard · remind Braiden via Anita Reminder / Todoist",
  ].filter(Boolean).join("\n");
  const r = await createReminder({
    title,
    description,
    dueString: due,
    leadId: lead.id,
    company: lead.company,
    brand: lead.brand,
    source: kind === "quote" ? "quoting" : "dashboard",
    createdBy: u.email,
  });
  revalidatePath("/dashboard");
  return r;
}
