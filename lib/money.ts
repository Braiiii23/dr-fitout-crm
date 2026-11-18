const aud = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: 2 });
export const fmtAUD = (n?: number | null) => (n === null || n === undefined ? "" : aud.format(n));
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
