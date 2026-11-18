# ENP Fitouts + DR Fitout: Leads CRM

A free, self-hosted replacement for the "Leadardo" Airtable base (`appcbbnP68yOLodPq`).
Built with Next.js 15 (App Router), TypeScript, Tailwind v4, Prisma and SQLite, with email + password login.
Locale: Australian English, AUD, Australia/Brisbane (UTC+10, no DST).

## Run it

```bash
npm install
cp .env.example .env        # then set SESSION_SECRET and the three passwords (already done on this box)
npm run db:push             # create the SQLite schema (prisma/dev.db)
npm run db:seed             # one-time Airtable import from ../enp-leads-rebuild/data (safe to re-run: upserts by Airtable id)
npm run build && npm start  # production on http://0.0.0.0:3100   (or: npm run dev)
npm run test:fees           # fee-formula assertions
```

`npm run db:reset` wipes the DB and re-imports. Only use it on a dev copy.

## Logins (passwords live only in `.env`)

| Who | Email | Sees |
|---|---|---|
| Braiden (Admin) | `braiden@enpfitouts.com.au` | Everything: all brands, leads, fees, setters, slots, statements, users |
| Jessie (Setter) | `jessielee2107@outlook.com` | Setter Portal only: her own Call List rows. No pricing, GP, budgets, contract values or other setters |
| Internal team | `team@enpfitouts.com.au` | Team Call List grouped by assignee, can claim unassigned rows, no financials |

Admins add more users (setter or team) at **Users**. Each user can be linked to a Setter record, and that link is the claim identity.

## Map from Airtable

| Airtable | Here |
|---|---|
| ENP Leads / DR Fitouts Leads / Consulting Leads | One `Lead` table with a `brand` column. `/leads/enp`, `/leads/dr`, `/leads/consulting`, each with a Grid and a Pipeline view. Use the company switch in the header (ENP / DR Fitout / Both) |
| Setter Call List | `CallListItem`: `/calls` (admin grid and editor), `/team` (team), `/portal` (setter) |
| Setters | `Setter` plus rollups at `/setters` (quote fees, win bonuses, holdback, clawback, payable) |
| Free Slots | `FreeSlot` at `/slots` (add, generate Mon–Fri hours, block or free, see clashes) |
| Interfaces | Dashboard (`/dashboard`) with the $1M monthly signed-work countdown, setter pay due, stage and call-status counts, appointments and follow-ups |
| Monthly statement email automation | `/statements`: preview and queue to the outbox (sending is stubbed) |

### Automations (`lib/automations.ts`, run on every save)
- Call row set to **Contacted / Quoting** creates a lead in the row's brand, unless the same company has a lead in the last **12 months**. Duplicates are flagged on the row with a note and no lead is created.
- **Appointment Set** + appointment creates the lead. On a duplicate it unticks New Client and flags the row.
- **Stage sync is forward-only.** A call status never moves a lead backwards.
- Setter and referral are copied onto the lead. Registered At is stamped. Quoted is ticked and the Quoted/Signed dates are stamped.
- **Booking a Free Slot** sets the Appointment, marks the slot Booked (atomic, so two people can't double-book) and optionally sets the status to Appointment Set. Rebooking frees the old slot.

### Fees (`lib/fees.ts`, exact port; legacy v1 formulas kept)
- Quote Fee v2: $150 (new client, quote issued, conditions per the base).
- Win bonus: 6% of GP, or 7.5% from the setter's 7th win. Minimum $500, maximum $15k. Jobs of $500k+ are paid in two tranches.
- 25% holdback, 90-day clawback on cancellation.
- **Payable This Month** = items that fell in the **previous Brisbane calendar month**.

### Improvements over Airtable
- **Real access control.** Server-side role checks on every page and action. Setter queries never join the Lead table, so money can't leak.
- **Claim by account.** "Claim" assigns the row to the logged-in user's setter. No free-text name.
- **Call Status is locked until a row is assigned.** Only the assignee (or an admin) can change it.
- Audit log of changes (`AuditLog` table).

## Customising
- Stages, call statuses and colours: `lib/constants.ts`
- Lead form fields and groups: `lib/fields.ts`
- Schema: `prisma/schema.prisma`, then `npm run db:push`
- Logos: `public/brand/enp.svg`, `public/brand/dr.svg` (placeholders, so swap in the real ones)

## Known gaps vs Airtable
- Emails (monthly statements) are written to an outbox table and **not sent**. Plug in SMTP or Resend in `lib/statements.ts`.
- No Google Calendar invite on booking. No Gmail (Kehoe) lead import.
- Attachments are stored as links, not uploads.
- The pipeline is move-by-select, not drag-and-drop.
- The imported data has no GP, quote or deposit values, so every fee shows $0 until those are entered.
- The quarterly holdback win-rate review is manual.
- Runs on this box only. No public hosting. To share it privately you could later run a tunnel (e.g. `cloudflared tunnel --url http://localhost:3100`), but that makes it internet-reachable, so only do it if Braiden wants that.
