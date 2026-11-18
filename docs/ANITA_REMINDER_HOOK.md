# Anita Reminder ↔ ENP CRM hooks

**Anita Reminder bot id:** `ca598b14-f4e4-4ff5-a2e4-81606f7c2dca`  
**Spelling:** DR Fitout (singular).

Braiden’s dashboard and admin assistant queue chase-up / quote-due reminders. Parent wires Anita to create Todoist tasks from the queue (this executor cannot `SendToAgent`).

## Where reminders live

1. **SQLite** `ReminderRequest` rows with `status = "pending"` (or `"todoist"` if `TODOIST_API_TOKEN` created them).
2. **JSONL append log:** `data/anita-reminder-queue.jsonl` (one JSON object per line).

Each row includes enough detail for Anita: `title`, `description` / `anitaDraft`, `dueString`, `leadId`, `callId`, `company`, `brand`, phone/email inside description for **Braiden to Connect**.

## Suggested Anita workflow

1. Read pending rows: `prisma.reminderRequest.findMany({ where: { status: "pending" } })` or tail the JSONL.
2. For each item, Todoist MCP `add-tasks` with:
   - `content` = `title`
   - `description` = `anitaDraft` / `description`
   - `dueString` = `dueString` (Australia/Brisbane)
   - labels e.g. `anita-reminder`, `enp-crm`, and for connect handoffs `braiden-to-connect`
3. Mark row `status = "todoist"` and set `todoistTaskId`.

## In-app triggers

- Dashboard **Remind me** on Quoting / due cards → `remindAboutLead`
- Admin chat: “remind me to chase Acme”, “chase up Jane tomorrow” → `adminAssistantChat` → `createReminder`
- **Call status → “Braiden to Connect”** (any path: quickStatus, full call edit, Jessie assistant, Braiden assistant) → `runCallAutomations` → `enqueueBraidenToConnect`  
  Payload includes lead name, company, phone, email, call id, lead id, brand (ENP / DR Fitout), setter, why-call / notes. Deduped while an open reminder exists for that `callId`.
- Optional env: `TODOIST_API_TOKEN` — app creates the Todoist task itself via REST (`status = "todoist"`).

## Do not

- Do not change Jessie’s setter assistant behaviour beyond status colour / net celebration.
- Do not invent financial edits from reminders.
