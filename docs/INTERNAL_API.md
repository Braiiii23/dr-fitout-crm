# ENP CRM internal API (teammate bots)

Live CRM replaces the Airtable base `appcbbnP68yOLodPq` for routines (per Braiden Millard). Airtable record ids live in `externalId`.

- **Base URL:** `APP_URL` (default `https://crm-production-b8fa.up.railway.app`)
- **Auth (every route):** env **`CRM_HOOK_SECRET`** — send either
  - `Authorization: Bearer $CRM_HOOK_SECRET`, or
  - `x-crm-hook-secret: $CRM_HOOK_SECRET`

  Missing/wrong → `401 {"ok":false,"error":"Unauthorised"}`. If `CRM_HOOK_SECRET` is unset on the server every call is 401. Never paste the real value into docs, logs, or chat.
- Middleware lets `/api/internal/*` through without a session; auth is enforced in each route via `lib/internal-api.ts` (`assertInternalAuth`).
- Spelling: **DR Fitout** (singular). Stored brand keys: `ENP | DR | CONSULTING`; responses add `brandLabel` (`ENP Fitouts`, `DR Fitout`, `Consulting`).
- Responses are `{ ok: true, ... }`. Batch POSTs return `{ ok, created, updated, failed, results: [{ index, action: created|updated|error, ... }] }`; HTTP 400 only when every item failed.
- Dates without time (signedDate, nextFollowUp, …) are `YYYY-MM-DD` strings (Australia/Brisbane). DateTimes (appointment, slot start/end) are ISO.

```bash
export CRM=https://crm-production-b8fa.up.railway.app   # or http://localhost:3100
export AUTH="Authorization: Bearer $CRM_HOOK_SECRET"
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/internal/leads?brand=ENP\|DR\|CONSULTING\|ALL&stage=Quoting&signed=1&limit=1000` | List leads |
| POST | `/api/internal/leads` | Upsert leads |
| GET | `/api/internal/calls?business=ENP\|DR&status=Appointment%20Set&limit=200` | List call-list items (max 200) |
| POST | `/api/internal/calls` | Upsert setter bookings / call rows |
| GET | `/api/internal/slots?scope=upcoming\|all&status=Free` | Braiden's free slots (default upcoming = end ≥ now) |
| POST | `/api/internal/slots` | Upsert slots, optional `replaceAll` |
| GET | `/api/internal/setters?status=Active` | Setters |
| GET | `/api/internal/signed` | Signed jobs, all brands (Count Dollarcula) |
| GET/POST | `/api/internal/reminders` | Anita reminder queue (see `ANITA_REMINDER_HOOK.md`) |

### Leads — GET
`signed=1` = stage matches `/signed/i` **or** `signedDate` set; excludes `cancelled` and any lead whose company/leadName contains EXAMPLE or TRIAL (case-insensitive). `stage` is a case-insensitive exact match.

Each lead: `id, externalId, brand, brandLabel, leadName, company, stage, contractValue, signedDate, quoteValue, quoteIssued, notes, attachments ([{url, filename}]), leadSource, nextFollowUp, jobNumber, setterId, setterName, phone, email, cancelled, createdAt, updatedAt, crmUrl` (`$APP_URL/leads/<enp|dr|consulting>/<id>`).

```bash
curl -s -H "$AUTH" "$CRM/api/internal/leads?brand=DR&signed=1"
```

### Leads — POST (upsert)
Body: `{ "leads": [ ... ] }`, a bare array, or one lead object. Matching: `externalId` (upsert) → else `id` (update existing) → else create. `brand` required on create. Omitted keys are left unchanged; `null` clears.

```bash
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' "$CRM/api/internal/leads" \
  -d '{"leads":[{"externalId":"recXXXX","brand":"DR Fitouts","leadName":"Jane Doe","company":"Acme","stage":"Signed","contractValue":125000,"signedDate":"2026-11-05"}]}'
```

Field map (API key ← also accepted Airtable column name):

| Prisma `Lead` | Accepted keys | Notes |
|---|---|---|
| externalId | externalId, airtableId, Airtable ID, recordId | upsert key |
| brand | brand, Brand, business, table | `ENP`/`ENP Fitouts` → ENP; `DR`/`DR Fitout`/`DR Fitouts` → DR; `Consulting…` → CONSULTING |
| leadName | leadName, Lead Name, name, Name | |
| company, role, phone, email, stage, location, budget, timeframe, notes | same name or Title Case | |
| leadSource | leadSource, Lead Source | |
| dateReceived | dateReceived, Date Received | YYYY-MM-DD |
| projectType | projectType, Project Type | |
| sizeSqm | sizeSqm, Size (sqm), Size sqm, Size | number |
| attachments | attachments, Attachments | URL string, comma/newline URLs, JSON string, or Airtable `[{url, filename}]` |
| appointmentSetter | appointmentSetter, Appointment Setter | also auto-links `setterId` on exact name match |
| setterId | setterId | Setter id or Setter externalId |
| contractValue, quoteValue, grossProfit | camelCase or Title Case | `"$12,500"` accepted |
| signedDate, quotedDate, quoteIssuedDate, nextFollowUp | camelCase or Title Case (`Next Follow Up`) | YYYY-MM-DD |
| quoteIssued, newClient, cancelled | camelCase or Title Case | true/false/yes/no/1/0 |
| jobNumber | jobNumber, Job Number, Job # | |
| marketingChannel | marketingChannel, Marketing Channel | |
| appointment | appointment, Appointment | ISO DateTime |

