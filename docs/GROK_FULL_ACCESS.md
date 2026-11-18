# Grok: full access to the DR Fitout CRM

Grok can read everything and create or change records like the admin, **except**: it can't delete anything, can't change the software,
can't touch logins, passwords or user accounts, and can't change the Xero / BuilderTrend connections. Everything is DR Fitout (brand is always DR).
Every change is recorded in the audit log as "grok".

## Two separate Grok connections
1. **Grok inside the app** (the Ask button, the Dashboard assistant and the AI concept fit): set `XAI_API_KEY` on the server.
   Optional: `AI_MODEL` (chat model, default `grok-4.3`) and `AI_VISION_MODEL` (model that reads floor plans; defaults to `AI_MODEL`; must accept images).
2. **Grok working on the CRM from outside** (e.g. a Grok agent / project): this API. Set `GROK_ADMIN_KEY` on the server (24+ random characters)
   and give Grok the base address and key below.

**Base address:** `https://<your-crm-address>/api/grok`
**Key:** header `Authorization: Bearer <GROK_ADMIN_KEY>`. Keep it in Grok's Secrets only.

## Start here
`GET /api/grok` lists every table Grok can use, its fields, and which ones it can change.

Tables: leads, clients, leases, concepts, directory, trade-quotes, scope-items, jobs, claims, cost-lines, bills, labour, materials, tasks,
calendar-events, todos, kpis, kpi-entries, reminders, accounts-settings; read only: concept-fits, claim-notices, emails, audit, snapshots.

## Reading
- `GET /api/grok/leads?q=Lee` — search
- `GET /api/grok/leads?where={"category":"Turnkey fitout","stage":"Quoting"}` — filter (Prisma filter as JSON, URL-encoded)
- `GET /api/grok/leases?where={"status":"Concept proposing"}`
- `GET /api/grok/actions/lease-dates?days=180` — upcoming option notices, rent reviews, expiries, starts
- `GET /api/grok/actions/wip` — every job's WIP; `GET /api/grok/actions/accounts` — cash, P&L, forecast

## Changing
- **Always test first:** add `?dryRun=1`, check `changes`, then send again without it.
- Create: `POST /api/grok/{table}`; change: `PATCH /api/grok/{table}/{id}` with only the fields to change.
- Notes: `"appendNotes": "text"` adds a dated "(Grok)" note (leads, jobs, clients, leases…).
- Lead categories: `Turnkey fitout` | `Joint venture` | `Normal fitout`.
- Lease stages (`status`): `Enquiring` → `Concept proposing` → `Sign`. Link a client with `clientId`.
- Concepts: `rooms` can be sent as a JSON array `[{"name":"Consult room","qty":6,"areaSqm":12}]`.
- AI concept fit: `POST /api/grok/actions/concept-fit {"leaseId":"…","conceptId":"…","brief":"optional"}` — needs a floor plan uploaded on the lease.
- Pull Xero now: `POST /api/grok/actions/refresh-xero`

## Rules for Grok
1. Look before you change: read the record first, then PATCH only what needs to change.
2. Dry run every change; check the `changes` it shows.
3. Don't invent values (amounts, dates, names). If something isn't known, leave it and report it.
4. Money is ex GST unless a field says Inc. Dates are YYYY-MM-DD (or full ISO for date-times).
5. Report back what you changed (the audit log also records it).
