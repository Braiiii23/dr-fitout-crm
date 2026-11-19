"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/automations";
import { saveFile } from "@/lib/files";
import { parseFiles } from "@/lib/concepts";
import { EST_FILE_KINDS, runAiEstimate, applyAiEstimate } from "@/lib/estimate-ai";

const EDITORS = ["ADMIN", "ESTIMATOR", "ACCOUNTS"] as const;
const enc = encodeURIComponent;
const back = (id: string, k: "msg" | "err", t: string, hash = "ai-estimate"): never => redirect(`/estimating/${id}?${k}=${enc(t)}#${hash}`);
async function job(id: string) {
  const l = await prisma.lead.findUnique({ where: { id }, select: { id: true, brand: true, estFiles: true } });
  if (!l || (l.brand !== "DR" && l.brand !== "ENP")) throw new Error("Job not found");
  return l;
}

export async function uploadEstFiles(fd: FormData) {
  const u = await requireUser([...EDITORS]);
  const id = String(fd.get("id") ?? "");
  const kind = EST_FILE_KINDS.includes(String(fd.get("kind"))) ? String(fd.get("kind")) : "other";
  const l = await job(id);
  const list = parseFiles(l.estFiles);
  let n = 0;
  try {
    for (const f of fd.getAll("files")) {
      if (!(f instanceof File) || !f.size) continue;
      const saved = await saveFile(f.name, Buffer.from(await f.arrayBuffer()));
      list.push({ id: saved.id, name: f.name, kind, added: new Date().toISOString().slice(0, 10), type: f.type }); n++;
    }
  } catch (e) { back(id, "err", (e as Error).message); }
  if (!n) back(id, "err", "Choose at least one file.");
  await prisma.lead.update({ where: { id }, data: { estFiles: JSON.stringify(list) } });
  await audit(u.email, "estimate files uploaded", "Lead", id, `${kind} ×${n}`);
  revalidatePath(`/estimating/${id}`);
  back(id, "msg", `Uploaded ${n} file${n === 1 ? "" : "s"}.`);
}

export async function removeEstFile(fd: FormData) {
  const u = await requireUser([...EDITORS]);
  const id = String(fd.get("id") ?? ""); const fileId = String(fd.get("fileId") ?? "");
  const l = await job(id);
  await prisma.lead.update({ where: { id }, data: { estFiles: JSON.stringify(parseFiles(l.estFiles).filter((f) => f.id !== fileId)) } });
  await audit(u.email, "estimate file removed", "Lead", id, fileId);
  revalidatePath(`/estimating/${id}`);
  back(id, "msg", "File removed.");
}

export async function runEstimate(fd: FormData) {
  const u = await requireUser([...EDITORS]);
  const id = String(fd.get("id") ?? "");
  await job(id);
  try {
    const e = await runAiEstimate(id, { conceptId: String(fd.get("conceptId") ?? "") || null, brief: String(fd.get("brief") ?? ""), by: u.name });
    await audit(u.email, "AI estimate", "Lead", id, `$${e.cost} cost · ${e.trades.length} trades · ${e.confidence}`);
  } catch (e) { back(id, "err", `The AI estimate didn't finish: ${(e as Error).message}`); }
  revalidatePath(`/estimating/${id}`);
  back(id, "msg", "Estimate ready. Check it below, then press Use this estimate.");
}

export async function applyEstimate(fd: FormData) {
  const u = await requireUser([...EDITORS]);
  const id = String(fd.get("id") ?? "");
  await job(id);
  let r: Awaited<ReturnType<typeof applyAiEstimate>>;
  try { r = await applyAiEstimate(id, { setQuote: fd.get("setQuote") === "on", by: u.name }); }
  catch (e) { return back(id, "err", (e as Error).message); }
  await audit(u.email, "AI estimate used", "Lead", id, `${r.trades} trades, ${r.scope} scope items`);
  revalidatePath(`/estimating/${id}`); revalidatePath("/estimating");
  redirect(`/estimating/${id}/sheet?msg=${enc(`Estimate sheet filled: ${r.lines} lines across ${r.trades} bands, ${r.scope} new scope items, and the trade pack updated.`)}`);
}

export async function saveRateNotes(fd: FormData) {
  const u = await requireUser(["ADMIN", "ESTIMATOR"]);
  const id = String(fd.get("id") ?? "");
  const notes = String(fd.get("estRateNotes") ?? "").trim().slice(0, 20000) || null;
  await prisma.accountsSettings.upsert({ where: { id: "settings" }, update: { estRateNotes: notes }, create: { id: "settings", estRateNotes: notes } });
  await audit(u.email, "estimating house rates saved", "AccountsSettings", "settings");
  revalidatePath(`/estimating/${id}`);
  back(id, "msg", "House rates saved. They're used in every AI estimate.");
}
