import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { assertInternalAuth, jsonOk } from "@/lib/internal-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/internal/setters?status=Active */
export async function GET(req: NextRequest) {
  const denied = assertInternalAuth(req);
  if (denied) return denied;
  const status = req.nextUrl.searchParams.get("status")?.trim();
  const rows = await prisma.setter.findMany({
    where: status ? { status } : {},
    select: { id: true, externalId: true, name: true, email: true, phone: true, status: true },
    orderBy: { name: "asc" },
  });
  return jsonOk({ count: rows.length, setters: rows });
}
