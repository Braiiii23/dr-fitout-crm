"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { isViewOnly, type AnyRole } from "@/lib/access";

/** "View only" banner, and hides save controls, on pages this login can look at but not change.
 *  (Saves are refused on the server for these logins anyway; this keeps the page tidy.) */
export default function ViewOnlyBanner({ role }: { role: AnyRole }) {
  const path = usePathname() || "/";
  const own = path.startsWith("/directory") || path.startsWith("/portal") || path.startsWith("/myday") || path.startsWith("/calendar");
  const viewOnly = role === "TEAM" ? !own : isViewOnly(role, path);
  useEffect(() => {
    if (role === "TEAM") return; // the team login's layout already marks the page
    if (viewOnly) document.body.dataset.viewer = "true"; else delete document.body.dataset.viewer;
  }, [viewOnly, role]);
  if (!viewOnly) return null;
  return <div className="view-only no-print" role="status">View only. You can look, but changes here are made by {role === "TEAM" ? "Braiden, Justin or accounts" : "the people who run this part of the CRM"}.</div>;
}
