import { getUser } from "@/lib/auth";
import { loadFile } from "@/lib/files";

// Files attached to leads, leases and concepts. Signed-in staff only (not the shared team login).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u || !["ADMIN", "BDM", "PM", "ESTIMATOR", "ACCOUNTS", "FOREMAN"].includes(u.role)) return new Response("Not allowed", { status: 403 });
  const { id } = await ctx.params;
  const f = await loadFile(id);
  if (!f) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(f.data), { headers: { "Content-Type": f.meta.type, "Content-Disposition": `inline; filename="${f.meta.name.replace(/[^\x20-\x7e]+/g, "-").replace(/["\\]/g, "")}"; filename*=UTF-8''${encodeURIComponent(f.meta.name)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
