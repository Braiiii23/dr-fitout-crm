import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";
export async function POST() {
  // Relative redirect: behind Railway's proxy the server's own URL is 0.0.0.0:3100,
  // so building an absolute URL from req.url sent people to a dead address.
  const res = new NextResponse(null, { status: 303, headers: { Location: "/login" } });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
