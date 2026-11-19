// AI estimate: Claude prices a job from its plans, site photos, concept, brief and DR Fitout's own past costs.
// The result is stored on the lead (aiEstimate) for review; "Use this estimate" puts it into the trade pack
// as "AI estimate" prices, which real trade quotes replace as they come in.
import "server-only";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, readdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import sharp from "sharp";
import { prisma } from "./db";
import { aiChat, aiConfig, jsonFrom, type AiPart } from "./ai";
import { loadFile } from "./files";
import { parseFiles, parseRooms, roomsTotal, type StoredFile } from "./concepts";
import { BANDS, summariseTrades, AI_EST, DEFAULT_MARGIN_PCT } from "./estimating";
import { DEFAULT_RATE_NOTES, ESTIMATING_RULES } from "./estimate-rules";
import { summarise, up10c, SOURCES, type SheetLine } from "./estimate-sheet";
import { syncTradePack } from "./estimate-sync";

const run = promisify(execFile);
export const EST_FILE_KINDS = ["plans", "photo", "other"];

export type EstLine = { item: string; clientText: string; qty: number; unit: string; supplyRate: number; installRate: number; source: string; sourceNote: string; provisional: boolean; amount: number; rate?: number };
export type EstTrade = { trade: string; amount: number; scope: string; basis: string; lines: EstLine[] };
export type AiEstimate = {
  summary: string; confidence: "Low" | "Medium" | "High"; pricingBasis: string;
  areaSqm: number | null;
  trades: EstTrade[];
  scope: { trade: string; description: string; byClient?: boolean }[];
  otherCosts: { amount: number; items: { item: string; amount: number }[] };
  contingencyPct: number;
  assumptions: string[]; exclusions: string[]; checks: string[];
  // added by the app
  tradeTotal?: number; cost?: number; suggestedSell?: number; gpGoal?: number;
  pastJobsUsed?: number; conceptName?: string | null; inputs?: string[]; model?: string; by?: string; appliedAt?: string | null; appliedBy?: string | null;
};

// ---------- DR Fitout's own past costs ----------
type Past = { name: string; sizeSqm: number | null; type: string | null; sell: number | null; byTrade: Record<string, number>; source: string };

/** Per-trade $/m² from completed and live DR jobs (cost lines) and from past trade packs (accepted / received quotes). */
export async function pastCosts(excludeLeadId?: string) {
  const [jobs, leads] = await Promise.all([
    prisma.job.findMany({ where: { brand: "DR" }, include: { costLines: { select: { trade: true, cost: true } } }, orderBy: { updatedAt: "desc" }, take: 60 }),
    prisma.lead.findMany({
      where: { brand: "DR", ...(excludeLeadId ? { id: { not: excludeLeadId } } : {}), tradeQuotes: { some: { status: { in: ["Received", "Accepted"] }, price: { not: null } } } },
      select: { id: true, company: true, leadName: true, sizeSqm: true, projectType: true, quoteValue: true, contractValue: true, tradeQuotes: { select: { trade: true, price: true, status: true, company: true } } },
      orderBy: { updatedAt: "desc" }, take: 60,
    }),
  ]);
  const leadSize = new Map((await prisma.lead.findMany({ where: { id: { in: jobs.map((j) => j.leadId).filter(Boolean) as string[] } }, select: { id: true, sizeSqm: true, projectType: true } })).map((l) => [l.id, l]));
  const past: Past[] = [];
  const seenLeads = new Set<string>();
  for (const j of jobs) {
    const byTrade: Record<string, number> = {};
    for (const c of j.costLines) if (c.cost > 0) byTrade[c.trade] = (byTrade[c.trade] ?? 0) + c.cost;
    if (!Object.keys(byTrade).length) continue;
    const l = j.leadId ? leadSize.get(j.leadId) : undefined;
    if (j.leadId) seenLeads.add(j.leadId);
    if (j.leadId === excludeLeadId) continue;
    past.push({ name: j.name, sizeSqm: l?.sizeSqm ?? null, type: l?.projectType ?? null, sell: j.contractValue || null, byTrade, source: `job (${j.status})` });
  }
  for (const l of leads) {
    if (seenLeads.has(l.id)) continue;
    const byTrade: Record<string, number> = {};
    for (const r of summariseTrades(l.tradeQuotes.filter((q) => q.status !== AI_EST)).rows) if (r.counts?.price) byTrade[r.trade] = r.counts.price;
    if (!Object.keys(byTrade).length) continue;
    past.push({ name: l.company || l.leadName || "Quote", sizeSqm: l.sizeSqm, type: l.projectType, sell: l.contractValue ?? l.quoteValue ?? null, byTrade, source: "trade pack" });
  }
  // $/m² per trade (median) where the size is known
  const per: Record<string, number[]> = {};
  for (const p of past) if (p.sizeSqm && p.sizeSqm > 0) for (const [t, v] of Object.entries(p.byTrade)) (per[t] ??= []).push(v / p.sizeSqm);
  const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const rates = Object.entries(per).map(([trade, v]) => ({ trade, perSqm: Math.round(median(v)), low: Math.round(Math.min(...v)), high: Math.round(Math.max(...v)), n: v.length })).sort((a, b) => a.trade.localeCompare(b.trade));
  const totals = past.filter((p) => p.sizeSqm).map((p) => Object.values(p.byTrade).reduce((a, b) => a + b, 0) / p.sizeSqm!);
  return { past, rates, overallPerSqm: totals.length ? Math.round(median(totals)) : null };
}

