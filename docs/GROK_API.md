# Grok: user-like access to the DR Fitout CRM

Grok works on the CRM from outside, like a team member at a keyboard: it reads, and it **adds and updates data for you**
(new leads, clients, leases, directory contacts, notes, notice board posts, job costs…). Claude is the brain *inside* the app;
Grok doesn't run any of the in-app AI.

Grok **can't**: delete anything, change the software, touch logins / passwords / users, or change the Xero / BuilderTrend connections.
Everything is DR Fitout (brand is always DR). Every change is in the audit log as "grok", and notes it adds are stamped "(Grok)".

## Set up
1. Railway → Variables: set `GROK_ADMIN_KEY` to a long random value (24+ characters).
2. Give Grok the base address `https://<your-crm-address>/api/grok` and the header `Authorization: Bearer <GROK_ADMIN_KEY>` (keep the key in Grok's secrets).
3. Tell Grok to start with `GET /api/grok`: it returns the rules, every table, its fields and what it can change.

## Reading
- `GET /api/grok/leads?q=Lee` — search · `GET /api/grok/leads?where={"category":"Turnkey fitout"}` — filter (Prisma filter as JSON, URL-encoded)
- `GET /api/grok/{table}/{id}` — one record
- `GET /api/grok/actions/lease-dates?days=180` · `/actions/wip` · `/actions/accounts`

Tables: leads, clients, leases, concepts, concept-fits (read only), notices, notice-replies, directory, trade-quotes, scope-items, jobs, claims,
cost-lines, bills, labour, materials, tasks, calendar-events, todos, kpis, kpi-entries, reminders, accounts-settings; read only: claim-notices, emails, audit, snapshots.

## Adding and changing
- **Test first:** add `?dryRun=1`, check what it would do, then send again without it.
- Add: `POST /api/grok/{table}` with a JSON object, e.g. `POST /api/grok/leads {"leadName":"Dr Jane Lee","company":"Lee Dental","category":"Joint venture","stage":"New","phone":"0400 000 000"}`
- Change: `PATCH /api/grok/{table}/{id}` with only the fields to change. `"appendNotes": "text"` adds a dated "(Grok)" note without replacing notes.
- Notice board: `POST /api/grok/notices {"body":"…","category":"Update"}` (Update | Progress | Win | Heads up | Site; optional `link` like `/leases/{id}`).
- AI concept fit (runs Claude inside the app): `POST /api/grok/actions/concept-fit {"leaseId":"…","conceptId":"…"}`. Pull Xero: `POST /api/grok/actions/refresh-xero`.

Values: lead `category` Turnkey fitout | Joint venture | Normal fitout. Lease `status` Enquiring | Concept proposing | Sign. Money ex GST unless a field says Inc. Dates YYYY-MM-DD.

## Rules for Grok
1. Look before you change: read the record first, then change only what needs to change.
2. Dry run every change and check it.
3. Don't invent values (amounts, dates, names). If something isn't known, leave it blank and say so.
4. Search before adding (q=) so you don't create duplicates.
5. Report back what you added or changed.
