"use server";
import { revalidatePath } from "next/cache";
import { aiConfig } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { CALL_STATUSES } from "@/lib/constants";
import { brisbaneToday } from "@/lib/time";
import { audit, runCallAutomations } from "@/lib/automations";

// "Ask Jessie's assistant": natural-language updates to the logged-in setter's OWN call cards only.
// Allowed edits: callStatus, callNotes (append), attempts (+n). Never money / fees / GP / budgets.
type Intent = { kind: "status"; target: string; status: string } | { kind: "note"; target: string; note: string } | { kind: "attempt"; target: string; n: number };
export type ChatReply = { ok: boolean; reply: string };

const STATUS_ALIASES: [RegExp, string][] = [
  [/no[\s-]?answer|didn'?t (pick|answer)|n\/a\b|voicemail only/i, "No Answer"],
  [/call[\s-]?back|ring back|callback/i, "Call Back"],
  [/not interested|no interest/i, "Not Interested"],
  [/appointment|appt|booked|meeting set/i, "Appointment Set"],
  [/wrong number|bad number/i, "Wrong Number"],
  [/braiden to connect|connect (with|to) braiden/i, "Braiden to Connect"],
  [/to call|reset/i, "To Call"],
  [/quoting/i, "Quoting"],
  [/contacted|spoke/i, "Contacted"],
];
const FINANCE = /\$|fee|commission|gp\b|gross profit|contract value|budget|price|payout|earn|net\b|paid|invoice/i;

function ruleParse(msg: string): Intent | null {
  const m = msg.trim();
  let r = m.match(/^(?:add |log )?(?:a )?note (?:on|for|to) (.+?)\s*[:\-–]\s*(.+)$/i);
  if (r) return { kind: "note", target: r[1], note: r[2] };
  r = m.match(/^(?:note|notes)\s*[:\-]?\s*(.+?)\s*[:\-–]\s*(.+)$/i);
  if (r) return { kind: "note", target: r[1], note: r[2] };
  r = m.match(/^(?:\+\s*(\d+)|add (\d+|an?|one)|log (\d+|an?|one))\s*(?:more )?(?:call )?attempts? (?:on|for|to) (.+)$/i);
  if (r) { const raw = r[1] ?? r[2] ?? r[3]; const n = /^\d+$/.test(raw) ? parseInt(raw, 10) : 1; return { kind: "attempt", target: r[4], n }; }
  r = m.match(/^(?:mark|set|move|put|change)\s+(.+?)\s+(?:as|to|into|=)\s+(.+)$/i);
  if (r) { const st = matchStatus(r[2]); if (st) return { kind: "status", target: r[1], status: st }; }
  r = m.match(/^(.+?)\s*[:\-–]\s*(.+)$/);
  if (r) { const st = matchStatus(r[2]); if (st) return { kind: "status", target: r[1], status: st }; }
  return null;
}
function matchStatus(s: string) {
  const exact = CALL_STATUSES.find((c) => c.toLowerCase() === s.trim().toLowerCase().replace(/[.!]$/, ""));
  return exact ?? STATUS_ALIASES.find(([re]) => re.test(s))?.[1] ?? null;
}

async function llmParse(msg: string, names: string[]): Promise<Intent | null> {
  const ai = aiConfig();
  if (!ai) return null;
  const key = ai.key;
  try {
    const res = await fetch(ai.url, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ model: ai.model, temperature: 0, response_format: { type: "json_object" }, messages: [
        { role: "system", content: `Convert a call setter's request into JSON {"kind":"status"|"note"|"attempt","target":lead or company name,"status"?:one of ${JSON.stringify(CALL_STATUSES)},"note"?:string,"n"?:int}. Known leads: ${JSON.stringify(names.slice(0, 200))}. Never handle money/fees. If unclear return {"kind":"none"}.` },
        { role: "user", content: msg } ] }),
    });
    const j = JSON.parse((await res.json()).choices?.[0]?.message?.content ?? "{}");
    if (j.kind === "status" && CALL_STATUSES.includes(j.status)) return { kind: "status", target: String(j.target), status: j.status };
    if (j.kind === "note" && j.note) return { kind: "note", target: String(j.target), note: String(j.note) };
    if (j.kind === "attempt") return { kind: "attempt", target: String(j.target), n: Math.min(5, Math.max(1, parseInt(j.n, 10) || 1)) };
  } catch { /* fall back to rules */ }
  return null;
}

