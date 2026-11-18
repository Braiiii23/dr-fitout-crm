"use client";
import { usePathname } from "next/navigation";
import { switchBrand } from "@/app/(app)/brand-actions";
export default function BrandSwitch({ brand, allowAll }: { brand: string; allowAll: boolean }) {
  const path = usePathname();
  const opts: [string, string][] = [["ENP", "ENP Fitouts"], ["DR", "DR Fitout"], ...(allowAll ? ([["ALL", "Both"]] as [string, string][]) : [])];
  return (
    <form action={switchBrand} className="brand-switch flex overflow-hidden rounded-full border border-white/35 text-xs shadow-sm">
      <input type="hidden" name="back" value={path} />
      {opts.map(([v, l]) => (
        <button
          key={v}
          name="brand"
          value={v}
          className={`px-3 py-1.5 transition ${brand === v ? "bg-white font-semibold text-slate-900" : "hover:bg-white/15"}`}
        >
          {l}
        </button>
      ))}
    </form>
  );
}
