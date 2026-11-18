"use server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { CONTACT_TYPE_KEYS } from "@/lib/constants";
import { TRADES } from "@/lib/estimating";
import { revalidatePath } from "next/cache";

import { audit } from "@/lib/automations";
const s = (fd: FormData, k: string) => { const v = String(fd.get(k) ?? "").trim(); return v || null; };
/** Where to go back to after saving: the /team view the person was on (only /team pages). */
const back = (fd: FormData, fallback: string) => { const r = String(fd.get("returnTo") ?? ""); return /^\/team(\?[\w=&%.+\-]*)?$/.test(r) ? r : fallback; };
const withMsg = (url: string, key: "msg" | "err", text: string) => `${url}${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(text)}`;
const pickTrade = (fd: FormData) => { const pick = s(fd, "trade"), other = s(fd, "tradeOther"); return pick === "Other" && other ? other.slice(0, 60) : pick && TRADES.includes(pick) ? pick : pick && !TRADES.includes(pick) ? pick.slice(0, 60) : null; };

/** Add a person to the shared team directory (stored as a CallListItem, unclaimed, no financials). */
export async function addContact(fd: FormData) {
  const u = await requireUser(["ADMIN", "TEAM", "BDM", "PM", "FOREMAN"]);
  const leadName = s(fd, "leadName");
  const type = String(fd.get("contactType") || "CLIENT");
  const contactType = CONTACT_TYPE_KEYS.includes(type) ? type : "CLIENT";
  const business = fd.get("business") === "DR" ? "DR" : "ENP";
  const ret = back(fd, `/team?type=${contactType}`);
  if (!leadName) redirect(withMsg(ret, "err", "Name is required"));
  // Trades: which trade (from the same list as the trade packs; "Other" + free text allowed).
  const trade = contactType === "TRADE" ? pickTrade(fd) : null;
  if (contactType === "TRADE" && !trade) redirect(withMsg(ret, "err", "Pick which trade they are"));
  const phone = s(fd, "phone"); const email = s(fd, "email");
  const dupe = (phone || email) ? await prisma.callListItem.findFirst({ where: { OR: [...(phone ? [{ phone }] : []), ...(email ? [{ email }] : [])] }, select: { leadName: true } }) : null;
  await prisma.callListItem.create({ data: { leadName, company: s(fd, "company"), phone, email, business, contactType, trade, leadInfo: s(fd, "leadInfo"),
    possibleDuplicate: !!dupe, duplicateNote: dupe ? `Matches existing: ${dupe.leadName ?? ""}` : null } });
  await audit(u.email, "create contact", "CallListItem", leadName);
  const msg = dupe ? `Added ${leadName} — heads up, phone/email matches ${dupe.leadName ?? "an existing person"}` : `Added ${leadName}`;
  redirect(withMsg(fd.get("returnTo") ? ret : `/team?type=${contactType}${trade ? `&trade=${encodeURIComponent(trade)}` : ""}`, "msg", msg));
}

/** Move someone into the Trades section (or change their trade). */
export async function setContactTrade(fd: FormData) {
  const u = await requireUser(["ADMIN", "TEAM", "BDM", "PM", "FOREMAN"]);
  const id = s(fd, "id"); if (!id) return;
  const pick = s(fd, "trade"), other = s(fd, "tradeOther");
  const trade = pick === "Other" && other ? other.slice(0, 60) : TRADES.includes(pick ?? "") ? pick : null;
  if (!trade) return;
  await prisma.callListItem.update({ where: { id }, data: { contactType: "TRADE", trade } });
  await audit(u.email, "set trade", "CallListItem", id, trade);
  revalidatePath("/team");
}

/** Edit a person in the directory (contact details, section and trade only; no call status or financials). */
export async function updateContact(fd: FormData) {
  const u = await requireUser(["ADMIN", "TEAM", "BDM", "PM", "FOREMAN"]);
  const id = s(fd, "id"); const ret = back(fd, "/team");
  if (!id) return;
  const leadName = s(fd, "leadName");
  if (!leadName) redirect(withMsg(ret, "err", "Name can't be empty"));
  const type = String(fd.get("contactType") || "CLIENT");
  const contactType = CONTACT_TYPE_KEYS.includes(type) ? type : "CLIENT";
  const trade = contactType === "TRADE" ? pickTrade(fd) : null;
  if (contactType === "TRADE" && !trade) redirect(withMsg(ret, "err", "Pick which trade they are"));
  await prisma.callListItem.update({ where: { id }, data: {
    leadName, company: s(fd, "company"), phone: s(fd, "phone"), email: s(fd, "email"),
    business: fd.get("business") === "DR" ? "DR" : "ENP", contactType, trade, leadInfo: s(fd, "leadInfo"),
  } });
  await audit(u.email, "edit contact", "CallListItem", id, leadName);
  revalidatePath("/team");
  redirect(withMsg(ret, "msg", `Saved ${leadName}`));
}
