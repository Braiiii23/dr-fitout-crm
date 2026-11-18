import { prisma } from "@/lib/db";
import { botAuth, body, str, digits, json, leadBrand } from "@/lib/bot-api";
import { companyDuplicates, stamp } from "@/lib/bot-leads";
import { audit } from "@/lib/automations";
import { brisbaneToday } from "@/lib/time";

// GET /api/bot/leads?q=...  Find leads by name, company, email or phone (to add notes or files to them).
export async function GET(req: Request) {
  const denied = botAuth(req); if (denied) return denied;
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return json({ error: "Add ?q= with at least 2 characters (name, company, email or phone)." }, 400);
  const d = digits(q);
  const leads = await prisma.lead.findMany({
    where: { OR: [{ leadName: { contains: q } }, { company: { contains: q } }, { email: { contains: q.toLowerCase() } }, ...(d.length >= 6 ? [{ phone: { contains: d.slice(-8) } }] : [])] },
    select: { id: true, brand: true, stage: true, leadName: true, company: true, phone: true, email: true, dateReceived: true, nextFollowUp: true },
    orderBy: { updatedAt: "desc" }, take: 20,
  });
  return json({ leads: leads.map((l) => ({ leadId: l.id, brand: l.brand, stage: l.stage, name: l.leadName, company: l.company, phone: l.phone, email: l.email, received: l.dateReceived, nextFollowUp: l.nextFollowUp })) });
}

// POST /api/bot/leads  Add a lead to ENP, DR Fitout or Consulting. Checks for the same company in the last 12 months first.
export async function POST(req: Request) {
  const denied = botAuth(req); if (denied) return denied;
  const b = await body(req);
  if (!b) return json({ error: "Send JSON." }, 400);
  const brand = leadBrand(b.brand);
  if (!brand) return json({ error: "brand must be ENP, DR or CONSULTING." }, 400);
  const name = str(b.name, 150), company = str(b.company, 150), phone = str(b.phone, 40), email = str(b.email, 150)?.toLowerCase() ?? null;
  if (!name && !company) return json({ error: "Give a name or a company." }, 400);
  if (!phone && !email) return json({ error: "Give a phone number or an email." }, 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "That email doesn't look right." }, 400);

  // Same person (email or phone) in the last 12 months: return that lead, never a second one.
  const since = new Date(Date.now() - 365 * 86400000);
  const recent = await prisma.lead.findMany({ where: { createdAt: { gte: since } }, select: { id: true, phone: true, email: true, stage: true, leadName: true, company: true, brand: true } });
  const p = digits(phone).slice(-9);
  const same = recent.find((l) => (email && l.email?.toLowerCase() === email) || (p.length >= 8 && digits(l.phone).slice(-9) === p));
  if (same) return json({ created: false, duplicate: "person", leadId: same.id, brand: same.brand, stage: same.stage, name: same.leadName, company: same.company, message: "This email or phone is already in the CRM. No new lead was created; add a note to this one instead." }, 409);

  // Same company in the last 12 months: stop unless the bot says allowDuplicate: true.
  const dups = await companyDuplicates(company);
  if (dups.length && b.allowDuplicate !== true) return json({ created: false, duplicate: "company", matches: dups, message: "This company is already in the CRM from the last 12 months. Send allowDuplicate: true to add it anyway (it won't count as a new client)." }, 409);

  const size = Number(b.sizeSqm);
  const today = brisbaneToday();
  const lead = await prisma.lead.create({
    data: {
      brand, leadName: name, company, phone, email, stage: "New", leadSource: str(b.leadSource, 60) ?? "Kehoe Studio", dateReceived: today,
      newClient: dups.length === 0, location: str(b.location, 200), projectType: str(b.projectType, 150), sizeSqm: Number.isFinite(size) && size > 0 ? size : null,
      budget: str(b.budget, 80), timeframe: str(b.timeframe, 150), lookingFor: str(b.lookingFor, 4000), sourceLink: str(b.sourceLink, 500),
      notes: [`${stamp()} (lead bot): Added.${dups.length ? ` Same company already in the CRM: ${dups.map((d) => `${d.brand} ${d.name ?? ""} (${d.received ?? "?"})`).join("; ")}.` : ""}`, str(b.notes, 4000)].filter(Boolean).join("\n"),
    },
  });
  await audit("lead bot", "create", "Lead", lead.id, `${brand} ${name ?? ""} ${company ?? ""}`.trim());
  return json({ created: true, leadId: lead.id, brand, stage: lead.stage, newClient: lead.newClient, companyMatches: dups }, 201);
}
