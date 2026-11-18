import { botAuth, json } from "@/lib/bot-api";

// GET /api/bot   What the lead bot can do. Needs the key, so nothing is visible without it.
export async function GET(req: Request) {
  const denied = botAuth(req); if (denied) return denied;
  return json({
    ok: true, timezone: "Australia/Brisbane", auth: "Authorization: Bearer <LEADBOT_API_KEY>",
    endpoints: {
      "GET /api/bot/leads?q=": "Find leads by name, company, email or phone.",
      "GET /api/bot/leads/duplicates?company=": "Same company in the CRM in the last 12 months.",
      "POST /api/bot/leads": "Add a DR Fitout lead. JSON: name, company, phone, email, location, projectType, sizeSqm, budget, timeframe, lookingFor, notes, sourceLink, leadSource (default 'Kehoe Studio'), allowDuplicate. 409 if the person or company is already there.",
      "POST /api/bot/leads/{leadId}/notes": "Add a dated note to the end of a lead's notes. JSON: { text }.",
      "POST /api/bot/leads/{leadId}/attachments": "Attach a quote or plans: JSON { url, filename, kind: plans|quote|other } or multipart with a 'file' field (25 MB max).",
      "GET /api/bot/follow-ups?until=YYYY-MM-DD": "Stay in Touch leads and Next Follow-ups due (default: next 14 days), for Anita.",
    },
  });
}
