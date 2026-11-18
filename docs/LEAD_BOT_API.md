# Lead bot API

Base address: `https://crm-production-b8fa.up.railway.app/api/bot`
Every request needs the header `Authorization: Bearer <LEADBOT_API_KEY>` (the value is in Railway → crm → Variables).
Times are ISO 8601 with an offset, e.g. `2026-11-12T09:00:00+10:00` (Brisbane). Limit: 60 requests a minute.
Everything the bot does is recorded in the CRM's audit log as "lead bot".

| Task | Request |
|---|---|
| What's available | `GET /api/bot` |
| Find a lead | `GET /leads?q=Empire` |
| Check a company | `GET /leads/duplicates?company=Empire Cuts` |
| Add a Kehoe lead | `POST /leads` `{ "brand": "ENP", "name": "Jane Smith", "company": "Acme Cafe", "phone": "0400 000 000", "email": "jane@acme.com", "location": "West End", "projectType": "Cafe fit-out", "budget": "$150k-$250k", "lookingFor": "...", "sourceLink": "https://..." }` |
| Add a note (appends, never overwrites) | `POST /leads/{leadId}/notes` `{ "text": "Sent capability statement" }` |
| Attach plans or a quote (link) | `POST /leads/{leadId}/attachments` `{ "url": "https://...", "filename": "Plans rev B.pdf", "kind": "plans" }` |
| Attach plans or a quote (file) | `POST /leads/{leadId}/attachments` multipart: `file=@plans.pdf`, `kind=plans` |
| Booked appointments needing an invite | `GET /appointments?invited=false` |
| Mark invite sent | `POST /appointments/{callId}/invited` `{ "invited": true }` |
| Free slots | `GET /slots?days=30` |
| Add or update a slot from the calendar | `POST /slots` `{ "start": "...", "end": "...", "externalId": "<calendar event id>" }` |
| Move a free slot | `PATCH /slots/ext:<calendar event id>` `{ "start": "...", "end": "..." }` |
| Remove a free slot | `DELETE /slots/ext:<calendar event id>` |
| Book a slot for a lead | `POST /bookings` `{ "slotId": "...", "leadId": "..." }` |
| Follow-ups for Anita | `GET /follow-ups?until=2026-11-30` |

Rules the API enforces:
- A lead whose email or phone is already in the CRM (last 12 months) isn't added again (409, with the existing leadId).
- A company already in the CRM in the last 12 months returns 409 with the matches; send `"allowDuplicate": true` to add it anyway (it won't count as a new client).
- Booked slots are never moved or removed (409).
- Notes are only ever added to the end, with the date and "(lead bot)".
