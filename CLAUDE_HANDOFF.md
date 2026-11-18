# ENP Fitouts · DR Fitout — Leads CRM (handoff for Claude)

## What this is
Private Next.js 15 CRM for ENP Fitouts (commercial fit-outs, Brisbane) and sister company **DR Fitout** (singular — never "DR Fitouts"). Replaces Airtable for leads, Jessie's setter portal, team call directory, and Braiden-only admin.

## Stack
- Next.js 15 (App Router) + TypeScript + Tailwind
- Prisma + SQLite (`prisma/dev.db` may be included for demo data — regenerate with `npx prisma migrate` / seed if missing)
- Port used in demo: **3100**

## Roles
- **ADMIN** (Braiden): full dark admin dashboards, leads, calls, team, setters, slots, statements, users, AI assistant hooks
- **SETTER** (Jessie): My Calls portal, earnings meter ($10k monthly net target), brand switch ENP/DR
- **TEAM**: shared team call directory (claim contacts, no double-call)

## Branding (locked)
- ENP: black / white / red `#c8102e`
- DR Fitout: lavender / purple `#5b2a86`
- Admin: dark charcoal; setter: light company theme
- Shared lock screen at `/login` for all portals; desktop split layout + separate phone CSS (`max-width: 767px`)

## Setup
1. Copy `.env.example` → `.env` and fill demo passwords / session secret (do **not** reuse production secrets from chat).
2. `npm install`
3. `npx prisma generate` && `npx prisma db push` (or migrate) && run seed if present (`npm run seed` / `npx tsx prisma/seed.ts` — check `package.json` scripts).
4. `npx next dev -p 3100` → http://localhost:3100/login

## Do not
- Publish publicly, buy domains, or connect client systems without Braiden's explicit OK
- Put passwords/keys in chat or commit `.env`
- Spell the medical sister company as "DR Fitouts"

## Related bots (Braiden's team)
Anita Reminder (Todoist chase), Esther Mater (estimating), Phil McForms (docs), Leadardo / Lead Zeppelin (leads). Anita hooks: `docs/ANITA_REMINDER_HOOK.md`, queue under `data/anita-reminder-queue.jsonl` when present.

## Origin
Private codebase: `enp-fitouts/enp-dr-leads-crm` on Cursor Origin (PR may exist for latest sync).
