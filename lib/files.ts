import "server-only";
import { mkdir, writeFile, readFile } from "fs/promises";
import { join } from "path";
import { randomBytes } from "crypto";

// Files attached to leads (quotes, plans) live on the storage disk next to the database.
const dir = () => join(process.env.DATA_DIR || "./data-local", "files");
export const ALLOWED: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  dwg: "application/acad", dxf: "application/dxf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", zip: "application/zip",
};
export const MAX_BYTES = 25 * 1024 * 1024;
export const safeName = (n: string) => n.replace(/[^A-Za-z0-9._ -]+/g, "_").slice(0, 120) || "file";

export async function saveFile(name: string, data: Buffer) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED[ext]) throw new Error(`File type .${ext} isn't allowed (pdf, png, jpg, webp, dwg, dxf, docx, xlsx, zip).`);
  if (data.length > MAX_BYTES) throw new Error("File is over 25 MB.");
  const id = randomBytes(12).toString("hex");
  await mkdir(dir(), { recursive: true });
  await writeFile(join(dir(), `${id}.bin`), data);
  await writeFile(join(dir(), `${id}.json`), JSON.stringify({ name: safeName(name), type: ALLOWED[ext] }));
  return { id, url: `/files/${id}` };
}

export async function loadFile(id: string) {
  if (!/^[a-f0-9]{24}$/.test(id)) return null;
  try {
    const meta = JSON.parse(await readFile(join(dir(), `${id}.json`), "utf8")) as { name: string; type: string };
    return { meta, data: await readFile(join(dir(), `${id}.bin`)) };
  } catch { return null; }
}
