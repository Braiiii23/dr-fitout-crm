import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { getUser } from "@/lib/auth";
import { authorizeUrl, xeroConfigured } from "@/lib/xero";

// Starts "Connect Xero": sends the person to Xero's own sign-in and approval screen.
export async function GET(req: NextRequest) {
  const u = await getUser();
  if (!u || (u.role !== "ADMIN" && u.role !== "ACCOUNTS")) return new NextResponse(null, { status: 303, headers: { Location: "/login" } });
  if (!xeroConfigured()) return new NextResponse(null, { status: 303, headers: { Location: "/accounts?xero=not-configured" } });
  const state = randomBytes(16).toString("hex");
  const basic = req.nextUrl.searchParams.get("basic") === "1";
  const res = NextResponse.redirect(authorizeUrl(state, basic), 303);
  res.cookies.set("xero_state", state, { httpOnly: true, sameSite: "lax", path: "/xero", maxAge: 600, secure: process.env.NODE_ENV === "production" });
  return res;
}
