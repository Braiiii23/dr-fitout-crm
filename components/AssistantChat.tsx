"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assistantChat } from "@/app/(app)/portal/assistant";

type Msg = { from: "user" | "bot"; text: string };
export function AssistantChat({ name, brand }: { name: string; brand: "ENP" | "DR" | "ALL" }) {
  const [open, setOpen] = useState(true);
  const [msgs, setMsgs] = useState<Msg[]>([{ from: "bot", text: `Hi ${name}! Tell me what happened on a call — e.g. “mark Smith as no answer”, “add note on Acme: left voicemail”, “+1 attempt on Jane”.` }]);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const endRef = useRef<HTMLDivElement>(null);
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const m = text.trim(); if (!m || pending) return;
    setText(""); setMsgs((x) => [...x, { from: "user", text: m }]);
    start(async () => {
      let r; try { r = await assistantChat(m, brand); } catch { r = { ok: false, reply: "Something went wrong — try again." }; }
      setMsgs((x) => [...x, { from: "bot", text: r.reply }]);
      if (r.ok) router.refresh();
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    });
  };
  return (
    <div className="chat-panel mb-4">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-2 text-sm font-bold brand-text">
        <span>💬 Ask Jessie&apos;s assistant</span><span className="text-xs text-slate-500">{open ? "Hide" : "Show"}</span>
      </button>
      {open && <div className="border-t border-slate-100 px-4 pb-3">
        <div className="flex max-h-56 flex-col gap-2 overflow-y-auto py-3">
          {msgs.map((m, i) => <div key={i} className={m.from === "user" ? "chat-msg-user" : "chat-msg-bot"}>{m.text}</div>)}
          {pending && <div className="chat-msg-bot opacity-70">…</div>}
          <div ref={endRef} />
        </div>
        <form onSubmit={send} className="flex gap-2">
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. mark Smith as no answer" maxLength={500} />
          <button className="btn" disabled={pending || !text.trim()}>Send</button>
        </form>
        <p className="mt-1 text-[11px] text-slate-500">Updates only your own call cards (status, notes, attempts). No money edits.</p>
      </div>}
    </div>
  );
}
