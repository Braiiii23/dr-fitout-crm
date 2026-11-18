"use client";
import { useEffect, useRef, useState } from "react";

/** A thin bar across the top the moment you click a link to another page, until that page appears.
 *  (Replaces a page-level loading screen, which interfered with pages updating after a save.) */
export default function NavProgress() {
  const [on, setOn] = useState(false);
  const from = useRef("");
  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
      from.current = location.pathname + location.search;
      setOn(true);
    };
    document.addEventListener("click", click, true);
    return () => document.removeEventListener("click", click, true);
  }, []);
  // Off as soon as the address changes (the new page is showing), or after 15 seconds at most.
  useEffect(() => {
    if (!on) return;
    const started = Date.now();
    const t = setInterval(() => { if (location.pathname + location.search !== from.current || Date.now() - started > 15000) setOn(false); }, 120);
    return () => clearInterval(t);
  }, [on]);
  if (!on) return null;
  return <div className="page-loading-bar" role="progressbar" aria-label="Loading page"><span /></div>;
}
