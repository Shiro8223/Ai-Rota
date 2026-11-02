/**
 * Shift-type colours. One colour per shift type, used everywhere that shift appears
 * (week grid, day timeline, staff phone view) so people learn it once.
 * Class names are written out in full so Tailwind can see them.
 */
export const SHIFT_COLORS = {
  amber: { name: "Amber", chip: "bg-amber-50 text-amber-900 ring-amber-200", bar: "bg-amber-400", soft: "bg-amber-50/60", dot: "bg-amber-400", text: "text-amber-700", border: "border-amber-400" },
  sky: { name: "Sky", chip: "bg-sky-50 text-sky-900 ring-sky-200", bar: "bg-sky-400", soft: "bg-sky-50/60", dot: "bg-sky-400", text: "text-sky-700", border: "border-sky-400" },
  indigo: { name: "Indigo", chip: "bg-indigo-50 text-indigo-900 ring-indigo-200", bar: "bg-indigo-500", soft: "bg-indigo-50/60", dot: "bg-indigo-500", text: "text-indigo-700", border: "border-indigo-500" },
  emerald: { name: "Green", chip: "bg-emerald-50 text-emerald-900 ring-emerald-200", bar: "bg-emerald-400", soft: "bg-emerald-50/60", dot: "bg-emerald-400", text: "text-emerald-700", border: "border-emerald-400" },
  rose: { name: "Rose", chip: "bg-rose-50 text-rose-900 ring-rose-200", bar: "bg-rose-400", soft: "bg-rose-50/60", dot: "bg-rose-400", text: "text-rose-700", border: "border-rose-400" },
  violet: { name: "Violet", chip: "bg-violet-50 text-violet-900 ring-violet-200", bar: "bg-violet-400", soft: "bg-violet-50/60", dot: "bg-violet-400", text: "text-violet-700", border: "border-violet-400" },
  teal: { name: "Teal", chip: "bg-teal-50 text-teal-900 ring-teal-200", bar: "bg-teal-400", soft: "bg-teal-50/60", dot: "bg-teal-400", text: "text-teal-700", border: "border-teal-400" },
  orange: { name: "Orange", chip: "bg-orange-50 text-orange-900 ring-orange-200", bar: "bg-orange-400", soft: "bg-orange-50/60", dot: "bg-orange-400", text: "text-orange-700", border: "border-orange-400" },
} as const;
export type ShiftColor = keyof typeof SHIFT_COLORS;
export const COLOR_KEYS = Object.keys(SHIFT_COLORS) as ShiftColor[];

/** Template's own colour, else one picked by its position. */
export function templateColor(t: { color?: string }, index: number): ShiftColor {
  return t.color && t.color in SHIFT_COLORS ? (t.color as ShiftColor) : COLOR_KEYS[index % COLOR_KEYS.length];
}

export const colorOf = (key: string) => SHIFT_COLORS[(key in SHIFT_COLORS ? key : "sky") as ShiftColor];
