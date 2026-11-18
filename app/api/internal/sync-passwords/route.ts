import bcrypt from "bcryptjs";
import { NextResponse, type NextRequest } from "next/server";
import { isInternalAuthorised } from "@/lib/internal-api";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Align User.passwordHash with ADMIN_/SETTER_/TEAM_PASSWORD env vars. */
export async function POST(req: NextRequest) {
  if (!isInternalAuthorised(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }

  const accounts = [
    { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD, role: "ADMIN" },
    { email: process.env.SETTER_EMAIL, password: process.env.SETTER_PASSWORD, role: "SETTER" },
    { email: process.env.TEAM_EMAIL, password: process.env.TEAM_PASSWORD, role: "TEAM" },
  ] as const;

  const results: { role: string; email: string; status: string; active?: boolean }[] = [];

  for (const a of accounts) {
    const email = (a.email || "").trim().toLowerCase();
    const password = a.password || "";
    if (!email || !password) {
      results.push({ role: a.role, email: email || "", status: "missing_env" });
      continue;
    }
    const u = await prisma.user.findUnique({ where: { email } });
    if (!u) {
      results.push({ role: a.role, email, status: "no_user" });
      continue;
    }
    const matches = await bcrypt.compare(password, u.passwordHash);
    if (matches && u.active) {
      results.push({ role: a.role, email, status: "ok", active: true });
      continue;
    }
    const passwordHash = matches ? u.passwordHash : await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id: u.id },
      data: { passwordHash, active: true },
    });
    results.push({
      role: a.role,
      email,
      status: matches ? "activated" : "updated",
      active: true,
    });
  }

  return NextResponse.json({ ok: true, results });
}

export async function GET(req: NextRequest) {
  if (!isInternalAuthorised(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }
  const users = await prisma.user.findMany({
    select: { email: true, role: true, active: true, name: true },
    orderBy: { email: "asc" },
  });
  return NextResponse.json({ ok: true, users });
}
