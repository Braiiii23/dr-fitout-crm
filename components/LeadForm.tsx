import type { Lead, Setter } from "@prisma/client";
import { fieldsFor } from "@/lib/fields";
import type { BrandKey } from "@/lib/constants";
import { toLocalInput } from "@/lib/time";

export default function LeadForm({ brand, lead, setters, action }: { brand: BrandKey; lead?: Lead | null; setters: Setter[]; action: (fd: FormData) => Promise<void> }) {
  const groups = fieldsFor(brand);
  const val = (k: string) => (lead ? (lead as unknown as Record<string, unknown>)[k] : undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="_brand" value={brand} /><input type="hidden" name="_id" value={lead?.id ?? ""} />
      {groups.map((g) => (
        <fieldset key={g.title} className="card">
          <legend className="px-1 text-sm font-semibold brand-text">{g.title}</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.fields.map((f) => {
              const v = val(f.key);
              const wide = f.type === "textarea";
              const opts = typeof f.options === "function" ? f.options(brand) : f.options;
              return (
                <div key={f.key} className={wide ? "sm:col-span-2 lg:col-span-3" : ""}>
                  {f.type === "checkbox" ? (
                    <label className="mt-5 flex items-center gap-2 text-sm"><input type="checkbox" name={f.key} defaultChecked={!!v} className="h-4 w-4" />{f.label}</label>
                  ) : (<>
                    <label className="label" htmlFor={f.key}>{f.label}</label>
                    {f.type === "textarea" ? <textarea id={f.key} name={f.key} defaultValue={(v as string) ?? ""} rows={f.key === "notes" ? 8 : 3} className="input" />
                    : f.type === "select" ? <select id={f.key} name={f.key} defaultValue={(v as string) ?? ""} className="input"><option value="">—</option>{opts!.map((o) => <option key={o}>{o}</option>)}</select>
                    : f.type === "setter" ? <select id={f.key} name={f.key} defaultValue={(v as string) ?? ""} className="input"><option value="">— none —</option>{setters.map((s) => <option key={s.id} value={s.id}>{s.name}{s.status !== "Active" ? " (inactive)" : ""}</option>)}</select>
                    : <input id={f.key} name={f.key} className="input"
                        type={f.type === "date" ? "date" : f.type === "datetime" ? "datetime-local" : f.type === "number" || f.type === "money" || f.type === "int" ? "number" : f.type === "url" ? "url" : f.type === "email" ? "email" : f.type === "phone" ? "tel" : "text"}
                        step={f.type === "money" ? "0.01" : f.type === "int" ? "1" : f.type === "number" ? "any" : undefined}
                        defaultValue={f.type === "datetime" ? toLocalInput(v as Date | null) : v === null || v === undefined ? "" : String(v)} />}
                    {f.help && <p className="mt-1 text-xs text-slate-500">{f.help}</p>}
                  </>)}
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}
      <div className="form-sticky-bar sticky bottom-0 flex gap-2 bg-slate-50/90 py-3 backdrop-blur"><button className="btn">Save lead</button></div>
    </form>
  );
}
