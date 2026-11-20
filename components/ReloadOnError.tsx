"use client";
import { useEffect } from "react";

/** After an app update, a page that was already open can call code that no longer exists.
 *  Reload once to pick up the new version; if it still fails, show a plain message with a button. */
export default function ReloadOnError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    const key = "dr-reloaded-at";
    let last = 0; try { last = Number(sessionStorage.getItem(key) || 0); } catch { /* storage blocked */ }
    if (Date.now() - last > 60_000) {
      try { sessionStorage.setItem(key, String(Date.now())); } catch { /* ignore */ }
      window.location.reload();
    }
  }, [error]);
  return (
    <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: "2rem", textAlign: "center" }}>
      <div>
        <p style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: ".5rem" }}>Something went wrong loading this page.</p>
        <p style={{ opacity: 0.75, marginBottom: "1rem" }}>The app may have just been updated. Reload to get the latest version.</p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>Reload</button>{" "}
        <button type="button" className="btn-ghost" onClick={() => reset()}>Try again</button>
      </div>
    </div>
  );
}
