import type { Job, JobClaim, JobTask } from "@prisma/client";

// When should each claim be invoiced? From the job's build program:
//  - a claim's milestone tasks are the tasks linked to it (or, if not linked, matched by Justin's usual pattern);
//  - the claim is ready to issue once the last of those tasks finishes;
//  - the deposit is issued before the job starts (a week before the start date).
// A date typed on the claim (issueOn) always wins.

type Kind = "deposit" | "sheeting" | "joinery" | "finishes" | "handover";
const TASK_RULES: [Kind, RegExp][] = [
  ["sheeting", /\bsheet(ing)?\b|plasterboard|lining/i],
  ["joinery", /cabinet|joinery|stainless|stone|cladding|benchtop|counter/i],
  ["finishes", /render|paint|venetian|plaster(?!board)|fit ?-?off/i],
  ["handover", /defect|final clean|site clean|silicone|handover|practical completion|\bpc\b|certif/i],
];

const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

/** What each claim is for, read from its name and milestone text. */
function claimKinds(claims: JobClaim[]) {
  const sorted = [...claims].sort((a, b) => a.seq - b.seq);
  const kinds = new Map<number, Kind>();
  sorted.forEach((c, k) => {
    const t = `${c.name} ${c.hook ?? ""}`.toLowerCase();
    if (k === 0 || /deposit|before start/.test(t)) kinds.set(c.seq, "deposit");
    else if (k === sorted.length - 1 || /handover|final|practical completion|certif/.test(t)) kinds.set(c.seq, "handover");
    else if (/sheet/.test(t)) kinds.set(c.seq, "sheeting");
  });
  // Middle claims that aren't sheeting share joinery and finishes: the first takes joinery, the last finishes.
  const mid = sorted.filter((c) => !kinds.has(c.seq));
  mid.forEach((c, k) => kinds.set(c.seq, mid.length > 1 && k === mid.length - 1 ? "finishes" : "joinery"));
  return kinds;
}

/** The claim a task most likely sits against, when nobody has linked it yet. */
export function suggestClaim(taskName: string, claims: JobClaim[]): number | null {
  const kinds = claimKinds(claims);
  const hit = TASK_RULES.find(([, re]) => re.test(taskName))?.[0];
  if (!hit) return null;
  const find = (k: Kind) => [...kinds.entries()].find(([, v]) => v === k)?.[0] ?? null;
  // With no separate finishes claim, finishes sit with joinery; with no sheeting claim, sheeting has no claim of its own.
  return find(hit) ?? (hit === "finishes" ? find("joinery") : hit === "joinery" ? find("finishes") : null);
}

export type ClaimPlan = {
  claimId: string; seq: number; name: string; pct: number; amount: number; amountInc: number;
  issueOn: string | null; basis: string; dueOn: string | null;
  state: "issued" | "ready" | "soon" | "later" | "unknown";
  tasks: { name: string; finish: string; done: boolean; suggested: boolean }[];
};

export function claimPlan(job: Job & { claims: JobClaim[]; tasks: JobTask[] }, today: string, termsDays = 10, noticeDays = 3): ClaimPlan[] {
  const kinds = claimKinds(job.claims);
  return [...job.claims].sort((a, b) => a.seq - b.seq).map((c) => {
    const linked = job.tasks.filter((t) => t.claimSeq === c.seq).map((t) => ({ t, suggested: false }));
    const suggested = job.tasks.filter((t) => t.claimSeq == null && suggestClaim(t.name, job.claims) === c.seq).map((t) => ({ t, suggested: true }));
    const tasks = (linked.length ? linked : suggested).map(({ t, suggested: s }) => ({ name: t.name, finish: t.finish, done: t.done || t.finish < today, suggested: s }));
    let issueOn: string | null = null, basis = "";
    if (c.issueOn) { issueOn = c.issueOn; basis = "date set on the claim"; }
    else if (tasks.length) {
      const last = tasks.reduce((a, b) => (b.finish > a.finish ? b : a));
      issueOn = last.finish; basis = `${last.name} finishes${tasks.some((t) => t.suggested) ? " (matched by name)" : ""}`;
    } else if (kinds.get(c.seq) === "deposit") {
      issueOn = job.startDate ? addDays(job.startDate, -7) : job.createdAt.toISOString().slice(0, 10);
      basis = job.startDate ? "a week before the start date" : "on signing";
    } else basis = "no milestone tasks linked yet";
    const issued = c.status === "Authorised" || c.status === "Paid";
    const state: ClaimPlan["state"] = issued ? "issued" : !issueOn ? "unknown" : issueOn <= today ? "ready" : issueOn <= addDays(today, noticeDays) ? "soon" : "later";
    return {
      claimId: c.id, seq: c.seq, name: c.name, pct: c.pct, amount: c.amount, amountInc: Math.round(c.amount * 110) / 100,
      issueOn, basis, dueOn: issued ? c.dueDate : issueOn ? addDays(issueOn, termsDays) : null, state, tasks,
    };
  });
}
