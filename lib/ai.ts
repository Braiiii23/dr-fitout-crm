// Claude is the brain inside the CRM: every in-app AI feature calls aiChat() here.
//   ANTHROPIC_API_KEY=sk-ant-...                    required
//   CLAUDE_MODEL (default claude-sonnet-5-5)         everyday features
//   CLAUDE_VISION_MODEL (defaults to CLAUDE_MODEL)   reading floor plans and concept packages, e.g. claude-opus-5-5
// (Grok is not used in here: Grok works on the CRM from outside, like a user, through the Grok API. See docs/GROK_API.md.)
//
// Adding a new AI feature: add it to AI_FEATURES, then call
//   aiChat({ feature: "myFeature", system: "...", messages: [{ role: "user", content: "..." }], json?: true, vision?: true })
// and use jsonFrom() on the reply when you asked for JSON. Every call is logged in the audit log as "claude-ai".
import "server-only";
import { audit } from "./automations";

export type AiFeature = "assistant" | "dashboard" | "conceptFit" | "conceptImport";
export const AI_FEATURES: Record<AiFeature, string> = {
  assistant: "Ask assistant (every page)",
  dashboard: "Dashboard assistant (updates leads)",
  conceptFit: "AI concept fit (recreates a concept on a tenancy floor plan)",
  conceptImport: "Concept package import (reads package PDFs)",
};

export function aiConfig(): { key: string; model: string; visionModel: string; base: string } | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model = process.env.CLAUDE_MODEL || process.env.AI_MODEL || "claude-sonnet-5-5";
  return { key, model, visionModel: process.env.CLAUDE_VISION_MODEL || process.env.AI_VISION_MODEL || model, base: (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "") };
}

export type AiPart = { type: "text"; text: string } | { type: "image"; dataUrl: string };
export type AiMsg = { role: "user" | "assistant"; content: string | AiPart[] };

/** One call to Claude. Images go as base64 (PNG / JPEG / GIF / WebP). Returns the text reply. */
/** effort: how hard Claude thinks before answering (low = quick replies, medium = floor plans / packages, high = hardest jobs). */
export async function aiChat(o: { feature: AiFeature; system: string; messages: AiMsg[]; maxTokens?: number; temperature?: number; timeoutMs?: number; vision?: boolean; json?: boolean; effort?: "low" | "medium" | "high" }): Promise<{ text: string; model: string }> {
  const c = aiConfig();
  if (!c) throw new Error("Claude isn't set up. Add ANTHROPIC_API_KEY on the server.");
  const model = o.vision ? c.visionModel : c.model;
  const content = (x: string | AiPart[]) => typeof x === "string" ? x : x.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text };
    const m = /^data:([^;]+);base64,(.*)$/s.exec(part.dataUrl);
    if (!m) throw new Error("Bad image data");
    return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
  });
  const system = o.json ? `${o.system}\n\nReply with one JSON object only: no prose before or after it, no code fences.` : o.system;
  const t0 = Date.now();
  const res = await fetch(`${c.base}/v1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": c.key, "anthropic-version": "2023-06-01" },
    // No temperature: current Claude models set it themselves (sending it is an error).
    body: JSON.stringify({ model, system, max_tokens: o.maxTokens ?? 4000, output_config: { effort: o.effort ?? "low" }, messages: o.messages.map((m) => ({ role: m.role, content: content(m.content) })) }),
    signal: AbortSignal.timeout(o.timeoutMs ?? 45000),
  });
  const body = (await res.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; error?: { message?: string }; usage?: { input_tokens?: number; output_tokens?: number }; stop_reason?: string };
  if (process.env.AI_DEBUG) console.log("AI_DEBUG", o.feature, body.stop_reason, JSON.stringify(body.usage), JSON.stringify(body.content ?? body).slice(0, 1500));
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (!res.ok) {
    await audit("claude-ai", "ai error", o.feature, undefined, `${model} · ${res.status} · ${body.error?.message ?? ""}`.slice(0, 400)).catch(() => {});
    throw new Error(body.error?.message ?? `Claude returned an error (${res.status})`);
  }
  if (body.stop_reason === "max_tokens" && !(body.content ?? []).some((b) => b.type === "text" && b.text)) throw new Error("Claude ran out of room before answering. Try again, or make the request smaller.");
  await audit("claude-ai", "ai call", o.feature, undefined, `${model} · ${secs}s · ${body.usage?.input_tokens ?? "?"} in / ${body.usage?.output_tokens ?? "?"} out tokens`).catch(() => {});
  return { text: (body.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim(), model };
}

/** Pull the JSON object out of a reply (tolerates stray text or fences around it). */
export function jsonFrom<T = unknown>(text: string): T {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("Claude didn't send back JSON.");
  return JSON.parse(text.slice(a, b + 1)) as T;
}
