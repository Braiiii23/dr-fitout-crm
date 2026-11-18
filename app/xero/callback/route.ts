import { NextResponse, type NextRequest } from "next/server";
import { getUser } from "@/lib/auth";
import { audit } from "@/lib/automations";
import { completeConnection, syncXero } from "@/lib/xero";

const back = (q: string) => new NextResponse(null, { status: 303, headers: { Location: `/accounts?${q}` } });

// Xero sends the person back here after they approve (or cancel) the connection.
export async function GET(req: NextRequest) {
  const u = await getUser();
  if (!u || (u.role !== "ADMIN" && u.role !== "ACCOUNTS")) return new NextResponse(null, { status: 303, headers: { Location: "/login" } });
  const sp = req.nextUrl.searchParams;
  const err = sp.get("error");
  if (err) return back(`xero=${err === "invalid_scope" ? "scope" : "cancelled"}`);
  const state = req.cookies.get("xero_state")?.value;
  if (!state || state !== sp.get("state")) return back("xero=expired");
  const code = sp.get("code");
  if (!code) return back("xero=cancelled");
  try {
    const org = await completeConnection(code, u.email);
    await audit(u.email, "xero connected", "Xero", undefined, org);
    try { await syncXero(); } catch { /* the page shows sync problems */ }
    const res = back("xero=connected");
    res.cookies.set("xero_state", "", { path: "/xero", maxAge: 0 });
    return res;
  } catch (e) {
    console.error("[xero] connect failed:", (e as Error).message);
    return back("xero=failed");
  }
}
