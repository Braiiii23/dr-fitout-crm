"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { askAssistant, applyAssistantChanges, cancelAssistantChanges, type PendingView } from "@/app/(app)/assistant-actions";

type Msg = { role: "user" | "assistant"; content: string };
type Result = { label: string; ok: boolean; error?: string; link?: string };
type Batch = PendingView & { state: "pending" | "applying" | "done" | "cancelled"; results?: Result[]; error?: string };

const SUGGESTIONS: Record<string, string[]> = {
  accounts: ["Do we need more work?", "Which invoices should we chase first?", "Why is cash forecast to drop?"],
  estimating: ["Which quotes are stuck?", "What's missing from this trade pack?", "Which jobs are under the GP goal?"],
  portal: ["Who should I call next?", "How many call-backs do I have?"],
  team: ["Who's in the directory for designers?"],
  default: ["What needs attention today?", "Add a note to a lease", "Post an update on the notice board"],
};

/** Floating "Ask" assistant on every page. Answers from the data this login can see, for the page being viewed. */
export default function AssistantWidget({ name }: { name: string }) {
  const path = usePathname() || "/";
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [batches, setBatches] = useState<Record<number, Batch>>({}); // keyed by the assistant message index
  const router = useRouter();
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs, busy, open, batches]);
  const setBatch = (i: number, b: Partial<Batch>) => setBatches((all) => ({ ...all, [i]: { ...all[i], ...b } }));

  async function apply(i: number) {
    const b = batches[i]; if (!b || b.state !== "pending") return;
    setBatch(i, { state: "applying" });
    const r = await applyAssistantChanges(b.id);
    if (r.error) setBatch(i, { state: "pending", error: r.error });
    else { setBatch(i, { state: "done", results: r.results, error: undefined }); router.refresh(); }
  }
  async function cancel(i: number) {
    const b = batches[i]; if (!b) return;
    setBatch(i, { state: "cancelled" });
    await cancelAssistantChanges(b.id);
  }
  const key = path.startsWith("/accounts") ? "accounts" : path.startsWith("/estimating") ? "estimating" : path.startsWith("/portal") ? "portal" : path.startsWith("/directory") ? "team" : "default";

  async function send(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    const next = [...msgs, { role: "user" as const, content: question }];
    setMsgs(next); setText(""); setBusy(true); setErr(null);
    const r = await askAssistant(next, path);
    setBusy(false);
    if (r.answer) {
      setMsgs([...next, { role: "assistant", content: r.answer }]);
      if (r.pending) setBatches((all) => ({ ...all, [next.length]: { ...r.pending!, state: "pending" } }));
    } else setErr(r.error ?? "Something went wrong.");
  }

  return (
    <div className="aw no-print">
      {open && (
        <section className="aw-panel" aria-label="Assistant">
          <header className="aw-head">
            <b>Assistant</b>
            <span>Answers questions · adds and edits for you</span>
            <button type="button" className="aw-x" aria-label="Close assistant" onClick={() => setOpen(false)}>×</button>
          </header>
          <div className="aw-body">
            {msgs.length === 0 && (
              <div className="aw-empty">
                <p>Hi {name.split(" ")[0]}. Ask about anything, or ask me to add or change something. I&apos;ll show you the change first and nothing saves until you press Apply.</p>
                <div className="aw-sugs">{SUGGESTIONS[key].map((s) => <button key={s} type="button" onClick={() => send(s)}>{s}</button>)}</div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className="aw-turn">
                <div className={`aw-msg aw-${m.role}`}>{m.content}</div>
                {batches[i] && <ChangeCard b={batches[i]} onApply={() => apply(i)} onCancel={() => cancel(i)} />}
              </div>
            ))}
            {busy && <div className="aw-msg aw-assistant aw-typing">Thinking…</div>}
            {err && <div className="aw-err" role="alert">{err}</div>}
            <div ref={endRef} />
          </div>
          <form className="aw-form" onSubmit={(e) => { e.preventDefault(); send(text); }}>
            <label className="sr-only" htmlFor="aw-input">Ask the assistant</label>
            <input id="aw-input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask, or tell me what to add or change…" maxLength={1000} autoComplete="off" />
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

function ChangeCard({ b, onApply, onCancel }: { b: Batch; onApply: () => void; onCancel: () => void }) {
  return (
    <div className={`aw-changes aw-changes-${b.state}`}>
      <div className="aw-changes-head">{b.state === "done" ? "Applied" : b.state === "cancelled" ? "Cancelled, nothing saved" : `${b.items.length} change${b.items.length === 1 ? "" : "s"} to check`}</div>
      <ul>
        {b.items.map((it, j) => {
          const res = b.results?.[j];
          return (
            <li key={j}>
              <b>{it.label}</b>{res && (res.ok ? <span className="aw-ok"> ✓ saved{res.link ? <> · <a href={res.link}>open</a></> : null}</span> : <span className="aw-bad"> ✗ {res.error}</span>)}
              {it.reason && <div className="aw-reason">{it.reason}</div>}
              <table><tbody>{it.details.map((d) => (
                <tr key={d.field}><th scope="row">{d.field}</th><td>{d.from !== undefined && <><s>{d.from}</s> → </>}{d.to}</td></tr>
              ))}</tbody></table>
            </li>
          );
        })}
      </ul>
      {b.error && <div className="aw-err" role="alert">{b.error}</div>}
      {(b.state === "pending" || b.state === "applying") && (
        <div className="aw-changes-btns">
          <button type="button" className="aw-apply" onClick={onApply} disabled={b.state === "applying"}>{b.state === "applying" ? "Saving…" : "Apply"}</button>
          <button type="button" className="aw-cancel" onClick={onCancel} disabled={b.state === "applying"}>Cancel</button>
        </div>
      )}
    </div>
  );
}
