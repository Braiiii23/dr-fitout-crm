"use client";
import { useEffect, useState } from "react";

/** Lightweight CSS confetti burst (no dependency). */
export function ConfettiBurst({ active, durationMs = 3200 }: { active: boolean; durationMs?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!active) return;
    setShow(true);
    const t = setTimeout(() => setShow(false), durationMs);
    return () => clearTimeout(t);
  }, [active, durationMs]);
  if (!show) return null;
  const bits = Array.from({ length: 48 }, (_, i) => i);
  return (
    <div className="confetti-layer" aria-hidden>
      {bits.map((i) => (
        <span
          key={i}
          className="confetti-bit"
          style={{
            left: `${(i * 17) % 100}%`,
            animationDelay: `${(i % 12) * 0.05}s`,
            background: ["#c8102e", "#5b2a86", "#f2a900", "#fff", "#22c55e", "#a46be0"][i % 6],
            transform: `rotate(${i * 23}deg)`,
          }}
        />
      ))}
    </div>
  );
}

/** Banner + confetti when Braiden has recent Signed wins. */
export function SignedCelebration({
  items,
}: {
  items: { id: string; name: string; company: string | null; signedDate: string | null; brand: string }[];
}) {
  const [dismissed, setDismissed] = useState(true);
  const [burst, setBurst] = useState(false);
  useEffect(() => {
    if (!items.length) return;
    const key = `signed-seen:${items.map((i) => i.id).sort().join(",")}`;
    try {
      if (sessionStorage.getItem(key)) {
        setDismissed(true);
        return;
      }
      sessionStorage.setItem(key, "1");
    } catch { /* ignore */ }
    setDismissed(false);
    setBurst(true);
  }, [items]);
  if (dismissed || !items.length) return null;
  return (
    <>
      <ConfettiBurst active={burst} />
      <div className="celebrate-banner mb-4" role="status">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider opacity-90">🎉 Job signed!</div>
          <div className="mt-0.5 text-sm font-semibold">
            {items.slice(0, 3).map((i) => `${i.name}${i.company ? ` (${i.company})` : ""}`).join(" · ")}
            {items.length > 3 ? ` +${items.length - 3} more` : ""}
          </div>
        </div>
        <button type="button" className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold hover:bg-white/30" onClick={() => setDismissed(true)}>
          Nice
        </button>
      </div>
    </>
  );
}

/** Toast/pulse when Jessie&apos;s net-this-month increases vs last visit. */
export function NetUpCelebration({ net }: { net: number }) {
  const [up, setUp] = useState(false);
  const [delta, setDelta] = useState(0);
  useEffect(() => {
    const key = "jessie-net-month";
    try {
      const prev = parseFloat(sessionStorage.getItem(key) || "");
      if (Number.isFinite(prev) && net > prev + 0.009) {
        setDelta(net - prev);
        setUp(true);
      }
      sessionStorage.setItem(key, String(net));
    } catch {
      /* ignore */
    }
  }, [net]);
  if (!up) return null;
  return (
    <>
      <ConfettiBurst active={up} />
      <div className="net-up-toast" role="status">
        🎉 Net this month went up by {delta.toLocaleString("en-AU", { style: "currency", currency: "AUD" })} — nice work!
        <button type="button" className="ml-2 underline" onClick={() => setUp(false)}>Dismiss</button>
      </div>
    </>
  );
}
