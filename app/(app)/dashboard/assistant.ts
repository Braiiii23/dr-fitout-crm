"use server";
import { revalidatePath } from "next/cache";
import { aiChat, aiConfig, jsonFrom } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { BRANDS, CALL_STATUSES, STAGES, type BrandKey } from "@/lib/constants";
import { brisbaneToday } from "@/lib/time";
import { audit, runCallAutomations, stageSideEffects } from "@/lib/automations";
import { createReminder } from "@/lib/reminders";

/** Braiden admin assistant: update any lead/call (status, notes, follow-ups). Not setter-scoped. */
export type ChatReply = { ok: boolean; reply: string };

type Intent =
  | { kind: "call_status"; target: string; status: string }
  | { kind: "call_note"; target: string; note: string }
  | { kind: "attempt"; target: string; n: number }
  | { kind: "lead_stage"; target: string; stage: string }
  | { kind: "lead_note"; target: string; note: string }
  | { kind: "followup"; target: string; date: string }
  | { kind: "remind"; target: string; due?: string; quote?: boolean };

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

const ALL_STAGES = Array.from(new Set(Object.values(STAGES).flat()));
const STAGE_ALIASES: [RegExp, string][] = [
  [/\bnew\b/i, "New"],
  [/contacted|spoke/i, "Contacted"],
  [/potential lease/i, "Potential Leases"],
  [/quoting|quote/i, "Quoting"],
  [/signed|won|closed.?won/i, "Signed"],
  [/lost|closed.?lost/i, "Lost"],
  [/stay in touch|nurture/i, "Stay in Touch"],
];

