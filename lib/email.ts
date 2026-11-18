import "server-only";
import { prisma } from "./db";

/** Sends an email through Resend when RESEND_API_KEY (and EMAIL_FROM) are set; otherwise just records it.
 *  Every email is logged in EmailLog either way. */
export async function sendEmail(to: string, subject: string, text: string): Promise<"sent" | "not sent (no email service)" | "failed"> {
  const key = process.env.RESEND_API_KEY, from = process.env.EMAIL_FROM;
  let status: "sent" | "not sent (no email service)" | "failed" = "not sent (no email service)";
  if (key && from) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: to.split(/[,;]\s*/).filter(Boolean), subject, text }), signal: AbortSignal.timeout(15000),
      });
      status = res.ok ? "sent" : "failed";
    } catch { status = "failed"; }
  }
  await prisma.emailLog.create({ data: { to, subject, body: text.slice(0, 8000), status } });
  return status;
}
