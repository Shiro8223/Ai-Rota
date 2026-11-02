"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { COLOR_KEYS, SHIFT_COLORS, colorOf, templateColor } from "@/lib/colors";
import { DAY_LABEL, DAYS, type Day, type ShiftTemplate, type Store } from "@/lib/types";
import { saveSetup } from "./actions";

type RoleLite = { id: string; name: string; category: string; color: string };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "shift";
const toMin = (hm: string) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);
const spanOf = (t: Pick<ShiftTemplate, "start" | "end">) => {
  const s = toMin(t.start);
  let e = toMin(t.end);
  if (e <= s) e += 1440;
  return e - s;
};
const fmt = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;
/** UK law: 20 minutes if more than 6 working hours. */
const legalBreak = (t: ShiftTemplate) => (spanOf(t) - (t.breakMinutes ?? 0) > 360 ? 20 : 0);

export function SetupEditor({ store, roles }: { store: Pick<Store, "id" | "name" | "openingHours" | "shiftTemplates">; roles: RoleLite[] }) {
  const [name, setName] = useState(store.name);
  const [hours, setHours] = useState(store.openingHours);
  const [templates, setTemplates] = useState<ShiftTemplate[]>(store.shiftTemplates.map((t, i) => ({ ...t, color: templateColor(t, i), breakMinutes: t.breakMinutes ?? 0, requirements: t.requirements ?? [] })));
  const [sel, setSel] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const t = templates[sel];
  const isNew = (x: ShiftTemplate) => !store.shiftTemplates.some((o) => o.id === x.id);

  const update = (patch: Partial<ShiftTemplate>) => {
    setTemplates((ts) => ts.map((x, n) => (n === sel ? { ...x, ...patch } : x)));
    setMsg(null);
  };
  const toggleDay = (d: Day) => update({ days: t.days.includes(d) ? t.days.filter((x) => x !== d) : DAYS.filter((x) => x === d || t.days.includes(x)) });
  function addTemplate() {
    let id = "shift";
    for (let n = 2; templates.some((x) => x.id === id); n++) id = `shift-${n}`;
    setTemplates([...templates, { id, name: "New shift", start: "12:00", end: "18:00", days: [...DAYS], minStaff: 2, maxStaff: 4, color: COLOR_KEYS[templates.length % COLOR_KEYS.length], breakMinutes: 0, requirements: [] }]);
    setSel(templates.length);
  }
  function save() {
    setMsg(null);
    start(async () => {
      const r = await saveSetup(store.id, { name, openingHours: hours, shiftTemplates: templates });
      setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error ?? "Couldn't save." });
    });
  }
  const reqTotal = (t?.requirements ?? []).reduce((n, r) => n + r.min, 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* shift picker */}
        <aside>
          <label className="label lg:hidden" htmlFor="pick">Shift type</label>
          <select id="pick" className="input mb-3 lg:hidden" value={sel} onChange={(e) => setSel(+e.target.value)}>
            {templates.map((x, i) => <option key={i} value={i}>{x.name} · {x.start}–{x.end}</option>)}
          </select>
          <div className="hidden space-y-2 lg:block">
            {templates.map((x, i) => {
              const c = colorOf(x.color ?? "sky");
              return (
                <button key={i} onClick={() => setSel(i)} className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition ${i === sel ? "border-brand-500 bg-white shadow-[var(--shadow-card)] ring-1 ring-brand-500" : "border-zinc-200 bg-white/60 hover:bg-white"}`}>
                  <span className={`h-10 w-1.5 rounded-sm ${c.bar}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{x.name}</span>
                    <span className="block text-xs text-zinc-500">{x.start}–{x.end} · {x.days.length === 7 ? "every day" : x.days.map((d) => DAY_LABEL[d]).join(" ")}</span>
                  </span>
                  <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-600">{x.minStaff}–{x.maxStaff}</span>
                </button>
              );
            })}
          </div>
          <button type="button" className="btn-secondary mt-3 w-full" onClick={addTemplate}><Icon name="plus" className="size-4" />Add shift type</button>
        </aside>

        {/* single editor */}
        {t && (
          <section className="card">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{t.name || "Untitled shift"}</h2>
                <p className="text-sm text-zinc-500">{fmt(spanOf(t))} on site · {fmt(spanOf(t) - (t.breakMinutes ?? 0))} paid · id <code>{t.id}</code></p>
              </div>
              {templates.length > 1 && (
                <button type="button" className="btn-ghost btn-sm text-red-600" onClick={() => { setTemplates(templates.filter((_, n) => n !== sel)); setSel(0); }}>Remove</button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div className="col-span-2">
                <label className="label">Name</label>
                <input className="input" value={t.name} onChange={(e) => update({ name: e.target.value, ...(isNew(t) ? { id: slug(e.target.value) } : {}) })} />
              </div>
              <div>
                <label className="label">Starts</label>
                <input type="time" className="input" value={t.start} onChange={(e) => update({ start: e.target.value })} />
              </div>
              <div>
                <label className="label">Ends</label>
                <input type="time" className="input" value={t.end} onChange={(e) => update({ end: e.target.value })} />
              </div>
              <div>
                <label className="label">Unpaid break (min)</label>
                <input type="number" min={0} max={180} step={5} className="input" value={t.breakMinutes ?? 0} onChange={(e) => update({ breakMinutes: +e.target.value })} />
              </div>
              <div className="col-span-2 flex items-end md:col-span-3">
                <p className={`text-xs ${(t.breakMinutes ?? 0) < legalBreak(t) ? "font-medium text-red-600" : "text-zinc-500"}`}>
                  {legalBreak(t) ? `Law: at least 20 minutes (more than 6 working hours).` : "No break legally required for adults (6 working hours or less)."} Under-18s need 30 minutes on anything over 4.5 hours, or they can&apos;t be put on this shift.
                </p>
              </div>
            </div>

            <div className="mt-5">
              <span className="label">Colour</span>
              <div className="flex flex-wrap gap-2">
                {COLOR_KEYS.map((k) => (
                  <button key={k} type="button" aria-label={SHIFT_COLORS[k].name} onClick={() => update({ color: k })} className={`size-7 rounded-md ${SHIFT_COLORS[k].bar} ${t.color === k ? "ring-2 ring-zinc-900 ring-offset-2" : ""}`} />
                ))}
              </div>
            </div>

            <div className="mt-5">
              <span className="label">Runs on</span>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((d) => (
                  <button key={d} type="button" onClick={() => toggleDay(d)} className={`min-h-9 rounded-md px-3 text-sm font-medium ring-1 ring-inset ${t.days.includes(d) ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-zinc-500 ring-zinc-300"}`}>{DAY_LABEL[d]}</button>
                ))}
              </div>
            </div>

            <div className="mt-6 rounded-lg border border-zinc-200 p-4">
              <p className="font-semibold">Staffing levels</p>
              <p className="mb-3 text-sm text-zinc-500">How many people in total, and which service roles must be on every one of these shifts.</p>
              <div className="grid max-w-sm grid-cols-2 gap-3">
                <div>
                  <label className="label">Minimum</label>
                  <input type="number" min={0} className="input" value={t.minStaff} onChange={(e) => update({ minStaff: +e.target.value })} />
                </div>
                <div>
                  <label className="label">Maximum</label>
                  <input type="number" min={1} className="input" value={t.maxStaff} onChange={(e) => update({ maxStaff: +e.target.value })} />
                </div>
              </div>
              <p className="label mt-5">Required service roles</p>
              <div className="space-y-2">
                {(t.requirements ?? []).map((r, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <input type="number" min={1} max={20} className="input w-20" value={r.min} aria-label="How many" onChange={(e) => update({ requirements: t.requirements!.map((x, n) => (n === i ? { ...x, min: +e.target.value } : x)) })} />
                    <span className="text-sm text-zinc-500">×</span>
                    <select className="input max-w-xs flex-1" value={r.roleId} onChange={(e) => update({ requirements: t.requirements!.map((x, n) => (n === i ? { ...x, roleId: e.target.value } : x)) })}>
                      {roles.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                    <button type="button" className="btn-ghost btn-sm text-zinc-500" aria-label="Remove requirement" onClick={() => update({ requirements: t.requirements!.filter((_, n) => n !== i) })}><Icon name="x" className="size-4" /></button>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={!roles.length}
                  onClick={() => update({ requirements: [...(t.requirements ?? []), { roleId: roles.find((o) => !(t.requirements ?? []).some((x) => x.roleId === o.id))?.id ?? roles[0].id, min: 1 }] })}
                >
                  <Icon name="plus" className="size-4" />Add required role
                </button>
              </div>
              {reqTotal > t.maxStaff && <p className="mt-2 text-xs font-medium text-red-600">Required roles add up to {reqTotal}, more than the maximum of {t.maxStaff}.</p>}
              <p className="mt-3 text-xs text-zinc-500">The rota builder always fills these, and the rota shows on each shift whether they&apos;re met.</p>
            </div>
          </section>
        )}
      </div>

      <section className="card">
        <h2 className="mb-1 font-semibold">Location &amp; opening hours</h2>
        <p className="mb-4 text-sm text-zinc-600">Untick a day to mark the store closed; no shifts are planned that day.</p>
        <label className="label" htmlFor="sname">Name</label>
        <input id="sname" className="input mb-4 max-w-md" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {DAYS.map((d) => {
            const h = hours[d];
            return (
              <div key={d} className="flex items-center gap-2 rounded-lg border border-zinc-200 p-2">
                <label className="flex w-14 items-center gap-1.5 text-sm font-medium">
                  <input type="checkbox" className="accent-brand-600" checked={!!h} onChange={(e) => setHours({ ...hours, [d]: e.target.checked ? { open: "10:00", close: "23:00" } : null })} />
                  {DAY_LABEL[d]}
                </label>
                {h ? (
                  <>
                    <input type="time" className="input px-1.5 py-1" value={h.open} onChange={(e) => setHours({ ...hours, [d]: { ...h, open: e.target.value } })} aria-label={`${d} open`} />
                    <input type="time" className="input px-1.5 py-1" value={h.close} onChange={(e) => setHours({ ...hours, [d]: { ...h, close: e.target.value } })} aria-label={`${d} close`} />
                  </>
                ) : (
                  <span className="text-sm text-zinc-400">Closed</span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="sticky bottom-20 z-10 flex items-center gap-3 rounded-lg border border-zinc-200 bg-white/95 p-3 shadow-[var(--shadow-float)] backdrop-blur md:bottom-4">
        <button className="btn-primary" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save shifts & hours"}</button>
        {msg && <p className={`text-sm whitespace-pre-line ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
