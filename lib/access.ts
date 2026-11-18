// Who can open which part of the DR Fitout CRM. Used by the middleware (routing), the menu, and page guards.
// Every save is also checked on the server; this file decides what each role can see.
// No "server-only" here: the middleware runs on the edge.

export const ROLES = ["ADMIN", "CEO", "BDM", "PM", "FOREMAN", "ESTIMATOR", "ACCOUNTS", "SETTER", "TEAM"] as const;
export type AnyRole = (typeof ROLES)[number];

export const ROLE_LABEL: Record<AnyRole, string> = {
  ADMIN: "Admin", CEO: "CEO", BDM: "BDM", PM: "Project manager", FOREMAN: "Finishing foreman",
  ESTIMATOR: "Estimating", ACCOUNTS: "Accounts", SETTER: "Setter (legacy)", TEAM: "Team (shared login)",
};
export const ROLE_ABOUT: Record<AnyRole, string> = {
  ADMIN: "Everything.",
  CEO: "Everything, including users, settings, Xero and BuilderTrend.",
  BDM: "Dashboard, leads, leases, clients and the Directory. Estimating view only. No accounts or job money.",
  PM: "Jobs and WIP: program, dates, trades, costs, labour, materials and bills (claims view only), BuilderTrend, leases, clients and the Directory. Can view the rest of the CRM.",
  FOREMAN: "My Day, team calendar and the Directory. Can view the rest of the CRM.",
  ESTIMATOR: "Estimating: add and edit quote jobs, trade packs and job costs. Can view the rest of the CRM.",
  ACCOUNTS: "Accounts, finance report, Jobs and WIP money side, leases and clients. Estimating view only.",
  SETTER: "My Day and the team calendar only.",
  TEAM: "Directory plus view-only pages.",
};

/** Every tab in the CRM, in menu order. */
export const TABS: [string, string][] = [
  ["/myday", "My Day"], ["/calendar", "Calendar"], ["/dashboard", "Dashboard"], ["/leads/dr", "Leads"],
  ["/jobs", "Jobs"], ["/wip", "WIP"], ["/estimating", "Estimating"], ["/accounts", "Accounts"],
  ["/leases", "Leases"], ["/clients", "Clients"], ["/directory", "Directory"], ["/kpis", "KPI's"], ["/users", "Users"],
];

/** Area → roles that can open AND change it (longest matching prefix wins). CEO is treated as Admin everywhere. */
const AREAS: [string, AnyRole[]][] = [
  ["/users", ["ADMIN", "CEO"]],
  ["/kpis", ["ADMIN", "CEO"]],
  ["/xero", ["ADMIN", "CEO", "ACCOUNTS"]],
  ["/accounts/settings", ["ADMIN", "CEO", "ACCOUNTS"]],
  ["/accounts", ["ADMIN", "CEO", "ACCOUNTS"]],
  ["/dashboard", ["ADMIN", "CEO", "BDM"]],
  ["/leads", ["ADMIN", "CEO", "BDM"]],
  ["/estimating", ["ADMIN", "CEO", "ESTIMATOR"]],
  ["/jobs/buildertrend", ["ADMIN", "CEO", "PM"]],
  ["/jobs", ["ADMIN", "CEO", "ACCOUNTS", "PM"]],
  ["/wip", ["ADMIN", "CEO", "ACCOUNTS", "PM"]],
  ["/leases", ["ADMIN", "CEO", "BDM", "PM", "ACCOUNTS"]],
  ["/clients", ["ADMIN", "CEO", "BDM", "PM", "ACCOUNTS"]],
  ["/directory", ["ADMIN", "CEO", "TEAM", "BDM", "PM", "FOREMAN", "ACCOUNTS"]],
  ["/myday", [...ROLES]],
  ["/calendar", [...ROLES]],
];
/** Roles who can also LOOK at the other parts of the CRM (view only: save buttons hidden, saves refused on the server). */
export const STAFF_VIEWERS: AnyRole[] = ["ESTIMATOR", "PM", "FOREMAN", "ACCOUNTS", "BDM", "TEAM"];
const VIEW_AREAS = ["/dashboard", "/leads", "/jobs", "/wip", "/estimating", "/accounts", "/leases", "/clients", "/directory"];
const NEVER_VIEW = ["/users", "/kpis", "/xero", "/accounts/settings", "/jobs/buildertrend"];
/** Money pages BDM never sees, even view-only. */
const BDM_HIDDEN = ["/accounts", "/wip"];

const under = (path: string, p: string) => path === p || path.startsWith(p + "/");
function baseCanOpen(role: AnyRole, path: string): boolean | null {
  const hit = AREAS.filter(([p]) => under(path, p)).sort((a, b) => b[0].length - a[0].length)[0];
  if (!hit) return null; // not an area this file controls
  return hit[1].includes(role);
}
const staffMayView = (role: AnyRole, path: string) =>
  STAFF_VIEWERS.includes(role) && VIEW_AREAS.some((p) => under(path, p)) && !NEVER_VIEW.some((p) => under(path, p)) && !/\/new$/.test(path)
  && !(role === "BDM" && BDM_HIDDEN.some((p) => under(path, p)));
export function canOpen(role: AnyRole, path: string): boolean | null {
  const base = baseCanOpen(role, path);
  if (base === false && staffMayView(role, path)) return true;
  return base;
}
/** Pages this role can look at but not change. */
export const isViewOnly = (role: AnyRole, path: string) => baseCanOpen(role, path) === false && staffMayView(role, path);

export function homeFor(role: AnyRole): string {
  switch (role) {
    case "ADMIN": case "CEO": case "BDM": return "/dashboard";
    case "PM": return "/jobs";
    case "ESTIMATOR": return "/estimating";
    case "ACCOUNTS": return "/accounts";
    case "TEAM": return "/directory";
    default: return "/myday";
  }
}

/** The menu for each role: every tab they can open, in the standard order. */
export function menuFor(role: AnyRole): [string, string][] {
  return TABS.filter(([href]) => canOpen(role, href) === true);
}
