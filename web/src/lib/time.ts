import { templateColor } from "./colors";
import { DAYS, type Day, type ShiftInstance, type Store, type WeekWindows, type Window } from "./types";

export const toMin = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
};

export function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseDate(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: string, n: number) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

export function mondayOf(date: Date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return isoDate(d);
}

export const nextMonday = () => addDays(mondayOf(), 7);

export function isMonday(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && parseDate(s).getDay() === 1;
}

export function dayDate(weekStart: string, day: Day) {
  return addDays(weekStart, DAYS.indexOf(day));
}

export function prettyDate(s: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) {
  return parseDate(s).toLocaleDateString("en-GB", opts);
}

export function weekLabel(weekStart: string) {
  return `${prettyDate(weekStart)} – ${prettyDate(addDays(weekStart, 6), { day: "numeric", month: "short", year: "numeric" })}`;
}

export function shiftMinutes(start: string, end: string) {
  let e = toMin(end);
  const s = toMin(start);
  if (e <= s) e += 1440;
  return e - s;
}

/** Same shift list the solver builds (ids "<templateId>:<day>"). */
export function shiftsForStore(store: Pick<Store, "shiftTemplates" | "openingHours">): ShiftInstance[] {
  const out: ShiftInstance[] = [];
  for (const day of DAYS) {
    if (store.openingHours[day] === null) continue;
    store.shiftTemplates.forEach((t, i) => {
      if (!t.days.includes(day)) return;
      const span = shiftMinutes(t.start, t.end);
      const breakMinutes = t.breakMinutes ?? 0;
      out.push({ id: `${t.id}:${day}`, templateId: t.id, name: t.name, day, start: t.start, end: t.end, minutes: span - breakMinutes, span, breakMinutes, minStaff: t.minStaff, maxStaff: t.maxStaff, color: templateColor(t, i), requirements: t.requirements ?? [] });
    });
  }
  return out.sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || toMin(a.start) - toMin(b.start));
}

export const ANY_DAY: Window[] = [{ from: "00:00", to: "24:00" }];
export const emptyWeek = (): WeekWindows => ({ mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] });
export const anyWeek = (): WeekWindows => ({ mon: ANY_DAY, tue: ANY_DAY, wed: ANY_DAY, thu: ANY_DAY, fri: ANY_DAY, sat: ANY_DAY, sun: ANY_DAY });

/** Mirrors Problem.available() in the solver; used only to decide who sees a swap. */
export function coversShift(windows: Window[] | undefined, start: string, end: string) {
  if (!windows) return false;
  const s = toMin(start);
  let e = toMin(end);
  if (e <= s) e += 1440;
  return windows.some((w) => {
    const f = toMin(w.from);
    let t = toMin(w.to);
    if (f === 0 && t >= 23 * 60 + 59) return true;
    if (t <= f) t += 1440;
    return f <= s && t >= e;
  });
}

export const hours = (minutes: number) => `${+(minutes / 60).toFixed(1)}h`;

/** The next n Mondays (this week first), labelled for a picker. */
export function upcomingWeeks(n = 12) {
  const first = mondayOf();
  return Array.from({ length: n }, (_, i) => {
    const value = addDays(first, 7 * i);
    return { value, label: `${i === 0 ? "This week" : i === 1 ? "Next week" : "w/c"} ${prettyDate(value, { day: "numeric", month: "short" })}` };
  });
}
