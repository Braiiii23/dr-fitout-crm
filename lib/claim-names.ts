/** Names for a claim split, following ENP's usual pattern: Deposit, Sheeting complete, Joinery and finishes (…), Handover. */
export function claimNamesFor(split: number[]): [number, string, string | null][] {
  const n = split.length;
  return split.map((pct, k) => {
    if (k === 0) return [pct, "Deposit", "Before start"];
    if (k === n - 1) return [pct, "Handover", "Last week before handover"];
    if (k === 1 && n >= 4) return [pct, "Sheeting complete", "Once sheeting is finished"];
    const mids = n >= 4 ? n - 3 : n - 2, idx = n >= 4 ? k - 1 : k;
    return [pct, mids > 1 ? `Joinery and finishes (${idx})` : "Joinery and finishes", idx === mids && mids > 1 ? "Near joinery and finishes (later)" : "Near joinery and finishes"];
  });
}