// ---------- Pictures for Claude ----------
async function toJpeg(buf: Buffer) {
  const out = await sharp(buf, { failOn: "none" }).rotate().resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}
/** Images as they are (resized); PDFs as their first `pages` pages. */
async function images(f: StoredFile, pages: number): Promise<{ label: string; dataUrl: string }[]> {
  const file = await loadFile(f.id);
  if (!file) return [];
  if (file.meta.type.startsWith("image/")) return [{ label: f.name, dataUrl: await toJpeg(file.data) }];
  if (file.meta.type !== "application/pdf") return [];
  const dir = await mkdtemp(join(tmpdir(), "est-"));
  try {
    await writeFile(join(dir, "in.pdf"), file.data);
    await run("pdftoppm", ["-png", "-f", "1", "-l", String(pages), "-scale-to", "1568", join(dir, "in.pdf"), join(dir, "p")], { timeout: 90000 });
    const names = (await readdir(dir)).filter((n) => n.startsWith("p") && n.endsWith(".png")).sort();
    return Promise.all(names.map(async (n, i) => ({ label: `${f.name} page ${i + 1}`, dataUrl: await toJpeg(await readFile(join(dir, n))) })));
  } catch { return []; } finally { await rm(dir, { recursive: true, force: true }); }
}

const SYSTEM = `You are DR Fitout's estimator. DR Fitout designs and builds medical and allied-health fitouts in Brisbane / South-East Queensland, Australia (sister company of ENP Fitouts; same rates, rules and terms).
Build a first-pass estimate the way our estimator does it: read every plan sheet (areas, wall runs, heights, doors, wet rooms, ceilings, joinery, electrical symbols), read the site photos for existing conditions, use the concept's room schedule and finishes, then quantify and price every scope item line by line.
All money is AUD ex GST AT COST (what it costs us). The app adds the margin; do NOT add margin or contingency.
Use ONLY these band names, in this order: ${BANDS.join(", ")}. Leave a band out if it isn't needed.

${ESTIMATING_RULES}

OUTPUT
Each band's lines: item (internal description, with the plan reference / derivation in sourceNote), clientText (the proposal wording: "Supply and install ..." with counts only, e.g. "Supply and install 22 x LED downlights", or "Allowance for ..." for prelims and services; no m², lm or rates), qty, unit (lm, m2, ea, hr, item), supplyRate and installRate ($/unit, either can be 0 for all-in labour or all-in supply), source (one of ${SOURCES.join(", ")}), sourceNote (where the rate and quantity came from), provisional (true for provisional sums).
Also write the scope of works reference (short lines per band) and lists of assumptions, checks (questions / things to confirm, each with your proposed answer) and exclusions.
confidence: High only with dimensioned plans and good rate data; Low when working mainly from a brief.
Reply with JSON matching exactly:
{"summary": string, "confidence": "Low"|"Medium"|"High", "pricingBasis": string, "areaSqm": number|null,
 "trades": [{"trade": string (band), "scope": string, "basis": string, "lines": [{"item": string, "clientText": string, "qty": number, "unit": string, "supplyRate": number, "installRate": number, "source": string, "sourceNote": string, "provisional": boolean}]}],
 "scope": [{"trade": string, "description": string, "byClient": boolean}],
 "assumptions": string[], "exclusions": string[], "checks": string[]}`;

