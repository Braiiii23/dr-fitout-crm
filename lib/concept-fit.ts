import "server-only";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, readdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { prisma } from "./db";
import { aiChat, aiConfig, jsonFrom, type AiPart } from "./ai";
import { loadFile } from "./files";
import { parseFiles, parseRooms, roomsTotal, type FitResult } from "./concepts";
import { expiryOf } from "./leases";

const run = promisify(execFile);

/** A picture the AI can look at: images as they are, PDFs as page 1 rendered to PNG. */
async function asImage(fileId: string): Promise<{ dataUrl: string; name: string } | null> {
  const f = await loadFile(fileId);
  if (!f) return null;
  if (f.meta.type.startsWith("image/")) return { dataUrl: `data:${f.meta.type};base64,${f.data.toString("base64")}`, name: f.meta.name };
  if (f.meta.type !== "application/pdf") return null;
  const dir = await mkdtemp(join(tmpdir(), "plan-"));
  try {
    await writeFile(join(dir, "in.pdf"), f.data);
    await run("pdftoppm", ["-png", "-f", "1", "-l", "1", "-scale-to", "1568", join(dir, "in.pdf"), join(dir, "page")], { timeout: 60000 });
    const name = (await readdir(dir)).find((n) => n.startsWith("page") && n.endsWith(".png"));
    if (!name) return null;
    return { dataUrl: `data:image/png;base64,${(await readFile(join(dir, name))).toString("base64")}`, name: f.meta.name };
  } catch {
    throw new Error("Couldn't read the PDF floor plan. Upload it as a PNG or JPG instead.");
  } finally { await rm(dir, { recursive: true, force: true }); }
}

const SYSTEM = `You are DR Fitout's concept planner. DR Fitout designs and builds medical and allied-health fitouts in Brisbane, Australia.
You are given a tenancy floor plan (image 1) and one of our concept designs: its design narrative, KEY DESIGN MOVES, room schedule and finishes, and usually its own concept floor plan (image 2).
RECREATE that concept to suit THIS tenancy as a first-pass test fit. The concept floor plan is the design to recreate, adapted to the new shape: keep its zoning (public zone on the shopfront, clinical zone behind the portal / reception, back-of-house spine to the rear), its key design moves and adjacencies (e.g. clean-to-dirty flow, quiet / infectious waiting by the door, private rear exit), its corridor widths, and its room sizes and room count as far as the tenancy allows. Shrink, re-proportion, merge or drop rooms only where the tenancy forces it, in this order: support and staff rooms first, then extra clinical rooms; keep the signature rooms. Say exactly what changed and why.
Read dimensions and the area from the plan (dimension strings, scale bar, area notes). If the plan gives no dimensions, use the lease's stated area and assume a sensible rectangle, and say so in assumptions.
Lay rooms out on a metre grid with the origin (0,0) at the top-left of the tenancy as drawn, x to the right, y down. Rooms must sit inside the tenancy and must not overlap. Leave corridors (min 1.2 m clear, 1.5 m where wheelchairs pass) — corridors are NOT listed as rooms.
Put reception/waiting at the entry, clinical rooms off the corridor, wet rooms (treatment, sterilising, toilets, staff kitchen) near likely plumbing where you can see it, and an accessible toilet (approx 2.3 x 2.3 m min) if the concept has a toilet.
Flag things to check: NCC / AS 1428.1 access, plumbing and sewer points, mechanical, natural light to consult rooms, infection control flow, landlord base-build items.
Never invent facts about the site; put guesses in "assumptions".
Reply with JSON matching exactly:
{"summary": string, "verdict": "Fits" | "Tight" | "Doesn't fit",
 "tenancy": {"areaSqm": number, "widthM": number, "depthM": number, "entry": string, "features": string[], "outline": [[x,y],...] },
 "rooms": [{"name": string, "zone": "front"|"clinical"|"wet"|"staff"|"support", "x": number, "y": number, "w": number, "h": number, "areaSqm": number, "notes": string}],
 "schedule": [{"name": string, "qty": number, "areaSqm": number, "vsConcept": string}],
 "usedSqm": number, "circulationPct": number,
 "changes": string[], "checks": string[], "assumptions": string[]}
"outline" is the tenancy boundary polygon in metres (same grid); use the bounding rectangle if it is a simple rectangle.`;

