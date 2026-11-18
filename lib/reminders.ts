import "server-only";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/automations";

export type ReminderInput = {
  title: string;
  description?: string;
  dueString?: string | null;
  leadId?: string | null;
  callId?: string | null;
  company?: string | null;
  brand?: string | null;
  source?: string;
  createdBy: string;
};

export type ReminderResult = {
  ok: boolean;
  id: string;
  reply: string;
  todoistTaskId?: string | null;
  /** Plain text Anita can turn into a Todoist task if MCP create is preferred. */
  anitaDraft: string;
};

/** Anita Reminder teammate — parent wires Todoist MCP from pending ReminderRequest rows. */
export const ANITA_REMINDER_BOT_ID = "ca598b14-f4e4-4ff5-a2e4-81606f7c2dca";

function draftText(input: ReminderInput) {
  const bits = [
    input.title,
    input.company ? `Company: ${input.company}` : null,
    input.brand ? `Brand: ${input.brand === "DR" ? "DR Fitout" : input.brand}` : null,
    input.dueString ? `Due: ${input.dueString}` : null,
    input.description || null,
    input.leadId ? `Lead id: ${input.leadId}` : null,
    input.callId ? `Call id: ${input.callId}` : null,
  ].filter(Boolean);
  return bits.join("\n");
}

async function tryTodoistCreate(input: ReminderInput): Promise<string | null> {
  const token = process.env.TODOIST_API_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch("https://api.todoist.com/rest/v2/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        content: input.title,
        description: [input.description, input.company ? `Company: ${input.company}` : null, input.brand ? `Brand: ${input.brand === "DR" ? "DR Fitout" : input.brand}` : null, input.leadId ? `CRM lead: ${input.leadId}` : null, input.callId ? `CRM call: ${input.callId}` : null].filter(Boolean).join("\n"),
        due_string: input.dueString || undefined,
        due_lang: "en",
        priority: 3,
        labels: ["anita-reminder", "enp-crm"],
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return j.id ? String(j.id) : null;
  } catch {
    return null;
  }
}

/** Create a chase-up / quote reminder. Uses Todoist REST when TODOIST_API_TOKEN is set; always queues for Anita. */
export async function createReminder(input: ReminderInput): Promise<ReminderResult> {
  const title = input.title.trim().slice(0, 200);
  if (!title) return { ok: false, id: "", reply: "Need a reminder title.", anitaDraft: "" };
  const anitaDraft = draftText({ ...input, title });
  const todoistTaskId = await tryTodoistCreate(input);
  const row = await prisma.reminderRequest.create({
    data: {
      title,
      description: input.description?.slice(0, 2000) ?? null,
      dueString: input.dueString ?? null,
      leadId: input.leadId ?? null,
      callId: input.callId ?? null,
      company: input.company ?? null,
      brand: input.brand ?? null,
      source: input.source ?? "dashboard",
      createdBy: input.createdBy,
      status: todoistTaskId ? "todoist" : "pending",
      todoistTaskId,
    },
  });
  await audit(input.createdBy, todoistTaskId ? "reminder→todoist" : "reminder→anita-queue", "ReminderRequest", row.id, title);
  // Append JSONL hook file for Anita (parent wires bot ca598b14-…)
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    const dir = path.join(process.cwd(), "data");
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(
      path.join(dir, "anita-reminder-queue.jsonl"),
      JSON.stringify({
        id: row.id,
        anitaBotId: ANITA_REMINDER_BOT_ID,
        title,
        description: input.description ?? null,
        dueString: input.dueString ?? null,
        leadId: input.leadId ?? null,
        callId: input.callId ?? null,
        company: input.company ?? null,
        brand: input.brand ?? null,
        todoistTaskId,
        status: row.status,
        createdAt: new Date().toISOString(),
        anitaDraft,
      }) + "\n",
    );
  } catch { /* non-fatal */ }

  if (todoistTaskId) {
    return { ok: true, id: row.id, todoistTaskId, anitaDraft, reply: `✓ Todoist task created for “${title}”.` };
  }
  return {
    ok: true,
    id: row.id,
    todoistTaskId: null,
    anitaDraft,
    reply: `✓ Queued for Anita Reminder: “${title}”${input.dueString ? ` (due ${input.dueString})` : ""}. Ask Anita to push pending reminders to Todoist.`,
  };
}

export async function listPendingReminders(limit = 50) {
  return prisma.reminderRequest.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" }, take: limit });
}


/** When Call Status becomes "Braiden to Connect" — queue Anita/Todoist with full contact detail. Dedupes open rows for the same call. */
export async function enqueueBraidenToConnect(call: {
  id: string;
  leadName: string | null;
  company: string | null;
  phone: string | null;
  email: string | null;
  business: string;
  leadId: string | null;
  leadInfo?: string | null;
  callNotes?: string | null;
  assignedSetter?: string | null;
}, createdBy = "system:braiden-to-connect"): Promise<ReminderResult | null> {
  const existing = await prisma.reminderRequest.findFirst({
    where: {
      callId: call.id,
      source: "braiden-to-connect",
      status: { in: ["pending", "todoist"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    return {
      ok: true,
      id: existing.id,
      todoistTaskId: existing.todoistTaskId,
      anitaDraft: existing.description ?? existing.title,
      reply: `Already queued for Anita (reminder ${existing.id}).`,
    };
  }
  const brandLabel = call.business === "DR" ? "DR Fitout" : "ENP Fitouts";
  const who = call.leadName ?? call.company ?? "contact";
  const title = `Braiden to Connect — ${who} (${brandLabel})`;
  const description = [
    `Status: Braiden to Connect (aka Braiden to contact)`,
    `Name: ${call.leadName ?? "—"}`,
    `Company: ${call.company ?? "—"}`,
    `Phone: ${call.phone ?? "—"}`,
    `Email: ${call.email ?? "—"}`,
    `Brand: ${brandLabel}`,
    `Call id: ${call.id}`,
    call.leadId ? `Lead id: ${call.leadId}` : null,
    call.assignedSetter ? `Setter: ${call.assignedSetter}` : null,
    call.leadInfo ? `Why call: ${call.leadInfo.slice(0, 500)}` : null,
    call.callNotes ? `Call notes: ${call.callNotes.slice(0, 500)}` : null,
    `Anita Reminder bot: ${ANITA_REMINDER_BOT_ID}`,
  ].filter(Boolean).join("\n");
  return createReminder({
    title,
    description,
    dueString: "today",
    leadId: call.leadId,
    callId: call.id,
    company: call.company,
    brand: "DR",
    source: "braiden-to-connect",
    createdBy,
  });
}
