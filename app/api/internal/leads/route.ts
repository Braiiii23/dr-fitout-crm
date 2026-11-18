import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { appUrl, asList, assertInternalAuth, jsonErr, jsonOk, normBrand, pick, readJson, str } from "@/lib/internal-api";
import { isSignedLead, leadOut, mapLeadInput, resolveSetterId } from "@/lib/internal-leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/internal/leads?brand=ENP|DR|CONSULTING|ALL&stage=Quoting&signed=1&limit=500 */
export async function GET(req: NextRequest) {
  const denied = assertInternalAuth(req);
  if (denied) return denied;
  const sp = req.nextUrl.searchParams;
  const brandQ = (sp.get("brand") || "ALL").trim();
  const brand = brandQ.toUpperCase() === "ALL" ? null : normBrand(brandQ);
  if (brandQ.toUpperCase() !== "ALL" && !brand) return jsonErr("brand must be ENP | DR | CONSULTING | ALL", 400);
  const stage = sp.get("stage")?.trim();
  const signed = ["1", "true", "yes"].includes((sp.get("signed") || "").toLowerCase());
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 1000, 1), 5000);

  let rows = await prisma.lead.findMany({
    where: brand ? { brand } : {},
    include: { setter: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
  });
  if (stage) rows = rows.filter((l) => (l.stage || "").toLowerCase() === stage.toLowerCase());
  if (signed) rows = rows.filter(isSignedLead);
  rows = rows.slice(0, limit);
  const base = appUrl();
  return jsonOk({ appUrl: base, count: rows.length, leads: rows.map((l) => leadOut(l, base)) });
}

/** POST { leads: [...] } | [...] | {...}. Upsert on externalId when given, else create (or update by `id`). */
export async function POST(req: NextRequest) {
  const denied = assertInternalAuth(req);
  if (denied) return denied;
  const body = await readJson(req);
  const items = asList(body, "leads");
  if (!items || !items.length) return jsonErr("Body must be { leads: [...] } or a lead object", 400);
  if (items.length > 1000) return jsonErr("Max 1000 leads per request", 413);

  const base = appUrl();
  const results: Record<string, unknown>[] = [];
  let created = 0, updated = 0, failed = 0;

  for (const [i, item] of items.entries()) {
    try {
      if (!item || typeof item !== "object") throw new Error("lead must be an object");
      const externalId = str(pick(item, "externalId", "airtableId", "Airtable ID", "recordId")) ?? null;
      const id = str(pick(item, "id")) ?? null;
      const { brand, rawBrand, data, setterId: rawSetterId } = mapLeadInput(item);
      if (rawBrand !== undefined && !brand) throw new Error(`unknown brand "${String(rawBrand)}" (use ENP | DR | CONSULTING)`);
      const setterId = await resolveSetterId(rawSetterId, data.appointmentSetter);
      const write = { ...data, ...(brand ? { brand } : {}), ...(setterId ? { setterId } : {}) };

      const existing = externalId
        ? await prisma.lead.findUnique({ where: { externalId } })
        : id
          ? await prisma.lead.findUnique({ where: { id } })
          : null;
      if (id && !externalId && !existing) throw new Error(`no lead with id ${id}`);

      let row;
      if (existing) {
        row = await prisma.lead.update({ where: { id: existing.id }, data: write, include: { setter: { select: { name: true } } } });
        updated++;
        results.push({ index: i, action: "updated", lead: leadOut(row, base) });
      } else {
        if (!brand) throw new Error("brand is required to create a lead");
        row = await prisma.lead.create({ data: { ...write, brand, externalId }, include: { setter: { select: { name: true } } } });
        created++;
        results.push({ index: i, action: "created", lead: leadOut(row, base) });
      }
    } catch (e) {
      failed++;
      results.push({ index: i, action: "error", error: e instanceof Error ? e.message.split("\n").pop() : String(e) });
    }
  }
  return jsonOk({ created, updated, failed, results }, failed && !created && !updated ? 400 : 200);
}
