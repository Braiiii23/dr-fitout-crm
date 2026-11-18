import "server-only";
import { prisma } from "./db";
import { brisbaneToday } from "./time";
import { claimPlan } from "./claim-timing";
import { sendEmail } from "./email";
import { createReminder } from "./reminders";

const aud = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dm = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/** Checks every live job's program and tells accounts about claims coming up (a few days ahead) and ready to invoice.
 *  Each claim gets at most one "coming up" and one "ready" notice; if its date moves, the next stage still fires once. */
export async function runClaimNotices(appUrl = process.env.APP_URL ?? "") {
  const today = brisbaneToday();
  const settings = await prisma.accountsSettings.findUnique({ where: { id: "settings" } });
  const terms = settings?.claimTermsDays ?? 10, ahead = settings?.claimNoticeDays ?? 3, to = settings?.claimNotifyEmail ?? "accounts@enpfitouts.com.au";
  const jobs = await prisma.job.findMany({ where: { status: "Live" }, include: { claims: true, tasks: true } });
  let sent = 0;
  for (const job of jobs) {
    for (const p of claimPlan(job, today, terms, ahead)) {
      if (p.state !== "ready" && p.state !== "soon") continue;
      const claim = job.claims.find((c) => c.id === p.claimId)!;
      const kind = p.state === "ready" ? "ready" : "soon";
      if (kind === "ready" ? claim.noticeReadyAt : claim.noticeSoonAt || claim.noticeReadyAt) continue;
      const brand = job.brand === "DR" ? "DR Fitout" : "ENP Fitouts";
      const title = kind === "ready"
        ? `Invoice now: ${job.name} claim ${p.seq} (${p.pct}%) ${aud(p.amountInc)} inc GST`
        : `Coming up ${dm(p.issueOn!)}: ${job.name} claim ${p.seq} (${p.pct}%) ${aud(p.amountInc)} inc GST`;
      const body = [
        `${brand} · ${job.name}${job.jobNumber ? ` (job ${job.jobNumber})` : ""}${job.xeroTracking ? ` · Xero tracking ${job.xeroTracking}` : ""}`,
        `Client: ${job.client ?? "—"}`,
        `Claim ${p.seq}: ${p.name}, ${p.pct}% of the ${aud(job.contractValue)} contract`,
        `Amount: ${aud(p.amount)} ex GST / ${aud(p.amountInc)} inc GST`,
        `${kind === "ready" ? "Ready to invoice" : "Due to be invoiced"}: ${dm(p.issueOn!)} (${p.basis})`,
        p.tasks.length ? `Milestone tasks: ${p.tasks.map((t) => `${t.name} ${t.done ? "done" : `finishes ${dm(t.finish)}`}`).join("; ")}` : "",
        `Suggested due date: ${p.dueOn ? dm(p.dueOn) : "—"} (${terms} days)`,
        claim.invoiceNumber ? `Invoice number on file: ${claim.invoiceNumber}` : "",
        appUrl ? `Open in the CRM: ${appUrl}/accounts` : "",
      ].filter(Boolean).join("\n");
      const emailed = await sendEmail(to, title, body);
      let reminderId: string | null = null;
      try {
        const r = await createReminder({ title, description: body, dueString: p.issueOn, company: job.client, brand: job.brand, source: "wip", createdBy: "wip" });
        reminderId = r.id || null;
      } catch { /* the in-app notice still shows */ }
      await prisma.claimNotice.create({ data: { jobId: job.id, claimId: claim.id, kind, issueOn: p.issueOn!, amountInc: p.amountInc, title, body, emailed, reminderId } });
      await prisma.jobClaim.update({ where: { id: claim.id }, data: kind === "ready" ? { noticeReadyAt: new Date(), noticeSoonAt: claim.noticeSoonAt ?? new Date() } : { noticeSoonAt: new Date() } });
      sent++;
    }
  }
  return sent;
}