function matchStatus(s: string) {
  const exact = CALL_STATUSES.find((c) => c.toLowerCase() === s.trim().toLowerCase().replace(/[.!]$/, ""));
  return exact ?? STATUS_ALIASES.find(([re]) => re.test(s))?.[1] ?? null;
}
function matchStage(s: string) {
  const exact = ALL_STAGES.find((c) => c.toLowerCase() === s.trim().toLowerCase().replace(/[.!]$/, ""));
  return exact ?? STAGE_ALIASES.find(([re]) => re.test(s))?.[1] ?? null;
}
function parseDate(s: string): string | null {
  const t = s.trim().toLowerCase();
  const today = brisbaneToday();
  if (/^today$/.test(t)) return today;
  if (/^tomorrow$/.test(t)) {
    const [y, m, d] = today.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + 1));
    return dt.toISOString().slice(0, 10);
  }
  const iso = t.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (iso) return iso[1];
  const au = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (au) {
    const day = au[1].padStart(2, "0");
    const mon = au[2].padStart(2, "0");
    let year = au[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${mon}-${day}`;
  }
  return null;
}

function ruleParse(msg: string): Intent | null {
  const m = msg.trim();
  let r = m.match(/^(?:remind me (?:to )?(?:chase(?:-?up)?|follow[\s-]?up(?: on)?|quote)|chase(?:-?up)?|ask anita (?:to )?(?:remind|chase))\s+(?:on |for |about )?(.+?)(?:\s+(?:on|by|due)\s+(.+))?$/i);
  if (r) return { kind: "remind", target: r[1].replace(/\s+tomorrow.*$/i, "").trim(), due: r[2]?.trim() || (/tomorrow/i.test(m) ? "tomorrow" : undefined), quote: /quote/i.test(m) };
  r = m.match(/^(?:set |schedule )?follow[-\s]?up (?:on|for|to) (.+?)\s*(?:to|:|=)\s*(.+)$/i);
  if (r) { const d = parseDate(r[2]); if (d) return { kind: "followup", target: r[1], date: d }; }
  r = m.match(/^(?:follow[-\s]?up)\s+(.+?)\s+(?:on|for|=)\s+(.+)$/i);
  if (r) { const d = parseDate(r[2]); if (d) return { kind: "followup", target: r[1], date: d }; }

  r = m.match(/^(?:add |log )?(?:a )?(?:lead )?note (?:on|for|to) (?:lead )?(.+?)\s*[:\-–]\s*(.+)$/i);
  if (r) return { kind: "lead_note", target: r[1], note: r[2] };
  r = m.match(/^(?:add |log )?(?:a )?note (?:on|for|to) (?:call )?(.+?)\s*[:\-–]\s*(.+)$/i);
  if (r) return { kind: "call_note", target: r[1], note: r[2] };

  r = m.match(/^(?:\+\s*(\d+)|add (\d+|an?|one)|log (\d+|an?|one))\s*(?:more )?(?:call )?attempts? (?:on|for|to) (.+)$/i);
  if (r) { const raw = r[1] ?? r[2] ?? r[3]; const n = /^\d+$/.test(raw) ? parseInt(raw, 10) : 1; return { kind: "attempt", target: r[4], n }; }

  r = m.match(/^(?:mark|set|move|put|change)\s+(?:lead )?(.+?)\s+(?:stage\s+)?(?:as|to|into|=)\s+(.+)$/i);
  if (r) {
    const stg = matchStage(r[2]);
    const st = matchStatus(r[2]);
    if (/\bstage\b/i.test(m) && stg) return { kind: "lead_stage", target: r[1], stage: stg };
    if (stg && !st) return { kind: "lead_stage", target: r[1], stage: stg };
    if (st) return { kind: "call_status", target: r[1], status: st };
    if (stg) return { kind: "lead_stage", target: r[1], stage: stg };
  }
  r = m.match(/^(.+?)\s*[:\-–]\s*(.+)$/);
  if (r) {
    const st = matchStatus(r[2]);
    if (st) return { kind: "call_status", target: r[1], status: st };
    const stg = matchStage(r[2]);
    if (stg) return { kind: "lead_stage", target: r[1], stage: stg };
  }
  return null;
}

async function llmParse(msg: string, names: string[]): Promise<Intent | null> {
  const ai = aiConfig();
  if (!ai) return null;
  try {
    const { text } = await aiChat({ feature: "dashboard", json: true, temperature: 0, maxTokens: 400, timeoutMs: 15000,
      system: `You help the DR Fitout admin update CRM leads. Return JSON {"kind":"call_status"|"call_note"|"attempt"|"lead_stage"|"lead_note"|"followup"|"remind"|"none","target":name,"status"?:one of ${JSON.stringify(CALL_STATUSES)},"stage"?:one of ${JSON.stringify(ALL_STAGES)},"note"?:string,"n"?:int,"date"?: "YYYY-MM-DD","due"?:string,"quote"?:boolean}. Known names: ${JSON.stringify(names.slice(0, 250))}. Spelling: DR Fitout (singular). If unclear return {"kind":"none"}.`,
      messages: [{ role: "user", content: msg }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j = jsonFrom<any>(text);
    if (j.kind === "call_status" && CALL_STATUSES.includes(j.status)) return { kind: "call_status", target: String(j.target), status: j.status };
    if (j.kind === "call_note" && j.note) return { kind: "call_note", target: String(j.target), note: String(j.note) };
    if (j.kind === "attempt") return { kind: "attempt", target: String(j.target), n: Math.min(5, Math.max(1, parseInt(j.n, 10) || 1)) };
    if (j.kind === "lead_stage" && ALL_STAGES.includes(j.stage)) return { kind: "lead_stage", target: String(j.target), stage: j.stage };
    if (j.kind === "lead_note" && j.note) return { kind: "lead_note", target: String(j.target), note: String(j.note) };
    if (j.kind === "followup" && j.date) {
      const d = parseDate(String(j.date));
      if (d) return { kind: "followup", target: String(j.target), date: d };
    }
    if (j.kind === "remind") return { kind: "remind", target: String(j.target), due: j.due ? String(j.due) : undefined, quote: !!j.quote };
  } catch { /* fall back */ }
  return null;
}

type Row = { id: string; leadName: string | null; company: string | null; kind: "call" | "lead"; brand?: string; callStatus?: string; callNotes?: string | null; notes?: string | null; stage?: string | null };
function findTarget(target: string, rows: Row[]): Row[] {
  const t = target.toLowerCase().replace(/^(the )/, "").replace(/'s$/, "").replace(/\b(lead|call)\b/g, "").trim();
  if (!t) return [];
  const exact = rows.filter((c) => c.leadName?.toLowerCase() === t || c.company?.toLowerCase() === t);
  if (exact.length) return exact;
  const words = t.split(/\s+/).filter((w) => w.length > 1);
  return rows.filter((c) => {
    const hay = `${c.leadName ?? ""} ${c.company ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export async function adminAssistantChat(message: string, brand: "ENP" | "DR" | "ALL"): Promise<ChatReply> {
  const u = await requireUser(["ADMIN", "BDM"]);
  const msg = String(message ?? "").slice(0, 500).trim();
  if (!msg) return { ok: false, reply: "Try “mark Smith as no answer”, “set lead Acme stage to Quoting”, or “follow-up on Jane to tomorrow”." };
  if (/^(help|\?)$/i.test(msg)) {
    return {
      ok: true,
      reply: "Admin shortcuts:\n• mark Smith as no answer  (call status)\n• set lead Acme stage to Quoting\n• add note on Acme: left VM\n• add lead note on Acme: sent CS\n• follow-up on Jane to 2026-11-12\n• +1 attempt on Jane\n• remind me to chase Acme tomorrow\n• chase up Jane (Ask Anita / Todoist)\nWorks across all setters. Spelling: DR Fitout.",
    };
  }

  const brandFilter = brand === "ALL" ? {} : { business: brand };
  const leadBrandFilter = brand === "ALL" ? {} : brand === "DR" ? { brand: { in: ["DR"] } } : { brand: { in: ["ENP", "CONSULTING"] } };

  const [calls, leads] = await Promise.all([
    prisma.callListItem.findMany({
      where: brandFilter,
      select: { id: true, leadName: true, company: true, callStatus: true, callNotes: true, business: true },
      take: 800,
    }),
    prisma.lead.findMany({
      where: leadBrandFilter,
      select: { id: true, leadName: true, company: true, stage: true, notes: true, brand: true },
      take: 800,
    }),
  ]);

  const callRows: Row[] = calls.map((c) => ({ id: c.id, leadName: c.leadName, company: c.company, kind: "call", brand: c.business, callStatus: c.callStatus, callNotes: c.callNotes }));
  const leadRows: Row[] = leads.map((l) => ({ id: l.id, leadName: l.leadName, company: l.company, kind: "lead", brand: l.brand, stage: l.stage, notes: l.notes }));
  const names = [...callRows, ...leadRows].map((r) => `${r.leadName ?? ""} (${r.company ?? ""}) [${r.kind}]`);

  const intent = ruleParse(msg) ?? (await llmParse(msg, names));
  if (!intent) return { ok: false, reply: "Sorry, I didn't catch that. Type “help” for examples (status, stage, notes, follow-up, attempts)." };

  const preferLead = intent.kind === "lead_stage" || intent.kind === "lead_note" || intent.kind === "followup";
  const pool = preferLead ? leadRows : intent.kind === "call_status" || intent.kind === "call_note" || intent.kind === "attempt" ? callRows : [...callRows, ...leadRows];
  let hits = findTarget(intent.target, pool);
  if (!hits.length && preferLead) hits = findTarget(intent.target, callRows);
  if (!hits.length && !preferLead) hits = findTarget(intent.target, leadRows);
  if (!hits.length) return { ok: false, reply: `Couldn't find “${intent.target}” in ${brand === "DR" ? "DR Fitout" : brand === "ENP" ? "ENP" : "all"} records.` };
  if (hits.length > 1) {
    return { ok: false, reply: `“${intent.target}” matches ${hits.length}: ${hits.slice(0, 5).map((h) => `${h.leadName ?? "?"} (${h.company ?? "—"}) [${h.kind}]`).join(", ")}. Be more specific.` };
  }
  const row = hits[0];
  const label = `${row.leadName ?? "?"}${row.company ? ` (${row.company})` : ""}`;

  if (intent.kind === "call_status") {
    if (row.kind !== "call") return { ok: false, reply: `${label} is a lead — say “set lead ${intent.target} stage to …” for pipeline stage.` };
    await prisma.callListItem.update({ where: { id: row.id }, data: { callStatus: intent.status } });
    const after = await runCallAutomations(row.id);
    await audit(u.email, `admin-assistant status → ${intent.status}`, "CallListItem", row.id);
    revalidatePath("/dashboard"); revalidatePath("/directory");
    return { ok: true, reply: `✓ Call ${label}: ${row.callStatus} → ${intent.status}.` + (intent.status === "Appointment Set" && !after.appointment ? " Book a slot if needed." : "") };
  }

  if (intent.kind === "call_note") {
    if (row.kind !== "call") {
      // fall through to lead note if they hit a lead
      const line = `[${brisbaneToday()}] ${intent.note.trim()}`;
      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: row.id } });
      await prisma.lead.update({ where: { id: row.id }, data: { notes: lead.notes ? `${lead.notes}\n${line}` : line } });
      await audit(u.email, "admin-assistant lead note", "Lead", row.id);
      revalidatePath("/dashboard"); revalidatePath(`/leads/${BRANDS[lead.brand as BrandKey]?.slug ?? "enp"}`);
      return { ok: true, reply: `✓ Lead note on ${label}: “${intent.note.trim()}”.` };
    }
    const line = `[${brisbaneToday()}] ${intent.note.trim()}`;
    await prisma.callListItem.update({ where: { id: row.id }, data: { callNotes: row.callNotes ? `${row.callNotes}\n${line}` : line } });
    await audit(u.email, "admin-assistant call note", "CallListItem", row.id);
    revalidatePath("/dashboard");
    return { ok: true, reply: `✓ Call note on ${label}: “${intent.note.trim()}”.` };
  }

  if (intent.kind === "attempt") {
    if (row.kind !== "call") return { ok: false, reply: `Attempts only apply to call cards — “${label}” is a lead.` };
    const n = Math.min(5, Math.max(1, intent.n));
    await prisma.callListItem.update({ where: { id: row.id }, data: { attempts: { increment: n }, lastCalled: brisbaneToday() } });
    await audit(u.email, `admin-assistant +${n} attempt`, "CallListItem", row.id);
    revalidatePath("/dashboard");
    return { ok: true, reply: `✓ Logged ${n} attempt${n === 1 ? "" : "s"} on ${label}.` };
  }

  if (intent.kind === "lead_stage") {
    let leadId = row.id;
    let brandKey = row.brand as BrandKey;
    if (row.kind === "call") {
      const linked = await prisma.callListItem.findUnique({ where: { id: row.id }, select: { leadId: true, business: true } });
      if (!linked?.leadId) return { ok: false, reply: `${label} is a call with no linked lead yet. Set a call status (Contacted/Quoting/Appointment Set) first, or name the CRM lead.` };
      leadId = linked.leadId;
      brandKey = (linked.business === "DR" ? "DR" : "ENP") as BrandKey;
    }
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    brandKey = lead.brand as BrandKey;
    if (!STAGES[brandKey]?.includes(intent.stage)) {
      return { ok: false, reply: `“${intent.stage}” isn't a ${BRANDS[brandKey].name} stage. Options: ${STAGES[brandKey].join(", ")}.` };
    }
    await prisma.lead.update({ where: { id: leadId }, data: { stage: intent.stage, ...stageSideEffects(brandKey, intent.stage, lead) } });
    await (await import("@/lib/job-estimate")).fillGpOnSign(leadId, null);
    await (await import("@/lib/job-from-lead")).ensureJobForLead(leadId);
    await audit(u.email, `admin-assistant stage → ${intent.stage}`, "Lead", leadId);
    revalidatePath("/dashboard"); revalidatePath(`/leads/${BRANDS[brandKey].slug}`);
    return { ok: true, reply: `✓ Lead ${lead.leadName ?? label}: stage ${lead.stage ?? "—"} → ${intent.stage}.` };
  }

  if (intent.kind === "lead_note") {
    let leadId = row.id;
    if (row.kind === "call") {
      const linked = await prisma.callListItem.findUnique({ where: { id: row.id }, select: { leadId: true } });
      if (!linked?.leadId) return { ok: false, reply: `No CRM lead linked to call ${label}. Use “add note on …” for the call card, or name the lead.` };
      leadId = linked.leadId;
    }
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    const line = `[${brisbaneToday()}] ${intent.note.trim()}`;
    await prisma.lead.update({ where: { id: leadId }, data: { notes: lead.notes ? `${lead.notes}\n${line}` : line } });
    await audit(u.email, "admin-assistant lead note", "Lead", leadId);
    revalidatePath("/dashboard"); revalidatePath(`/leads/${BRANDS[lead.brand as BrandKey]?.slug ?? "enp"}`);
    return { ok: true, reply: `✓ Lead note on ${lead.leadName ?? label}: “${intent.note.trim()}”.` };
  }

  if (intent.kind === "followup") {
    let leadId = row.id;
    if (row.kind === "call") {
      const linked = await prisma.callListItem.findUnique({ where: { id: row.id }, select: { leadId: true } });
      if (!linked?.leadId) return { ok: false, reply: `No CRM lead linked to call ${label} — follow-ups live on leads.` };
      leadId = linked.leadId;
    }
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    await prisma.lead.update({ where: { id: leadId }, data: { nextFollowUp: intent.date } });
    await audit(u.email, `admin-assistant follow-up → ${intent.date}`, "Lead", leadId);
    revalidatePath("/dashboard"); revalidatePath(`/leads/${BRANDS[lead.brand as BrandKey]?.slug ?? "enp"}`);
    return { ok: true, reply: `✓ Follow-up for ${lead.leadName ?? label} set to ${intent.date}.` };
  }


  if (intent.kind === "remind") {
    const preferLead = true;
    let hits = findTarget(intent.target, leadRows);
    if (!hits.length) hits = findTarget(intent.target, callRows);
    if (!hits.length) return { ok: false, reply: `Couldn't find “${intent.target}” to remind about.` };
    if (hits.length > 1) return { ok: false, reply: `“${intent.target}” matches ${hits.length} — be more specific.` };
    const hit = hits[0];
    let leadId = hit.id;
    let company = hit.company;
    let brandKey = hit.brand;
    let name = hit.leadName;
    if (hit.kind === "call") {
      const linked = await prisma.callListItem.findUnique({ where: { id: hit.id }, select: { leadId: true, company: true, business: true, leadName: true } });
      if (linked?.leadId) {
        leadId = linked.leadId;
        const lead = await prisma.lead.findUnique({ where: { id: linked.leadId } });
        company = lead?.company ?? linked.company;
        brandKey = lead?.brand ?? linked.business;
        name = lead?.leadName ?? linked.leadName;
      } else {
        company = linked?.company ?? company;
        brandKey = linked?.business ?? brandKey;
        name = linked?.leadName ?? name;
        leadId = "";
      }
    } else {
      const lead = await prisma.lead.findUnique({ where: { id: hit.id } });
      company = lead?.company ?? company;
      brandKey = lead?.brand ?? brandKey;
      name = lead?.leadName ?? name;
    }
    const brandLabel = brandKey === "DR" ? "DR Fitout" : brandKey === "CONSULTING" ? "Consulting" : "ENP Fitouts";
    const due = intent.due || "tomorrow";
    const title = intent.quote
      ? `Quote due — ${name ?? company ?? "lead"} (${brandLabel})`
      : `Chase-up — ${name ?? company ?? "lead"} (${brandLabel})`;
    const r = await createReminder({
      title,
      description: `From Braiden admin assistant.\nTarget: ${name ?? "—"} / ${company ?? "—"}\nBrand: ${brandLabel}`,
      dueString: due,
      leadId: leadId || null,
      company,
      brand: brandKey ?? null,
      source: "assistant",
      createdBy: u.email,
    });
    revalidatePath("/dashboard");
    return { ok: r.ok, reply: r.reply };
  }

  return { ok: false, reply: "Sorry, that didn't work." };
}
