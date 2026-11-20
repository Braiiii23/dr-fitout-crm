"use client";
import ReloadOnError from "@/components/ReloadOnError";
export default function GlobalError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="en"><body style={{ background: "#0c0c0e", color: "#f4f4f5", fontFamily: "system-ui, sans-serif" }}><ReloadOnError {...props} /></body></html>;
}