### Calls — POST (upsert by externalId)
```bash
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' "$CRM/api/internal/calls" \
  -d '{"calls":[{"externalId":"recCALL1","leadName":"Jane Doe","company":"Acme","business":"DR","contactType":"CLIENT","callStatus":"Appointment Set","appointment":"2026-11-10T09:00:00+10:00","slotId":"recSLOT1","setterId":"<setter id>"}]}'
```
Fields: `externalId, leadName, company, phone, email, business (ENP|DR — "DR Fitout" ok), contactType (DESIGNER|LEASING_AGENT|LANDLORD|CLIENT, "leasing agent" ok), leadInfo, assignedSetter, setterId, callStatus, attempts, appointment (ISO), lastCalled (YYYY-MM-DD), callNotes, addedToCrm, leadId, slotId, possibleDuplicate, duplicateNote`. `leadId`/`slotId`/`setterId` accept the CRM id **or** the Airtable externalId; unknown ids fail that item. `assignedSetter` auto-links `setterId` on exact name match. Each call returns `crmUrl` = `$APP_URL/calls/<id>` and `businessLabel`.

Note: API upserts do **not** run in-app call automations (e.g. "Braiden to Connect" → Anita reminder); those fire only from the UI paths.

### Slots — POST
```bash
curl -s -X POST -H "$AUTH" -H 'content-type: application/json' "$CRM/api/internal/slots" \
  -d '{"replaceAll":true,"slots":[{"externalId":"cal-evt-123","label":"Tue 10 Nov 9:00am","start":"2026-11-10T09:00:00+10:00","end":"2026-11-10T09:30:00+10:00","status":"Free"}]}'
```
`status`: Free | Booked. `start`+`end` required on create; `label` defaults to the ISO range.
**replaceAll** (only when `true`): deletes every slot whose externalId isn't in the payload (including slots with no externalId). Safety: refused for an empty array; skipped (nothing deleted) if any item failed or lacks an externalId. Calls booked into a deleted slot keep their `appointment` but get `slotId = null`.

### Signed — GET (Count Dollarcula)
`{ ok, appUrl, count, totals: { "ENP Fitouts": {count, contractValue}, "DR Fitout": {...}, "Consulting": {...} }, signed: [lead…] }` — same lead shape and signed rule as `leads?signed=1`, ENP + DR + CONSULTING.

## Which bot uses what

| Bot | Was (Airtable) | Now |
|---|---|---|
| **Leadardo** (lead intake) | create/update rows in ENP Leads / DR Fitout Leads / Consulting Leads | `POST /api/internal/leads` with `externalId` = Airtable rec id (or own stable id); check dupes via `GET /api/internal/leads?brand=…` |
| **Count Dollarcula** (finance) | read signed jobs, contract value, notes, attachments | `GET /api/internal/signed` (or `leads?signed=1&brand=…`); key fields `contractValue, signedDate, jobNumber, notes, attachments, brandLabel, crmUrl` |
| **Anita Reminder** | Todoist from reminder queue | `GET/POST /api/internal/reminders`; follow-up dates from `leads` `nextFollowUp`; call bookings via `GET /api/internal/calls?status=Appointment%20Set` |
| **Braiden free-slots routine** | refresh Free Slots table | `POST /api/internal/slots` with `replaceAll: true` and calendar event ids as `externalId` |
| **Setter booking routines** | Call List rows | `POST /api/internal/calls`, `GET /api/internal/setters` for setter ids |

## Tasks import (Todoist migration)
`POST /api/internal/tasks` `{ tasks: [...], dryRun?, user? }`: upsert on externalId per person (default Braiden). Fields: title, description, dueDate, time, deadline, repeat, priority (P1–P4), project, section, labels[], parentExternalId, status (open|completed), completedAt, source. Returns created / updated / unchanged + per-row errors.
`GET /api/internal/tasks?prefix=todoist:&user=email` lists them.

## Tasks (day to day, for an assistant)
`GET /api/internal/todos?user=email` open tasks + finished today; `GET /api/internal/todos?finished=YYYY-MM-DD` everyone's completions that day (team email).
`POST /api/internal/todos` `{ user, id? | externalId?, title, due, time, deadline, recurrence, priority, labels, completed?, delete? }`: create or update the same task; `completed: true` ticks it off.