export async function runAiEstimate(leadId: string, o: { conceptId?: string | null; brief?: string | null; by: string }) {
  if (!aiConfig()) throw new Error("Claude isn't set up. Add ANTHROPIC_API_KEY on the server.");
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      scopeItems: { select: { trade: true, description: true, byClient: true } },
      tradeQuotes: { where: { status: { in: ["Received", "Accepted"] } }, select: { trade: true, company: true, price: true, status: true, scope: true } },
      leases: { select: { id: true, premises: true, tenancy: true, sizeSqm: true, notes: true, concepts: { select: { id: true } }, fits: { where: { chosen: true }, select: { result: true }, take: 1 } } },
    },
  });
  if (!lead) throw new Error("Job not found.");
  const conceptId = o.conceptId || lead.leases.flatMap((l) => l.concepts.map((c) => c.id))[0] || null;
  const concept = conceptId ? await prisma.concept.findUnique({ where: { id: conceptId } }) : null;
  const settings = await prisma.accountsSettings.findUnique({ where: { id: "settings" } });
  const bench = await pastCosts(leadId);
  const files = parseFiles(lead.estFiles);
  const brief = (o.brief ?? lead.estBrief ?? "").trim();

  // Pictures: plans first (up to 4 pages each), then site photos; 10 images at most.
  const pics: { label: string; dataUrl: string }[] = [];
  for (const f of files.filter((f) => f.kind === "plans")) { if (pics.length >= 7) break; pics.push(...(await images(f, 4)).slice(0, 7 - pics.length)); }
  for (const f of files.filter((f) => f.kind !== "plans")) { if (pics.length >= 10) break; pics.push(...(await images(f, 2)).slice(0, 10 - pics.length)); }

  const size = lead.sizeSqm ?? lead.leases.find((l) => l.sizeSqm)?.sizeSqm ?? null;
  const rooms = concept ? parseRooms(concept.rooms) : [];
  const fit = lead.leases.flatMap((l) => l.fits)[0];
  let fitSchedule = "";
  try { const r = fit?.result ? JSON.parse(fit.result) : null; if (r?.schedule?.length) fitSchedule = r.schedule.map((s: { qty: number; name: string; areaSqm: number }) => `- ${s.qty} x ${s.name} @ ${s.areaSqm} m²`).join("\n"); } catch { /* ignore */ }

  const text = [
    `JOB: ${lead.company || lead.leadName || "Untitled"} · ${lead.location ?? "location not given"} · ${lead.projectType ?? "type not given"} · ${size ? `${size} m²` : "size not given"}`,
    `Client budget: ${lead.budget ?? "not given"} · Timeframe: ${lead.timeframe ?? "not given"}`,
    `What they're after: ${lead.lookingFor ?? "not given"}`,
    lead.notes ? `Lead notes: ${lead.notes.slice(0, 3000)}` : "",
    brief ? `\nBRIEF FROM THE TEAM:\n${brief.slice(0, 4000)}` : "",
    ...lead.leases.map((l) => `Tenancy: ${[l.tenancy, l.premises].filter(Boolean).join(", ")}${l.sizeSqm ? ` (${l.sizeSqm} m²)` : ""}${l.notes ? ` · notes: ${l.notes.slice(0, 600)}` : ""}`),
    concept ? `\nCONCEPT: ${concept.name}${concept.practiceType ? ` (${concept.practiceType})` : ""}\n${concept.description?.slice(0, 3000) ?? ""}\nFinishes: ${concept.finishes ?? "not given"}\nRoom schedule (${Math.round(roomsTotal(rooms))} m² of rooms):\n${rooms.map((r) => `- ${r.qty} x ${r.name}${r.areaSqm ? ` @ ${r.areaSqm} m²` : ""}`).join("\n")}` : "\nCONCEPT: none chosen",
    fitSchedule ? `\nRoom schedule from the AI concept fit on this tenancy:\n${fitSchedule}` : "",
    lead.scopeItems.length ? `\nSCOPE ALREADY WRITTEN BY THE TEAM (include all of it):\n${lead.scopeItems.map((s) => `- ${s.trade}: ${s.description}${s.byClient ? " (by client)" : ""}`).join("\n")}` : "",
    lead.tradeQuotes.length ? `\nREAL TRADE QUOTES ALREADY IN (use these prices for those trades):\n${lead.tradeQuotes.map((q) => `- ${q.trade}: ${q.company ?? "?"} $${q.price} (${q.status})${q.scope ? ` - ${q.scope.slice(0, 200)}` : ""}`).join("\n")}` : "",
    `\nDR FITOUT'S PAST COSTS (${bench.past.length} past job${bench.past.length === 1 ? "" : "s"}${bench.overallPerSqm ? `, median all trades ≈ $${bench.overallPerSqm}/m²` : ""}):`,
    bench.rates.length ? bench.rates.map((r) => `- ${r.trade}: median $${r.perSqm}/m² (range $${r.low}-$${r.high}, ${r.n} job${r.n === 1 ? "" : "s"})`).join("\n") : "- none with a known size yet: use Brisbane market rates and say so",
    ...bench.past.slice(0, 15).map((p) => `- ${p.name} (${p.source}${p.sizeSqm ? `, ${p.sizeSqm} m²` : ""}${p.type ? `, ${p.type}` : ""}${p.sell ? `, sold $${Math.round(p.sell)}` : ""}): ${Object.entries(p.byTrade).map(([t, v]) => `${t} $${Math.round(v)}`).join("; ")}`),
    `\nOUR STANDARD RATES AND HOUSE RULES (override everything else):\n${(settings?.estRateNotes || DEFAULT_RATE_NOTES).slice(0, 12000)}`,
    pics.length ? `\nATTACHED IMAGES, in order: ${pics.map((p, i) => `${i + 1}. ${p.label}`).join("; ")}` : "\nNo plans or photos attached: estimate from the brief, concept and size, and set confidence Low.",
  ].filter(Boolean).join("\n");

  const parts: AiPart[] = [{ type: "text", text }, ...pics.map((p) => ({ type: "image" as const, dataUrl: p.dataUrl }))];
  const r = await aiChat({ feature: "estimate", system: SYSTEM, messages: [{ role: "user", content: parts }], vision: true, json: true, effort: "medium", maxTokens: 32000, timeoutMs: 280000 });
  const est = clean(jsonFrom<AiEstimate>(r.text));
  const marginPct = lead.estMarginPct ?? settings?.estMarginPct ?? DEFAULT_MARGIN_PCT;
  const sum = summarise(toSheet(est), marginPct);
  const full: AiEstimate = {
    ...est, tradeTotal: Math.round(sum.cost * 100) / 100, cost: Math.round(sum.cost * 100) / 100, gpGoal: marginPct, suggestedSell: sum.sell,
    pastJobsUsed: bench.past.length, conceptName: concept?.name ?? null, model: r.model, by: o.by, appliedAt: null,
    inputs: [...pics.map((p) => p.label), concept ? `Concept: ${concept.name}` : "", brief ? "Brief" : "", size ? `${size} m²` : ""].filter(Boolean),
  };
  await prisma.lead.update({ where: { id: leadId }, data: { aiEstimate: JSON.stringify(full), aiEstimateAt: new Date(), ...(o.brief != null ? { estBrief: o.brief.trim() || null } : {}) } });
  return full;
}


