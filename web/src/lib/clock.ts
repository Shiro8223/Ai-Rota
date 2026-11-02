import { zonedNow } from "./zone";
import type { BreakPeriod } from "./types";

/** Wall-clock "YYYY-MM-DDTHH:MM:SS" in the site's timezone (how time entries are stored). */
export function wallNow(timeZone?: string, at = new Date()) {
  const z = zonedNow(timeZone, at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${z.getFullYear()}-${p(z.getMonth() + 1)}-${p(z.getDate())}T${p(z.getHours())}:${p(z.getMinutes())}:${p(z.getSeconds())}`;
}

/** Minutes between two wall-clock stamps. */
export const minutesBetween = (a: string, b: string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000));

/** The legal minimum unpaid break for a stretch of work (UK): 20 min over 6h, 30 min over 4.5h for under-18s. */
export function statutoryBreak(minutes: number, under18: boolean) {
  if (under18) return minutes > 270 ? 30 : 0;
  return minutes > 360 ? 20 : 0;
}

/** Minutes of break taken; an unfinished break counts up to `now`. */
export function breakTotal(breaks: BreakPeriod[] | undefined, now?: string) {
  return (breaks ?? []).reduce((n, b) => n + (b.end ? minutesBetween(b.start, b.end) : now ? minutesBetween(b.start, now) : 0), 0);
}

export const onBreak = (t: { clockOut: string | null; breaks?: BreakPeriod[] }) => !t.clockOut && (t.breaks ?? []).some((b) => !b.end);

/**
 * Break still owed: the larger of the rota's unpaid break and the legal minimum for the
 * shift length, minus what's been taken.
 */
export function breakRemaining(opts: { shiftBreak: number; shiftMinutes: number; under18: boolean; taken: number }) {
  const need = Math.max(opts.shiftBreak, statutoryBreak(opts.shiftMinutes, opts.under18));
  return Math.max(0, need - opts.taken);
}

/** Paid minutes of a time entry. */
export function paidMinutes(t: { clockIn: string; clockOut: string | null; breakMinutes: number }) {
  return t.clockOut ? Math.max(0, minutesBetween(t.clockIn, t.clockOut) - t.breakMinutes) : 0;
}

/** "7h 32m" */
export const hm = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
