"use server";
import { getUser } from "@/lib/auth";
import { aiConfig } from "@/lib/ai";
import { assistantContext } from "@/lib/assistant-context";

type Msg = { role: "user" | "assistant"; content: string };

const SYSTEM = `You are the built-in assistant for ENP Fitouts and DR Fitout's CRM (Brisbane commercial fitout businesses).
Answer using only the DATA below, which is everything this person is allowed to see. If the data doesn't hold the answer, say so plainly and say where in the app to look.
Be brief and practical: short sentences, plain Australian English, dollar figures rounded. Explain how a number is worked out when asked.
You can't change anything in the app. If asked to update a lead or call, point to the assistant box on the Dashboard (Braiden) or My Calls (setters), or the right page.
Never invent figures, clients or dates.`;

export async function askAssistant(history: Msg[], path: string): Promise<{ answer?: string; error?: string }> {
  const u = await getUser();
  if (!u) return { error: "Please sign in again." };
  const ai = aiConfig();
  if (!ai) return { error: "The assistant needs an AI key on the server (Grok or OpenAI). Ask the admin to add XAI_API_KEY in Railway." };
  const msgs = history.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-8)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") return { error: "Type a question first." };
  const safePath = /^\/[A-Za-z0-9/_-]*$/.test(path) ? path.slice(0, 100) : "/";
  let data: string;
  try { data = await assistantContext(u, safePath); } catch (e) { data = `Data couldn't be loaded: ${(e as Error).message}`; }
  try {
    const res = await fetch(ai.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${ai.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: ai.model, temperature: 0.2, max_tokens: 700, messages: [{ role: "system", content: `${SYSTEM}\n\nDATA:\n${data}` }, ...msgs] }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) return { error: `The AI service returned an error (${res.status}). Try again in a minute.` };
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const answer = j.choices?.[0]?.message?.content?.trim();
    return answer ? { answer } : { error: "No answer came back. Try rephrasing." };
  } catch {
    return { error: "The AI service didn't respond in time. Try again." };
  }
}
