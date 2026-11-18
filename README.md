# DR Fitout CRM

## What this is
Private Next.js 15 back-of-house CRM for **DR Fitout** (singular, never "DR Fitouts"): medical and allied-health fitouts, Brisbane.
Built from the ENP/DR Leads CRM v60, locked to DR Fitout only (DR lavender/purple theme everywhere, no brand switch).

## Tabs (menu order)
My Day · Calendar · Dashboard · Leads · Jobs · WIP · Estimating · Accounts · Leases · Concepts · Clients · Directory · KPI's · Users
- Leads live at `/leads/dr` (`/leads`, `/leads/enp`, `/leads/consulting` redirect there). `/team` redirects to `/directory`.
- **Leads** have a category: Turnkey fitout | Joint venture | Normal fitout (filter tabs on the Leads page).
- **Leases** (`/leases`): stages Enquiring → Concept proposing → Sign (board view + list). Premises, landlord/agent, term, options,
  option-notice / review / expiry dates, rent, outgoings, incentive, files (floor plan, lease, other). Clients link from the board, list,
  lease page ("…or add a new client" creates one) and the client page. Key dates show on Leases, Dashboard, team Calendar and the assistant.
  Old stage names from v1 are moved onto the new stages on start (`scripts/migrate-lease-stages.ts`).
- **Concepts** (`/concepts`): our concept library: room schedule (one per line, e.g. `6 x Consult room 12 sqm`), design intent, finishes, images/plans.
- **Concept packages**: "Import a concept package" (Concepts page) — Claude reads an A3 package PDF (narrative, key design moves, room schedule,
  finishes, compliance) into a concept and keeps the cover, the concept floor plan page (kind "plan"), a render and the PDF. `lib/concept-import.ts`.
  The GP and Allied Health packages ship in `seed/concepts/` and load on first start (`scripts/seed-concepts.ts`).
- **AI concept fit** (lease page → Concept design): pick a concept; Claude reads the tenancy floor plan (PDF page 1 via `pdftoppm`, or PNG/JPG)
  plus the concept's own floor plan, and RECREATES the concept for the tenancy (keeps zoning, design moves, adjacencies, corridor widths and room sizes
  where it can): block plan, room schedule, verdict (Fits / Tight / Doesn't fit), changes, checks, assumptions. `lib/concept-fit.ts`; saved as `ConceptFit`.
  A starting point for the designer, not a buildable drawing.
- **My Day notice board**: posts and replies for everyone (admin pins); the CRM auto-posts signed leads, leads to Quoting, lease stage moves, concept fits and imports. `Notice`, `NoticeReply`, `lib/notices.ts`.
- **Claude**: `ANTHROPIC_API_KEY` powers the in-app AI (`lib/ai.ts`); `CLAUDE_CONNECTOR_KEY` turns on the Claude connector, a remote MCP server at `/api/mcp`
  (`app/api/mcp/route.ts`, `lib/agent-api.ts`). See `docs/CLAUDE_CONNECTOR.md`. (Grok was replaced by Claude.)
- **Clients** (`/clients`): practices. Leads, jobs and leases link to a client. "Create from N leads" makes clients from DR lead companies.
- Removed from v60: setters, call lists, free slots, statements, team tasks, setter portal, consulting, ENP pipeline, setter pay.

## Stack
Next.js 15 (App Router) + TypeScript + Tailwind, Prisma + SQLite. Port 3100.
New Prisma models: `Client`, `Lease`, `Concept`, `ConceptFit`, `Notice`, `NoticeReply` (+ `clientId` and `category` on `Lead`, `clientId` on `Job`). Uploaded files live in `$DATA_DIR/files`. `prisma db push` on start adds them.
The `brand` column stays on leads/jobs (always "DR"); `lib/brand.ts` always returns DR. Setter/CallListItem tables are kept for the Directory.

## Roles (lib/access.ts)
ADMIN/CEO everything. BDM: dashboard, leads, leases, clients, directory (+ estimating view). PM: jobs, WIP, leases, clients, directory (+ view rest).
ACCOUNTS: accounts, jobs, WIP, leases, clients. Concepts: ADMIN/CEO, BDM, PM, ESTIMATOR edit; others view (not the shared team login). ESTIMATOR: estimating (+ view rest). FOREMAN: directory (+ view rest). TEAM: directory + view-only.

## Setup
1. `.env.example` → `.env` (never commit `.env`). Optional `MONTHLY_TARGET` (dashboard signed-work target, default 1000000).
   For AI: `ANTHROPIC_API_KEY` (optionally `AI_MODEL`, `AI_VISION_MODEL`). For the Claude connector: `CLAUDE_CONNECTOR_KEY`.
   PDF floor plans need `pdftoppm` (poppler-utils; already in the Dockerfile).
2. `npm install && npx prisma generate && npx prisma db push`
3. `npx next dev -p 3100` → http://localhost:3100/login
Hosting: `Dockerfile` + `scripts/start.sh` (DB on a volume at `$DATA_DIR/crm.db`; first start copies `seed/initial.db`, which now holds DR data only).

## Do not
- Publish publicly, buy domains, or connect client systems without the admin's explicit OK
- Put passwords/keys in chat or commit `.env`
