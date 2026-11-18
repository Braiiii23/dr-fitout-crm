import Link from "next/link";
import { prisma } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth";
import ActionForm from "@/components/ActionForm";
import { NOTICE_CATEGORIES } from "@/lib/notices";
import { pinNotice, postNotice, removeNotice, replyNotice } from "@/app/(app)/myday/notice-actions";

const when = (d: Date) => {
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now"; if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60); if (h < 24) return `${h}h ago`;
  return new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Brisbane", day: "numeric", month: "short" }).format(d);
};
const CAT: Record<string, string> = { Update: "nb-update", Progress: "nb-progress", Win: "nb-win", "Heads up": "nb-heads", Site: "nb-site" };

/** My Day notice board: updates and progress for everyone. */
export default async function NoticeBoard({ u, filter }: { u: CurrentUser; filter?: string }) {
  const cat = NOTICE_CATEGORIES.includes(filter ?? "") ? filter : filter === "people" ? "people" : "";
  const notices = await prisma.notice.findMany({
    where: cat === "people" ? { auto: false } : cat ? { category: cat } : {},
    include: { replies: { orderBy: { createdAt: "asc" } } },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }], take: 40,
  });
  const tab = (v: string, label: string) => <Link prefetch={false} key={v} href={`/myday${v ? `?board=${encodeURIComponent(v)}` : ""}#board`} className={`lease-tab ${cat === v ? "is-on" : ""}`}>{label}</Link>;
  return (
    <section id="board" className="card acc-pad nb">
      <div className="acc-head"><h2 className="est-h2">Notice board</h2><span className="acc-muted">Updates and progress for the whole team. The CRM posts stage moves, signed work and concept fits here too.</span></div>
      <ActionForm action={postNotice} className="nb-post">
        <textarea name="body" rows={2} className="input" placeholder="Share an update: what's moving, what's done, what people need to know…" required maxLength={4000} />
        <div className="nb-post-row">
          <select name="category" className="input" aria-label="Type" defaultValue="Update">{NOTICE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          <input name="link" className="input" placeholder="Link in the CRM (optional), e.g. /leases/…" maxLength={300} />
          {u.role === "ADMIN" && <label className="flex items-center gap-1 text-sm whitespace-nowrap"><input type="checkbox" name="pinned" /> Pin</label>}
          <button className="btn">Post</button>
        </div>
      </ActionForm>
      <nav className="mt-3 flex flex-wrap gap-2">{tab("", "Everything")}{tab("people", "From people")}{NOTICE_CATEGORIES.map((c) => tab(c, c))}</nav>
      <ul className="nb-list">
        {notices.map((n) => (
          <li key={n.id} className={`nb-item ${n.pinned ? "is-pinned" : ""} ${n.auto ? "is-auto" : ""}`}>
            <div className="nb-head">
              <span className="nb-avatar" aria-hidden="true">{n.auto ? "◆" : n.authorName.split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
              <b>{n.authorName}</b><span className={`badge ${CAT[n.category] ?? "nb-update"}`}>{n.category}</span>
              {n.pinned && <span className="badge nb-pin">Pinned</span>}
              <span className="acc-muted text-xs">{when(n.createdAt)}</span>
              <span className="ml-auto flex gap-2">
                {u.role === "ADMIN" && <form action={pinNotice}><input type="hidden" name="id" value={n.id} /><button className="text-xs acc-muted underline">{n.pinned ? "Unpin" : "Pin"}</button></form>}
                {(u.role === "ADMIN" || n.authorId === u.id) && <form action={removeNotice}><input type="hidden" name="id" value={n.id} /><button className="text-xs acc-muted underline">Remove</button></form>}
              </span>
            </div>
            <p className="nb-body">{n.body}</p>
            {n.link && <Link prefetch={false} href={n.link} className="text-sm brand-text underline">{n.linkLabel ?? "Open"} →</Link>}
            {n.replies.length > 0 && <ul className="nb-replies">{n.replies.map((r) => <li key={r.id}><b>{r.authorName}</b> <span className="acc-muted text-xs">{when(r.createdAt)}</span><p>{r.body}</p></li>)}</ul>}
            <ActionForm action={replyNotice} className="nb-reply"><input type="hidden" name="noticeId" value={n.id} /><input name="body" className="input" placeholder="Reply…" required maxLength={2000} /><button className="btn-ghost">Reply</button></ActionForm>
          </li>
        ))}
        {!notices.length && <li className="acc-muted text-sm">Nothing posted yet. Be the first: share what you&apos;re working on.</li>}
      </ul>
    </section>
  );
}