export async function runConceptFit(leaseId: string, conceptId: string, brief: string, by: string) {
  const ai = aiConfig();
  if (!ai) throw new Error("The AI isn't set up. Add ANTHROPIC_API_KEY (Claude) on the server.");
  const [lease, concept] = await Promise.all([
    prisma.lease.findUnique({ where: { id: leaseId }, include: { client: { select: { name: true, type: true } } } }),
    prisma.concept.findUnique({ where: { id: conceptId } }),
  ]);
  if (!lease || !concept) throw new Error("Lease or concept not found.");
  const plan = parseFiles(lease.files).find((f) => f.kind === "floor plan");
  if (!plan) throw new Error("Upload the tenancy floor plan to this lease first (kind: floor plan).");
  const planImg = await asImage(plan.id);
  if (!planImg) throw new Error("The floor plan must be a PDF, PNG, JPG or WebP.");
  // One concept plan image too, if there is one, so the AI can see how the concept is laid out.
  const cPlan = parseFiles(concept.files).find((f) => f.kind === "plan") ?? parseFiles(concept.files).find((f) => f.kind === "image");
  const conceptImg = cPlan ? await asImage(cPlan.id).catch(() => null) : null;

  const rooms = parseRooms(concept.rooms);
  const text = [
    `TENANCY: ${[lease.tenancy, lease.premises, lease.centre, lease.suburb].filter(Boolean).join(", ")}`,
    `Lease says: ${lease.sizeSqm ? `${lease.sizeSqm} sqm` : "area not given"}; permitted use ${lease.permittedUse ?? "not given"}; term ${lease.termYears ?? "?"} yrs; expiry ${expiryOf(lease) ?? "?"}.`,
    `Client: ${lease.client?.name ?? "not linked"}${lease.client?.type ? ` (${lease.client.type})` : ""}.`,
    `Lease notes: ${lease.notes ?? "none"}`,
    ``,
    `CONCEPT: ${concept.name}${concept.practiceType ? ` (${concept.practiceType})` : ""}. Designed for ${concept.minSqm ?? "?"}–${concept.maxSqm ?? "?"} sqm.`,
    `Design narrative and key design moves:\n${concept.description ?? "none given"}`,
    `Finishes: ${concept.finishes ?? "none given"}`,
    `Room schedule (${Math.round(roomsTotal(rooms))} sqm of rooms before circulation):`,
    ...(rooms.length ? rooms.map((r) => `- ${r.qty} x ${r.name}${r.areaSqm ? ` @ ${r.areaSqm} sqm` : ""}${r.notes ? ` (${r.notes})` : ""}`) : ["- (no schedule given: propose one that suits the practice type)"]),
    brief ? `\nEXTRA INSTRUCTIONS FROM THE TEAM: ${brief}` : "",
    `\nImage 1 is the tenancy floor plan (${planImg.name}).${conceptImg ? ` Image 2 is the concept's own floor plan (${conceptImg.name}): the layout to recreate in this tenancy.` : " (No concept floor plan image: work from the schedule and design moves.)"}`,
  ].join("\n");

  const parts: AiPart[] = [{ type: "text", text }, { type: "image", dataUrl: planImg.dataUrl }];
  if (conceptImg) parts.push({ type: "image", dataUrl: conceptImg.dataUrl });

  let result: FitResult | null = null; let error: string | null = null; let model = ai.visionModel;
  try {
    const r = await aiChat({ system: SYSTEM, messages: [{ role: "user", content: parts }], vision: true, json: true, maxTokens: 8000, timeoutMs: 180000 });
    model = r.model;
    result = clean(jsonFrom<FitResult>(r.text));
  } catch (e) { error = (e as Error).message.slice(0, 500); }

  return prisma.conceptFit.create({ data: { leaseId, conceptId, brief: brief || null, model, createdBy: by, status: result ? "done" : "error", result: result ? JSON.stringify(result) : null, error } });
}

/** Keep only sensible numbers so the drawing can't break. */
function clean(r: FitResult): FitResult {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v));
  const rooms = (Array.isArray(r.rooms) ? r.rooms : [])
    .map((x) => ({ ...x, x: n(x.x), y: n(x.y), w: n(x.w), h: n(x.h) }))
    .filter((x) => [x.x, x.y, x.w, x.h].every(Number.isFinite) && x.w > 0 && x.h > 0);
  return { ...r, rooms };
}
