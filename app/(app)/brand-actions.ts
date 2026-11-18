"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
export async function switchBrand(fd: FormData) {
  const b = String(fd.get("brand"));
  const v = b === "DR" || b === "ALL" ? b : "ENP";
  (await cookies()).set("brand", v, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  const back = String(fd.get("back") || "/");
  // On a brand pipeline page, jump to the other brand's pipeline
  if (back.startsWith("/leads/enp") || back.startsWith("/leads/dr")) redirect(v === "DR" ? "/leads/dr" : "/leads/enp");
  redirect(back.startsWith("/") ? back : "/");
}
