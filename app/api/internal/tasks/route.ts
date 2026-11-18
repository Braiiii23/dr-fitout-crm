import { prisma } from "@/lib/db";
import { assertInternalAuth, jsonOk, jsonErr, readJson } from "@/lib/internal-api";
import { BRAIDEN_EMAIL } from "@/lib/auth";
import { importTasks, type ImportRow } from "@/lib/task-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/internal/tasks  { tasks: [...], dryRun?: boolean, user?: email }
 *  Upserts on externalId (per person; default person = Braiden). Re-runs never duplicate.
 *  Returns created / updated / unchanged counts and per-row errors. dryRun checks everything and saves nothing. */
export async function POST(req: Request) {
  const denied = assertInternalAuth(req); if (denied) return denied;
  const b = await readJson<{ tasks?: ImportRow[]; dryRun?: boolean; user?: string }>(req);
  if (!b || !Array.isArray(b.tasks)) return jsonErr("Send { tasks: [...] }");
  if (b.tasks.length > 2000) return jsonErr("At most 2000 tasks per request");
  const r = await importTasks(b.tasks, { dryRun: b.dryRun === true, user: b.user });
  return jsonOk({ dryRun: b.dryRun === true, received: b.tasks.length, created: r.created, updated: r.updated, unchanged: r.unchanged, errors: r.errors });
}

/** GET /api/internal/tasks?prefix=todoist:&user=email  — tasks whose externalId starts with the prefix. */
export async function GET(req: Request) {
  const denied = assertInternalAuth(req); if (denied) return denied;
  const sp = new URL(req.url).searchParams;
  const prefix = sp.get("prefix") ?? "";
  const email = (sp.get("user") ?? BRAIDEN_EMAIL).toLowerCase();
  const u = await prisma.user.findFirst({ where: { email }, select: { id: true } });
  if (!u) return jsonErr("No user with that email", 404);
  const rows = await prisma.todo.findMany({ where: { userId: u.id, externalId: prefix ? { startsWith: prefix } : { not: null } }, orderBy: [{ done: "asc" }, { date: "asc" }], take: 5000 });
  const byId = new Map(rows.map((t) => [t.id, t.externalId]));
  return jsonOk({ count: rows.length, tasks: rows.map((t) => ({
    externalId: t.externalId, id: t.id, title: t.text, description: t.description, dueDate: t.date, time: t.time, deadline: t.deadline, repeat: t.recurrence,
    priority: `P${t.priority}`, project: t.project, section: t.section, labels: (t.labels ?? "").split(",").filter(Boolean),
    parentExternalId: t.parentId ? byId.get(t.parentId) ?? null : null, status: t.done ? "completed" : "open", completedAt: t.doneAt, source: t.source,
  })) });
}
