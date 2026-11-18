import { grokAuth, json, RESOURCES, writableFields, scalarFields } from "@/lib/grok-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/grok — what Grok can read and change, with each table's fields. */
export async function GET(req: Request) {
  const denied = grokAuth(req); if (denied) return denied;
  const resources = Object.fromEntries(Object.entries(RESOURCES).map(([name, r]) => [name, {
    about: r.about, canChange: r.write,
    fields: scalarFields(r.model).map((f) => `${f.name}: ${f.type}${f.isRequired ? "" : " (optional)"}`),
    ...(r.write ? { writable: writableFields(r.model).map((f) => f.name) } : {}),
  }]));
  return json({
    ok: true, actingAs: "Braiden (admin), recorded as \"grok\"", timezone: "Australia/Brisbane",
    rules: ["No deleting anything.", "No logins, passwords or user accounts.", "No Xero / BuilderTrend connection settings.", "Add ?dryRun=1 to any change to see what would happen without saving.", "Use appendNotes to add to notes; it never replaces what's there."],
    endpoints: {
      "GET /api/grok/{resource}?q=&where={json}&orderBy={json}&limit=&offset=": "List records (q = text search on names; where = Prisma filter).",
      "GET /api/grok/{resource}/{id}": "One record.",
      "POST /api/grok/{resource}": "Create a record (JSON body of fields).",
      "PATCH /api/grok/{resource}/{id}": "Change fields (JSON body). Include appendNotes to add a dated note.",
      "POST /api/grok/actions/book-slot": "{ callId, slotId } books a free slot (double-booking safe).",
      "POST /api/grok/actions/release-slot": "{ callId } frees a call's booked slot.",
      "GET /api/grok/actions/accounts": "Accounts summary (cash, P&L, work on the books, signed jobs, forecast).",
      "GET /api/grok/actions/wip": "WIP for every live job (claims, costs, actual P&L, flags, next claim).",
      "POST /api/grok/actions/refresh-xero": "Pull the latest from Xero now (also fills blank job details).",
    },
    resources,
  });
}
