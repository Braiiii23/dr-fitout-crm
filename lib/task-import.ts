import "server-only";
import { prisma } from "./db";
import { BRAIDEN_EMAIL } from "./auth";
import { validRepeat } from "./tasks";

// Bulk task import (e.g. from Todoist). Upserts on externalId per person, so re-running never duplicates.
// Subtasks are linked by parentExternalId (parents are processed first). Completed tasks keep their history.

export type ImportRow = {
  externalId?: string; user?: string; title?: string; description?: string | null; dueDate?: string | null; time?: string | null;
  deadline?: string | null; repeat?: string | null; priority?: string | number | null; project?: string | null; section?: string | null;
  labels?: string[] | string | null; parentExternalId?: string | null; status?: "open" | "completed"; completedAt?: string | null; source?: string | null;
};
export type ImportResult = { created: number; updated: number; unchanged: number; errors: { index: number; externalId: string | null; error: string }[]; rows: { index: number; externalId: string; action: "created" | "updated" | "unchanged" }[] };

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const bneDate = (d: Date) => new Date(d.getTime() + 10 * 3600000).toISOString().slice(0, 10);

/** Turn one incoming row into task fields, or an error message. */
type Fields = { data: Record<string, unknown>; completedAt: Date | null; done: boolean };
function toFields(r: ImportRow): { error: string } | Fields {
  if (!r.externalId || typeof r.externalId !== "string") return { error: "externalId is required" };
  if (!r.title || !String(r.title).trim()) return { error: "title is required" };
  if (r.dueDate != null && r.dueDate !== "" && !isDate(r.dueDate)) return { error: "dueDate must be YYYY-MM-DD or null" };
  if (r.deadline != null && r.deadline !== "" && !isDate(r.deadline)) return { error: "deadline must be YYYY-MM-DD or null" };
  if (r.time != null && r.time !== "" && !/^\d{2}:\d{2}$/.test(String(r.time))) return { error: "time must be HH:MM or null" };
  const pr = r.priority == null || r.priority === "" ? 4 : Number(String(r.priority).replace(/^p/i, ""));
  if (![1, 2, 3, 4].includes(pr)) return { error: "priority must be P1–P4" };
  const repeat = r.repeat ? validRepeat(String(r.repeat)) : null;
  if (r.repeat && !repeat) return { error: `repeat "${r.repeat}" isn't a supported schedule (daily, weekdays, weekly, fortnightly, monthly, yearly, every N days)` };
  const status = r.status ?? "open";
  if (status !== "open" && status !== "completed") return { error: "status must be open or completed" };
  let completedAt: Date | null = null;
  if (status === "completed") {
    completedAt = r.completedAt ? new Date(r.completedAt) : new Date();
    if (Number.isNaN(completedAt.getTime())) return { error: "completedAt must be an ISO date-time" };
  }
  const labels = (Array.isArray(r.labels) ? r.labels : typeof r.labels === "string" ? r.labels.split(",") : []).map((l) => String(l).trim().replace(/^@/, "")).filter(Boolean).join(",") || null;
  const t = (v: unknown, max: number) => (v == null ? null : String(v).trim().slice(0, max) || null);
  return {
    done: status === "completed", completedAt,
    data: {
      text: String(r.title).trim().slice(0, 300), description: t(r.description, 5000), project: t(r.project, 60), section: t(r.section, 60),
      date: isDate(r.dueDate) ? r.dueDate : null, time: r.time ? String(r.time) : null, deadline: isDate(r.deadline) ? r.deadline : null,
      recurrence: repeat, priority: pr, labels, source: t(r.source, 30) ?? "import",
    },
  };
}

const SAME = ["text", "description", "project", "section", "date", "time", "deadline", "recurrence", "priority", "labels", "parentId", "done"] as const;

export async function importTasks(rows: ImportRow[], opts: { dryRun?: boolean; user?: string }): Promise<ImportResult> {
  const out: ImportResult = { created: 0, updated: 0, unchanged: 0, errors: [], rows: [] };
  const userCache = new Map<string, string | null>();
  const userId = async (email?: string) => {
    const e = (email ?? opts.user ?? BRAIDEN_EMAIL).trim().toLowerCase();
    if (!userCache.has(e)) userCache.set(e, (await prisma.user.findFirst({ where: { email: e, active: true }, select: { id: true } }))?.id ?? null);
    return userCache.get(e) ?? null;
  };
  // Parents before subtasks, so parentExternalId always resolves (to a row in this batch or one already in the CRM).
  const order = rows.map((r, i) => ({ r, i })).sort((a, b) => Number(!!a.r.parentExternalId) - Number(!!b.r.parentExternalId));
  const createdInRun = new Map<string, string>(); // `${userId}|${externalId}` → id (also used in dry runs)

  for (const { r, i } of order) {
    const res = toFields(r);
    if ("error" in res) { out.errors.push({ index: i, externalId: r.externalId ?? null, error: res.error }); continue; }
    const f = res as Fields;
    const uid = await userId(r.user);
    if (!uid) { out.errors.push({ index: i, externalId: r.externalId!, error: `no active user ${r.user ?? opts.user ?? BRAIDEN_EMAIL}` }); continue; }
    let parentId: string | null = null;
    if (r.parentExternalId) {
      parentId = createdInRun.get(`${uid}|${r.parentExternalId}`) ?? (await prisma.todo.findFirst({ where: { userId: uid, externalId: r.parentExternalId }, select: { id: true } }))?.id ?? null;
      if (!parentId) { out.errors.push({ index: i, externalId: r.externalId!, error: `parent ${r.parentExternalId} not found (include it in the batch or import it first)` }); continue; }
    }
    const data: Record<string, unknown> = { ...f.data, parentId, done: f.done, doneAt: f.done ? f.completedAt : null };
    const existing = await prisma.todo.findFirst({ where: { userId: uid, externalId: r.externalId! } });

    if (!existing) {
      out.created++; out.rows.push({ index: i, externalId: r.externalId!, action: "created" });
      if (opts.dryRun) { createdInRun.set(`${uid}|${r.externalId}`, `dry-${i}`); continue; }
      const t = await prisma.todo.create({ data: { ...(data as Record<string, unknown>), userId: uid, externalId: r.externalId! } as never });
      createdInRun.set(`${uid}|${r.externalId}`, t.id);
      if (f.done && f.completedAt) await prisma.todoCompletion.create({ data: { todoId: t.id, userId: uid, title: t.text, project: t.project, dueDate: t.date, completedAt: f.completedAt, date: bneDate(f.completedAt) } });
      continue;
    }
    createdInRun.set(`${uid}|${r.externalId}`, existing.id);
    const changed = SAME.some((k) => ((existing as Record<string, unknown>)[k] ?? null) !== ((data as Record<string, unknown>)[k] ?? null));
    const needsHistory = f.done && f.completedAt && !(await prisma.todoCompletion.findFirst({ where: { todoId: existing.id, completedAt: f.completedAt } }));
    if (!changed && !needsHistory) { out.unchanged++; out.rows.push({ index: i, externalId: r.externalId!, action: "unchanged" }); continue; }
    out.updated++; out.rows.push({ index: i, externalId: r.externalId!, action: "updated" });
    if (opts.dryRun) continue;
    await prisma.todo.update({ where: { id: existing.id }, data: data as never });
    if (needsHistory) await prisma.todoCompletion.create({ data: { todoId: existing.id, userId: uid, title: String(data.text), project: (data.project as string) ?? null, dueDate: (data.date as string) ?? null, completedAt: f.completedAt!, date: bneDate(f.completedAt!) } });
  }
  return out;
}
