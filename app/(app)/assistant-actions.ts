"use server";
import { getUser } from "@/lib/auth";
import { aiToolChat, aiConfig } from "@/lib/ai";
import { assistantContext } from "@/lib/assistant-context";
import { prisma } from "@/lib/db";
import { ASSISTANT_TOOLS, makeToolHandler, tablesGuide, changeableTables, applyPending, cancelPending, type PendingOp } from "@/lib/assistant-edits";

type Msg = { role: "user" | "assistant"; content: string };

const SYSTEM = `You are the built-in assistant for DR Fitout's CRM (DR Fitout builds medical and allied-health fitouts in Brisbane; always spelt "DR Fitout", singular).
Answer using only the DATA below, which is everything this person is allowed to see. If the data doesn't hold the answer, say so plainly and say where in the app to look.
Be brief and practical: short sentences, plain Australian English, dollar figures rounded. Explain how a number is worked out when asked.
Never invent figures, clients or dates.

ADDING AND EDITING
You can add and edit records for this person using your tools. You never save anything yourself: prepare_create / prepare_update only PREPARE a change, and the person reviews it and presses Apply.
- Always find_records (or get_record) first so you change the right record. If more than one record could match, ask which one instead of guessing.
- Only include fields that change. Use the exact field names listed under TABLES. Dates YYYY-MM-DD. Money ex GST unless the field says Inc.
- To add a note, use appendNotes (it adds a dated line and keeps what's there). Don't overwrite notes fields.
- Don't make up values the person didn't give you; leave them blank and mention it.
- You can't delete anything, and you can't touch logins, users or passwords. Say so if asked.
- After preparing, reply in one or two lines saying what you've prepared and that they need to press Apply below. Don't claim anything is saved.`;

export type PendingView = { id: string; items: { label: string; reason?: string; details: PendingOp["details"] }[] };

export async function askAssistant(history: Msg[], path: string): Promise<{ answer?: string; error?: string; pending?: PendingView }> {
  const u = await getUser();
  if (!u) return { error: "Please sign in again." };
  const ai = aiConfig();
  if (!ai) return { error: "The assistant needs Claude set up on the server. Ask the admin to add ANTHROPIC_API_KEY in Railway." };
  const msgs = history.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-8)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") return { error: "Type a question first." };
  const safePath = /^\/[A-Za-z0-9/_-]*$/.test(path) ? path.slice(0, 100) : "/";
  let data: string;
  try { data = await assistantContext(u, safePath); } catch (e) { data = `Data couldn't be loaded: ${(e as Error).message}`; }
  const canEdit = changeableTables(u).length > 0;
  const who = `PERSON: ${u.name} (${u.role}). Page open: ${safePath}. Today: ${new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane" }).format(new Date())}.${canEdit ? "" : " This login can't change data through you (shared team login or view-only role): explain that if they ask for a change."}`;
  const pending: PendingOp[] = [];
  try {
    const { text } = await aiToolChat({ feature: "assistant", system: `${SYSTEM}\n\n${who}\n\nTABLES (* = required when adding):\n${tablesGuide(u)}\n\nDATA:\n${data}`, messages: msgs, tools: ASSISTANT_TOOLS, onTool: makeToolHandler(u, pending), maxTokens: 4000, maxSteps: 10 });
    let view: PendingView | undefined;
    if (pending.length) {
      const row = await prisma.aiPendingChange.create({ data: { userId: u.id, ops: JSON.stringify(pending) } });
      view = { id: row.id, items: pending.map((p) => ({ label: p.label, reason: p.reason, details: p.details })) };
    }
    return text || view ? { answer: text || "I've prepared these changes. Check them and press Apply.", pending: view } : { error: "No answer came back. Try rephrasing." };
  } catch (e) {
    return { error: `The AI didn't answer: ${(e as Error).message}. Try again in a minute.` };
  }
}

export async function applyAssistantChanges(id: string): Promise<{ results?: { label: string; ok: boolean; error?: string; link?: string }[]; error?: string }> {
  const u = await getUser();
  if (!u) return { error: "Please sign in again." };
  try { return { results: await applyPending(u, String(id)) }; } catch (e) { return { error: (e as Error).message }; }
}

export async function cancelAssistantChanges(id: string) {
  const u = await getUser();
  if (u) await cancelPending(u, String(id));
}
