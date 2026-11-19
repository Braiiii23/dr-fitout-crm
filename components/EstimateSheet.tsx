"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { saveSheet } from "@/app/(app)/estimating/sheet-actions";
import { summarise, lineCost, atCost, SOURCES, type SheetLine } from "@/lib/estimate-sheet";
import { BANDS } from "@/lib/estimating";

type Row = SheetLine & { key: string; open?: boolean };
const money = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: string) => { const x = Number(v.replace(/[$,\s]/g, "")); return Number.isFinite(x) ? x : 0; };
let seq = 0; const key = () => `r${Date.now().toString(36)}${seq++}`;
const blank = (band: string): Row => ({ key: key(), band, item: "", clientText: null, qty: 1, unit: "item", supplyRate: 0, installRate: 0, source: "ESTIMATE", sourceNote: null, provisional: false, sortOrder: 0, open: true });

/** The estimate workbook inside the app: one row per item, supply / install rates, source tags, margin, MB summary. */
export default function EstimateSheet({ leadId, initial, marginPct, defaultMargin, canEdit, quoteValue }: { leadId: string; initial: SheetLine[]; marginPct: number | null; defaultMargin: number; canEdit: boolean; quoteValue: number | null }) {
  const [rows, setRows] = useState<Row[]>(() => initial.map((l) => ({ ...l, key: key() })));
  const [margin, setMargin] = useState<string>(marginPct == null ? "" : String(marginPct));
  const [tab, setTab] = useState<string>("MB");
  const [dirty, setDirty] = useState(false);
  const [setQuote, setSetQuote] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const m = margin === "" ? defaultMargin : num(margin);
  const sum = useMemo(() => summarise(rows, m), [rows, m]);
  const bandsUsed = useMemo(() => [...BANDS, ...[...new Set(rows.map((r) => r.band))].filter((b) => !BANDS.includes(b))], [rows]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const update = (k: string, patch: Partial<Row>) => { setRows((rs) => rs.map((r) => (r.key === k ? { ...r, ...patch } : r))); setDirty(true); };
  const toggle = (k: string) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, open: !r.open } : r)));
  const remove = (k: string) => { setRows((rs) => rs.filter((r) => r.key !== k)); setDirty(true); };
  const add = (band: string) => { setRows((rs) => { const last = rs.map((r) => r.band).lastIndexOf(band); const next = [...rs]; next.splice(last === -1 ? rs.length : last + 1, 0, blank(band)); return next; }); setDirty(true); };
  const move = (k: string, d: -1 | 1) => setRows((rs) => { const i = rs.findIndex((r) => r.key === k); const j = i + d; if (j < 0 || j >= rs.length || rs[j].band !== rs[i].band) return rs; const n = [...rs]; [n[i], n[j]] = [n[j], n[i]]; setDirty(true); return n; });

  function save() {
    setMsg(null);
    start(async () => {
      const r = await saveSheet(leadId, rows.map((x, i) => ({ ...x, sortOrder: i })), margin === "" ? null : num(margin), setQuote);
      if (r.error) setMsg({ ok: false, text: r.error });
      else { setDirty(false); setMsg({ ok: true, text: `Saved. Trade pack updated${setQuote ? ` and the quote amount set to ${money(r.sell ?? 0)} ex GST` : ""}.` }); }
    });
  }

  const shown = tab === "MB" ? [] : tab === "All" ? bandsUsed.filter((b) => rows.some((r) => r.band === b)) : [tab];
  const ro = !canEdit;

  return (
    <div className="es">
      <div className="es-bar">
        <label className="es-margin"><span>Margin on cost</span><input inputMode="decimal" value={margin} placeholder={String(defaultMargin)} onChange={(e) => { setMargin(e.target.value); setDirty(true); }} disabled={ro} aria-label="Margin percent" /><span>%</span></label>
        <div className="es-tot"><span>Cost</span><b>{money(sum.cost)}</b></div>
        <div className="es-tot"><span>Margin</span><b>{money(sum.margin)}</b></div>
        <div className="es-tot es-tot-main"><span>Sell ex GST</span><b>{money(sum.sell)}</b></div>
        <div className="es-tot"><span>GST</span><b>{money(sum.gst)}</b></div>
        <div className="es-tot"><span>Total inc GST</span><b>{money(sum.total)}</b></div>
        <div className="es-tot"><span>GP on sell</span><b>{sum.gpPct.toFixed(1)}%</b></div>
        {canEdit && (
          <div className="es-save">
            <label className="es-check"><input type="checkbox" checked={setQuote} onChange={(e) => setSetQuote(e.target.checked)} /> Set quote amount{quoteValue ? ` (now ${money(quoteValue)})` : ""}</label>
            <button type="button" className="btn" onClick={save} disabled={pending}>{pending ? "Saving…" : dirty ? "Save sheet •" : "Save sheet"}</button>
          </div>
        )}
      </div>
      {msg && <div className={msg.ok ? "acc-notice" : "aw-err"} role={msg.ok ? "status" : "alert"}>{msg.text}</div>}

      <nav className="es-tabs" aria-label="Sheet tabs">
        {["MB", "All", ...bandsUsed.filter((b) => rows.some((r) => r.band === b) || BANDS.includes(b))].map((b) => {
          const s = sum.bands.find((x) => x.band === b);
          return <button type="button" key={b} className={`es-tab ${tab === b ? "is-on" : ""} ${s ? "has" : ""}`} onClick={() => setTab(b)}>{b === "MB" ? "MB summary" : b}{s ? <span>{money(s.sell)}</span> : null}</button>;
        })}
      </nav>

      {tab === "MB" ? (
        <div className="es-wrap">
          <table className="es-table es-mb">
            <thead><tr><th>Category</th><th>Lines</th><th className="r">Cost</th><th className="r">Margin</th><th className="r">Sell ex GST</th><th className="r">Effective margin</th><th>Priced by</th></tr></thead>
            <tbody>
              {sum.bands.length === 0 && <tr><td colSpan={7} className="es-empty">No lines yet. Run the AI estimate on the trade pack, or pick a band tab and add lines.</td></tr>}
              {sum.bands.map((b) => (
                <tr key={b.band} onClick={() => setTab(b.band)} className="es-click">
                  <td><b>{b.band.toUpperCase()}</b>{b.atCost && <span className="es-tag es-tag-cost">at cost</span>}{b.provisional && <span className="es-tag es-tag-ps">PS</span>}</td>
                  <td>{b.lines}</td><td className="r">{money(b.cost)}</td><td className="r">{money(b.margin)}</td><td className="r"><b>{money(b.sell)}</b></td>
                  <td className="r">{b.cost ? `${(b.margin / b.cost * 100).toFixed(0)}%` : "—"}</td>
                  <td>{pricedBy(rows.filter((r) => r.band === b.band))}</td>
                </tr>))}
            </tbody>
            <tfoot>
              <tr><td>TOTAL ex GST</td><td /><td className="r">{money(sum.cost)}</td><td className="r">{money(sum.margin)}</td><td className="r"><b>{money(sum.sell)}</b></td><td className="r">{sum.effectivePct.toFixed(1)}%</td><td /></tr>
              <tr><td>GST (10%)</td><td colSpan={3} /><td className="r">{money(sum.gst)}</td><td colSpan={2} /></tr>
              <tr><td>TOTAL inc GST</td><td colSpan={3} /><td className="r"><b>{money(sum.total)}</b></td><td colSpan={2} /></tr>
            </tfoot>
          </table>
          <p className="es-note">Margin {m}% on cost on every band except Preliminaries and Miscellaneous (at cost). Each band&apos;s sell is rounded up to the next 10 cents. Prices ex GST.</p>
        </div>
      ) : (
        <div className="es-wrap">
          <table className="es-table">
            <thead><tr><th className="es-n">#</th><th className="es-item">Item</th><th>Qty</th><th>Unit</th><th>Supply $/u</th><th>Install $/u</th><th className="r">S&amp;I $/u</th><th className="r">Cost</th><th className="r">Sell</th><th>Source</th><th title="Provisional sum">PS</th><th /></tr></thead>
            {shown.map((band) => {
              const rs = rows.filter((r) => r.band === band); const s = sum.bands.find((x) => x.band === band);
              return (
                <tbody key={band}>
                  <tr className="es-band"><td colSpan={7}>{band.toUpperCase()}{atCost(band) && <span className="es-tag es-tag-cost">at cost</span>}</td><td className="r">{money(s?.cost ?? 0)}</td><td className="r">{money(s?.sell ?? 0)}</td><td colSpan={3}>{canEdit && <button type="button" className="es-add" onClick={() => add(band)}>+ Add line</button>}</td></tr>
                  {rs.map((r, i) => {
                    const cost = lineCost(r); const sell = atCost(band) ? cost : cost * (1 + m / 100);
                    return [
                      <tr key={r.key} className={`es-row es-src-${r.source.replace(/\s/g, "").toLowerCase()} ${r.provisional ? "is-ps" : ""}`}>
                        <td className="es-n">{i + 1}</td>
                        <td className="es-item"><input value={r.item} onChange={(e) => update(r.key, { item: e.target.value })} disabled={ro} placeholder="Item" aria-label="Item" /></td>
                        <td><input className="es-num" inputMode="decimal" value={r.qty} onChange={(e) => update(r.key, { qty: num(e.target.value) })} disabled={ro} aria-label="Quantity" /></td>
                        <td><input className="es-unit" value={r.unit ?? ""} onChange={(e) => update(r.key, { unit: e.target.value })} disabled={ro} aria-label="Unit" /></td>
                        <td><input className="es-num" inputMode="decimal" value={r.supplyRate} onChange={(e) => update(r.key, { supplyRate: num(e.target.value) })} disabled={ro} aria-label="Supply rate" /></td>
                        <td><input className="es-num" inputMode="decimal" value={r.installRate} onChange={(e) => update(r.key, { installRate: num(e.target.value) })} disabled={ro} aria-label="Install rate" /></td>
                        <td className="r">{money(r.supplyRate + r.installRate)}</td>
                        <td className="r">{money(cost)}</td>
                        <td className="r">{money(sell)}</td>
                        <td><select value={r.source} onChange={(e) => update(r.key, { source: e.target.value })} disabled={ro} aria-label="Source">{SOURCES.map((x) => <option key={x}>{x}</option>)}</select></td>
                        <td><input type="checkbox" checked={r.provisional} onChange={(e) => update(r.key, { provisional: e.target.checked })} disabled={ro} aria-label="Provisional sum" /></td>
                        <td className="es-acts">
                          <button type="button" onClick={() => toggle(r.key)} aria-expanded={!!r.open} title="Proposal wording and source note">{r.open ? "▴" : "▾"}</button>
                          {canEdit && <><button type="button" onClick={() => move(r.key, -1)} title="Move up" aria-label="Move up">↑</button><button type="button" onClick={() => move(r.key, 1)} title="Move down" aria-label="Move down">↓</button><button type="button" onClick={() => remove(r.key)} title="Delete line" aria-label="Delete line">×</button></>}
                        </td>
                      </tr>,
                      r.open ? (
                        <tr key={`${r.key}-x`} className="es-more"><td />
                          <td colSpan={11}>
                            <label><span>Proposal wording (client sees this)</span><input value={r.clientText ?? ""} onChange={(e) => update(r.key, { clientText: e.target.value })} disabled={ro} placeholder="Supply and install …" /></label>
                            <label><span>Source / working</span><input value={r.sourceNote ?? ""} onChange={(e) => update(r.key, { sourceNote: e.target.value })} disabled={ro} placeholder="e.g. A-101: 4.2 + 3.6 + 5.1 lm; Justin standard rate $340/lm" /></label>
                          </td></tr>
                      ) : null,
                    ];
                  })}
                  {rs.length === 0 && <tr><td /><td colSpan={11} className="es-empty">No lines in {band}.</td></tr>}
                </tbody>
              );
            })}
          </table>
          <p className="es-note">Source colours: <span className="es-key es-src-justin">JUSTIN</span> <span className="es-key es-src-quote">QUOTE</span> <span className="es-key es-src-pastjob">PAST JOB</span> <span className="es-key es-src-xero">XERO</span> <span className="es-key es-src-estimate">ESTIMATE (check)</span> · Rates ex GST at cost.</p>
        </div>
      )}
    </div>
  );
}

function pricedBy(rows: SheetLine[]) {
  const srcs = [...new Set(rows.map((r) => r.source))];
  const ps = rows.length > 0 && rows.every((r) => r.provisional) ? " – Provisional Sum" : "";
  if (srcs.length === 1 && srcs[0] === "QUOTE") return `Quote${ps}`;
  if (srcs.includes("QUOTE")) return `Part quote + DR estimate${ps}`;
  return `DR estimate${ps}`;
}
