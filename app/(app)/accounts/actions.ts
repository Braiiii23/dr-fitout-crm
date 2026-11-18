"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/automations";
import { syncXero } from "@/lib/xero";

export async function refreshXero() {
  await requireUser(["ADMIN", "ACCOUNTS"]);
  try { await syncXero(); } catch (e) {
    await prisma.xeroConnection.updateMany({ data: { lastSyncAt: new Date(), lastSyncError: String((e as Error).message).slice(0, 500) } });
  }
  revalidatePath("/accounts");
}

export async function disconnectXero() {
  const u = await requireUser(["ADMIN", "ACCOUNTS"]);
  await prisma.xeroConnection.deleteMany({});
  await prisma.xeroSnapshot.deleteMany({});
  await audit(u.email, "xero disconnected", "Xero");
  revalidatePath("/accounts");
}

const num = (fd: FormData, k: string, min = 0, max = 1e12) => {
  const n = Number(String(fd.get(k) ?? "").replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};
const txt = (fd: FormData, k: string) => String(fd.get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean).join(",");

export async function saveAccountsSettings(fd: FormData) {
  const u = await requireUser(["ADMIN", "ACCOUNTS"]);
  const data = {
    monthlyTarget: num(fd, "monthlyTarget"), grossMarginGoal: num(fd, "grossMarginGoal", 0, 100), netMarginGoal: num(fd, "netMarginGoal", 0, 100),
    bufferAmount: num(fd, "bufferAmount"), runningCostsMonthly: num(fd, "runningCostsMonthly"), avgJobSize: num(fd, "avgJobSize"),
    quoteWinRate: num(fd, "quoteWinRate", 1, 100), companyTaxRate: num(fd, "companyTaxRate", 0, 100), staleDays: (() => { const v = num(fd, "staleDays", 14, 365); return v === undefined ? undefined : Math.round(v); })(), accountsTarget: num(fd, "accountsTarget"), claimTermsDays: (() => { const v = num(fd, "claimTermsDays", 0, 120); return v === undefined ? undefined : Math.round(v); })(), claimNoticeDays: (() => { const v = num(fd, "claimNoticeDays", 0, 30); return v === undefined ? undefined : Math.round(v); })(), claimNotifyEmail: String(fd.get("claimNotifyEmail") ?? "").trim().slice(0, 300) || undefined, depositPct: num(fd, "depositPct", 0, 100), jobWeeks: (() => { const v = num(fd, "jobWeeks", 1, 104); return v === undefined ? undefined : Math.round(v); })(), otherWorkOnHand: num(fd, "otherWorkOnHand"), workAlertMonths: num(fd, "workAlertMonths", 0, 24),
    cashAccounts: txt(fd, "cashAccounts"), holdingAccounts: txt(fd, "holdingAccounts"), creditAccounts: txt(fd, "creditAccounts"),
    addRunningCostsToForecast: fd.get("addRunningCostsToForecast") === "on", forecastRecurringIncome: fd.get("forecastRecurringIncome") === "on", useXeroFigures: fd.get("useXeroFigures") === "on", forecastSecuredOnly: fd.get("forecastSecuredOnly") === "on", updatedBy: u.email,
  };
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
  await prisma.accountsSettings.upsert({ where: { id: "settings" }, create: { id: "settings", ...clean }, update: clean });
  await audit(u.email, "accounts settings saved", "AccountsSettings");
  revalidatePath("/accounts"); revalidatePath("/accounts/settings");
}

/** Tell the app which Xero contact a signed job is invoiced to, when it can't match it by name. */
export async function setJobXeroContact(fd: FormData) {
  const u = await requireUser(["ADMIN", "ACCOUNTS"]);
  const id = String(fd.get("id") ?? "");
  const name = String(fd.get("xeroContact") ?? "").trim().slice(0, 200);
  if (!id) return;
  await prisma.lead.update({ where: { id }, data: { xeroContact: name || null } });
  await audit(u.email, "xero contact set", "Lead", id, name);
  revalidatePath("/accounts");
}
