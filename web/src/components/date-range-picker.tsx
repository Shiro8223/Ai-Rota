"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";

export interface RangeLabels { fromDate: string; toDate: string; pickDates: string; pickStart: string; pickEnd: string; clearDates: string; prevMonth: string; nextMonth: string }

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s: string) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));

/**
 * Tap a start day then an end day on a month calendar. Shows the chosen range as two
 * summary boxes (From / To) that also open the calendar. Mobile-first: full width, big
 * touch targets, no native date inputs.
 */
export function DateRangePicker({ from, to, onChange, min, locale = "en-GB", labels }: { from: string; to: string; onChange: (from: string, to: string) => void; min?: string; locale?: string; labels: RangeLabels }) {
  const [open, setOpen] = useState(!from);
  const [month, setMonth] = useState(() => {
    const d = parse(from || min || iso(new Date()));
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  // Waiting for the end date once a start has been picked.
  const picking = !!from && !to;
  const pretty = (s: string) => parse(s).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
  const tap = (day: string) => {
    if (min && day < min) return;
    if (!from || to || day < from) onChange(day, "");
    else {
      onChange(from, day);
      setOpen(false);
    }
  };
  const first = month;
  const lead = (first.getDay() + 6) % 7; // Monday first
  const daysIn = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => iso(new Date(first.getFullYear(), first.getMonth(), i + 1)))];
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: "narrow" }));
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const canBack = !min || iso(new Date(month.getFullYear(), month.getMonth(), 0)) >= min;

  return (
    <div className="space-y-2">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="grid w-full grid-cols-2 overflow-hidden rounded-xl border border-zinc-200 bg-white text-left">
        {[
          [labels.fromDate, from],
          [labels.toDate, to],
        ].map(([label, value], i) => (
          <span key={label} className={`min-w-0 px-3 py-2.5 ${i ? "border-l border-zinc-200" : ""} ${(i === 0 && open && !from) || (i === 1 && picking) ? "bg-brand-50" : ""}`}>
            <span className="block text-xs text-zinc-500">{label}</span>
            <span className={`block truncate text-[15px] font-medium ${value ? "text-zinc-900" : "text-zinc-400"}`}>{value ? pretty(value) : labels.pickDates}</span>
          </span>
        ))}
      </button>

      {open && (
        <div className="rounded-xl border border-zinc-200 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => shift(-1)} disabled={!canBack} aria-label={labels.prevMonth} className="grid size-10 place-items-center rounded-md text-zinc-600 hover:bg-zinc-100 disabled:opacity-30"><Icon name="left" className="size-5" /></button>
            <p className="font-semibold first-letter:uppercase">{month.toLocaleDateString(locale, { month: "long", year: "numeric" })}</p>
            <button type="button" onClick={() => shift(1)} aria-label={labels.nextMonth} className="grid size-10 place-items-center rounded-md text-zinc-600 hover:bg-zinc-100"><Icon name="right" className="size-5" /></button>
          </div>
          <p className="mb-2 text-center text-xs font-medium text-brand-700" aria-live="polite">{picking ? labels.pickEnd : labels.pickStart}</p>
          <div className="grid grid-cols-7 text-center text-[11px] font-medium text-zinc-400">
            {weekdays.map((w, i) => <span key={i} className="py-1">{w}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-y-1">
            {cells.map((day, i) => {
              if (!day) return <span key={`b${i}`} />;
              const disabled = !!min && day < min;
              const start = day === from;
              const end = day === to;
              const inside = !!from && !!to && day > from && day < to;
              return (
                <button
                  key={day}
                  type="button"
                  disabled={disabled}
                  onClick={() => tap(day)}
                  aria-pressed={start || end || inside}
                  aria-label={pretty(day)}
                  className={`h-10 text-sm tabular-nums disabled:text-zinc-300 ${
                    start || end ? "rounded-md bg-brand-600 font-semibold text-white" : inside ? "bg-brand-100 text-brand-900" : "rounded-md hover:bg-zinc-100"
                  } ${start && to ? "rounded-r-none" : ""} ${end && from !== to ? "rounded-l-none" : ""}`}
                >
                  {+day.slice(8)}
                </button>
              );
            })}
          </div>
          {from && (
            <div className="mt-2 text-right">
              <button type="button" onClick={() => onChange("", "")} className="text-sm text-zinc-500 underline">{labels.clearDates}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
