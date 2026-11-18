"use server";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE, signSession } from "@/lib/session";
import { homeFor } from "@/lib/auth";
import { audit } from "@/lib/automations";

// Brute-force guard: 5 wrong passwords for an email locks that email for 15 minutes.
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const fails = new Map<string, { count: number; until: number }>();

export async function login(_: unknown, fd: FormData) {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const now = Date.now();
  const f = fails.get(email);
  if (f && f.until > now) {
    return { error: "Too many wrong attempts. Try again in 15 minutes." };
  }
  const u = await prisma.user.findUnique({ where: { email } });
  if (!u || !u.active || !(await bcrypt.compare(password, u.passwordHash))) {
    const count = (f && f.until <= now && f.until !== 0 ? 0 : f?.count ?? 0) + 1;
    fails.set(email, { count, until: count >= MAX_FAILS ? now + LOCK_MS : 0 });
    await new Promise((r) => setTimeout(r, 400));
    return { error: "Email or password is incorrect." };
  }
  fails.delete(email);
  const token = await signSession({ uid: u.id, email: u.email, name: u.name, role: u.role as "ADMIN" | "TEAM" | "SETTER" | "ESTIMATOR" | "ACCOUNTS", setterId: u.setterId });
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 12, secure: process.env.COOKIE_SECURE === "true" || (process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false") });
  await audit(u.email, "login", "User", u.id);
  redirect(homeFor(u.role as "ADMIN"));
}
