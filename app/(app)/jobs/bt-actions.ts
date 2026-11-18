"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/automations";
import { setFeedUrl, syncBuildertrend } from "@/lib/buildertrend";

const refresh = () => { revalidatePath("/jobs"); revalidatePath("/jobs/buildertrend"); revalidatePath("/wip"); };

export async function saveBtLink(fd: FormData) {
  const u = await requireUser(["ADMIN", "PM"]);
  const url = String(fd.get("url") ?? "").trim();
  // https or webcal only (plain http allowed just for local testing with BT_ALLOW_HTTP=1).
  if (url && !/^(https|webcal):\/\/\S+$/i.test(url) && !(process.env.BT_ALLOW_HTTP === "1" && /^http:\/\/\S+$/.test(url))) return;
  await setFeedUrl(url || null);
  await audit(u.email, url ? "buildertrend link saved" : "buildertrend link removed", "Integration");
  if (url) await syncBuildertrend();
  refresh();
}

export async function btSyncNow() {
  await requireUser(["ADMIN", "PM"]);
  await syncBuildertrend();
  refresh();
}

/** Link a BuilderTrend job name to an existing CRM job, or create a new job for it, then sync. */
export async function btLinkJob(fd: FormData) {
  const u = await requireUser(["ADMIN", "PM"]);
  const name = String(fd.get("btName") ?? "").trim(); const jobId = String(fd.get("jobId") ?? "");
  if (!name) return;
  if (jobId === "new") {
    const brand = "DR";
    await prisma.job.create({ data: { name, btJobName: name, brand, status: "Live", startDate: String(fd.get("first") || "") || null, finishDate: String(fd.get("last") || "") || null, source: "buildertrend", notes: "Created from BuilderTrend's schedule. Add the contract value and claim split." } });
  } else if (jobId) {
    await prisma.job.update({ where: { id: jobId }, data: { btJobName: name } });
  }
  await audit(u.email, "buildertrend job linked", "Job", jobId || undefined, name);
  await syncBuildertrend();
  refresh();
}
