"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { askAssistant } from "@/app/(app)/assistant-actions";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS: Record<string, string[]> = {
  accounts: ["Do we need more work?", "Which invoices should we chase first?", "Why is cash forecast to drop?"],
  estimating: ["Which quotes are stuck?", "What's missing from this trade pack?", "Which jobs are under the GP goal?"],
  portal: ["Who should I call next?", "How many call-backs do I have?"],
  team: ["Who's in the directory for designers?"],
  default: ["What needs attention today?", "Which follow-ups are overdue?"],
};

/** Floating "Ask" assistant on every page. Answers from the data this login can see, for the page being viewed. */
export default function AssistantWidget({ name }: { name: string }) {
  const path = usePathname() || "/";
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs, busy, open]);
  const key = path.startsWith("/accounts") ? "accounts" : path.startsWith("/estimating") ? "estimating" : path.startsWith("/portal") ? "portal" : path.startsWith("/directory") ? "team" : "default";

  async function send(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    const next = [...msgs, { role: "user" as const, content: question }];
    setMsgs(next); setText(""); setBusy(true); setErr(null);
    const r = await askAssistant(next, path);
    setBusy(false);
    if (r.answer) setMsgs([...next, { role: "assistant", content: r.answer }]); else setErr(r.error ?? "Something went wrong.");
  }

  return (
    <div className="aw no-print">
      {open && (
        <section className="aw-panel" aria-label="Assistant">
          <header className="aw-head">
            <b>Assistant</b>
            <span>Answers from this page&apos;s data</span>
            <button type="button" className="aw-x" aria-label="Close assistant" onClick={() => setOpen(false)}>×</button>
          </header>
          <div className="aw-body">
            {msgs.length === 0 && (
              <div className="aw-empty">
                <p>Hi {name.split(" ")[0]}. Ask about anything on this page.</p>
                <div className="aw-sugs">{SUGGESTIONS[key].map((s) => <button key={s} type="button" onClick={() => send(s)}>{s}</button>)}</div>
              </div>
            )}
            {msgs.map((m, i) => <div key={i} className={`aw-msg aw-${m.role}`}>{m.content}</div>)}
            {busy && <div className="aw-msg aw-assistant aw-typing">Thinking…</div>}
            {err && <div className="aw-err" role="alert">{err}</div>}
            <div ref={endRef} />
          </div>
          <form className="aw-form" onSubmit={(e) => { e.preventDefault(); send(text); }}>
            <label className="sr-only" htmlFor="aw-input">Ask the assistant</label>
            <input id="aw-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask a question…" maxLength={1000} autoComplete="off" />
            <button type="submit" disabled={busy || !text.trim()}>Send</button>
          </form>
        </section>
      )}
      <button type="button" className="aw-fab" aria-expanded={open} aria-label={open ? "Close assistant" : "Open assistant"} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>
        <span>Ask</span>
      </button>
    </div>
  );
}
