import { SignJWT, jwtVerify } from "jose";
export const SESSION_COOKIE = "enp_session";
export type SessionPayload = { uid: string; email: string; name: string; role: "ADMIN" | "CEO" | "BDM" | "PM" | "FOREMAN" | "TEAM" | "SETTER" | "ESTIMATOR" | "ACCOUNTS"; setterId: string | null };
const key = () => {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret === "CHANGE_ME" || secret.length < 32) {
    if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set to a random value of at least 32 characters");
    return new TextEncoder().encode("dev-only-insecure-secret-change-me");
  }
  return new TextEncoder().encode(secret);
};
export async function signSession(p: SessionPayload) {
  return new SignJWT(p as unknown as Record<string, unknown>).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("12h").sign(key());
}
export async function verifySession(token?: string): Promise<SessionPayload | null> {
  if (!token) return null;
  try { const { payload } = await jwtVerify(token, key()); return payload as unknown as SessionPayload; } catch { return null; }
}