/** Keep numbers sane and band names on our list. */
function clean(e: AiEstimate): AiEstimate {
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0; };
  const bandName = (t: unknown) => {
    const v = String(t ?? "").toLowerCase().trim();
    const exact = BANDS.find((x) => x.toLowerCase() === v);
    if (exact) return exact;
    const hit = BAND_WORDS.find(([re]) => re.test(v));
    return hit ? hit[1] : "Miscellaneous";
  };
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? v : []) as T[];
  const merged = new Map<string, EstTrade>();
  for (const t of arr<EstTrade>(e.trades)) {
    const lines: EstLine[] = arr<EstLine>(t.lines).map((l) => {
      const qty = num(l.qty); let supplyRate = num(l.supplyRate), installRate = num(l.installRate);
      if (!supplyRate && !installRate && l.rate) installRate = num(l.rate);
      const src = String(l.source ?? "").toUpperCase().trim();
      return { item: String(l.item ?? "").slice(0, 300), clientText: String(l.clientText ?? "").slice(0, 500), qty, unit: String(l.unit ?? "").slice(0, 20), supplyRate, installRate,
        source: (SOURCES as readonly string[]).includes(src) ? src : "ESTIMATE", sourceNote: String(l.sourceNote ?? "").slice(0, 500), provisional: !!l.provisional, amount: up10c(qty * (supplyRate + installRate)) };
    }).filter((l) => l.item && l.amount > 0);
    if (!lines.length) continue;
    const name = bandName(t.trade);
    const prev = merged.get(name);
    if (prev) { prev.lines.push(...lines); prev.scope = [prev.scope, t.scope].filter(Boolean).join("; "); }
    else merged.set(name, { trade: name, amount: 0, scope: String(t.scope ?? "").slice(0, 1000), basis: String(t.basis ?? "").slice(0, 300), lines });
  }
  for (const t of merged.values()) t.amount = Math.round(t.lines.reduce((a, l) => a + l.amount, 0) * 100) / 100;
  const strs = (v: unknown) => arr<unknown>(v).map((x) => String(x).slice(0, 400)).filter(Boolean).slice(0, 25);
  return {
    summary: String(e.summary ?? "").slice(0, 2000), confidence: (["Low", "Medium", "High"].includes(e.confidence) ? e.confidence : "Low") as AiEstimate["confidence"],
    pricingBasis: String(e.pricingBasis ?? "").slice(0, 1000), areaSqm: e.areaSqm ? num(e.areaSqm) : null,
    trades: [...merged.values()].sort((a, b) => BANDS.indexOf(a.trade) - BANDS.indexOf(b.trade)),
    scope: arr<{ trade: string; description: string; byClient?: boolean }>(e.scope).map((x) => ({ trade: bandName(x.trade), description: String(x.description ?? "").slice(0, 500), byClient: !!x.byClient })).filter((x) => x.description).slice(0, 150),
    otherCosts: { amount: 0, items: [] }, contingencyPct: 0,
    assumptions: strs(e.assumptions), exclusions: strs(e.exclusions), checks: strs(e.checks),
  };
}

