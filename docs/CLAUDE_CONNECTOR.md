# Claude and the DR Fitout CRM

Claude is connected two ways.

## 1. Claude inside the app
The Ask button, the Dashboard assistant, the **AI concept fit** (lease page → Concept design) and **Import a concept package** (Concepts page)
all use Claude through the Anthropic API.
- `ANTHROPIC_API_KEY` (from console.anthropic.com → API keys) — required.
- `AI_MODEL` — optional, default `claude-sonnet-5-5`. `AI_VISION_MODEL` — optional model for reading floor plans and packages (e.g. `claude-opus-5-5` for the best plan reading; defaults to `AI_MODEL`).

## 2. The Claude connector (Claude working on the CRM)
A remote MCP server at `https://<your-crm-address>/api/mcp`. Add it once and Claude (claude.ai, the Claude apps, Claude Code) can work in the CRM.

**Set up**
1. On the server (Railway → Variables) set `CLAUDE_CONNECTOR_KEY` to a long random value (24+ characters). Keep it secret.
2. In Claude: Customize → Connectors → Add custom connector (Team / Enterprise: an owner adds it under Organization settings → Connectors).
   - URL: `https://<your-crm-address>/api/mcp`
   - Authentication: no OAuth. Under **Request headers** add `Authorization` = `Bearer <CLAUDE_CONNECTOR_KEY>`.
3. Claude Code: `claude mcp add --transport http dr-fitout-crm https://<your-crm-address>/api/mcp --header "Authorization: Bearer <CLAUDE_CONNECTOR_KEY>"`

The key is shared: anyone using the connector acts with the same access. Change the key on the server to cut everyone off.

**What Claude can do**
Read everything, and create or change records like the admin — with dry runs first. Every change is in the audit log as "claude".
It **can't** delete anything, change the software, touch logins / passwords / users, or change the Xero / BuilderTrend connections. Everything is DR Fitout (brand is always DR).

**Tools**
- `crm_overview` — rules, every table, its fields and what can change. Start here.
- `crm_list` / `crm_get` — search and read (leads, clients, leases, concepts, concept-fits, notices, directory, jobs, claims, costs, bills, labour, materials, tasks, calendar events, to-dos, KPIs, reminders, audit…).
- `crm_create` / `crm_update` — dry run by default; send `dryRun: false` to save. `data.appendNotes` adds a dated "(Claude)" note.
- `crm_lease_dates` — upcoming option notices, rent reviews, expiries, starts.
- `crm_wip`, `crm_accounts` — WIP for every job; cash, P&L and forecast.
- `crm_concept_fit` — recreate a concept on a lease's tenancy floor plan.
- `crm_refresh_xero` — pull the latest from Xero.
- Notice board: `crm_create` on `notices` (`body`, `category`: Update | Progress | Win | Heads up | Site, optional `link` like `/leases/{id}`) posts as "Claude".

**Values**: lead `category` Turnkey fitout | Joint venture | Normal fitout. Lease `status` Enquiring | Concept proposing | Sign. Money ex GST unless a field says Inc. Dates YYYY-MM-DD.
