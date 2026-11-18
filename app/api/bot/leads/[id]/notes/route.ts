import { prisma } from "@/lib/db";
import { botAuth, body, str, json } from "@/lib/bot-api";
import { stamp } from "@/lib/bot-leads";
import { audit } from "@/lib/automations";

// POST /api/bot/leads/{leadId}/notes  { "text": "..." }  Adds a dated note to the end. Never changes what's already there.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = botAuth(req); if (denied) return denied;
  const { id } = await ctx.params;
  const b = await body(req);
  const text = str(b?.text, 4000);
  if (!text) return json({ error: "Send { \"text\": \"...\" }." }, 400);
  const lead = await prisma.lead.findUnique({ where: { id }, select: { notes: true } });
  if (!lead) return json({ error: "Lead not found." }, 404);
  const notes = [lead.notes?.trimEnd(), `${stamp()} (lead bot): ${text}`].filter(Boolean).join("\n\n");
  await prisma.lead.update({ where: { id }, data: { notes } });
  await audit("lead bot", "add note", "Lead", id, text.slice(0, 80));
  return json({ added: true, leadId: id }, 201);
}