const BAND_WORDS: [RegExp, string][] = [
  [/prelim|site set|supervis|project manag/, "Preliminaries"], [/demol|strip.?out|make.?good/, "Demolition"], [/upholst/, "Upholstery"],
  [/stone|benchtop/, "Stone"], [/join|cabinet|millwork/, "Joinery"], [/tile|tiling|waterproof|screed|wet area/, "Tiling"],
  [/plaster(ing)?$|set.?(and|&).?finish/, "Plastering"], [/paint|wall.?cover|coating/, "Painting"],
  [/partition|stud|ceiling|bulkhead|door|skirting|silicone|carpent|framing|plasterboard|new construction|access panel|backing/, "New Construction"],
  [/floor|vinyl|carpet/, "Flooring"], [/cctv|security camera/, "CCTV"], [/fire|sprinkler|smoke|evac/, "Fire Services"],
  [/mech|hvac|air.?con|a\/c|ventil|duct|exhaust|canopy/, "Mechanical"], [/stainless|\bss\b/, "Stainless Steel"], [/shopfront|cladding/, "Shopfront"],
  [/glaz|glass|window/, "Glazing"], [/plumb|hydraulic|sanitary|sewer|drain/, "Plumbing"], [/electric|power|light|switch|data|comms/, "Electrical"], [/sign/, "Signage"],
  [/misc|clean|rubbish|waste|certif/, "Miscellaneous"],
];

