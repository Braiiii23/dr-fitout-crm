// Who can open which part of the CRM. Used by the middleware (routing), the menu, and page guards.
// Every save is also checked on the server; this file decides what each role can see.
// No "server-only" here: the middleware runs on the edge.

export const ROLES = ["ADMIN", "CEO", "BDM", "PM", "FOREMAN", "ESTIMATOR", "ACCOUNTS", "SETTER", "TEAM"] as const;
export type AnyRole = (typeof ROLES)[number];

export const ROLE_LABEL: Record<AnyRole, string> = {
  ADMIN: "Admin (Braiden)", CEO: "CEO", BDM: "BDM", PM: "Project manager", FOREMAN: "Finishing foreman",
  ESTIMATOR: "Estimating", ACCOUNTS: "Accounts", SETTER: "Setter", TEAM: "Team (shared login)",
};
export const ROLE_ABOUT: Record<AnyRole, string> = {
  ADMIN: "Everything.",
  CEO: "Everything, including users, settings, Xero and BuilderTrend.",
  BDM: "Dashboard, leads, consulting, call lists, free slots, setters and statements. Estimating view only. No accounts or job money.",
  PM: "Jobs and WIP: program, dates, trades, costs, labour, materials and bills (claims view only), BuilderTrend and Directory. Can view the rest of the CRM.",
  FOREMAN: "My Day, team calendar and the Directory. Can view the rest of the CRM.",
  ESTIMATOR: "Estimating: add and edit quote jobs, trade packs and job costs. Can view the rest of the CRM.",
  ACCOUNTS: "Accounts (including setter pay), finance report, Jobs and WIP money side, Estimating view only.",
  SETTER: "My Calls portal: their own call list, bookings and earnings.",
  TEAM: "Directory plus view-only pages.",
};

/** Area → roles that can open it (longest matching prefix wins). CEO is treated as Admin everywhere. */
const AREAS: [string, AnyRole[]][] = [
  ["/users", ["ADMIN", "CEO"]],
  ["/kpis", ["ADMIN", "CEO"]],
  ["/tasks", ["ADMIN", "CEO"]],
  ["/xero", ["ADMIN", "CEO", "ACCOUNTS"]],
  ["/accounts/settings", ["ADMIN", "CEO", "ACCOUNTS"]],
  ["/accounts", ["ADMIN", "CEO", "ACCOUNTS"]],
  ["/dashboard", ["ADMIN", "CEO", "BDM"]],
  ["/leads", ["ADMIN", "CEO", "BDM"]],
  ["/calls", ["ADMIN", "CEO", "BDM"]],
  ["/slots", ["ADMIN", "CEO", "BDM"]],
  ["/setters", ["ADMIN", "CEO", "BDM"]],
  ["/statements", ["ADMIN", "CEO", "BDM"]],
  ["/estimating", ["ADMIN", "CEO", "ESTIMATOR", "ACCOUNTS"]],
  ["/jobs/buildertrend", ["ADMIN", "CEO", "PM"]],
  ["/jobs", ["ADMIN", "CEO", "ACCOUNTS", "PM"]],
  ["/wip", ["ADMIN", "CEO", "ACCOUNTS", "PM"]],
  ["/team", ["ADMIN", "CEO", "TEAM", "BDM", "PM", "FOREMAN"]],
  ["/portal", ["SETTER", "TEAM", "ADMIN", "CEO"]],
  ["/myday", [...ROLES]],
  ["/calendar", [...ROLES]],
];
/** Staff who can also LOOK at every other part of the CRM (view only: save buttons hidden, saves refused on the server). */
export const STAFF_VIEWERS: AnyRole[] = ["ESTIMATOR", "PM", "FOREMAN"];
const VIEW_AREAS = ["/dashboard", "/leads", "/calls", "/jobs", "/wip", "/estimating", "/accounts", "/setters", "/team"];
const NEVER_VIEW = ["/users", "/xero", "/accounts/settings", "/jobs/buildertrend"];