type Mine = { id: string; leadName: string | null; company: string | null; callStatus: string; callNotes: string | null; business: string };
function findTarget(target: string, calls: Mine[]): Mine[] {
  const t = target.toLowerCase().replace(/^(the )/, "").replace(/'s$/, "").trim();
  if (!t) return [];
  const exact = calls.filter((c) => c.leadName?.toLowerCase() === t || c.company?.toLowerCase() === t);
  if (exact.length) return exact;
  const words = t.split(/\s+/).filter((w) => w.length > 1);
  return calls.filter((c) => { const hay = `${c.leadName ?? ""} ${c.company ?? ""}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
}

export async function assistantChat(message: string, brand: "ENP" | "DR" | "ALL"): Promise<ChatReply> {
  const u = await requireUser();
  if (!u.setterId) return { ok: false, reply: "Your account isn't linked to a setter yet." };
  const msg = String(message ?? "").slice(0, 500).trim();
  if (!msg) return { ok: false, reply: "Type something like “mark Smith as no answer”." };
  if (/^(help|\?)$/i.test(msg)) return { ok: true, reply: "Try:\n• mark Smith as no answer\n• add note on Acme: left voicemail\n• +1 attempt on Jane\n• set Jane to call back" };
  const calls: Mine[] = await prisma.callListItem.findMany({
    where: { setterId: u.setterId, ...(brand === "ALL" ? {} : { business: brand }) },
    select: { id: true, leadName: true, company: true, callStatus: true, callNotes: true, business: true },
  });
  const intent = ruleParse(msg) ?? (await llmParse(msg, calls.map((c) => `${c.leadName ?? ""} (${c.company ?? ""})`)));
  if (!intent) return { ok: false, reply: "Sorry, I didn't catch that. I can change a status, add a note, or log an attempt — type “help” for examples." };
  if (intent.kind === "note" && FINANCE.test(intent.note) && /\$\s*\d/.test(intent.note)) return { ok: false, reply: "I can't record financial figures — ask Braiden for anything money-related." };
  const hits = findTarget(intent.target, calls);
  const brandName = brand === "DR" ? "DR Fitout" : brand === "ENP" ? "ENP" : "your";
  if (!hits.length) return { ok: false, reply: `I couldn't find “${intent.target}” in ${brandName} calls assigned to you.` };
  if (hits.length > 1) return { ok: false, reply: `“${intent.target}” matches ${hits.length} calls: ${hits.slice(0, 5).map((h) => `${h.leadName ?? "?"} (${h.company ?? "—"})`).join(", ")}. Be more specific.` };
  const c = hits[0]; const label = `${c.leadName ?? "?"}${c.company ? ` (${c.company})` : ""}`;
  // Ownership enforced again at write-time via updateMany where setterId = mine.
  const own = { id: c.id, setterId: u.setterId };
  let reply = "";
  if (intent.kind === "status") {
    const r = await prisma.callListItem.updateMany({ where: own, data: { callStatus: intent.status } });
    if (r.count !== 1) return { ok: false, reply: "That call isn't assigned to you." };
    const after = await runCallAutomations(c.id);
    await audit(u.email, `assistant status → ${intent.status}`, "CallListItem", c.id);
    reply = `✓ ${label}: status ${c.callStatus} → ${intent.status}.` + (intent.status === "Appointment Set" && !after.appointment ? " Open Notes / book to pick a slot." : "");
  } else if (intent.kind === "note") {
    const line = `[${brisbaneToday()}] ${intent.note.trim()}`;
    const r = await prisma.callListItem.updateMany({ where: own, data: { callNotes: c.callNotes ? `${c.callNotes}\n${line}` : line } });
    if (r.count !== 1) return { ok: false, reply: "That call isn't assigned to you." };
    await audit(u.email, "assistant note", "CallListItem", c.id);
    reply = `✓ Note added to ${label}: “${intent.note.trim()}”.`;
  } else {
    const n = Math.min(5, Math.max(1, intent.n));
    const r = await prisma.callListItem.updateMany({ where: own, data: { attempts: { increment: n }, lastCalled: brisbaneToday() } });
    if (r.count !== 1) return { ok: false, reply: "That call isn't assigned to you." };
    await audit(u.email, `assistant +${n} attempt`, "CallListItem", c.id);
    reply = `✓ Logged ${n} attempt${n === 1 ? "" : "s"} on ${label}.`;
  }
  revalidatePath("/portal"); revalidatePath("/team"); revalidatePath("/calls");
  return { ok: true, reply };
}
