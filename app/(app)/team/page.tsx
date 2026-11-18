import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { CONTACT_TYPES } from "@/lib/constants";
import { fmtDate } from "@/lib/time";
import { Flash } from "@/components/ui";
import { addContact, updateContact } from "./actions";
import { TRADES } from "@/lib/estimating";

// ENP Directory — shared list of people so nobody double-calls.
// Contact fields only: no financials, no claim/setter flow. Sections = CallListItem.contactType.
export default async function TeamPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const viewer = await requireUser(["ADMIN", "TEAM", "BDM", "PM", "FOREMAN", "ESTIMATOR"]);
  const sp = await searchParams; const brand = "ALL"; // all leads together: ENP + DR
  const type = CONTACT_TYPES.some((t) => t.key === sp.type) ? sp.type : "ALL";
  const q = (sp.q ?? "").trim();
  const rows = await prisma.callListItem.findMany({
    where: {
      ...(q ? { OR: [{ leadName: { contains: q } }, { company: { contains: q } }, { phone: { contains: q } }, { email: { contains: q } }] } : {}),
    },
    select: { id: true, leadName: true, company: true, phone: true, email: true, business: true, contactType: true, trade: true, leadInfo: true, lastCalled: true, possibleDuplicate: true },
    orderBy: [{ leadName: "asc" }],
  });
  const counts = Object.fromEntries(CONTACT_TYPES.map((t) => [t.key, rows.filter((r) => r.contactType === t.key).length]));
  const shown = CONTACT_TYPES.filter((t) => type === "ALL" || t.key === type);
  const brandLabel = "ENP Fitouts · DR Fitout";
  const href = (t: string, trade?: string) => `/team?${new URLSearchParams({ ...(t !== "ALL" ? { type: t } : {}), ...(trade ? { trade } : {}), ...(q ? { q } : {}) })}`;
  // Trades: one sub-section per trade, in the same order as the trade packs, then any others.
  const tradeRows = rows.filter((r) => r.contactType === "TRADE");
  const extraTrades = [...new Set(tradeRows.map((r) => r.trade).filter((t): t is string => !!t && !TRADES.includes(t)))].sort();
  const tradeGroups = [...TRADES.filter((t) => t !== "Other"), ...extraTrades, "Other"]
    .map((t) => ({ trade: t, list: tradeRows.filter((r) => (t === "Other" ? !r.trade || r.trade === "Other" : r.trade === t)) }))
    .filter((g) => g.list.length);
  const tradeFilter = type === "TRADE" && sp.trade ? sp.trade : null;
  const here = href(type, tradeFilter ?? undefined); // come back to this exact view after saving

  return (
    <div data-theme="team-dark" data-brand={brand} className={`dir space-y-6 ${viewer.role === "ESTIMATOR" ? "" : "team-editable"}`}>
      <section className="dir-hero">
        <p className="dir-eyebrow">{brandLabel}</p>
        <h1 className="text-2xl font-bold tracking-tight">Directory</h1>
        <p className="mt-1 text-sm dir-muted">Everyone already in our database. Search before you call, and add anyone new.</p>
        <form className="mt-4 flex gap-2" action="/team">
          {type !== "ALL" && <input type="hidden" name="type" value={type} />}
          <input name="q" defaultValue={q} placeholder="Search name, company, phone or email…" className="dir-input flex-1" />
          <button className="dir-btn">Search</button>
        </form>
        <nav className="mt-4 flex flex-wrap gap-2">
          <Link prefetch={false} href={href("ALL")} className={`dir-tab ${type === "ALL" ? "dir-tab-on" : ""}`}>All <span>{rows.length}</span></Link>
          {CONTACT_TYPES.map((t) => <Link prefetch={false} key={t.key} href={href(t.key)} className={`dir-tab ${type === t.key ? "dir-tab-on" : ""}`}>{t.label} <span>{counts[t.key]}</span></Link>)}
        </nav>
      </section>

      <Flash msg={sp.msg} /><Flash msg={sp.err} kind="err" />

      <details className="dir-card" open={!rows.length || !!sp.add}>
        <summary className="cursor-pointer text-base font-semibold dir-accent">+ Add person</summary>
        <form action={addContact} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <input type="hidden" name="returnTo" value={here} />
          <F label="Name *"><input name="leadName" className="dir-input w-full" required /></F>
          <F label="Company"><input name="company" className="dir-input w-full" /></F>
          <F label="Section"><select name="contactType" className="dir-input w-full" defaultValue={type === "ALL" ? "CLIENT" : type}>{CONTACT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label.replace(/s$/, "")}</option>)}</select></F>
          <F label="Trade (for trades)"><select name="trade" className="dir-input w-full" defaultValue={tradeFilter ?? ""}><option value="">—</option>{TRADES.map((t) => <option key={t}>{t}</option>)}</select></F>
          <F label="If Other, which trade"><input name="tradeOther" className="dir-input w-full" placeholder="e.g. Stone, Stainless" /></F>
          <F label="Phone"><input name="phone" className="dir-input w-full" /></F>
          <F label="Email"><input name="email" type="email" className="dir-input w-full" /></F>
          <F label="Brand"><select name="business" className="dir-input w-full" defaultValue="ENP"><option value="ENP">ENP Fitouts</option><option value="DR">DR Fitout</option></select></F>
          <div className="sm:col-span-2 lg:col-span-3"><F label="Notes / why"><textarea name="leadInfo" rows={2} className="dir-input w-full" /></F></div>
          <div><button className="dir-btn px-6">Add person</button></div>
        </form>
      </details>

      {shown.map((t) => {
        const list = rows.filter((r) => r.contactType === t.key);
        if (t.key === "TRADE") return (
          <section key={t.key}>
            <h2 className="dir-h2">{t.label} <span className="dir-count">{list.length}</span></h2>
            {tradeGroups.length > 0 && <nav className="mb-3 flex flex-wrap gap-2" aria-label="Trades">
              <Link prefetch={false} href={href("TRADE")} className={`dir-tab ${type === "TRADE" && !tradeFilter ? "dir-tab-on" : ""}`}>All trades <span>{list.length}</span></Link>
              {tradeGroups.map((g) => <Link prefetch={false} key={g.trade} href={href("TRADE", g.trade)} className={`dir-tab ${tradeFilter === g.trade ? "dir-tab-on" : ""}`}>{g.trade} <span>{g.list.length}</span></Link>)}
            </nav>}
            {tradeGroups.filter((g) => !tradeFilter || g.trade === tradeFilter).map((g) => (
              <div key={g.trade} className="dir-sub">
                <h3 className="dir-h3">{g.trade} <span className="dir-count">{g.list.length}</span></h3>
                <ContactTable list={g.list} showTrade={g.trade === "Other"} here={here} />
                <QuickAdd contactType="TRADE" trade={g.trade === "Other" ? undefined : g.trade} label={g.trade} here={here} />
              </div>
            ))}
            {!list.length && <p className="text-sm dir-muted">No trades yet{q ? " matching that search" : ""}.</p>}
            <QuickAdd contactType="TRADE" label="a new trade" here={here} pickTrade />
          </section>
        );
        return (
          <section key={t.key}>
            <h2 className="dir-h2">{t.label} <span className="dir-count">{list.length}</span></h2>
            {list.length ? (
              <ContactTable list={list} here={here} />
            ) : <p className="text-sm dir-muted">No {t.label.toLowerCase()} yet{q ? " matching that search" : ""}.</p>}
            <QuickAdd contactType={t.key} label={t.label.replace(/s$/, "").toLowerCase()} here={here} />
          </section>
        );
      })}
    </div>
  );
}
function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs font-medium dir-muted">{label}<div className="mt-1">{children}</div></label>;
}

