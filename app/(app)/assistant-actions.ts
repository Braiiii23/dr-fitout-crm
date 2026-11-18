"use server";
import { getUser } from "@/lib/auth";
import { aiChat, aiConfig } from "@/lib/ai";
import { assistantContext } from "@/lib/assistant-context";

type Msg = { role: "user" | "assistant"; content: string };

const SYSTEM = `You are the built-in assistant for DR Fitout's CRM (DR Fitout builds medical and allied-health fitouts in Brisbane; always spelt "DR Fitout", singular).
Answer using only the DATA below, which is everything this person is allowed to see. If the data doesn't hold the answer, say so plainly and say where in the app to look.
Be brief and practical: short sentences, plain Australian English, dollar figures rounded. Explain how a number is worked out when asked.
You can't change anything in the app. If asked to update something, point to the assistant box on the Dashboard or the right page (Leads, Jobs, WIP, Leases, Clients…).
Never invent figures, clients or dates.`;

export async function askAssistant(history: Msg[], path: string): Promise<{ answer?: string; error?: string }> {
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
  try {
    const { text } = await aiChat({ system: `${SYSTEM}\n\nDATA:\n${data}`, messages: msgs, maxTokens: 900 });
    return text ? { answer: text } : { error: "No answer came back. Try rephrasing." };
  } catch (e) {
    return { error: `The AI didn't answer: ${(e as Error).message}. Try again in a minute.` };
  }
}
