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
- **AI concept fit** (lease page → Concept design): pick a concept; Grok reads the tenancy floor plan (PDF page 1 via `pdftoppm`, or PNG/JPG)
  and returns a test-fit layout drawn as a block plan, a room schedule, verdict (Fits / Tight / Doesn't fit), changes, checks and assumptions.
  `lib/concept-fit.ts`. Saved as `ConceptFit`; star one as the proposal. It's a starting point for the designer, not a buildable drawing.
- **Grok**: `XAI_API_KEY` powers the in-app assistants and concept fit; `GROK_ADMIN_KEY` turns on the outside API. See `docs/GROK_FULL_ACCESS.md`.
- **Clients** (`/clients`): practices. Leads, jobs and leases link to a client. "Create from N leads" makes clients from DR lead companies.
- Removed from v60: setters, call lists, free slots, statements, team tasks, setter portal, consulting, ENP pipeline, setter pay.

## Stack
Next.js 15 (App Router) + TypeScript + Tailwind, Prisma + SQLite. Port 3100.
New Prisma models: `Client`, `Lease`, `Concept`, `ConceptFit` (+ `clientId` and `category` on `Lead`, `clientId` on `Job`). Uploaded files live in `$DATA_DIR/files`. `prisma db push` on start adds them.
The `brand` column stays on leads/jobs (always "DR"); `lib/brand.ts` always returns DR. Setter/CallListItem tables are kept for the Directory.

## Roles (lib/access.ts)
ADMIN/CEO everything. BDM: dashboard, leads, leases, clients, directory (+ estimating view). PM: jobs, WIP, leases, clients, directory (+ view rest).
ACCOUNTS: accounts, jobs, WIP, leases, clients. Concepts: ADMIN/CEO, BDM, PM, ESTIMATOR edit; others view (not the shared team login). ESTIMATOR: estimating (+ view rest). FOREMAN: directory (+ view rest). TEAM: directory + view-only.

## Setup
1. `.env.example` → `.env` (never commit `.env`). Optional `MONTHLY_TARGET` (dashboard signed-work target, default 1000000).
   For AI: `XAI_API_KEY` (and optionally `AI_MODEL`, `AI_VISION_MODEL`). For the outside Grok API: `GROK_ADMIN_KEY`.
   PDF floor plans need `pdftoppm` (poppler-utils; already in the Dockerfile).
2. `npm install && npx prisma generate && npx prisma db push`
3. `npx next dev -p 3100` → http://localhost:3100/login
Hosting: `Dockerfile` + `scripts/start.sh` (DB on a volume at `$DATA_DIR/crm.db`; first start copies `seed/initial.db`, which now holds DR data only).

## Do not
- Publish publicly, buy domains, or connect client systems without the admin's explicit OK
- Put passwords/keys in chat or commit `.env`
