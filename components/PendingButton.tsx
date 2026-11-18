"use client";
import { useFormStatus } from "react-dom";
/** A submit button that shows a waiting message while the server works (e.g. the AI concept fit). */
export default function PendingButton({ children, pending, className = "btn" }: { children: React.ReactNode; pending: string; className?: string }) {
  const s = useFormStatus();
  return <button className={className} disabled={s.pending} aria-busy={s.pending || undefined}>{s.pending ? pending : children}</button>;
}
