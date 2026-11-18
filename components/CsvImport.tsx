"use client";
import { useState } from "react";
import { previewImport, commitImport, type ImportKind } from "@/app/(app)/jobs/import-actions";

const TEMPLATES: Record<ImportKind, string> = {
  costs: "trade,supplier,cost,status,paid,claim,notes\nTiling (Spectra),Spectra,20555,Quoted,,3,\nQLeave,QLeave,2000,Quoted,4052,,",
  claims: "seq,name,pct,amount,hook,invoice,status,invoiced,due,received,notes\n1,Deposit,30,,Before start,INV-2192,Authorised,2026-09-25,2026-09-29,195000,",
  bills: "supplier,invoice,amount,status,due,paid date,claim,trade,notes\nInterlocked,INV0509,35330.03,Authorised,2026-11-12,,,Joinery (Interlocked),",
  labour: "date,person,hours,rate,approved,trade,notes\n2026-10-27,Khodi Mcdonald,6.03,40.49,no,New construction,",
  materials: "date,supplier,description,amount,trade\n2026-11-03,Bunnings,Fixings,19.33,New construction",
  program: "title,start,workdays,claim,done\nSheeting,2026-11-04,2,2,no",
};
const LABEL: Record<ImportKind, string> = { costs: "Trades and costs", claims: "Claim schedule", bills: "Supplier invoices", labour: "Labour hours (BuilderTrend Time Clock)", materials: "Materials receipts", program: "Build program (BuilderTrend schedule)" };

/** Upload or paste a CSV, check the preview, then import. Nothing is saved until "Import" is pressed. */
export default function CsvImport({ jobId, allowProgram = true }: { jobId: string; allowProgram?: boolean }) {
  const [kind, setKind] = useState<ImportKind>("costs");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewImport>> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function doPreview(t = text) { setBusy(true); setMsg(null); setPreview(await previewImport(kind, jobId, t)); setBusy(false); }
  async function doImport() { setBusy(true); const r = await commitImport(kind, jobId, text); setBusy(false); setMsg(`Imported ${r.imported} row${r.imported === 1 ? "" : "s"}.`); setPreview(null); setText(""); }
  const cols = preview?.rows[0] ? Object.keys(preview.rows[0]) : [];
  return (
    <div className="wip-import">
      <div className="wip-import-top">
        <label><span className="label">What are you importing?</span>
          <select className="input" value={kind} onChange={(e) => { setKind(e.target.value as ImportKind); setPreview(null); }}>
            {(Object.keys(LABEL) as ImportKind[]).filter((k) => allowProgram || k !== "program").map((k) => <option key={k} value={k}>{LABEL[k]}</option>)}
          </select>
        </label>
        <label><span className="label">CSV file</span>
          <input className="input" type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const t = await f.text(); setText(t); await doPreview(t); }} />
        </label>
        <a className="acc-link" download={`${kind}-template.csv`} href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATES[kind])}`}>Download a template</a>
      </div>
      <label><span className="label">Or paste CSV</span><textarea className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={TEMPLATES[kind]} /></label>
      <div className="acc-actions"><button type="button" className="btn" disabled={!text.trim() || busy} onClick={() => doPreview()}>Check before importing</button>{msg && <span className="acc-good-text">{msg}</span>}</div>
      {preview && (
        <div className="wip-preview">
          <p><b>{preview.count ?? 0}</b> of {preview.total} rows ready to import.{preview.errors.length ? ` ${preview.errors.length} skipped:` : ""}</p>
          {preview.errors.length > 0 && <ul className="wip-errs">{preview.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
          {cols.length > 0 && (
            <div className="overflow-x-auto"><table className="acc-pl"><thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>{preview.rows.slice(0, 25).map((r, k) => <tr key={k}>{cols.map((c) => <td key={c}>{r[c] == null ? <span className="acc-muted">{c === "paid" ? "Pending" : "—"}</span> : String(r[c])}</td>)}</tr>)}</tbody></table></div>
          )}
          {(preview.count ?? 0) > 0 && <button type="button" className="btn" disabled={busy} onClick={doImport}>Import {preview.count} row{preview.count === 1 ? "" : "s"}</button>}
        </div>
      )}
    </div>
  );
}
