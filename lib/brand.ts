import "server-only";
/** This CRM is DR Fitout only. The brand type is kept so shared code keeps compiling. */
export type BrandFilter = "ENP" | "DR" | "ALL";
export async function getBrand(): Promise<BrandFilter> {
  return "DR";
}
