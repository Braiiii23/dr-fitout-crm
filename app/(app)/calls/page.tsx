import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";

// The Call List is now only for setters (their "My Calls"). Everyone else uses the Directory.
// Individual call pages (/calls/{id}) still open from links on leads and the dashboard.
export default async function CallsMoved() {
  const u = await requireUser();
  redirect(u.role === "SETTER" ? "/portal" : "/team");
}
