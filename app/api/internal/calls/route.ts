import type { NextRequest } from "next/server";
import type { CallListItem } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  BRAND_LABEL, appUrl, asList, assertInternalAuth, bool, compact, dateOnly, dateTime, int, jsonErr, jsonOk, normBrand, pick, readJson, str,
} from "@/lib/internal-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTACT_TYPES = ["DESIGNER", "LEASING_AGENT", "LANDLORD", "CLIENT"];

function callOut(c: CallListItem & { setter?: { name: string } | null }, base: string) {
  return {
    id: c.id,
    externalId: c.externalId,
    leadName: c.leadName,
    company: c.company,
    phone: c.phone,
    email: c.email,
    business: c.business,
    businessLabel: c.business === "DR" ? BRAND_LABEL.DR : BRAND_LABEL.ENP,
    contactType: c.contactType,
    leadInfo: c.leadInfo,
    assignedSetter: c.assignedSetter,
    setterId: c.setterId,
    setterName: c.setter?.name ?? c.assignedSetter ?? null,
    callStatus: c.callStatus,
    attempts: c.attempts,
    appointment: c.appointment,
    lastCalled: c.lastCalled,
    callNotes: c.callNotes,
    addedToCrm: c.addedToCrm,
    leadId: c.leadId,
    slotId: c.slotId,
    possibleDuplicate: c.possibleDuplicate,
    duplicateNote: c.duplicateNote,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    crmUrl: `${base}/calls/${c.id}`,
  };
}

/** GET /api/internal/calls?business=ENP|DR&status=Appointment%20Set&limit=200 */
export async function GET(req: NextRequest) {
  const denied = assertInternalAuth(req);
  if (denied) return denied;
  const sp = req.nextUrl.searchParams;
  const bq = sp.get("business")?.trim();
  const business = bq && bq.toUpperCase() !== "ALL" ? normBrand(bq) : null;
  if (bq && bq.toUpperCase() !== "ALL" && business !== "ENP" && business !== "DR") return jsonErr("business must be ENP | DR", 400);
  const status = sp.get("status")?.trim();
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 200, 1), 200);
  let rows = await prisma.callListItem.findMany({
    where: business ? { business } : {},
    include: { setter: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
  });
  if (status) rows = rows.filter((c) => c.callStatus.toLowerCase() === status.toLowerCase());
  rows = rows.slice(0, limit);
  const base = appUrl();
  return jsonOk({ appUrl: base, count: rows.length, calls: rows.map((c) => callOut(c, base)) });
}

async function resolveId(model: "lead" | "freeSlot" | "setter", v: string | null | undefined) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const where = { OR: [{ id: v }, { externalId: v }] };
  const hit =
    model === "lead" ? await prisma.lead.findFirst({ where, select: { id: true } })
    : model === "freeSlot" ? await prisma.freeSlot.findFirst({ where, select: { id: true } })
    : await prisma.setter.findFirst({ where, select: { id: true } });
  if (!hit) throw new Error(`${model} not found: ${v}`);
  return hit.id;
}

/** POST { calls: [...] } — upsert by externalId (or update by id; else create). */
export async function POST(req: NextRequest) {
  const denied = assertInternalAuth(req);
  if (denied) return denied;
  const items = asList(await readJson(req), "calls");
  if (!items || !items.length) return jsonErr("Body must be { calls: [...] } or a call object", 400);
  if (items.length > 1000) return jsonErr("Max 1000 calls per request", 413);

  const base = appUrl();
  const results: Record<string, unknown>[] = [];
  let created = 0, updated = 0, failed = 0;

  for (const [i, o] of items.entries()) {
    try {
      if (!o || typeof o !== "object") throw new Error("call must be an object");
      const p = (...k: string[]) => pick(o, ...k);
      const externalId = str(p("externalId", "airtableId", "Airtable ID")) ?? null;
      const id = str(p("id")) ?? null;

      const rawBiz = p("business", "Business", "brand");
      let business: string | undefined;
      if (rawBiz !== undefined && rawBiz !== null && rawBiz !== "") {
        const b = normBrand(rawBiz);
        if (b !== "ENP" && b !== "DR") throw new Error(`business must be ENP | DR (got "${String(rawBiz)}")`);
        business = b;
      }
      const rawCt = str(p("contactType", "Contact Type"));
      let contactType: string | undefined;
      if (rawCt) {
        const ct = rawCt.toUpperCase().replace(/[\s-]+/g, "_");
        if (!CONTACT_TYPES.includes(ct)) throw new Error(`contactType must be one of ${CONTACT_TYPES.join(", ")}`);
        contactType = ct;
      }

      const assignedSetter = str(p("assignedSetter", "Assigned Setter"));
      let setterId = await resolveId("setter", str(p("setterId")));
      if (setterId === undefined && assignedSetter) {
        const all = await prisma.setter.findMany({ select: { id: true, name: true } });
        setterId = all.find((s) => s.name.trim().toLowerCase() === assignedSetter.trim().toLowerCase())?.id;
      }

      const data = compact({
        leadName: str(p("leadName", "Lead Name", "name", "Name")),
        company: str(p("company", "Company")),
        phone: str(p("phone", "Phone")),
        email: str(p("email", "Email")),
        business,
        contactType,
        leadInfo: str(p("leadInfo", "Lead Info")),
        assignedSetter,
        setterId,
        callStatus: str(p("callStatus", "Call Status", "status")) ?? undefined,
        attempts: int(p("attempts", "Attempts")) ?? undefined,
        appointment: dateTime(p("appointment", "Appointment")),
        lastCalled: dateOnly(p("lastCalled", "Last Called")),
        callNotes: str(p("callNotes", "Call Notes", "notes")),
        addedToCrm: bool(p("addedToCrm", "Added to CRM")),
        leadId: await resolveId("lead", str(p("leadId"))),
        slotId: await resolveId("freeSlot", str(p("slotId"))),
        possibleDuplicate: bool(p("possibleDuplicate", "Possible Duplicate")),
        duplicateNote: str(p("duplicateNote", "Duplicate Note")),
      });

      const existing = externalId
        ? await prisma.callListItem.findUnique({ where: { externalId } })
        : id ? await prisma.callListItem.findUnique({ where: { id } }) : null;
      if (id && !externalId && !existing) throw new Error(`no call with id ${id}`);

      const include = { setter: { select: { name: true } } };
      if (existing) {
        const row = await prisma.callListItem.update({ where: { id: existing.id }, data, include });
        updated++;
        results.push({ index: i, action: "updated", call: callOut(row, base) });
      } else {
        const row = await prisma.callListItem.create({ data: { ...data, externalId }, include });
        created++;
        results.push({ index: i, action: "created", call: callOut(row, base) });
      }
    } catch (e) {
      failed++;
      results.push({ index: i, action: "error", error: e instanceof Error ? e.message.split("\n").pop() : String(e) });
    }
  }
  return jsonOk({ created, updated, failed, results }, failed && !created && !updated ? 400 : 200);
}
