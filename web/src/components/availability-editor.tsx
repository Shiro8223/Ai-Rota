"use client";

import { useState, useTransition } from "react";
import { dict, fill, type Dict } from "@/lib/i18n";
import { DAYS, type Day, type WeekWindows, type Window } from "@/lib/types";

/** Text the availability components show; defaults to English. */
export type AvailabilityLabels = Pick<Dict, "off" | "anyTime" | "setTimes" | "addTime" | "saveAvailability" | "saving" | "saved" | "sending" | "fromWeek" | "forHowLong" | "week1" | "weeksN" | "reason" | "reasonPh" | "tempNote" | Day>;
const EN = dict("en");

const isAny = (w: Window[]) => w.length === 1 && w[0].from === "00:00" && (w[0].to === "24:00" || w[0].to === "23:59");
type Result = { ok: boolean; error?: string; info?: string };

/** Controlled weekly grid: Not available / Any time / Set times, per day. */
export function AvailabilityGrid({ value, onChange, labels = EN }: { value: WeekWindows; onChange: (v: WeekWindows) => void; labels?: AvailabilityLabels }) {
  const set = (d: Day, w: Window[]) => onChange({ ...value, [d]: w });
  return (
    <div className="divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200">
      {DAYS.map((d) => {
        const w = value[d] ?? [];
        const mode = w.length === 0 ? "off" : isAny(w) ? "any" : "times";
        return (
          <div key={d} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
            <span className="w-28 text-sm font-medium">{labels[d]}</span>
            <div className="grid grid-cols-3 rounded-lg bg-zinc-100 p-0.5 sm:inline-grid">
              {(
                [
                  ["off", labels.off],
                  ["any", labels.anyTime],
                  ["times", labels.setTimes],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => set(d, m === "off" ? [] : m === "any" ? [{ from: "00:00", to: "24:00" }] : [{ from: "16:00", to: "23:00" }])}
                  className={`min-h-9 rounded-md px-3 text-xs font-medium transition ${mode === m ? (m === "off" ? "bg-white text-zinc-800 shadow-sm" : "bg-brand-600 text-white shadow-sm") : "text-zinc-600"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {mode === "times" && (
              <div className="flex flex-wrap items-center gap-2 sm:ml-2">
                {w.map((win, i) => (
                  <span key={i} className="flex items-center gap-1 text-sm">
                    <input type="time" className="input w-[6.5rem] px-2 py-1.5" value={win.from} aria-label={`${d} from`} onChange={(e) => set(d, w.map((x, n) => (n === i ? { ...x, from: e.target.value } : x)))} />
                    <span className="text-zinc-400">–</span>
                    <input type="time" className="input w-[6.5rem] px-2 py-1.5" value={win.to === "24:00" ? "23:59" : win.to} aria-label={`${d} to`} onChange={(e) => set(d, w.map((x, n) => (n === i ? { ...x, to: e.target.value } : x)))} />
                    {w.length > 1 && <button type="button" className="px-1 text-zinc-400 hover:text-red-600" onClick={() => set(d, w.filter((_, n) => n !== i))} aria-label="Remove time">×</button>}
                  </span>
                ))}
                <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => set(d, [...w, { from: "10:00", to: "16:00" }])}>{labels.addTime}</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Grid + save button. */
export function AvailabilityEditor({ initial, onSave, hint, submitLabel, labels = EN }: { initial: WeekWindows; onSave: (days: WeekWindows) => Promise<Result>; hint?: string; submitLabel?: string; labels?: AvailabilityLabels }) {
  const [days, setDays] = useState<WeekWindows>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      {hint && <p className="mb-3 text-sm text-zinc-600">{hint}</p>}
      <AvailabilityGrid value={days} labels={labels} onChange={(v) => { setDays(v); setMsg(null); }} />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button className="btn-primary" disabled={pending} onClick={() => start(async () => { const r = await onSave(days); setMsg({ ok: r.ok, text: r.ok ? r.info ?? labels.saved : r.error ?? "Couldn't save." }); })}>
          {pending ? labels.saving : submitLabel ?? labels.saveAvailability}
        </button>
        {msg && <span className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}

/**
 * Temporary availability for a set number of weeks (exams, term time, holidays).
 * It reverts to the usual pattern by itself, so nobody has to remember to undo it.
 */
export function TemporaryAvailabilityForm({ weeks, initial, onSubmit, submitLabel, labels = EN }: { weeks: { value: string; label: string }[]; initial: WeekWindows; onSubmit: (input: { startWeek: string; weeks: number; note: string }, days: WeekWindows) => Promise<Result>; submitLabel: string; labels?: AvailabilityLabels }) {
  const [days, setDays] = useState<WeekWindows>(initial);
  const [startWeek, setStartWeek] = useState(weeks[0]?.value ?? "");
  const [count, setCount] = useState(4);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="tw-start">{labels.fromWeek}</label>
          <select id="tw-start" className="input" value={startWeek} onChange={(e) => setStartWeek(e.target.value)}>
            {weeks.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="tw-count">{labels.forHowLong}</label>
          <select id="tw-count" className="input" value={count} onChange={(e) => setCount(+e.target.value)}>
            {[1, 2, 3, 4, 5, 6, 8, 10, 12, 16].map((n) => <option key={n} value={n}>{n === 1 ? labels.week1 : fill(labels.weeksN, { n })}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="tw-note">{labels.reason}</label>
          <input id="tw-note" className="input" maxLength={80} placeholder={labels.reasonPh} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <AvailabilityGrid value={days} onChange={setDays} labels={labels} />
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="btn-primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await onSubmit({ startWeek, weeks: count, note }, days);
              setMsg({ ok: r.ok, text: r.ok ? r.info ?? labels.saved : r.error ?? "Couldn't save." });
            })
          }
        >
          {pending ? labels.sending : submitLabel}
        </button>
        {msg && <span className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</span>}
      </div>
      <p className="text-xs text-zinc-500">{labels.tempNote}</p>
    </div>
  );
}
