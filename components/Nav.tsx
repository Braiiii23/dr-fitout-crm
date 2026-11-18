import Link from "next/link";
import type { CurrentUser } from "@/lib/auth";
import type { BrandFilter } from "@/lib/brand";
import BrandSwitch from "./BrandSwitch";
import { menuFor } from "@/lib/access";

export default function Nav({ user, brand, teamView }: { user: CurrentUser; brand: BrandFilter; teamView?: { accounts: boolean; setterPay: boolean } }) {
  const leadsSlug = brand === "DR" ? "dr" : "enp";
  const links = menuFor(user.role, { setterId: user.setterId, leadsSlug, teamView });
  const isSetter = user.role === "SETTER";
  const showDr = brand === "DR";
  const logoSrc = showDr ? "/brand/dr-logo-nav.png" : "/brand/enp-logo-nav.png";
  const logoAlt = showDr ? "DR Fitout" : "ENP Fitouts";
  return (
    <header className={`nav-bar text-white shadow ${isSetter ? "nav-bar-setter" : "brand-bar"}`}>
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <Link prefetch={false}
          href={isSetter ? "/portal" : "/"}
          className={`logo-chip flex items-center ${showDr ? "logo-chip-light" : "logo-chip-dark"}`}
          aria-label={logoAlt}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} alt={logoAlt} className={`logo-img ${showDr ? "logo-img-dr" : "logo-img-enp"}`} />
        </Link>
        {!isSetter && <BrandSwitch brand={brand} allowAll={user.role !== "SETTER"} />}
        {isSetter && (
          <BrandSwitch brand={brand === "ALL" ? "ENP" : brand} allowAll={false} />
        )}
        <nav className={`nav-links flex flex-wrap gap-1 text-sm ${links.length < 2 ? "nav-links-single" : ""}`}>
          {links.map(([href, label]) => (
            <Link prefetch={false} key={href} href={href} className="nav-link rounded-full px-3 py-1.5 hover:bg-white/15">{label}</Link>
          ))}
        </nav>
        <div className="nav-user ml-auto flex items-center gap-3 text-sm">
          <span className="nav-name hidden sm:inline">{user.name} · <span className="opacity-80">{user.role === "ADMIN" ? "Admin" : user.role === "TEAM" ? "Team" : user.role === "ESTIMATOR" ? "Estimator" : user.role === "ACCOUNTS" ? "Accounts" : "Setter"}</span></span>
          <form action="/logout" method="post"><button className="signout-btn rounded-full bg-white/15 px-3 py-1.5 hover:bg-white/25" aria-label="Sign out" title="Sign out">
            <svg className="signout-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
            <span className="signout-text">Sign out</span>
          </button></form>
        </div>
      </div>
    </header>
  );
}
