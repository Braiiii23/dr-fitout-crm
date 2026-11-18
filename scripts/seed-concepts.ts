// Runs on every start: loads the concept packages in seed/concepts/<folder>/ into the Concepts library
// the first time (skips any concept whose name is already there). Each folder: concept.json + thumb.jpg,
// plan-*.png (the concept floor plan the AI recreates), render-*.jpg and package.pdf.
import { PrismaClient } from "@prisma/client";
import { readdir, readFile, mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { randomBytes } from "crypto";

const prisma = new PrismaClient();
const filesDir = join(process.env.DATA_DIR || "./data-local", "files");
const TYPES: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };

async function store(path: string, name: string) {
  const id = randomBytes(12).toString("hex");
  const type = TYPES[name.split(".").pop()!.toLowerCase()];
  await writeFile(join(filesDir, `${id}.bin`), await readFile(path));
  await writeFile(join(filesDir, `${id}.json`), JSON.stringify({ name, type }));
  return { id, type };
}

async function main() {
  const root = join(process.cwd(), "seed", "concepts");
  const folders = await readdir(root).catch(() => [] as string[]);
  await mkdir(filesDir, { recursive: true });
  for (const f of folders) {
    const dir = join(root, f);
    const c = JSON.parse(await readFile(join(dir, "concept.json"), "utf8"));
    if (await prisma.concept.findFirst({ where: { name: c.name } })) continue;
    const names = (await readdir(dir)).sort();
    const pick = (re: RegExp) => names.filter((n) => re.test(n));
    const order: [string, string][] = [
      ...pick(/^thumb\./).map((n) => [n, "image"] as [string, string]),
      ...pick(/^plan/).map((n) => [n, "plan"] as [string, string]),
      ...pick(/^render/).map((n) => [n, "image"] as [string, string]),
      ...pick(/\.pdf$/).map((n) => [n, "package"] as [string, string]),
    ];
    const files = [];
    for (const [n, kind] of order) {
      const label = kind === "package" ? `${c.name} – concept package.pdf` : kind === "plan" ? `${c.name} – concept floor plan.png` : n === "thumb.jpg" ? `${c.name} – render.jpg` : `${c.name} – ${n}`;
      const s = await store(join(dir, n), label);
      files.push({ id: s.id, name: label, kind, added: new Date().toISOString().slice(0, 10), type: s.type });
    }
    const { rooms, ...rest } = c;
    await prisma.concept.create({ data: { ...rest, rooms: JSON.stringify(rooms), files: JSON.stringify(files), createdBy: "DR Fitout (seed)" } });
    console.log(`Concepts: loaded "${c.name}"`);
  }
}
main().catch((e) => console.error("concept seed skipped:", e.message)).finally(() => prisma.$disconnect());
