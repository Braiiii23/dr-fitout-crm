"use client";
import { useState } from "react";
/** A block of text with a Copy button (e.g. the team's finished list for the email). */
export default function CopyText({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="tk-email">
      <div className="tk-email-head"><span className="label">{label}</span><button type="button" className="acc-link" onClick={async () => { await navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? "Copied" : "Copy"}</button></div>
      <pre>{text}</pre>
    </div>
  );
}
