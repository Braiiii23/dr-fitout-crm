"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getUser, requireUser } from "@/lib/auth";
import { audit } from "@/lib/automations";
import { bneToday, bneStart, setGoogleIcal, syncGoogle, METRICS, guessMetric } from "@/lib/myday";
import { completeTask, uncompleteTask, validRepeat } from "@/lib/tasks";

// Everyone works on their own My Day: every action only touches the signed-in person's rows.
async function me() { const u = await getUser(); if (!u) throw new Error("Not signed in"); return u; }
const s = (fd: FormData, k: string, max = 500) => { const v = String(fd.get(k) ?? "").trim(); return v ? v.slice(0, max) : null; };
const isDate = (v: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const refresh = () => { revalidatePath("/myday"); revalidatePath("/calendar"); };

// ---------- tasks (to-dos) ----------
function taskData(fd: FormData) {
  const pr = Number(fd.get("priority")); const time = s(fd, "time");
  const labels = (s(fd, "labels", 300) ?? "").split(",").map((x) => x.trim().replace(/^@/, "")).filter(Boolean).join(",");
  return {
    text: s(fd, "text", 300) ?? "Task", description: s(fd, "description", 5000), project: s(fd, "project", 60), section: s(fd, "section", 60),
    date: isDate(s(fd, "date")) ? s(fd, "date") : null, time: time && /^\d{2}:\d{2}$/.test(time) ? time : null,
    deadline: isDate(s(fd, "deadline")) ? s(fd, "deadline") : null, recurrence: validRepeat(s(fd, "recurrence")),
    priority: [1, 2, 3, 4].includes(pr) ? pr : 4, labels: labels || null,
  };
}
/** Add a task, or change one (same task, never a copy). A new task with no date goes on today. */
export async function saveTodo(fd: FormData) {
  const u = await me(); const id = s(fd, "id");
  const data = taskData(fd);
  if (!s(fd, "text")) return;
  if (id) await prisma.todo.updateMany({ where: { id, userId: u.id, assignedById: null }, data }); // tasks given to you stay as set
  else {
    const parentId = s(fd, "parentId");
    const parent = parentId ? await prisma.todo.findFirst({ where: { id: parentId, userId: u.id } }) : null;
    const date = fd.has("date") ? data.date : bneToday();
    await prisma.todo.create({ data: { ...data, date: parent ? (data.date ?? parent.date) : date, project: data.project ?? parent?.project ?? null, parentId: parent?.id ?? null, userId: u.id, sort: await prisma.todo.count({ where: { userId: u.id, date } }) } });
  }
  refresh();
}
export const addTodo = saveTodo;
export async function toggleTodo(fd: FormData) {
  const u = await me(); const id = s(fd, "id"); if (!id) return;
  const t = await prisma.todo.findFirst({ where: { id, userId: u.id } }); if (!t) return;
  if (t.done) await uncompleteTask(id, u.id); else await completeTask(id, u.id);
  refresh();
}
export async function deleteTodo(fd: FormData) {
  const u = await me(); const id = s(fd, "id"); if (!id) return;
  const t = await prisma.todo.findFirst({ where: { id, userId: u.id } });
  if (!t || (t.assignedById && t.assignedById !== u.id)) return; // tasks given to you can't be deleted by you
  await prisma.todo.deleteMany({ where: { userId: u.id, OR: [{ id }, { parentId: id }] } }); refresh();
}
/** Move overdue unfinished tasks onto today. */
export async function carryOver() {
  const u = await me(); const today = bneToday();
  await prisma.todo.updateMany({ where: { userId: u.id, done: false, parentId: null, date: { lt: today } }, data: { date: today } });
  refresh();
}

// ---------- calendar events ----------
function eventData(fd: FormData) {
  const date = s(fd, "date"); const allDay = fd.get("allDay") === "on";
  if (!isDate(date)) return null;
  const tm = (k: string, dflt: string) => { const v = s(fd, k) ?? dflt; return /^\d{2}:\d{2}$/.test(v) ? v : dflt; };
  const start = allDay ? bneStart(date!) : new Date(bneStart(date!).getTime() + (Number(tm("startTime", "09:00").slice(0, 2)) * 60 + Number(tm("startTime", "09:00").slice(3))) * 60000);
  let end = allDay ? new Date(bneStart(date!).getTime() + 86400000 - 60000) : new Date(bneStart(date!).getTime() + (Number(tm("endTime", "10:00").slice(0, 2)) * 60 + Number(tm("endTime", "10:00").slice(3))) * 60000);
  if (end <= start) end = new Date(start.getTime() + 3600000);
  return { title: s(fd, "title", 200) ?? "Meeting", start, end, allDay, location: s(fd, "location", 200), notes: s(fd, "notes", 2000), private: fd.get("private") === "on" };
}
export async function saveEvent(fd: FormData) {
  const u = await me(); const data = eventData(fd); if (!data) return;
  const id = s(fd, "id");
  if (id) await prisma.calEvent.updateMany({ where: { id, userId: u.id, source: "crm" }, data });
  else await prisma.calEvent.create({ data: { ...data, userId: u.id } });
  await (await import("@/lib/availability")).syncAvailabilityFor(u.id);
  refresh();
}
export async function deleteEvent(fd: FormData) {
  const u = await me(); const id = s(fd, "id"); if (!id) return;
  await prisma.calEvent.deleteMany({ where: { id, userId: u.id, source: "crm" } });
  await (await import("@/lib/availability")).syncAvailabilityFor(u.id);
  refresh();
}

// ---------- Google Calendar link ----------
export async function saveGoogleLink(fd: FormData) {
  const u = await me(); const url = s(fd, "url", 1000);
  // https / webcal calendar addresses (plain http only for local testing with BT_ALLOW_HTTP=1).
  const ok = url && (/^(https|webcal):\/\/\S+\.ics(\?\S*)?$/i.test(url) || (process.env.BT_ALLOW_HTTP === "1" && /^http:\/\/\S+\.ics$/i.test(url)));
  if (url && !ok) return;
  await setGoogleIcal(u.id, url);
  if (url) await syncGoogle(u.id);
  refresh();
}
export async function syncGoogleNow() { const u = await me(); await syncGoogle(u.id); refresh(); }

// ---------- KPIs ----------
export async function saveKpi(fd: FormData) {
  const u = await me(); const id = s(fd, "id");
  const target = Number(String(fd.get("target") ?? "").replace(/[$,\s]/g, ""));
  // "auto" (or nothing picked) = work out how to track it from the KPI's name.
  const picked = s(fd, "source");
  const source = picked && METRICS[picked] ? picked : guessMetric(s(fd, "name") ?? "");
  const period = ["day", "week", "month"].includes(s(fd, "period") ?? "") ? s(fd, "period")! : "week";
  const data = { name: s(fd, "name", 80) ?? "KPI", target: Number.isFinite(target) && target > 0 ? target : 1, period, source, unit: s(fd, "unit", 20) ?? (METRICS[source]?.unit || null) };
  // KPIs set by a manager can't be changed by the person.
  if (id) await prisma.kpi.updateMany({ where: { id, userId: u.id, setBy: null }, data });
  else await prisma.kpi.create({ data: { ...data, userId: u.id, sort: await prisma.kpi.count({ where: { userId: u.id } }) } });
  refresh();
}
export async function deleteKpi(fd: FormData) {
  const u = await me(); const id = s(fd, "id"); if (!id) return;
  await prisma.kpi.deleteMany({ where: { id, userId: u.id, setBy: null } }); refresh();
}
export async function logKpi(fd: FormData) {
  const u = await me(); const kpiId = s(fd, "kpiId"); const value = Number(String(fd.get("value") ?? "").replace(/[$,\s]/g, ""));
  if (!kpiId || !Number.isFinite(value)) return;
  const k = await prisma.kpi.findFirst({ where: { id: kpiId, userId: u.id } }); if (!k) return;
  await prisma.kpiEntry.create({ data: { kpiId, date: isDate(s(fd, "date")) ? s(fd, "date")! : bneToday(), value, note: s(fd, "note", 200) } });
  refresh();
}

// ---------- giving tasks to other people (Braiden / CEO) ----------
/** Give someone a task, or change one you gave. It shows on their My Day as "From <you>". */
export async function giveTodo(fd: FormData) {
  const u = await requireUser(["ADMIN"]);
  const userId = s(fd, "userId"); const id = s(fd, "id"); if (!userId || !s(fd, "text")) return;
  const data = { ...taskData(fd), assignedBy: u.name.split(" ")[0], assignedById: u.id };
  if (id) await prisma.todo.updateMany({ where: { id, assignedById: u.id }, data });
  else await prisma.todo.create({ data: { ...data, date: data.date ?? bneToday(), userId, source: "assigned", sort: -1 } });
  await audit(u.email, id ? "task changed" : "task given", "Todo", userId, data.text);
  refresh();
}
export async function takeBackTodo(fd: FormData) {
  const u = await requireUser(["ADMIN"]);
  const id = s(fd, "id"); if (!id) return;
  await prisma.todo.deleteMany({ where: { assignedById: u.id, OR: [{ id }, { parentId: id }] } });
  refresh();
}
