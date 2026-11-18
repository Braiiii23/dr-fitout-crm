# DR Fitout CRM (handoff for Claude)

## What this is
Private Next.js 15 back-of-house CRM for **DR Fitout** (singular, never "DR Fitouts"): medical and allied-health fitouts, Brisbane.
Built from the ENP/DR Leads CRM v60, locked to DR Fitout only (DR lavender/purple theme everywhere, no brand switch).

## Tabs (menu order)
My Day · Calendar · Dashboard · Leads · Jobs · WIP · Estimating · Accounts · Leases · Clients · Directory · KPI's · Users
- Leads live at `/leads/dr` (`/leads`, `/leads/enp`, `/leads/consulting` redirect there). `/team` redirects to `/directory`.
- **Leases** (`/leases`): tenancies we're securing for clients or that they hold. Status, premises, landlord/agent, term, options,
  option-notice / review / expiry dates, rent, outgoings, incentive. Key dates show on the Leases page, Dashboard, team Calendar and the assistant.
- **Clients** (`/clients`): practices. Leads, jobs and leases link to a client. "Create from N leads" makes clients from DR lead companies.
- Removed from v60: setters, call lists, free slots, statements, team tasks, setter portal, consulting, ENP pipeline, setter pay.

## Stack
Next.js 15 (App Router) + TypeScript + Tailwind, Prisma + SQLite. Port 3100.
New Prisma models: `Client`, `Lease` (+ `clientId` on `Lead` and `Job`). `prisma db push` on start adds them.
The `brand` column stays on leads/jobs (always "DR"); `lib/brand.ts` always returns DR. Setter/CallListItem tables are kept for the Directory.

## Roles (lib/access.ts)
ADMIN/CEO everything. BDM: dashboard, leads, leases, clients, directory (+ estimating view). PM: jobs, WIP, leases, clients, directory (+ view rest).
ACCOUNTS: accounts, jobs, WIP, leases, clients. ESTIMATOR: estimating (+ view rest). FOREMAN: directory (+ view rest). TEAM: directory + view-only.

## Setup
1. `.env.example` → `.env` (never commit `.env`). Optional `MONTHLY_TARGET` (dashboard signed-work target, default 1000000).
2. `npm install && npx prisma generate && npx prisma db push`
3. `npx next dev -p 3100` → http://localhost:3100/login
Hosting: `Dockerfile` + `scripts/start.sh` (DB on a volume at `$DATA_DIR/crm.db`; first start copies `seed/initial.db`, which now holds DR data only).

## Do not
- Publish publicly, buy domains, or connect client systems without the admin's explicit OK
- Put passwords/keys in chat or commit `.env`
