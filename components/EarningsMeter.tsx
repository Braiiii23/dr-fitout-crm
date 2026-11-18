"use client";

import { useEffect, useMemo, useState } from "react";
import { fmtAUD } from "@/lib/money";
import { ConfettiBurst } from "@/components/Celebrate";

type Props = {
  net: number;
  target?: number;
  monthLabel?: string;
};

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

/** Animated net-this-month figure + progress bar toward the monthly target. Celebrates increases. */
export function EarningsMeter({ net, target = 10_000, monthLabel }: Props) {
  const safeNet = Number.isFinite(net) ? Math.max(0, net) : 0;
  const [display, setDisplay] = useState(0);
  const [pulse, setPulse] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const pct = Math.min(100, (safeNet / target) * 100);
  const remaining = Math.max(0, target - safeNet);
  const hit = safeNet >= target;

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const duration = 900;
    const from = 0;
    const to = safeNet;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setDisplay(from + (to - from) * easeOutCubic(t));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [safeNet]);

  useEffect(() => {
    const key = "jessie-net-month-v2";
    try {
      const prevRaw = sessionStorage.getItem(key);
      const prev = prevRaw == null ? null : parseFloat(prevRaw);
      if (prev != null && Number.isFinite(prev) && safeNet > prev + 0.009) {
        setPulse(true);
        setCelebrate(true);
        const t = setTimeout(() => setPulse(false), 2400);
        sessionStorage.setItem(key, String(safeNet));
        return () => clearTimeout(t);
      }
      sessionStorage.setItem(key, String(safeNet));
    } catch { /* ignore */ }
  }, [safeNet]);

  const amountText = useMemo(() => fmtAUD(Math.round(display * 100) / 100), [display]);

  return (
    <div className={`earnings-meter kpi-hero ${pulse ? "earnings-meter-pulse" : ""}`}>
      <ConfettiBurst active={celebrate} />
      <div className="kpi-label">Net this month{monthLabel ? ` · ${monthLabel}` : ""}</div>
      <div className="earnings-meter-amount tabular-nums" aria-live="polite">{amountText}</div>
      <div className="earnings-meter-bar" role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.round(safeNet)} aria-label="Monthly earnings target">
        <div className="earnings-meter-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="kpi-sub earnings-meter-sub">
        <span>{fmtAUD(safeNet)} of {fmtAUD(target)}</span>
        <span>{hit ? "Target hit — nice work!" : `${fmtAUD(remaining)} to go`}</span>
      </div>
      {celebrate && <div className="mt-2 text-xs font-semibold text-white/95">🎉 Earnings just went up — keep going!</div>}
    </div>
  );
}
