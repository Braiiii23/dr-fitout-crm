import "server-only";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, readdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { prisma } from "./db";
import { aiChat, jsonFrom, type AiPart } from "./ai";
import { saveFile } from "./files";
import { CLIENT_TYPES } from "./leases";
import type { Room, StoredFile } from "./concepts";

const run = promisify(execFile);

const SYSTEM = `You read DR Fitout concept design packages (A3 PDFs: cover, brief and design narrative, concept floor plan with key design moves, renders, room schedule, finishes intent, compliance flags, open questions)
and turn them into a concept record for the company's concept library. Copy facts from the package; never invent rooms, sizes or finishes.
JSON shape:
{"name": string (the concept title, e.g. "High-End GP Clinic"),
 "practiceType": one of ${JSON.stringify(CLIENT_TYPES)},
 "designedForSqm": number | null (the assumed tenancy area),
 "description": string (2-4 sentence design narrative, the assumed tenancy size and shape, then a "KEY DESIGN MOVES" list with one "- " line per move, including zoning, adjacencies, corridor widths and exits),
 "finishes": string (materials, lighting and acoustics intent, condensed),
 "compliance": string (the key compliance and buildability flags, condensed to one paragraph),
 "tags": string (comma-separated: practice type, style words, room highlights, revision),
 "rooms": [{"name": string, "qty": number, "areaSqm": number, "notes": string (zone; size like "4.5 x 3.2"; key fit-out notes)}]}
Rooms: every room in the room schedule EXCEPT corridors / circulation. Group identical rooms (e.g. six 14.4 m² consults = qty 6). Use the schedule's m² (average when grouped).`;

/** Turns an uploaded concept package PDF into a Concept, using Claude to read it. */
export async function importConceptPackage(pdf: Buffer, fileName: string, by: string) {
  const dir = await mkdtemp(join(tmpdir(), "pkg-"));
  try {
    await writeFile(join(dir, "in.pdf"), pdf);
    const pages = Number(/Pages:\s+(\d+)/.exec((await run("pdfinfo", [join(dir, "in.pdf")])).stdout)?.[1] ?? 0);
    if (!pages) throw new Error("That PDF couldn't be read. Is it complete? Try uploading it again.");
    const pageText: string[] = [];
    for (let p = 1; p <= Math.min(pages, 40); p++) pageText.push((await run("pdftotext", ["-layout", "-f", String(p), "-l", String(p), join(dir, "in.pdf"), "-"], { maxBuffer: 20e6 })).stdout);
    // The concept floor plan page, and the first render page (cover is page 1).
    const planPage = (pageText.findIndex((t, i) => i > 0 && /^\s*\d+\s*\/\s*(CONCEPT\s+)?(\w+\s+)?FLOOR PLAN/im.test(t)) + 1) || (pageText.findIndex((t, i) => i > 0 && /FLOOR PLAN/i.test(t.slice(0, 400))) + 1) || Math.min(3, pages);
    const renderPage = (pageText.findIndex((t, i) => i > 2 && /RENDER/i.test(t.slice(0, 600))) + 1) || 0;
    const render = async (p: number, fmt: "png" | "jpeg", stem: string) => {
      await run("pdftoppm", [`-${fmt}`, "-f", String(p), "-l", String(p), "-scale-to", "1568", join(dir, "in.pdf"), join(dir, stem)], { timeout: 90000 });
      const n = (await readdir(dir)).find((x) => x.startsWith(stem));
      return n ? readFile(join(dir, n)) : null;
    };
    const [cover, plan, rend] = await Promise.all([render(1, "jpeg", "cover"), render(planPage, "png", "plan"), renderPage ? render(renderPage, "jpeg", "render") : Promise.resolve(null)]);

    const text = pageText.map((t, i) => `===== PAGE ${i + 1} =====\n${t.replace(/[ \t]{3,}/g, "  ")}`).join("\n").slice(0, 120000);
    const parts: AiPart[] = [{ type: "text", text: `Package file: ${fileName}\n\n${text}\n\nThe image is the concept floor plan (page ${planPage}).` }];
    if (plan) parts.push({ type: "image", dataUrl: `data:image/png;base64,${plan.toString("base64")}` });
    const { text: reply } = await aiChat({ feature: "conceptImport", system: SYSTEM, messages: [{ role: "user", content: parts }], json: true, vision: true, effort: "medium", maxTokens: 32000, timeoutMs: 270000 });
    const c = jsonFrom<{ name?: string; practiceType?: string; designedForSqm?: number | null; description?: string; finishes?: string; compliance?: string; tags?: string; rooms?: Room[] }>(reply);

    const files: StoredFile[] = [];
    const today = new Date().toISOString().slice(0, 10);
    const keep = async (data: Buffer | null, name: string, kind: string, type: string) => { if (!data) return; const s = await saveFile(name, data); files.push({ id: s.id, name, kind, added: today, type }); };
    const title = (c.name ?? fileName.replace(/\.pdf$/i, "")).slice(0, 120);
    await keep(cover, `${title} – cover.jpg`, "image", "image/jpeg");
    await keep(plan, `${title} – concept floor plan.png`, "plan", "image/png");
    await keep(rend, `${title} – render.jpg`, "image", "image/jpeg");
    await keep(pdf, fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`, "package", "application/pdf");

    const sqm = typeof c.designedForSqm === "number" && c.designedForSqm > 0 ? c.designedForSqm : null;
    const rooms = (Array.isArray(c.rooms) ? c.rooms : []).filter((r) => r && r.name).map((r) => ({ name: String(r.name), qty: Math.max(1, Number(r.qty) || 1), areaSqm: Number(r.areaSqm) || null, ...(r.notes ? { notes: String(r.notes) } : {}) }));
    return prisma.concept.create({ data: {
      name: title, practiceType: CLIENT_TYPES.includes(String(c.practiceType)) ? String(c.practiceType) : null, status: "Ready",
      // A working range around the size it was designed for (edit on the concept page).
      minSqm: sqm ? Math.round(sqm * 0.8) : null, maxSqm: sqm ? Math.round(sqm * 1.2) : null,
      description: [c.description, c.compliance ? `\nCOMPLIANCE FLAGS\n${c.compliance}` : ""].filter(Boolean).join("\n").slice(0, 20000) || null,
      finishes: c.finishes?.slice(0, 8000) ?? null, tags: c.tags?.slice(0, 500) ?? null,
      rooms: JSON.stringify(rooms), files: JSON.stringify(files), createdBy: by,
    } });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