/** The estimate's lines as estimate sheet rows. */
export function toSheet(e: AiEstimate): SheetLine[] {
  let n = 0;
  return e.trades.flatMap((t) => t.lines.map((l) => ({ band: t.trade, item: l.item, clientText: l.clientText || null, qty: l.qty, unit: l.unit || null, supplyRate: l.supplyRate, installRate: l.installRate, source: l.source, sourceNote: l.sourceNote || null, provisional: l.provisional, sortOrder: n++ })));
}

/** Put the reviewed estimate onto the estimate sheet (replacing the sheet's rows), add new scope lines, and update the trade pack. */
export async function applyAiEstimate(leadId: string, o: { setQuote: boolean; by: string }) {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, include: { scopeItems: true } });
  if (!lead?.aiEstimate) throw new Error("Run the AI estimate first.");
  const est = JSON.parse(lead.aiEstimate) as AiEstimate;
  if (!est.trades?.[0]?.lines?.[0] || est.trades[0].lines[0].supplyRate === undefined) throw new Error("This estimate was made before the estimate sheet existed. Press Estimate again first.");
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const have = new Set(lead.scopeItems.map((x) => `${norm(x.trade)}|${norm(x.description)}`));
  let sort = lead.scopeItems.reduce((m, x) => Math.max(m, x.sortOrder), 0) + 1;
  const newScope = est.scope.filter((x) => !have.has(`${norm(x.trade)}|${norm(x.description)}`));
  const rows = toSheet(est);
  const proposal = { ...JSON.parse(lead.estProposal || "{}"), exclusions: est.exclusions, assumptions: est.assumptions };
  await prisma.$transaction([
    prisma.estimateLine.deleteMany({ where: { leadId } }),
    prisma.estimateLine.createMany({ data: rows.map((x) => ({ ...x, leadId })) }),
    prisma.scopeItem.createMany({ data: newScope.map((x) => ({ leadId, trade: x.trade, description: x.description, byClient: !!x.byClient, sortOrder: sort++ })) }),
    prisma.lead.update({ where: { id: leadId }, data: {
      estProposal: JSON.stringify(proposal),
      ...(o.setQuote && est.suggestedSell ? { quoteValue: est.suggestedSell } : {}),
      aiEstimate: JSON.stringify({ ...est, appliedAt: new Date().toISOString(), appliedBy: o.by }),
    } }),
  ]);
  await syncTradePack(leadId);
  return { trades: est.trades.length, lines: rows.length, scope: newScope.length };
}
