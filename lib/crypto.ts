import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
// AES-256-GCM with a key derived from SESSION_SECRET. Used for the Xero tokens stored in the database.
const key = () => createHash("sha256").update("xero-tokens:" + (process.env.SESSION_SECRET || "dev-only-insecure-secret-change-me")).digest();
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}
export function decrypt(packed: string): string {
  const [iv, tag, data] = packed.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}
