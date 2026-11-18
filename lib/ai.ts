// Which AI the in-app assistants use. Any OpenAI-compatible provider works.
//   Grok (xAI):  XAI_API_KEY=xai-...      (optional AI_MODEL, default below)
//   OpenAI:      OPENAI_API_KEY=sk-...    (optional OPENAI_MODEL / AI_MODEL)
//   Other:       AI_API_KEY + AI_BASE_URL + AI_MODEL
// With no key set, the assistants still work using their built-in phrase matching.
export function aiConfig(): { url: string; key: string; model: string; provider: string } | null {
  const xai = process.env.XAI_API_KEY;
  const key = process.env.AI_API_KEY || xai || process.env.OPENAI_API_KEY;
  if (!key) return null;
  const isXai = !process.env.AI_API_KEY && !!xai;
  const base = (process.env.AI_BASE_URL || (isXai ? "https://api.x.ai/v1" : "https://api.openai.com/v1")).replace(/\/+$/, "");
  const model = process.env.AI_MODEL || (isXai ? "grok-4.3" : process.env.OPENAI_MODEL || "gpt-4o-mini");
  return { url: `${base}/chat/completions`, key, model, provider: isXai ? "xai" : "openai-compatible" };
}
