"use client";

import { useState, useTransition } from "react";
import type { HolidayPolicy } from "@/lib/types";
import { saveHolidayPolicy } from "./actions";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
type Result = { ok: boolean; error?: string; info?: string };

/** Edit one holiday policy. `target` = "store", "role:<id>" or "person:<id>". */
export function HolidayPolicyForm({ storeId, target, initial, removable, fallbackLabel }: { storeId: string; target: string; initial: HolidayPolicy; removable: boolean; fallbackLabel?: string }) {
  const [p, setP] = useState<HolidayPolicy>(initial);
  const [res, setRes] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const set = (patch: Partial<HolidayPolicy>) => {
    setP({ ...p, ...patch });
    setRes(null);
  };
  const perYear = p.period === "year" ? p.allowance : p.period === "quarter" ? p.allowance * 4 : p.allowance * 12;
  const minimum = p.unit === "days" ? 28 : 5.6 * p.fullTimeHours;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 rounded-md bg-zinc-100 p-1 text-sm sm:max-w-md">
        {(["fixed", "accrual"] as const).map((m) => (
          <button key={m} type="button" onClick={() => set({ mode: m, ...(m === "accrual" ? { unit: "hours" as const } : {}) })} className={`min-h-9 rounded-md font-medium ${(p.mode ?? "fixed") === m ? "bg-white shadow-[var(--shadow-card)]" : "text-zinc-600"}`}>
            {m === "fixed" ? "Fixed allowance" : "Accrue 12.07% of hours"}
          </button>
        ))}
      </div>
      {p.mode === "accrual" && <p className="text-xs text-zinc-600">For irregular-hours and part-year workers (UK, leave years from April 2024): holiday builds up at 12.07% of hours actually worked, using approved timesheets or published shifts.</p>}
      {p.mode !== "accrual" && <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <label className="label">Allowance</label>
          <input type="number" min={0} step={0.5} className="input" value={p.allowance} onChange={(e) => set({ allowance: +e.target.value })} />
        </div>
        <div>
          <label className="label">Measured in</label>
          <select className="input" value={p.unit} onChange={(e) => set({ unit: e.target.value as HolidayPolicy["unit"] })}>
            <option value="days">Days</option>
            <option value="hours">Hours</option>
          </select>
        </div>
        <div>
          <label className="label">Refreshes every</label>
          <select className="input" value={p.period} onChange={(e) => set({ period: e.target.value as HolidayPolicy["period"] })}>
            <option value="year">Year</option>
            <option value="quarter">Quarter</option>
            <option value="month">Month</option>
          </select>
        </div>
        {p.period === "year" && (
          <div>
            <label className="label">Holiday year starts</label>
            <select className="input" value={p.startMonth} onChange={(e) => set({ startMonth: +e.target.value })}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </div>
        )}
      </div>}
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-brand-600" checked={p.proRata} onChange={(e) => set({ proRata: e.target.checked })} />
          Pro rata for part-time (by contract hours)
        </label>
        {p.proRata && (
          <div className="w-40">
            <label className="label">Full-time hours / week</label>
            <input type="number" min={1} max={80} step={0.5} className="input" value={p.fullTimeHours} onChange={(e) => set({ fullTimeHours: +e.target.value })} />
          </div>
        )}
      </div>
      {p.mode !== "accrual" && perYear + 1e-9 < minimum && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          That&apos;s below the UK statutory minimum of 5.6 weeks a year ({Math.round(minimum * 10) / 10} {p.unit} a year for full-time, pro rata for part-time).
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary btn-sm" disabled={pending} onClick={() => start(async () => setRes(await saveHolidayPolicy(storeId, target, p)))}>{pending ? "Saving…" : "Save"}</button>
        {removable && (
          <button className="btn-ghost btn-sm" disabled={pending} onClick={() => start(async () => setRes(await saveHolidayPolicy(storeId, target, null)))}>
            Remove override{fallbackLabel ? ` (use ${fallbackLabel})` : ""}
          </button>
        )}
        {res && <span className={`text-sm ${res.ok ? "text-emerald-700" : "text-red-600"}`}>{res.ok ? res.info : res.error}</span>}
      </div>
    </div>
  );
}

/** Pick a person to give their own allowance. */
export function PersonPicker({ people }: { people: { id: string; name: string }[] }) {
  return (
    <form className="flex flex-wrap gap-2" method="get">
      <input type="hidden" name="tab" value="holidays" />
      <select name="person" className="input max-w-xs" defaultValue="">
        <option value="" disabled>Choose a person…</option>
        {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button className="btn-secondary">Set their allowance</button>
    </form>
  );
}
