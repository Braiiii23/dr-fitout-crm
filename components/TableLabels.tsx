"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
// On phones, tables are shown as stacked cards. Each cell needs its column name as a label,
// so this copies the header text onto every cell (data-label) and marks empty cells.
function label() {
  document.querySelectorAll<HTMLTableElement>("table.table, table.dir-table").forEach((t) => {
    const heads = Array.from(t.querySelectorAll("thead th")).map((th) => th.textContent?.trim() ?? "");
    t.querySelectorAll("tbody tr").forEach((tr) => {
      Array.from(tr.children).forEach((td, i) => {
        const el = td as HTMLElement;
        if (heads[i] && el.dataset.label !== heads[i]) el.dataset.label = heads[i];
        const txt = el.textContent?.trim() ?? "";
        const empty = !el.querySelector("input,select,button,a,img") && (txt === "" || txt === "—" || txt === "-");
        if (empty) el.dataset.empty = "1"; else delete el.dataset.empty;
      });
    });
  });
}
export default function TableLabels() {
  const path = usePathname();
  useEffect(() => {
    label();
    const mo = new MutationObserver(() => label());
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [path]);
  return null;
}