const under = (path: string, p: string) => path === p || path.startsWith(p + "/");
/** Can this role change things here (or open it at all, for areas without a view-only mode)? */
function baseCanOpen(role: AnyRole, path: string): boolean | null {
  const hit = AREAS.filter(([p]) => under(path, p)).sort((a, b) => b[0].length - a[0].length)[0];
  if (!hit) return null; // not an area this file controls
  return hit[1].includes(role);
}
const staffMayView = (role: AnyRole, path: string) => STAFF_VIEWERS.includes(role) && VIEW_AREAS.some((p) => under(path, p)) && !NEVER_VIEW.some((p) => under(path, p)) && !/\/new$/.test(path);
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
    case "FOREMAN": return "/myday";
    case "ESTIMATOR": return "/estimating";
    case "ACCOUNTS": return "/accounts";
    case "TEAM": return "/team";
    default: return "/portal";
  }
}

/** The menu for each role, in order. */
export function menuFor(role: AnyRole, opts: { setterId?: string | null; leadsSlug: string; teamView?: { accounts: boolean; setterPay: boolean } }): [string, string][] {
  const base: [string, string][] = [["/myday", "My Day"], ["/calendar", "Calendar"]];
  const L = opts.leadsSlug;
  switch (role) {
    case "ADMIN": case "CEO": return [...base, ["/dashboard", "Dashboard"], [`/leads/${L}`, "Leads"], ["/jobs", "Jobs"], ["/wip", "WIP"], ["/estimating", "Estimating"], ["/accounts", "Accounts"], ["/leads/consulting", "Consulting"], ["/team", "Directory"], ["/setters", "Setters"], ["/setters/calls", "Call lists"], ["/tasks", "Team tasks"], ["/kpis", "KPIs"], ["/users", "Users"]];
    case "BDM": return [...base, ["/dashboard", "Dashboard"], [`/leads/${L}`, "Leads"], ["/leads/consulting", "Consulting"], ["/team", "Directory"], ["/setters", "Setters"], ["/estimating", "Estimating"]];
    case "PM": return staffMenu([...base, ["/jobs", "Jobs"], ["/wip", "WIP"], ["/team", "Directory"]], L);
    case "FOREMAN": return staffMenu([...base, ["/team", "Directory"]], L);
    case "ESTIMATOR": return staffMenu([...base, ["/estimating", "Estimating"]], L);
    case "ACCOUNTS": return [...base, ["/accounts", "Accounts"], ["/jobs", "Jobs"], ["/wip", "WIP"], ["/estimating", "Estimating"]];
    case "SETTER": return [...base, ["/portal", "My Calls"]];
    case "TEAM": return [...base, ["/team", "Directory"], ...(opts.setterId ? ([["/portal", "My Calls"]] as [string, string][]) : []),
      ["/dashboard", "Dashboard"], [`/leads/${L}`, "Leads"], ["/jobs", "Jobs"], ["/wip", "WIP"], ["/estimating", "Estimating"],
      ...(opts.teamView?.accounts ? ([["/accounts", "Accounts"]] as [string, string][]) : []), ["/leads/consulting", "Consulting"],
      ...(opts.teamView?.setterPay ? ([["/setters", "Setters"]] as [string, string][]) : [])];
  }
}

/** Estimating, PMs and the foreman: their own pages, then the rest of the CRM to look at. */
function staffMenu(own: [string, string][], L: string): [string, string][] {
  const all: [string, string][] = [["/dashboard", "Dashboard"], [`/leads/${L}`, "Leads"], ["/leads/consulting", "Consulting"], ["/jobs", "Jobs"], ["/wip", "WIP"], ["/estimating", "Estimating"], ["/accounts", "Accounts"], ["/team", "Directory"], ["/setters", "Setters"]];
  return [...own, ...all.filter(([h]) => !own.some(([o]) => o === h))];
}
