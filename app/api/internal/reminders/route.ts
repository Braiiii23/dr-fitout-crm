import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { appUrl, isInternalAuthorised as authorised } from "@/lib/internal-api";

export const runtime = "nodejs";

/** GET pending ReminderRequest rows for Anita / Grok Bot routine. */
export async function GET(req: NextRequest) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const rows = await prisma.reminderRequest.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  const base = appUrl();
  return NextResponse.json({
    ok: true,
    appUrl: base,
    reminders: rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      dueString: r.dueString,
      leadId: r.leadId,
      callId: r.callId,
      company: r.company,
      brand: r.brand === "DR" ? "DR Fitout" : r.brand,
      source: r.source,
      createdAt: r.createdAt,
      crmLinks: {
        call: r.callId ? `${base}/calls/${r.callId}` : null,
        lead: r.leadId ? `${base}/leads/enp` : null,
        dashboard: `${base}/dashboard`,
      },
    })),
  });
}

/** POST { ids: string[] } marks pending reminders delivered to Anita (status done). */
export async function POST(req: NextRequest) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  let body: { ids?: string[]; mark?: "done" | "todoist"; todoistTaskId?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === "string") : [];
  if (!ids.length) {
    return NextResponse.json({ error: "ids required" }, { status: 400 });
  }
  const status = body.mark === "todoist" ? "todoist" : "done";
  await prisma.reminderRequest.updateMany({
    where: { id: { in: ids }, status: "pending" },
    data: {
      status,
      ...(body.todoistTaskId ? { todoistTaskId: body.todoistTaskId } : {}),
    },
  });
  return NextResponse.json({ ok: true, updated: ids.length, status });
}
