# Grok → CRM: BuilderTrend transfer

**Address:** `https://crm-production-b8fa.up.railway.app/api/internal/buildertrend`
**Key:** header `Authorization: Bearer <BUILDERTREND_SYNC_KEY>` (copy the value from Railway → crm → Variables). This key only works for this address.

## Steps for each run
1. `GET` the address: lists the CRM's live jobs and which BuilderTrend job each is linked to.
2. `POST` the data with `?dryRun=1` first: shows what would be created, updated or left unmatched, without saving.
3. `POST` again without `dryRun` to save. Re-running is safe; everything is matched on BuilderTrend's ids.

## What to send (JSON)
```json
{
  "replaceTasks": true,
  "jobs": [
    { "btJobId": "BT-898", "name": "Hecho Robina - Robina Town Centre", "jobNumber": "898", "status": "Open",
      "startDate": "2026-10-19", "finishDate": "2026-12-11", "projectManager": "Josh", "client": "Hecho En Mexico Robina", "brand": "ENP",
      "contractValue": 704632.37, "contractIncludesGst": true, "claimSplit": "30/30/20/15/5", "xeroTracking": "HECH002", "address": "Robina Town Centre",
      "notes": "Signed 24 Sep (Gmail: 'Hecho Robina - signed agreement')", "documents": [{ "url": "https://www.dropbox.com/...", "filename": "Hecho Robina signed agreement.pdf" }] }
  ],
  "tasks": [
    { "btId": "<schedule item id>", "btJobId": "BT-898", "name": "Sheeting", "start": "2026-11-04", "finish": "2026-11-05", "done": true }
  ],
  "timeClock": [
    { "btId": "<time clock entry id>", "btJobId": "BT-898", "date": "2026-11-09", "person": "Khodi Mcdonald", "hours": 7.5, "approved": false }
  ]
}
```
- `btId` / `btJobId`: BuilderTrend's own ids (any stable id works if the real one isn't visible, e.g. job name + task name + start date).
- Dates `YYYY-MM-DD`. Hours as a decimal (7.5, not 7:30). Leave `rate` out unless it's the real pay rate (BuilderTrend's Cost Rate shows $0 and is not a pay rate); the CRM uses the person's last known rate.
- `replaceTasks: true` only when sending a job's **whole** schedule: BuilderTrend items not in the list are removed from that job.
- Instead of `btJobId` a task or time entry can give `jobName` (the job's name in BuilderTrend).

## Where Grok finds each piece
- **BuilderTrend**: jobs, schedule items, Time Clock hours, project manager, site address.
- **Xero**: the CRM already reads Xero itself (claim invoices, payments, supplier bills and spend tagged with the job's tracking code). Grok only needs to send each job's **Xero tracking code** (`xeroTracking`, e.g. HECH002) so they link up.
- **Gmail**: the signed agreement / acceptance email: contract price (inc or ex GST), the signed claim split, client name, job number; plus links to the signed contract or plans (`documents`) and anything worth noting (`notes`, e.g. "client asked for claims fortnightly").
- **Estimating**: already in the CRM; Justin's trade pack becomes the job's cost lines when the lead is signed (or press "Pull trade pack" on the job).

## What the CRM fills in by itself
After every import (and every Xero sync) the CRM fills BLANK job details it can find: the Xero tracking code (from invoices and bills for that client), the client name, and the contract value (signed lead in the CRM, else the client's accepted quote in Xero, else estimated from the deposit invoice and flagged). Nothing already on a job is overwritten. The reply's `filledFromXeroAndCrm` lists what was filled and what still needs checking; send those "still to check" items back to Braiden.

## What the CRM does with it
- Jobs: links each to the CRM job (by BuilderTrend id, BuilderTrend name, job number, then name).
- **Missing jobs are created** (open ones only; closed, presale, warranty and cancelled are skipped and listed). A new job gets its contract (ex GST; send `contractIncludesGst: true` if the figure includes GST), the signed claim split as claims (usual 30/30/35/5 if none is sent), client, job number, Xero tracking code, dates and PM. If a signed CRM lead has the same job number or client, the job is linked to it (and takes its contract value if none was sent).
- Anything missing (contract, claim split) is listed under `needsReview` and noted on the job. Existing jobs are only filled in where blank: a contract, client or job number already in the CRM is never overwritten.
- Tasks: become the job's program. A task with the same name already on the job is taken over, keeping its claim link. Dates drive progress, "running late" and **when each claim should be invoiced** (accounts are notified automatically).
- Time clock: becomes the job's labour (New construction line), approved or pending.
- Never sends anything back to BuilderTrend.

## Paste-ready instructions for Grok
> You transfer BuilderTrend data for ENP Fitouts and DR Fitout into our CRM. Each run: (1) GET the CRM address to see live jobs. (2) Collect, for every open job, from BuilderTrend and from the signed agreement emails in Gmail: job id, name, job number, status, start and finish dates, project manager, client, site address, contract price (say whether it includes GST) and the claim split in the signed agreement if you can see it; every schedule item (id, name, start, finish, complete or not); and Time Clock entries since the last run (id, date, person, hours as a decimal, approved or not). (3) POST it as JSON in the format in GROK_BUILDERTREND.md with ?dryRun=1, read the reply, then POST again without dryRun. (4) Report back: jobs created, anything under needsReview (missing contract or claim split), anything listed as unmatched, people with no pay rate, and any errors. Never invent ids, dates or hours: leave out anything you can't read. Send the full schedule for a job with "replaceTasks": true only when you have all of that job's items.
