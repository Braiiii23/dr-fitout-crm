import "server-only";
import { prisma } from "./db";
import { encrypt, decrypt } from "./crypto";

// ---- Configuration (bases are overridable so the flow can be tested against a local stand-in) ----
const LOGIN = () => process.env.XERO_LOGIN_BASE || "https://login.xero.com";
const IDENTITY = () => process.env.XERO_IDENTITY_BASE || "https://identity.xero.com";
const API = () => process.env.XERO_API_BASE || "https://api.xero.com";
export const XERO_REDIRECT_URI = () => process.env.XERO_REDIRECT_URI || "https://crm-production-b8fa.up.railway.app/xero/callback";

// Read-only, granular scopes (Xero apps created after 2 March 2026 can't use the old broad ones).
const FULL_SCOPES = [
  "openid", "profile", "email", "offline_access",
  "accounting.settings.read", "accounting.contacts.read", "accounting.invoices.read", "accounting.payments.read",
  "accounting.banktransactions.read", "accounting.reports.banksummary.read", "accounting.reports.profitandloss.read",
];
// Without the P&L report scope, in case the app isn't allowed it. The P&L is then worked out from invoices and bills.
const BASIC_SCOPES = FULL_SCOPES.filter((s) => s !== "accounting.reports.profitandloss.read");

export function xeroConfigured() {
  return !!process.env.XERO_CLIENT_ID && !!process.env.XERO_CLIENT_SECRET;
}

export function authorizeUrl(state: string, basic = false) {
  const scopes = process.env.XERO_SCOPES || (basic ? BASIC_SCOPES : FULL_SCOPES).join(" ");
  const q = new URLSearchParams({
    response_type: "code", client_id: process.env.XERO_CLIENT_ID!, redirect_uri: XERO_REDIRECT_URI(), scope: scopes, state,
  });
  return `${LOGIN()}/identity/connect/authorize?${q}`;
}

async function tokenRequest(body: Record<string, string>) {
  const basic = Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${IDENTITY()}/connect/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const body = await res.text();
    if (/invalid_grant|invalid_client|unauthorized_client/.test(body)) throw new NeedsReconnect(/different client/.test(body)
      ? "The saved Xero connection belongs to a different Xero app. Press Reconnect Xero and approve ENP Fitouts again."
      : "Xero has ended this connection (it was revoked, or not used for 60 days). Press Reconnect Xero and approve ENP Fitouts again.");
    throw new Error(`Xero sign-in failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return (await res.json()) as { access_token: string; refresh_token: string; expires_in: number; scope?: string };
}

/** Finish the sign-in: swap the code for tokens, pick the ENP organisation, save everything encrypted. */
export async function completeConnection(code: string, who: string) {
  const t = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: XERO_REDIRECT_URI() });
  const res = await fetch(`${API()}/connections`, { headers: { Authorization: `Bearer ${t.access_token}` }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Couldn't list Xero organisations (${res.status})`);
  const orgs = ((await res.json()) as { tenantId: string; tenantName: string; tenantType: string }[]).filter((o) => o.tenantType === "ORGANISATION");
  if (!orgs.length) throw new Error("No Xero organisation was approved. Connect again and tick ENP Fitouts.");
  const org = orgs.find((o) => /enp/i.test(o.tenantName)) ?? orgs[0];
  const data = {
    tenantId: org.tenantId, tenantName: org.tenantName, accessToken: encrypt(t.access_token), refreshToken: encrypt(t.refresh_token),
    expiresAt: new Date(Date.now() + (t.expires_in - 60) * 1000), scopes: t.scope ?? null, connectedBy: who, lastSyncError: null,
  };
  await prisma.xeroConnection.upsert({ where: { id: "xero" }, create: { id: "xero", ...data }, update: { ...data, connectedAt: new Date() } });
  return org.tenantName;
}

/** A valid access token, refreshing it first if it has expired (Xero access tokens last 30 minutes). */
async function accessToken() {
  const c = await prisma.xeroConnection.findUnique({ where: { id: "xero" } });
  if (!c) throw new Error("Xero isn't connected.");
  if (c.expiresAt > new Date()) return { token: decrypt(c.accessToken), tenantId: c.tenantId };
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: decrypt(c.refreshToken) });
  await prisma.xeroConnection.update({
    where: { id: "xero" },
    data: { accessToken: encrypt(t.access_token), refreshToken: encrypt(t.refresh_token), expiresAt: new Date(Date.now() + (t.expires_in - 60) * 1000) },
  });
  return { token: t.access_token, tenantId: c.tenantId };
}

class XeroHttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
export class NeedsReconnect extends Error {}
class RateLimited extends Error {
  constructor(public which: string, public wait: number) {
    super(which === "day" ? "Xero's daily limit for this app has been reached. It resets within 24 hours; the page keeps the last figures until then."
      : `Xero asked us to slow down (${which || "rate"} limit). Try Refresh again in ${Math.max(1, Math.ceil(wait / 60))} minute${wait > 60 ? "s" : ""}.`);
  }
}

let lastCall = 0;
async function get(path: string) {
  const gap = 1100 - (Date.now() - lastCall);
  if (gap > 0) await new Promise((r) => setTimeout(r, gap));
  lastCall = Date.now();
  const { token, tenantId } = await accessToken();
  const res = await fetch(`${API()}/api.xro/2.0/${path}`, {
    headers: { Authorization: `Bearer ${token}`, "xero-tenant-id": tenantId, Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 429) {
    // Xero's rate limits: 60 calls a minute and (on the free tier) 1,000 a day per organisation.
    const which = res.headers.get("x-rate-limit-problem") ?? "";
    const wait = Number(res.headers.get("retry-after") ?? "60");
    throw new RateLimited(which, wait);
  }
  if (!res.ok) throw new XeroHttpError(res.status, `Xero ${path.split("?")[0]} returned ${res.status}`);
  return res.json();
}

/** Every page of an invoice query (Xero returns 100 per page). */
async function allInvoices(where: string) {
  const out: XInvoice[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = (await get(`Invoices?where=${encodeURIComponent(where)}&page=${page}`)) as { Invoices: XInvoice[] };
    out.push(...r.Invoices);
    if (r.Invoices.length < 100) break;
  }
  return out;
}

export type XInvoice = {
  InvoiceID: string; InvoiceNumber?: string; Reference?: string; Type: string; Status: string;
  Contact?: { Name?: string }; DateString?: string; DueDateString?: string; SubTotal?: number; Total?: number; AmountDue?: number;
  FullyPaidOnDate?: string;
};

const ym = (d: Date) => ({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 });
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

async function save(key: string, fn: () => Promise<unknown>) {
  try {
    const json = JSON.stringify(await fn());
    await prisma.xeroSnapshot.upsert({ where: { key }, create: { key, json, ok: true }, update: { json, ok: true, note: null, fetchedAt: new Date() } });
    return null;
  } catch (e) {
    if (e instanceof RateLimited || e instanceof NeedsReconnect) throw e; // stop this sync; the rest would be refused too
    const notAllowed = e instanceof XeroHttpError && (e.status === 401 || e.status === 403);
    const note = notAllowed ? "not-allowed" : String((e as Error).message).slice(0, 300);
    // A refused permission clears the data; any other failure keeps the last good copy.
    if (notAllowed) await prisma.xeroSnapshot.upsert({ where: { key }, create: { key, json: "null", ok: false, note }, update: { ok: false, note, fetchedAt: new Date() } });
    else await prisma.xeroSnapshot.updateMany({ where: { key }, data: { note } });
    return notAllowed ? null : `${key}: ${note}`;
  }
}

/** Pull everything the Accounts page needs from Xero and store it. Returns a list of problems (empty = all fine). */
export async function syncXero() {
  // Mark the start so a second page load doesn't start another sync alongside this one.
  await prisma.xeroConnection.update({ where: { id: "xero" }, data: { lastSyncAt: new Date() } });
  try {
    const res = await runSync();
    // Then fill blank job details (tracking code, client, contract) and each job's claims, bills and materials.
    try { await (await import("./job-fill")).fillJobsMissingInfo(); } catch (e) { console.error("job fill failed:", (e as Error).message); }
    try { await (await import("./xero-jobs")).syncJobsFromXero(); } catch (e) { console.error("job sync from Xero failed:", (e as Error).message); }
    return res;
  } catch (e) {
    if (!(e instanceof RateLimited) && !(e instanceof NeedsReconnect)) throw e;
    await prisma.xeroConnection.update({ where: { id: "xero" }, data: { lastSyncAt: new Date(), lastSyncError: (e instanceof NeedsReconnect ? "RECONNECT: " : "") + e.message } });
    return [e.message];
  }
}

async function runSync() {
  const now = new Date();
  const { y, m } = ym(now);
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  const from = iso(prev.y, prev.m, 1);
  const errors: string[] = [];
  const add = (e: string | null) => { if (e) errors.push(e); };

  add(await save("bankSummary", () => get(`Reports/BankSummary?fromDate=${iso(y, m, 1)}&toDate=${iso(y, m, lastDay(y, m))}`)));
  add(await save("receivables", () => allInvoices(`Type=="ACCREC" AND Status=="AUTHORISED"`)));
  add(await save("payables", () => allInvoices(`Type=="ACCPAY" AND Status=="AUTHORISED"`)));
  add(await save("plThis", () => get(`Reports/ProfitAndLoss?fromDate=${iso(y, m, 1)}&toDate=${iso(y, m, lastDay(y, m))}`)));
  add(await save("plLast", () => get(`Reports/ProfitAndLoss?fromDate=${from}&toDate=${iso(prev.y, prev.m, lastDay(prev.y, prev.m))}`)));
  // Used when the P&L report isn't available: income and bills for last month and this month.
  const dateWhere = `Date >= DateTime(${prev.y}, ${prev.m}, 1) AND (Status=="AUTHORISED" OR Status=="PAID")`;
  add(await save("salesRecent", () => allInvoices(`Type=="ACCREC" AND ${dateWhere}`)));
  add(await save("billsRecent", () => allInvoices(`Type=="ACCPAY" AND ${dateWhere}`)));
  add(await save("spendRecent", async () => {
    const r = (await get(`BankTransactions?where=${encodeURIComponent(`Type=="SPEND" AND Date >= DateTime(${prev.y}, ${prev.m}, 1)`)}`)) as { BankTransactions: { DateString?: string; SubTotal?: number; Status?: string }[] };
    return r.BankTransactions.filter((t) => t.Status !== "DELETED").map((t) => ({ DateString: t.DateString, SubTotal: t.SubTotal }));
  }));

  // ----- spend money tagged to jobs (materials etc.), last 6 months, with line items and tracking (every 6 hours) -----
  const js = await prisma.xeroSnapshot.findUnique({ where: { key: "jobSpend" } });
  if (!js?.ok || Date.now() - js.fetchedAt.getTime() > 6 * 3600 * 1000) add(await save("jobSpend", async () => {
    const since = new Date(Date.UTC(y, m - 1 - 6, 1));
    const out: unknown[] = [];
    for (let page = 1; page <= 10; page++) {
      const spendWhere = 'Type=="SPEND" AND Date >= DateTime(' + since.getUTCFullYear() + ', ' + (since.getUTCMonth() + 1) + ', 1)';
      const r = (await get(`BankTransactions?where=${encodeURIComponent(spendWhere)}&page=${page}`)) as { BankTransactions: { BankTransactionID: string; Status?: string; LineItems?: { Tracking?: unknown[] }[] }[] };
      // Keep only transactions with a tracking code on at least one line (job-tagged spend).
      out.push(...r.BankTransactions.filter((t) => t.Status !== "DELETED" && (t.LineItems ?? []).some((l) => (l.Tracking ?? []).length)));
      if (r.BankTransactions.length < 100) break;
    }
    return out;
  }));

  // ----- accepted quotes (contract values for jobs), every 6 hours; skipped quietly if Xero doesn't allow quotes -----
  const qs = await prisma.xeroSnapshot.findUnique({ where: { key: "quotes" } });
  if (!qs || (qs.ok && Date.now() - qs.fetchedAt.getTime() > 6 * 3600 * 1000) || (!qs.ok && qs.note !== "not-allowed" && Date.now() - qs.fetchedAt.getTime() > 6 * 3600 * 1000)) add(await save("quotes", async () => {
    const out: unknown[] = [];
    for (let page = 1; page <= 10; page++) {
      const r = (await get(`Quotes?Statuses=ACCEPTED,INVOICED&page=${page}`)) as { Quotes: { QuoteID: string; QuoteNumber?: string; Reference?: string; Title?: string; Contact?: { Name?: string }; DateString?: string; Status?: string; SubTotal?: number; Total?: number }[] };
      out.push(...r.Quotes.map((q) => ({ QuoteID: q.QuoteID, QuoteNumber: q.QuoteNumber, Reference: q.Reference, Title: q.Title, Contact: { Name: q.Contact?.Name }, DateString: q.DateString, Status: q.Status, SubTotal: q.SubTotal, Total: q.Total })));
      if (r.Quotes.length < 100) break;
    }
    return out;
  }));

  // ----- 12 months of history, used to work out running costs, margins and how fast clients pay -----
  const hist = await prisma.xeroSnapshot.findUnique({ where: { key: "salesHistory" } });
  const histFresh = hist?.ok && Date.now() - hist.fetchedAt.getTime() < 6 * 3600 * 1000;
  const start = new Date(Date.UTC(y, m - 1 - 24, 1));
  const sy = start.getUTCFullYear(), sm = start.getUTCMonth() + 1;
  if (!histFresh) add(await save("plHistory", () => get(`Reports/ProfitAndLoss?fromDate=${iso(y, m, 1)}&toDate=${iso(y, m, lastDay(y, m))}&periods=11&timeframe=MONTH`)));
  const older = new Date(Date.UTC(y, m - 1 - 12, 1)); const oy = older.getUTCFullYear(), om = older.getUTCMonth() + 1;
  if (!histFresh) add(await save("plHistory2", () => get(`Reports/ProfitAndLoss?fromDate=${iso(oy, om, 1)}&toDate=${iso(oy, om, lastDay(oy, om))}&periods=11&timeframe=MONTH`)));
  const histWhere = `Date >= DateTime(${sy}, ${sm}, 1) AND (Status=="AUTHORISED" OR Status=="PAID")`;
  if (!histFresh) add(await save("salesHistory", () => allInvoices(`Type=="ACCREC" AND ${histWhere}`)));
  if (!histFresh) add(await save("billsHistory", () => allInvoices(`Type=="ACCPAY" AND ${histWhere}`)));
  if (!histFresh) add(await save("spendHistory", async () => {
    const out: { DateString?: string; SubTotal?: number }[] = [];
    for (let page = 1; page <= 30; page++) {
      const r = (await get(`BankTransactions?where=${encodeURIComponent(`Type=="SPEND" AND Date >= DateTime(${sy}, ${sm}, 1)`)}&page=${page}`)) as { BankTransactions: { DateString?: string; SubTotal?: number; Status?: string }[] };
      out.push(...r.BankTransactions.filter((t) => t.Status !== "DELETED").map((t) => ({ DateString: t.DateString, SubTotal: t.SubTotal })));
      if (r.BankTransactions.length < 100) break;
    }
    return out;
  }));

  await prisma.xeroConnection.update({ where: { id: "xero" }, data: { lastSyncAt: new Date(), lastSyncError: errors.length ? errors.join(" | ").slice(0, 1000) : null } });
  return errors;
}

/** Sync if the last one is older than 15 minutes (called when the Accounts page opens). */
/** Start a Xero refresh without waiting for it (one at a time). Pages call this so they open straight away. */
let running: Promise<void> | null = null;
export function kickXeroSync(): boolean {
  if (running) return true;
  running = (async () => {
    try { await syncIfStale(); } catch { /* recorded on the connection */ }
  })().finally(() => { running = null; });
  return true;
}
export const xeroSyncRunning = () => running !== null;

export async function syncIfStale() {
  const c = await prisma.xeroConnection.findUnique({ where: { id: "xero" } });
  if (!c || !xeroConfigured()) return;
  if (c.lastSyncAt && Date.now() - c.lastSyncAt.getTime() < 15 * 60 * 1000) return;
  try { await syncXero(); } catch (e) {
    await prisma.xeroConnection.update({ where: { id: "xero" }, data: { lastSyncAt: new Date(), lastSyncError: String((e as Error).message).slice(0, 500) } });
  }
}
