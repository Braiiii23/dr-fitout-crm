import { CALL_STATUS_COLOURS, STAGE_COLOURS } from "@/lib/constants";
export const StageBadge = ({ stage }: { stage?: string | null }) =>
  stage ? <span className={`badge ${STAGE_COLOURS[stage] ?? "bg-slate-100"}`}>{stage}</span> : <span className="text-slate-400">—</span>;
export const StatusBadge = ({ status }: { status: string }) => <span className={`badge ${CALL_STATUS_COLOURS[status] ?? "bg-slate-100"}`}>{status}</span>;
export const BusinessBadge = ({ b }: { b: string }) =>
  <span className={`badge ${b === "DR" ? "bg-purple-100 text-purple-900" : "bg-red-100 text-red-800"}`}>{b === "DR" ? "DR Fitout" : "ENP Fitouts"}</span>;
export const PageTitle = ({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) => (
  <div className="page-title-wrap mb-4 flex flex-wrap items-end justify-between gap-2">
    <div><h1 className="text-xl font-bold brand-text">{title}</h1>{sub && <p className="admin-muted text-sm text-slate-500">{sub}</p>}</div>
    <div className="flex flex-wrap gap-2">{children}</div>
  </div>
);
export const Flash = ({ msg, kind = "ok" }: { msg?: string; kind?: "ok" | "err" }) =>
  msg ? <div className={`mb-4 rounded-md px-3 py-2 text-sm ${kind === "ok" ? "flash-ok bg-green-50 text-green-800 ring-1 ring-green-200" : "flash-err bg-red-50 text-red-800 ring-1 ring-red-200"}`}>{msg}</div> : null;
