import { prisma } from "@/lib/db";
import { assertInternalAuth, jsonOk, jsonErr, readJson } from "@/lib/internal-api";
import { bneToday } from "@/lib/myday";
import { completeTask, uncompleteTask, validRepeat, finishedOn } from "@/lib/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Tasks for an assistant (e.g. the one that runs Todoist today). Auth: CRM_HOOK_SECRET.
// Tasks are matched by `id` (CRM) or `externalId` (e.g. the Todoist id) + user, so updates never create copies.

const userBy = (email: string) => prisma.user.findFirst({ where: { email: email.trim().toLowerCase(), active: true }, select: { id: true, name: true, email: true } });
const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const out = (t: Awaited<ReturnType<typeof prisma.todo.findFirst>>) => t && ({
  id: t.id, externalId: t.externalId, title: t.text, description: t.description, project: t.project, section: t.section,
  due: t.date, time: t.time, deadline: t.deadline, recurrence: t.recurrence, priority: t.priority,
  labels: (t.labels ?? "").split(",").filter(Boolean), parentId: t.parentId, completed: t.done, completedAt: t.doneAt, updatedAt: t.updatedAt,
});

/** GET ?user=email → that person's open tasks (with subtasks) and what they finished today.
 *  GET ?finished=YYYY-MM-DD[&user=email] → completions that day (everyone, or one person), for the team email. */
export async function GET(req: Request) {
  const denied = assertInternalAuth(req); if (denied) return denied;
  const sp = new URL(req.url).searchParams;
  if (sp.get("finished")) {
    const date = isDate(sp.get("finished")) ? sp.get("finished")! : bneToday();
    const u = sp.get("user") ? await userBy(sp.get("user")!) : null;
    if (sp.get("user") && !u) return jsonErr("No active user with that email", 404);
    const rows = await finishedOn(u?.id ?? null, date);
    const names = new Map((await prisma.user.findMany({ select: { id: true, name: true } })).map((x) => [x.id, x.name]));
    return jsonOk({ date, finished: rows.map((r) => ({ taskId: r.todoId, title: r.title, project: r.project, dueDate: r.dueDate, completedAt: r.completedAt, person: names.get(r.userId) ?? r.userId })) });
  }
  const email = sp.get("user"); if (!email) return jsonErr("user (email) is required");
  const u = await userBy(email); if (!u) return jsonErr("No active user with that email", 404);
  const tasks = await prisma.todo.findMany({ where: { userId: u.id, done: false }, orderBy: [{ date: "asc" }, { priority: "asc" }] });
  const finished = await finishedOn(u.id);
  return jsonOk({ user: u.email, today: bneToday(), tasks: tasks.map(out), finishedToday: finished.map((r) => ({ taskId: r.todoId, title: r.title, project: r.project, completedAt: r.completedAt })) });
}

/** POST { user, id? | externalId?, title, description, project, section, due, time, deadline, recurrence, priority, labels, parentId | parentExternalId, completed?, delete? }
 *  Creates the task if no match, otherwise updates that same task. `completed: true` ticks it off (repeating tasks move on). */
export async function POST(req: Request) {
  const denied = assertInternalAuth(req); if (denied) return denied;
  const b = await readJson<Record<string, unknown>>(req); if (!b) return jsonErr("Send JSON");
  const u = typeof b.user === "string" ? await userBy(b.user) : null; if (!u) return jsonErr("user (an active user's email) is required", 404);
  const ext = typeof b.externalId === "string" ? b.externalId.slice(0, 100) : null;
  const existing = typeof b.id === "string" ? await prisma.todo.findFirst({ where: { id: b.id, userId: u.id } })
    : ext ? await prisma.todo.findFirst({ where: { externalId: ext, userId: u.id } }) : null;
  if (b.delete === true) { if (existing) await prisma.todo.deleteMany({ where: { userId: u.id, OR: [{ id: existing.id }, { parentId: existing.id }] } }); return jsonOk({ deleted: !!existing }); }

  const str = (k: string, max = 300) => (typeof b[k] === "string" ? (b[k] as string).trim().slice(0, max) || null : undefined);
  const pr = typeof b.priority === "string" ? Number(String(b.priority).replace(/^p/i, "")) : Number(b.priority);
  const labels = Array.isArray(b.labels) ? (b.labels as unknown[]).map(String).map((x) => x.replace(/^@/, "").trim()).filter(Boolean).join(",") : str("labels");
  let parentId: string | null | undefined;
  if (typeof b.parentId === "string") parentId = (await prisma.todo.findFirst({ where: { id: b.parentId, userId: u.id } }))?.id ?? null;
  else if (typeof b.parentExternalId === "string") parentId = (await prisma.todo.findFirst({ where: { externalId: b.parentExternalId, userId: u.id } }))?.id ?? null;
  const data = {
    ...(str("title") !== undefined || str("text") !== undefined ? { text: (str("title") ?? str("text")) || "Task" } : {}),
    ...(str("description", 5000) !== undefined ? { description: str("description", 5000) } : {}),
    ...(str("project", 60) !== undefined ? { project: str("project", 60) } : {}),
    ...(str("section", 60) !== undefined ? { section: str("section", 60) } : {}),
    ...("due" in b ? { date: isDate(b.due) ? (b.due as string) : null } : {}),
    ...("time" in b ? { time: typeof b.time === "string" && /^\d{2}:\d{2}$/.test(b.time) ? b.time : null } : {}),
    ...("deadline" in b ? { deadline: isDate(b.deadline) ? (b.deadline as string) : null } : {}),
    ...("recurrence" in b ? { recurrence: validRepeat(typeof b.recurrence === "string" ? b.recurrence : null) } : {}),
    ...([1, 2, 3, 4].includes(pr) ? { priority: pr } : {}),
    ...(labels !== undefined ? { labels: labels || null } : {}),
    ...(parentId !== undefined ? { parentId } : {}),
  };
  let task = existing
    ? await prisma.todo.update({ where: { id: existing.id }, data: { ...data, ...(ext ? { externalId: ext } : {}) } })
    : await prisma.todo.create({ data: { text: "Task", date: bneToday(), ...data, externalId: ext, userId: u.id, source: "assistant" } });
  if (b.completed === true && !task.done) task = (await completeTask(task.id, u.id)) ?? task;
  if (b.completed === false && task.done) task = (await uncompleteTask(task.id, u.id)) ?? task;
  return jsonOk({ created: !existing, task: out(task) }, existing ? 200 : 201);
}
