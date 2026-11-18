// The AI behind the in-app assistants and the concept fit: Claude (Anthropic API).
//   ANTHROPIC_API_KEY=sk-ant-...        required
//   AI_MODEL=claude-sonnet-5-5           optional (default below)
//   AI_VISION_MODEL=claude-opus-5-5      optional: model for reading floor plans (defaults to AI_MODEL)
// With no key set, the assistants still work using their built-in phrase matching.
export const DEFAULT_MODEL = "claude-sonnet-5-5";

export function aiConfig(): { key: string; model: string; visionModel: string; provider: "anthropic" } | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model = process.env.AI_MODEL || DEFAULT_MODEL;
  return { key, model, visionModel: process.env.AI_VISION_MODEL || model, provider: "anthropic" };
}

export type AiPart = { type: "text"; text: string } | { type: "image"; dataUrl: string };
export type AiMsg = { role: "user" | "assistant"; content: string | AiPart[] };

/** One call to Claude. Images are sent as base64 (PNG / JPEG / GIF / WebP). Returns the text reply. */
export async function aiChat(opts: { system: string; messages: AiMsg[]; maxTokens?: number; temperature?: number; timeoutMs?: number; vision?: boolean; json?: boolean }): Promise<{ text: string; model: string }> {
  const ai = aiConfig();
  if (!ai) throw new Error("The AI isn't set up. Add ANTHROPIC_API_KEY on the server.");
  const model = opts.vision ? ai.visionModel : ai.model;
  const content = (c: string | AiPart[]) => typeof c === "string" ? c : c.map((p) => {
    if (p.type === "text") return { type: "text", text: p.text };
    const m = /^data:([^;]+);base64,(.*)$/s.exec(p.dataUrl);
    if (!m) throw new Error("Bad image data");
    return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
  });
  const system = opts.json ? `${opts.system}\n\nReply with one JSON object only: no prose before or after it, no code fences.` : opts.system;
  const base = (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ai.key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, system, max_tokens: opts.maxTokens ?? 1024, temperature: opts.temperature ?? 0.2, messages: opts.messages.map((m) => ({ role: m.role, content: content(m.content) })) }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 45000),
  });
  const body = (await res.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; error?: { message?: string } };
  if (!res.ok) throw new Error(body.error?.message ?? `Claude returned an error (${res.status})`);
  const text = (body.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
  return { text, model };
}

/** Pull the JSON object out of a reply (tolerates stray text or fences around it). */
export function jsonFrom<T = unknown>(text: string): T {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("The AI didn't send back JSON.");
  return JSON.parse(text.slice(a, b + 1)) as T;
}
