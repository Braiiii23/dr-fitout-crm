import "server-only";
import { prisma } from "./db";
import { bneToday, addDays } from "./myday";

import { REPEATS } from "./task-consts";
export { REPEATS };
export const PRIORITY_LABEL: Record<number, string> = { 1: "P1", 2: "P2", 3: "P3", 4: "P4" };

/** The next due date for a repeating task, after `from`. Supports the REPEATS list and "every N days". */
export function nextDate(from: string, rule: string): string | null {
  const r = rule.trim().toLowerCase();
  const n = /^every (\d+) days?$/.exec(r);
  if (n) return addDays(from, Math.max(1, Number(n[1])));
  if (r === "daily") return addDays(from, 1);
  if (r === "weekdays") { let d = addDays(from, 1); while ([0, 6].includes(new Date(d + "T00:00:00Z").getUTCDay())) d = addDays(d, 1); return d; }
  if (r === "weekly") return addDays(from, 7);
  if (r === "fortnightly") return addDays(from, 14);
  if (r === "monthly" || r === "yearly") {
    const [y, m, d] = from.split("-").map(Number);
    const ny = r === "yearly" ? y + 1 : y + (m === 12 ? 1 : 0), nm = r === "yearly" ? m : (m % 12) + 1;
    const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
    return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
  }
  return null;
}
export const validRepeat = (r: string | null | undefined) => !r ? null : (REPEATS.some(([k]) => k === r) || /^every \d+ days?$/i.test(r)) ? r.toLowerCase() : null;

/** Tick a task off. Repeating tasks are logged and move to their next date (they stay open); others are marked done. */
export async function completeTask(id: string, userId: string) {
  const t = await prisma.todo.findFirst({ where: { id, userId } });
  if (!t || t.done) return t;
  const today = bneToday();
  await prisma.todoCompletion.create({ data: { todoId: t.id, userId, title: t.text, project: t.project, dueDate: t.date, date: today } });
  const next = t.recurrence ? nextDate(t.date && t.date > today ? t.date : (t.date ?? today), t.recurrence) : null;
  if (next) {
    await prisma.todo.update({ where: { id }, data: { date: next } });
    // A repeating task's subtasks start again for the next round.
    await prisma.todo.updateMany({ where: { parentId: id }, data: { done: false, doneAt: null } });
  } else await prisma.todo.update({ where: { id }, data: { done: true, doneAt: new Date() } });
  return prisma.todo.findUnique({ where: { id } });
}

/** Undo a tick-off made today. */
export async function uncompleteTask(id: string, userId: string) {
  const t = await prisma.todo.findFirst({ where: { id, userId } });
  if (!t) return null;
  const last = await prisma.todoCompletion.findFirst({ where: { todoId: id, date: bneToday() }, orderBy: { completedAt: "desc" } });
  if (last) await prisma.todoCompletion.delete({ where: { id: last.id } });
  await prisma.todo.update({ where: { id }, data: { done: false, doneAt: null, ...(t.recurrence && last?.dueDate ? { date: last.dueDate } : {}) } });
  return prisma.todo.findUnique({ where: { id } });
}

/** What someone finished on a day, as lines for the team email. */
export async function finishedOn(userId: string | null, date = bneToday()) {
  const rows = await prisma.todoCompletion.findMany({ where: { date, ...(userId ? { userId } : {}) }, orderBy: { completedAt: "asc" } });
  return rows;
}
