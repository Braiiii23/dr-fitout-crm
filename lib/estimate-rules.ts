// DR Fitout estimating rules and standard rates (taken from ENP's Esto handover, 16 Nov 2026; same rates and terms for DR).
// The standard rates are the default "house rates" text: the team edits them in the app, and what they save overrides these.

export const DEFAULT_RATE_NOTES = `STANDARD RATES (these override past-job data and market rates). All ex GST at cost.
- Stud wall framing: $340/lm, excluding plastering. Height factor where walls are taller than the standard 3000 mm.
- Plastering: $65/m² supply & install, ready for paint, on every new wall face plus ceilings and bulkheads, as its own line (Plastering band). Don't double up with a partition "set & finish" rate.
- New plasterboard ceiling: $150/m² install, excluding plastering (plastering is the $65 line). Ceiling framing sits in New Construction.
- Labour: $120/hr; after hours $240/hr. A $100 labour allowance is fine for small fit-off items.
- Form 4: $110, standard on every estimate.
- Aluminium skirting: about $65/lm.
- Paint: about $40/m² internal and external.
- Compact laminate (Polytec 5 mm): $250/m² material plus about $250/m² labour, plus 20% waste.
- Aluminium doors: about $1,200 each including hardware, plus white powder coat (check it isn't already covered).
- Silicone: a whole tenancy is normally $1,500-2,000 depending on size (New Construction).
- Electrical safe disconnect before demolition: $440 (Electrical).
- Furniture relocation: about 0.5 hr for 2 workers per item.
- Flooring: researched supply cost plus install at our normal rate. Vinyl cove is an m² S&I rate. Slab prep is grind and level (screed only for wet areas / waterproofing). Lifted vinyl always gets a glue grind at real trade minimums.
- Coatings: a 2-3 coat system.

MARGIN AND TERMS
- Margin 35% on cost (adjustable per job). Mechanical carries the margin too. Preliminaries and Miscellaneous are at cost.
- No contingency unless we ask for it. Contingency is never shown to the client.
- Payment terms 30% / 30% / 35% / 5%, no retention. 7-day payment. Hours weekdays 6:30am-3:30pm. $500 variation fee after set-out. Quote valid 7 days.`;

export const ESTIMATING_RULES = `HOW WE ESTIMATE (DR Fitout / ENP rules)
SCOPE
- Only price what is drawn on the plans or what the client asked for. Never assume scope (no data line, core holes, exhaust, switchboard works etc. unless drawn). If the plans don't ask for it, don't add it, not even as an option: raise it as a question instead.
- Sensible process assumptions are fine but list them as assumptions (e.g. plumbing needs hydraulic engineering even when not drawn).
- Drawn but unclear whether the client wants it: allow for it and flag it. Unclear whether it's our scope: include it and flag it in checks.
- Items not drawn aren't priced; list them as exclusions. We don't supply equipment or appliances (fridges, TVs, chairs) unless asked: exclusions. We do supply plumbing fixtures, vanities, WC fixtures, mirrors and light fittings shown. Plants: a question, not a line.
- Use room names exactly as labelled on the plan.
MEASURING
- Count each item once, from its primary sheet. Walls: solid wall lm only (gross run minus openings priced on their own line). Wall heights from elevations / RCP, else the standard 3000 mm and say so.
- Areas reconcile to the lease / tenancy area; split by finish and zone. Paint m² = lm x actual ceiling height minus openings, on the faces actually painted. Tiles: m² plus 10%. Tiled skirting in m².
- Electrical: count every labelled symbol on the electrical plan. Access panels from the RCP. Where sizes conflict, allow the bigger one.
- Accurate, not padded: protection goes in rates, never in inflated quantities.
PRICING
- Source order: our standard rates, then our own past jobs and trade quotes, then market research. Every line carries its source tag: QUOTE (a real trade quote), JUSTIN (standard rate), PAST JOB, or ESTIMATE (market research / educated guess).
- Price gaps go to the PROTECTIVE HIGH END of the market range, tagged ESTIMATE, never the typical figure.
- Every line is supply (material) plus install (labour), shown separately. Every supply item has an install line or says install is included.
- Electrical and plumbing are never lump-sum guesses. Electrical is built bottom-up: point S&I rates for every drawn point, plus cable runs from the board, board work and testing, plus a protective buffer. Plumbing with no hydraulic drawings is a provisional sum (provisional: true), described in general terms, subject to hydraulic design.
- Body-protected areas: provisional sum to upgrade existing GPOs. Exhaust with no details, signage without enough detail and shopfront paint with no colour are provisional sums.
- Round every price up to the next 10 cents.
BANDS (where things go)
- New Construction order: new walls, then ceilings and bulkheads (m²), doors, door hardware as its own line, then the rest. With new walls always include a stud wall line here AND plastering lines in Plastering (both faces plus ceilings). Silicone, skirting (vinyl / aluminium / timber), access panels, structural backing and bulkheads go in New Construction. Tiled skirting stays in Tiling.
- Wet areas (screed, waterproofing, wall panels) are part of Tiling. Canopies and exhaust hoods are Mechanical. Emergency lighting is Electrical. Fire and CCTV are their own bands. Signage is its own band, never Shopfront; a shopfront door and cladding are their own Shopfront lines.
- Plumbing make-safe (disconnect and cap) goes in Plumbing, not Demolition.
- Each stone type is its own Stone line, never under Joinery. Upholstery is its own band (fabric, foam, make-up, install).
- Demolition: allow for everything coming out (benches, tiles behind benches, cabinets, plinths, flooring as indicated), with services made safe by the trades above.
- Preliminaries are "Allowance for ..." lines (site set-out, induction / access, project management, waste management, equipment hire, Form 4, etc.). Rubbish removal, BA and certification, and final clean are each their own Miscellaneous line.`;
