import type { FitResult } from "@/lib/concepts";

const ZONE: Record<string, string> = { front: "#a46be0", clinical: "#5b2a86", wet: "#2b7a9e", staff: "#8a6d3b", support: "#4b5563" };

/** Draws the AI's test fit as a scaled block plan (metres), with a 1 m grid and room labels. */
export default function FitPlan({ r }: { r: FitResult }) {
  const rooms = r.rooms ?? [];
  const outline = r.tenancy?.outline?.length ? r.tenancy.outline : null;
  const W = Math.max(r.tenancy?.widthM ?? 0, ...rooms.map((x) => x.x + x.w), ...(outline ?? []).map((p) => p[0]), 1);
  const H = Math.max(r.tenancy?.depthM ?? 0, ...rooms.map((x) => x.y + x.h), ...(outline ?? []).map((p) => p[1]), 1);
  const pad = 1.2; const S = 40; // px per metre in the viewBox
  const vb = `${-pad * S} ${-pad * S} ${(W + pad * 2) * S} ${(H + pad * 2) * S}`;
  const poly = (outline ?? [[0, 0], [W, 0], [W, H], [0, H]]).map(([x, y]) => `${x * S},${y * S}`).join(" ");
  const grid: React.ReactNode[] = [];
  for (let x = 0; x <= Math.ceil(W); x++) grid.push(<line key={`gx${x}`} x1={x * S} y1={0} x2={x * S} y2={H * S} />);
  for (let y = 0; y <= Math.ceil(H); y++) grid.push(<line key={`gy${y}`} x1={0} y1={y * S} x2={W * S} y2={y * S} />);
  return (
    <figure className="fit-plan">
      <svg viewBox={vb} role="img" aria-label="Concept test fit block plan">
        <g className="fit-grid">{grid}</g>
        <polygon points={poly} className="fit-outline" />
        {rooms.map((x, i) => {
          const fs = Math.max(7, Math.min(15, Math.min(x.w, x.h) * S / 5, (x.w * S * 0.9) / (Math.max(4, x.name.length) * 0.6)));
          return (
            <g key={i}>
              <rect x={x.x * S} y={x.y * S} width={x.w * S} height={x.h * S} fill={ZONE[x.zone ?? ""] ?? "#6b5b85"} className="fit-room" />
              <text x={(x.x + x.w / 2) * S} y={(x.y + x.h / 2) * S} fontSize={fs} textAnchor="middle" className="fit-label">
                <tspan x={(x.x + x.w / 2) * S} dy={-fs * 0.2}>{x.name}</tspan>
                <tspan x={(x.x + x.w / 2) * S} dy={fs * 1.15} className="fit-dim">{(x.areaSqm ?? x.w * x.h).toFixed(1)} m²</tspan>
              </text>
            </g>
          );
        })}
        <text x={0} y={-0.45 * S} fontSize={13} className="fit-dim">{W.toFixed(1)} m</text>
        <text x={-0.45 * S} y={H * S} fontSize={13} className="fit-dim" transform={`rotate(-90 ${-0.45 * S} ${H * S})`}>{H.toFixed(1)} m</text>
      </svg>
      {r.tenancy?.entry && <p className="fit-entry">Entry: {r.tenancy.entry}</p>}
      <figcaption className="fit-legend">{Object.entries(ZONE).map(([z, c]) => <span key={z}><i style={{ background: c }} />{z}</span>)}<span className="admin-muted">1 m grid · blank space = circulation</span></figcaption>
    </figure>
  );
}