type Row = { id: string; leadName: string | null; company: string | null; phone: string | null; email: string | null; business: string; contactType: string; trade: string | null; leadInfo: string | null; lastCalled: string | null; possibleDuplicate: boolean };

const tradeOptions = (current?: string | null) => [...TRADES.filter((t) => t !== "Other"), ...(current && !TRADES.includes(current) ? [current] : []), "Other"];

/** People in a section, each with an Edit link that opens their details in place. */
function ContactTable({ list, showTrade, here }: { list: Row[]; showTrade?: boolean; here: string }) {
  return (
    <div className="dir-table-wrap">
      <table className="dir-table">
        <thead><tr><th>Name</th><th>Company</th>{showTrade && <th>Trade</th>}<th>Phone</th><th>Email</th><th>Brand</th><th>Notes</th><th>Last contacted</th><th><span className="sr-only">Edit</span></th></tr></thead>
        <tbody>{list.map((r) => (
          <tr key={r.id}>
            <td className="font-semibold">{r.leadName}{r.possibleDuplicate && <span title="Possible duplicate" className="ml-1 text-amber-400">⚠</span>}</td>
            <td>{r.company}</td>
            {showTrade && <td>{r.trade ?? "—"}</td>}
            <td>{r.phone && <a className="dir-accent" href={`tel:${r.phone.replace(/\s/g, "")}`}>{r.phone}</a>}</td>
            <td>{r.email && <a className="dir-accent" href={`mailto:${r.email}`}>{r.email}</a>}</td>
            <td><span className={`dir-badge ${r.business === "DR" ? "dir-badge-dr" : ""}`}>{r.business === "DR" ? "DR Fitout" : "ENP"}</span></td>
            <td className="dir-muted max-w-xs truncate" title={r.leadInfo ?? ""}>{r.leadInfo}</td>
            <td className="dir-muted whitespace-nowrap">{r.lastCalled ? fmtDate(r.lastCalled) : "—"}</td>
            <td><details className="dir-edit"><summary className="dir-accent text-xs">Edit</summary>
              <form action={updateContact} className="dir-edit-form">
                <input type="hidden" name="id" value={r.id} /><input type="hidden" name="returnTo" value={here} />
                <F label="Name"><input name="leadName" className="dir-input w-full" defaultValue={r.leadName ?? ""} required /></F>
                <F label="Company"><input name="company" className="dir-input w-full" defaultValue={r.company ?? ""} /></F>
                <F label="Phone"><input name="phone" className="dir-input w-full" defaultValue={r.phone ?? ""} /></F>
                <F label="Email"><input name="email" type="email" className="dir-input w-full" defaultValue={r.email ?? ""} /></F>
                <F label="Section"><select name="contactType" className="dir-input w-full" defaultValue={r.contactType}>{CONTACT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label.replace(/s$/, "")}</option>)}</select></F>
                <F label="Trade (if a trade)"><select name="trade" className="dir-input w-full" defaultValue={r.trade ?? ""}><option value="">—</option>{tradeOptions(r.trade).map((t) => <option key={t}>{t}</option>)}</select></F>
                <F label="If Other, which trade"><input name="tradeOther" className="dir-input w-full" /></F>
                <F label="Brand"><select name="business" className="dir-input w-full" defaultValue={r.business}><option value="ENP">ENP Fitouts</option><option value="DR">DR Fitout</option></select></F>
                <div className="dir-wide"><F label="Notes"><textarea name="leadInfo" rows={2} className="dir-input w-full" defaultValue={r.leadInfo ?? ""} /></F></div>
                <div><button className="dir-btn px-5">Save</button></div>
              </form></details></td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}

/** A one-line add form under each section / trade, already set to that section (and trade). */
function QuickAdd({ contactType, trade, label, here, pickTrade }: { contactType: string; trade?: string; label: string; here: string; pickTrade?: boolean }) {
  return (
    <details className="dir-quick">
      <summary className="dir-accent text-sm">+ Add {pickTrade ? label : `to ${label}`}</summary>
      <form action={addContact} className="dir-quick-form">
        <input type="hidden" name="contactType" value={contactType} /><input type="hidden" name="returnTo" value={here} />
        {trade && <input type="hidden" name="trade" value={trade} />}
        <input name="leadName" className="dir-input" placeholder="Name *" required aria-label="Name" />
        <input name="company" className="dir-input" placeholder="Company" aria-label="Company" />
        <input name="phone" className="dir-input" placeholder="Phone" aria-label="Phone" />
        <input name="email" type="email" className="dir-input" placeholder="Email" aria-label="Email" />
        {contactType === "TRADE" && !trade && <>
          <select name="trade" className="dir-input" defaultValue="Other" aria-label="Trade">{TRADES.map((t) => <option key={t}>{t}</option>)}</select>
          <input name="tradeOther" className="dir-input" placeholder="If Other: which trade" aria-label="If Other, which trade" />
        </>}
        <select name="business" className="dir-input" defaultValue="ENP" aria-label="Brand"><option value="ENP">ENP</option><option value="DR">DR Fitout</option></select>
        <button className="dir-btn">Add</button>
      </form>
    </details>
  );
}
