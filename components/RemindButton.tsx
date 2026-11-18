"use client";
import { useState, useTransition } from "react";
import { remindAboutLead } from "@/app/(app)/dashboard/reminders";

export function RemindButton({
  leadId,
  kind = "chase",
  due,
  label,
}: {
  leadId: string;
  kind?: "chase" | "quote";
  due?: string | null;
  label?: string;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="inline-flex flex-col gap-0.5">
      <button
        type="button"
        className="btn-ghost py-1 text-xs"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const fd = new FormData();
            fd.set("leadId", leadId);
            fd.set("kind", kind);
            if (due) fd.set("due", due);
            const r = await remindAboutLead(fd);
            setMsg(r.reply);
          })
        }
      >
        {pending ? "…" : label ?? (kind === "quote" ? "Remind me · quote" : "Remind me · Anita")}
      </button>
      {msg && <span className="text-[10px] text-slate-500 max-w-[14rem] leading-snug">{msg}</span>}
    </div>
  );
}
