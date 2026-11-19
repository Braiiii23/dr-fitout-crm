import Link from "next/link";
import { notFound } from "next/navigation";
import { getUser } from "@/lib/auth";
import { requireViewer } from "@/lib/team-view";
import { buildProposal, aud } from "@/lib/proposal";
import { parseProposal } from "@/lib/estimate-sheet";
import { prisma } from "@/lib/db";
import PrintButton from "@/components/PrintButton";
import { saveProposalForm } from "../../sheet-actions";

// Client proposal built from the estimate sheet, in the Maroochy / Proposal.docx layout. Print to PDF or download as Word.
export default async function ProposalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  await requireViewer(["ADMIN", "ESTIMATOR", "ACCOUNTS", "BDM", "PM"]);
  const { id } = await params; const sp = await searchParams;
  const p = await buildProposal(id);
  if (!p || (p.lead.brand !== "DR" && p.lead.brand !== "ENP")) notFound();
  const viewer = await getUser();
  const canEdit = !!viewer && ["ADMIN", "ESTIMATOR", "ACCOUNTS"].includes(viewer.role);
  const saved = parseProposal((await prisma.lead.findUnique({ where: { id }, select: { estProposal: true } }))?.estProposal);
  const i = p.info;
  const rows: [string, string][] = [["COST ESTIMATE", i.title], ["BUSINESS NAME", i.businessName], ["CUSTOMER CONTACT #", i.contact], ["CUSTOMER EMAIL", i.email], ["ABN", i.abn], ["BUSINESS ADDRESS", i.businessAddress], ["PROJECT ADDRESS", i.projectAddress], ["SALES CONTACT", i.salesContact], ["DATE ISSUED", i.dateIssued], ["EXPIRY DATE", i.expiry]];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 no-print">
        <Link prefetch={false} href={`/estimating/${id}`} className="est-open" style={{ marginLeft: 0 }}>← Trade pack</Link>
        <Link prefetch={false} href={`/estimating/${id}/sheet`} className="est-open">← Estimate sheet</Link>
        <a href={`/estimating/${id}/proposal/docx`} className="btn-ghost">Download Word</a>
        <PrintButton />
      </div>
      {sp.msg && <div className="acc-notice no-print" role="status">{sp.msg}</div>}
      {sp.err && <div className="aw-err no-print" role="alert">{sp.err}</div>}
      {p.empty && <div className="aw-err no-print" role="alert">The estimate sheet is empty, so there are no prices yet. Fill the sheet first (AI estimate, or add lines).</div>}

      {canEdit && (
        <details className="card acc-pad no-print">
          <summary className="acc-link">Proposal details, exclusions and assumptions</summary>
          <form action={saveProposalForm} className="tp-form" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginTop: ".8rem" }}>
            <input type="hidden" name="id" value={id} />
            {([["title", "Cost estimate (title)"], ["businessName", "Business name"], ["contact", "Customer contact"], ["email", "Customer email"], ["abn", "ABN"], ["businessAddress", "Business address"], ["projectAddress", "Project address"], ["salesContact", "Sales contact"], ["dateIssued", "Date issued"], ["expiry", "Expiry"]] as const).map(([k, l]) => (
              <label key={k}><span className="label">{l}</span><input name={k} className="input" defaultValue={(saved[k] as string | undefined) ?? (i[k] as string)} /></label>
            ))}
            <label style={{ gridColumn: "1 / -1" }}><span className="label">Job exclusions (one per line; the standard exclusions are added after these)</span><textarea name="exclusions" rows={5} className="input" defaultValue={(saved.exclusions ?? []).join("\n")} /></label>
            <label style={{ gridColumn: "1 / -1" }}><span className="label">Assumptions (one per line)</span><textarea name="assumptions" rows={4} className="input" defaultValue={(saved.assumptions ?? []).join("\n")} /></label>
            <label style={{ gridColumn: "1 / -1" }}><span className="label">Note under the price summary (optional)</span><textarea name="notes" rows={2} className="input" defaultValue={saved.notes ?? ""} /></label>
            <div className="tp-form-actions"><button className="btn">Save details</button></div>
          </form>
        </details>
      )}

      <article className="prop">
        <header className="prop-head">
          <img src="/brand/dr-logo-dark.png" alt="DR Fitout" className="prop-logo" />
        </header>
        <table className="prop-info"><tbody>{rows.map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}</tbody></table>

        {p.sections.map((s) => (
          <section key={s.band} className="prop-sec">
            <h2 className="prop-bar"><span>{s.no}. {s.band} scope of works{s.provisional ? " – Provisional Sum" : ""}</span><span>{aud(s.price)}</span></h2>
            <ol className="prop-items">{s.items.map((t, k) => <li key={k}><span className="prop-no">{s.no}.{k + 1}.</span> {t}</li>)}</ol>
          </section>
        ))}

        <section className="prop-sec">
          <h2 className="prop-bar"><span>Price summary</span><span /></h2>
          <table className="prop-sum"><tbody>
            {p.sections.map((s) => <tr key={s.band}><td>{s.no}. {s.band}{s.provisional ? " (Provisional Sum)" : ""}</td><td>{aud(s.price)}</td></tr>)}
            <tr className="prop-sum-tot"><td>Total ex GST</td><td>{aud(p.summary.sell)}</td></tr>
            <tr><td>GST (10%)</td><td>{aud(p.summary.gst)}</td></tr>
            <tr className="prop-sum-tot"><td>Total inc GST</td><td>{aud(p.summary.total)}</td></tr>
          </tbody></table>
          {i.notes && <p className="prop-p">{i.notes}</p>}
        </section>

        <section className="prop-sec">
          <h2 className="prop-bar"><span>{p.sections.length + 1}. Exclusions</span><span /></h2>
          <ol className="prop-items">{p.exclusions.map((t, k) => <li key={k}><span className="prop-no">{p.sections.length + 1}.{k + 1}.</span> {t}</li>)}</ol>
          <p className="prop-p">This quotation is subject to a site inspection. Any other works not specifically listed in this quotation are excluded.</p>
        </section>

        {p.assumptions.length > 0 && (
          <section className="prop-sec">
            <h2 className="prop-bar"><span>Assumptions</span><span /></h2>
            <ul className="prop-list">{p.assumptions.map((t, k) => <li key={k}>{t}</li>)}</ul>
          </section>
        )}

        <section className="prop-sec">
          <p className="prop-p"><b>ESTIMATED START DATE:</b> TBA<br /><b>ESTIMATED COMPLETION DATE:</b> TBA</p>
          <p className="prop-total">Total Exc. GST: {aud(p.summary.sell)} + GST</p>
          <h3 className="prop-h3">PAYMENT SCHEDULE</h3>
          <p className="prop-p">{p.payment}</p>
          <p className="prop-p">Should you wish to engage DR Fitout, please sign and date this acceptance page, and review and initial all pages in this document. On receipt of the signed document we will provide a deposit invoice (payable immediately) and schedule construction of your project.</p>
          <p className="prop-p">We would like to thank you for choosing DR Fitout.</p>
          <p className="prop-sign">Yours faithfully,<br /><br />Signed: ______________________ &nbsp; Name: ______________________ &nbsp; Date: __________</p>
        </section>

        <section className="prop-sec prop-terms">
          <h2 className="prop-bar"><span>Terms and Conditions</span><span /></h2>
          {p.terms.map((t, k) => (
            <div key={t.h}><h3 className="prop-h3">{k + 1}. {t.h}</h3>{t.p.map((x, j) => <p key={j} className="prop-p">{x}</p>)}</div>
          ))}
        </section>
      </article>
    </div>
  );
}
