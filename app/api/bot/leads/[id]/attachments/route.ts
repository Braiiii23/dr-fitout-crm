import { prisma } from "@/lib/db";
import { botAuth, json, str } from "@/lib/bot-api";
import { saveFile, safeName } from "@/lib/files";
import { audit } from "@/lib/automations";
import { brisbaneToday } from "@/lib/time";

// POST /api/bot/leads/{leadId}/attachments
//   JSON: { "url": "https://...", "filename": "Plans rev B.pdf", "kind": "plans" | "quote" | "other" }   (a link, e.g. Dropbox/OneDrive)
//   or multipart form-data with a "file" field (plus optional "kind")                                    (stored in the CRM, up to 25 MB)
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = botAuth(req); if (denied) return denied;
  const { id } = await ctx.params;
  const lead = await prisma.lead.findUnique({ where: { id }, select: { attachments: true } });
  if (!lead) return json({ error: "Lead not found." }, 404);
  const kindOf = (v: unknown) => (["plans", "quote"].includes(String(v)) ? String(v) : "other");
  let item: { url: string; filename: string; kind: string; added: string; stored?: boolean };
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.startsWith("multipart/form-data")) {
      const fd = await req.formData();
      const f = fd.get("file");
      if (!(f instanceof File)) return json({ error: "Add the file in a field called \"file\"." }, 400);
      const saved = await saveFile(f.name, Buffer.from(await f.arrayBuffer()));
      item = { url: saved.url, filename: safeName(f.name), kind: kindOf(fd.get("kind")), added: brisbaneToday(), stored: true };
    } else {
      const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      const url = str(b?.url, 1000);
      if (!url || !/^https:\/\/\S+$/i.test(url)) return json({ error: "Send { \"url\": \"https://...\", \"filename\": \"...\", \"kind\": \"plans\" } or upload a file." }, 400);
      item = { url, filename: safeName(str(b?.filename, 150) ?? url.split("/").pop() ?? "link"), kind: kindOf(b?.kind), added: brisbaneToday() };
    }
  } catch (e) { return json({ error: (e as Error).message }, 400); }
  let list: unknown[] = [];
  try { list = lead.attachments ? JSON.parse(lead.attachments) : []; } catch { list = []; }
  list.push(item);
  await prisma.lead.update({ where: { id }, data: { attachments: JSON.stringify(list) } });
  await audit("lead bot", "attach", "Lead", id, `${item.kind}: ${item.filename}`);
  return json({ added: true, leadId: id, attachment: item }, 201);
}
