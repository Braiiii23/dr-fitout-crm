import "server-only";
import type { CallListItem } from "@prisma/client";
import type { CurrentUser } from "./auth";
/** Fields each role may edit on a call-list row. Nothing on the call list is financial, but setters are kept to their own rows. */
export const EDITABLE: Record<CurrentUser["role"], string[]> = {
  ADMIN: ["leadName", "company", "phone", "email", "business", "contactType", "trade", "leadInfo", "callStatus", "attempts", "lastCalled", "callNotes", "appointment", "addedToCrm", "possibleDuplicate", "duplicateNote", "assignedSetter"],
  TEAM: ["leadName", "company", "phone", "email", "leadInfo", "callStatus", "attempts", "lastCalled", "callNotes"],
  SETTER: ["callStatus", "attempts", "lastCalled", "callNotes"],
  ESTIMATOR: [], // estimators have no access to the call list
  ACCOUNTS: [],
  CEO: [], // a CEO login is treated as ADMIN before this is used
  PM: [], FOREMAN: [],
  BDM: [], // set just below: the BDM works the call list like Braiden does
};
EDITABLE.BDM = EDITABLE.ADMIN;
export function canView(u: CurrentUser, c: Pick<CallListItem, "setterId">) {
  if (u.role === "ADMIN" || u.role === "TEAM" || u.role === "BDM") return true;
  return !!u.setterId && c.setterId === u.setterId;
}
export function canEdit(u: CurrentUser, c: Pick<CallListItem, "setterId">) {
  if (u.role === "ADMIN") return true;
  return !!u.setterId && c.setterId === u.setterId; // team + setters edit only rows assigned to them
}
/** Safe projection for setter/team screens — never joins Lead (which holds GP, budgets, contract values). */
export const SAFE_CALL_SELECT = {
  id: true, leadName: true, company: true, phone: true, email: true, business: true, contactType: true, leadInfo: true, assignedSetter: true,
  setterId: true, callStatus: true, priority: true, attempts: true, appointment: true, lastCalled: true, callNotes: true, addedToCrm: true,
  possibleDuplicate: true, registeredAt: true, createdAt: true, claimedAt: true, slotId: true,
  setter: { select: { id: true, name: true } },
} as const;
