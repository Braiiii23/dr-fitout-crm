import { botAuth, json } from "@/lib/bot-api";
import { companyDuplicates } from "@/lib/bot-leads";

// GET /api/bot/leads/duplicates?company=...  Same company in the CRM in the last 12 months.
export async function GET(req: Request) {
  const denied = botAuth(req); if (denied) return denied;
  const company = (new URL(req.url).searchParams.get("company") ?? "").trim();
  if (!company) return json({ error: "Add ?company=" }, 400);
  const matches = await companyDuplicates(company);
  return json({ company, duplicate: matches.length > 0, matches });
}
