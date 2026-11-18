import "server-only";
import { cookies } from "next/headers";
export type BrandFilter = "ENP" | "DR" | "ALL";
export async function getBrand(): Promise<BrandFilter> {
  const v = (await cookies()).get("brand")?.value;
  return v === "DR" || v === "ALL" ? v : "ENP";
}
