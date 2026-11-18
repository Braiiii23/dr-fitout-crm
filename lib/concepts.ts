// Concepts library + attached files (shared by concepts and leases).
export type Room = { name: string; qty: number; areaSqm: number | null; notes?: string };
export type StoredFile = { id: string; name: string; kind: string; added: string; type?: string };

export const CONCEPT_STATUSES = ["Draft", "Ready", "Archived"];
export const LEASE_FILE_KINDS = ["floor plan", "lease", "other"];
export const CONCEPT_FILE_KINDS = ["image", "plan", "other"];

export const parseFiles = (s?: string | null): StoredFile[] => { try { const v = s ? JSON.parse(s) : []; return Array.isArray(v) ? v : []; } catch { return []; } };
export const parseRooms = (s?: string | null): Room[] => { try { const v = s ? JSON.parse(s) : []; return Array.isArray(v) ? v : []; } catch { return []; } };

/** Room schedule typed one per line: "6 x Consult room 12 sqm - notes" (qty and size optional). */
export function roomsFromText(text: string): Room[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    let rest = line; let notes: string | undefined;
    const dash = rest.split(/\s+[-–]\s+/); if (dash.length > 1) { rest = dash[0]; notes = dash.slice(1).join(" - ").trim(); }
    let qty = 1; const q = /^(\d+)\s*[x×]\s*/i.exec(rest); if (q) { qty = Number(q[1]); rest = rest.slice(q[0].length); }
    let areaSqm: number | null = null; const a = /\s*@?\s*(\d+(?:\.\d+)?)\s*(?:sqm|m2|m²)\s*(each)?\s*$/i.exec(rest); if (a) { areaSqm = Number(a[1]); rest = rest.slice(0, a.index); }
    return { name: rest.trim() || "Room", qty, areaSqm, ...(notes ? { notes } : {}) };
  });
}
export const roomsToText = (rooms: Room[]) =>
  rooms.map((r) => `${r.qty > 1 ? `${r.qty} x ` : ""}${r.name}${r.areaSqm ? ` ${r.areaSqm} sqm` : ""}${r.notes ? ` - ${r.notes}` : ""}`).join("\n");
export const roomsTotal = (rooms: Room[]) => rooms.reduce((s, r) => s + (r.areaSqm ?? 0) * (r.qty || 1), 0);

/** What the AI sends back for a concept fit (validated loosely; anything missing is shown as unknown). */
export type FitRoom = { name: string; areaSqm?: number; x: number; y: number; w: number; h: number; zone?: string; notes?: string };
export type FitResult = {
  summary?: string;
  verdict?: "Fits" | "Tight" | "Doesn't fit" | string;
  tenancy?: { areaSqm?: number; widthM?: number; depthM?: number; entry?: string; features?: string[]; outline?: [number, number][] };
  rooms?: FitRoom[];
  schedule?: { name: string; qty?: number; areaSqm?: number; vsConcept?: string }[];
  changes?: string[];
  checks?: string[];
  assumptions?: string[];
  usedSqm?: number;
  circulationPct?: number;
};
export const parseFit = (s?: string | null): FitResult | null => { try { return s ? (JSON.parse(s) as FitResult) : null; } catch { return null; } };
