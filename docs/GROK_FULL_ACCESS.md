# Grok: full access to the CRM

Grok works as Braiden would, **except**: it can't delete anything, can't touch logins, passwords or user accounts, and can't change the Xero / BuilderTrend connections. Every change is recorded in the audit log as "grok".

**Base address:** `https://crm-production-b8fa.up.railway.app/api/grok`
**Key:** header `Authorization: Bearer <GROK_ADMIN_KEY>` (copy from Railway → crm → Variables → GROK_ADMIN_KEY). Keep it in Grok's Secrets only.

## Start here
`GET /api/grok` lists every table Grok can use, its fields, and which ones it can change.

## Reading
- `GET /api/grok/leads?q=Empire` — search (names, companies, emails, phones, invoice and job numbers)
- `GET /api/grok/leads?where={"stage":"Quoting","brand":"ENP"}&orderBy={"updatedAt":"desc"}&limit=50` — filter (Prisma filter as JSON, URL-encoded)
- `GET /api/grok/jobs/{id}` — one record
- `GET /api/grok/actions/wip` — every job's WIP: claims and when to invoice them, costs, actual P&L, flags
- `GET /api/grok/actions/accounts` — cash, P&L, live profit, work on the books, signed jobs, 13-week forecast

Tables: leads, calls, setters, slots, trade-quotes, scope-items, jobs, claims, cost-lines, bills, labour, materials, tasks, reminders, accounts-settings; read only: claim-notices, emails, audit, snapshots.

## Changing
- **Always test first:** add `?dryRun=1` to see exactly what would change, then send again without it.
- Create: `POST /api/grok/{table}` with a JSON object of fields, e.g. `POST /api/grok/leads {"brand":"ENP","leadName":"Jane Smith","company":"Acme Cafe","stage":"New","phone":"0400 000 000"}`
- Change: `PATCH /api/grok/{table}/{id}` with only the fields to change, e.g. `{"stage":"Signed","contractValue":95000}`
- Notes: send `"appendNotes": "text"` to add a dated "(Grok)" note to the end. Never send the whole notes field unless you mean to replace it.
- Book a slot: `POST /api/grok/actions/book-slot {"callId":"...","slotId":"..."}` (refuses if someone else booked it). Free it: `POST /api/grok/actions/release-slot {"callId":"..."}`
- Pull Xero now: `POST /api/grok/actions/refresh-xero`

The app's own automations run after each change, the same as in the browser: e.g. setting a lead's stage to Signed stamps the signed date, fills the job's GP from Justin's estimate and creates the job with its claim schedule.

## Rules for Grok
1. Look before you change: read the record first, then PATCH only what needs to change.
2. Dry run every change; check the `changes` it shows.
3. Don't invent values (amounts, dates, names). If something isn't known, leave it and report it.
4. Money is ex GST unless a field says Inc. Dates are YYYY-MM-DD (or full ISO for date-times).
5. Report back what you changed (the audit log also records it).
