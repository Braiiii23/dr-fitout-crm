import Link from "next/link";
import type { CurrentUser } from "@/lib/auth";
import { menuFor, ROLE_LABEL, type AnyRole } from "@/lib/access";

export default function Nav({ user, hide = [] }: { user: CurrentUser; hide?: string[] }) {
  const links = menuFor(user.role).filter(([href]) => !hide.includes(href));
  const roleLabel = user.role === "ADMIN" ? "Admin" : ROLE_LABEL[user.role as AnyRole] ?? user.role;
  return (
    <header className="nav-bar brand-bar text-white shadow">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <Link prefetch={false} href="/" className="logo-chip logo-chip-light flex items-center" aria-label="DR Fitout">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/dr-logo-nav.png" alt="DR Fitout" className="logo-img logo-img-dr" />
        </Link>
        <nav className="nav-links flex flex-wrap gap-1 text-sm">
          {links.map(([href, label]) => (
            <Link prefetch={false} key={href} href={href} className="nav-link rounded-full px-3 py-1.5 hover:bg-white/15">{label}</Link>
          ))}
        </nav>
        <div className="nav-user ml-auto flex items-center gap-3 text-sm">
          <span className="nav-name hidden sm:inline">{user.name} · <span className="opacity-80">{roleLabel}</span></span>
          <form action="/logout" method="post"><button className="signout-btn rounded-full bg-white/15 px-3 py-1.5 hover:bg-white/25" aria-label="Sign out" title="Sign out">
            <svg className="signout-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
            <span className="signout-text">Sign out</span>
          </button></form>
        </div>
      </div>
    </header>
  );
}
