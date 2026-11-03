"use client";

import { useId, useState } from "react";

/** "261103" -> "2026-11-03" (null if it isn't a real date). */
export function parseYYMMDD(digits: string): string | null {
  if (!/^\d{6}$/.test(digits)) return null;
  const y = 2000 + +digits.slice(0, 2);
  const m = +digits.slice(2, 4);
  const d = +digits.slice(4, 6);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const toDigits = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10) : "");
const shown = (digits: string) => digits.match(/.{1,2}/g)?.join(" / ") ?? "";

/**
 * Quick date entry: type YYMMDD on the number pad (e.g. 261103 = 3 Nov 2026). No native
 * date picker, so nothing to scroll or drag on a phone. Submits YYYY-MM-DD under `name`
 * (empty if blank or not a real date). Pasting 2026-11-03 also works.
 */
export function DateField({ name, defaultValue, label, required, locale = "en-GB" }: { name: string; defaultValue?: string | null; label: string; required?: boolean; locale?: string }) {
  const id = useId();
  const [digits, setDigits] = useState(toDigits(defaultValue));
  const iso = parseYYMMDD(digits);
  const bad = digits.length === 6 && !iso;
  const set = (raw: string) => {
    const pasted = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    setDigits(pasted ? pasted[1].slice(2) + pasted[2] + pasted[3] : raw.replace(/\D/g, "").slice(0, 6));
  };
  const today = () => setDigits(toDigits(new Date().toISOString().slice(0, 10)));
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <div className={`flex items-center rounded-xl border bg-white shadow-[var(--shadow-card)] focus-within:ring-4 ${bad ? "border-red-300 focus-within:ring-red-100" : "border-zinc-200 focus-within:border-brand-500 focus-within:ring-brand-100"}`}>
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          placeholder="YY / MM / DD"
          value={shown(digits)}
          onChange={(e) => set(e.target.value)}
          onPaste={(e) => {
            e.preventDefault();
            set(e.clipboardData.getData("text").trim());
          }}
          required={required}
          pattern={required ? "\\d{2} / \\d{2} / \\d{2}" : undefined}
          aria-invalid={bad || undefined}
          aria-describedby={`${id}-hint`}
          className="min-w-0 flex-1 rounded-xl bg-transparent px-3.5 py-2.5 font-mono text-[15px] tracking-wider outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-zinc-400"
        />
        {digits ? (
          <button type="button" onClick={() => setDigits("")} className="px-3 text-lg leading-none text-zinc-400 hover:text-zinc-700" aria-label={`Clear ${label}`}>×</button>
        ) : (
          <button type="button" onClick={today} className="mr-1.5 rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50">Today</button>
        )}
      </div>
      <p id={`${id}-hint`} className={`mt-1 min-h-4 text-xs ${bad ? "text-red-600" : "text-zinc-500"}`}>
        {bad ? "Not a real date" : iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : digits ? "Keep typing: YY MM DD" : ""}
      </p>
      <input type="hidden" name={name} value={iso ?? ""} />
    </div>
  );
}
