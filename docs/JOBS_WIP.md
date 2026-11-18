# Jobs and WIP

Admin only (Braiden). Menu: **Jobs** (cards) and **WIP** (weekly table). Both open the same job page.

## Where the numbers come from
- **Job**: created automatically when a lead is marked Signed (contract value, job number, client, usual 30/30/35/5 claims, Justin's trade quotes as cost lines), or with **New job**.
- **Claims**: the job's own signed split. Received is inc GST; everything else ex GST. The last claim takes the remainder so the schedule adds up to the contract.
- **Costs**: one line per trade. **Paid left blank = Pending** (not $0). Owing only counts lines with a known paid. A line's paid can also come from linked labour, receipts and paid supplier invoices.
- **Labour**: BuilderTrend Time Clock hours × ordinary rate. **Materials**: receipts. **Program**: tasks mapped to the claim they support.
- **Weekly snapshot**: saved the first time WIP is opened each week, so the table shows what changed since last week.

## Flags
Overdue claims · authorised-but-unpaid claims · claims whose program tasks are done but not yet invoiced · supplier invoices not mapped to a claim · trades over allowance · unapproved labour hours · running late · claim split not adding to 100% · pending payments · no costs / no handover date.

## CSV import (Import CSV tab)
Trades and costs, claim schedule, supplier invoices, labour hours (BuilderTrend Time Clock), materials, build program (BuilderTrend schedule: Title, Start, Workdays). Column names are flexible; download a template from the tab. Nothing saves until **Import** after the preview.
Every row records its source (manual, csv, lead, seed) so Xero / BuilderTrend syncs can be added later without double entry.

## Migration
New tables only (Job, JobClaim, JobCostLine, JobBill, JobLabour, JobMaterial, JobTask, JobSnapshot) plus new columns from earlier versions. SQL in `prisma/migrations/20261106000000_jobs_wip/migration.sql` for reference. The app applies the schema on start with `prisma db push` (additive; nothing is dropped).

## Test locally before deploying
1. Unpack the package, open PowerShell in `enp-leads-app`.
2. `npm install`
3. Copy `.env.example` to `.env`; set `SESSION_SECRET` (any 64 random characters), `DATABASE_URL="file:./test.db"`, and a test `ADMIN_PASSWORD`.
4. `copy seed\initial.db prisma\test.db`  (a copy of the starting data; your live data is never touched)
5. `npx prisma db push` then `npm run set-passwords` then `npm run seed:wip`
6. `npm run build` then `npm start`, open http://localhost:3100, log in as braiden@enpfitouts.com.au.
7. Check **Jobs**, **WIP** and Hecho Robina's tabs. Expected (as at 6 Nov 2026): costs $449,422.02, paid $68,165.75, owing $153,749.81 with 19 trades pending, 64.62 hours = $2,187.39, Claim 1 $16,389.71 inc owing and 38 days overdue, Claim 2 due 13 Nov, Interlocked INV0509 not mapped, QLeave over allowance.
8. Try marking a test lead Signed: a job should appear under Jobs.

## BuilderTrend schedule (live timelines)
BuilderTrend has no public API, but it can share its Schedule as a calendar (iCal) link. Jobs → **BuilderTrend** → paste the link.
- Read every 30 minutes (and on **Read it now**). Each schedule item becomes a task on the matching job's Program tab, marked "BuilderTrend".
- Matching: the job's **Job name in BuilderTrend** (Job details tab), then the job name, then the job number. BuilderTrend jobs that don't match are listed so you can link them or create a new job from them.
- Tasks already on a job with the same name are taken over, so their claim link and Done tick are kept. Items deleted in BuilderTrend are removed from the CRM (only ones that came from BuilderTrend).
- Moved dates flow through to progress and the "running late" flag.
- Hours, daily logs and costs aren't in the calendar feed: keep using the Time Clock CSV export until BuilderTrend grants API access.
- The link is stored encrypted. Treat it like a password.

## Filled in from Xero (automatic)
After every Xero sync (and the "Update from Xero" buttons), each live job with a **Xero tracking code** is filled in:
- Claim invoices: matched by invoice number (or by amount if the claim has no number yet) → status, invoice and due dates, cash received. Job invoices that don't match a claim are listed on the Claims tab.
- Supplier bills tagged with the code → Supplier invoices, linked to the trade by supplier name. Paid bills count towards the trade's paid figure.
- Spend money tagged with the code (last 6 months) → Materials.
Rows typed in by hand with the same invoice number (or same supplier, amount and date) are adopted, not duplicated. Jobs without a tracking code are matched on the client's name for sales invoices only.
