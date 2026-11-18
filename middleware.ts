import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "./lib/session";
import { canOpen, homeFor, type AnyRole } from "./lib/access";

const BRAIDEN_EMAIL = "braiden@enpfitouts.com.au";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // The lead bot authenticates with its own key inside these routes.
  if (pathname.startsWith("/api/bot")) return NextResponse.next();
  // Teammate bots (Leadardo, Count Dollarcula, Anita): CRM_HOOK_SECRET is checked inside each /api/internal route.
  if (pathname.startsWith("/api/internal/")) return NextResponse.next();
  // Personal calendar feeds (private token in the address) for Google / Outlook to subscribe to.
  if (pathname.startsWith("/cal/")) return NextResponse.next();
  // Grok full access: GROK_ADMIN_KEY is checked inside each /api/grok route.
  if (pathname === "/api/grok" || pathname.startsWith("/api/grok/")) return NextResponse.next();
  if (pathname.startsWith("/login") || pathname.startsWith("/_next") || pathname === "/favicon.ico" || pathname.startsWith("/brand/") || pathname.startsWith("/icons/") || pathname === "/manifest.webmanifest" || pathname === "/icon.png") return NextResponse.next();
  const s = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return NextResponse.redirect(new URL("/login", req.url));

  const email = (s.email || "").trim().toLowerCase();
  // CEO = full admin. Any other ADMIN flag (not Braiden) is treated as the team login.
  const isBraidenAdmin = (s.role === "ADMIN" && email === BRAIDEN_EMAIL) || s.role === "CEO";
  const effectiveRole = (s.role === "ADMIN" && email !== BRAIDEN_EMAIL ? "TEAM" : s.role === "CEO" ? "ADMIN" : s.role) as AnyRole;

  const under = (p: string) => pathname === p || pathname.startsWith(p + "/");
  // My Day and the team calendar are for everyone (each person only ever edits their own).
  if (under("/myday") || under("/calendar")) return NextResponse.next();
  // Team login: view-only access to most pages (each page and every save also checks the role on the server).
  // Never: logins/passwords, the Xero connection, BuilderTrend settings, Accounts settings, or "new" forms.
  if (effectiveRole === "TEAM") {
    const never = under("/users") || under("/xero") || under("/jobs/buildertrend") || under("/accounts/settings") || /\/new$/.test(pathname);
    const view = ["/dashboard", "/leads", "/calls", "/estimating", "/jobs", "/wip", "/slots", "/accounts", "/setters", "/statements"].some(under);
    if (never) return NextResponse.redirect(new URL("/team", req.url));
    if (view) { const ok = NextResponse.next(); ok.headers.set("X-Robots-Tag", "noindex, nofollow"); return ok; }
  }
  // Everything else: the access rules in lib/access.ts (pages and every save check the role again on the server).
  const ok = canOpen(effectiveRole, pathname);
  if (ok === false) return NextResponse.redirect(new URL(homeFor(effectiveRole), req.url));
  if (effectiveRole === "SETTER" && pathname.startsWith("/team")) return NextResponse.redirect(new URL("/portal", req.url));
  const res = NextResponse.next();
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}
export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
