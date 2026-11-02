import { shiftsForStore } from "./time";
import { zonedNow } from "./zone";
import { DAYS, type Assignment, type Rota, type Store } from "./types";

/**
 * What staff currently see for a week: the last published assignments. While a manager
 * edits an unlocked copy (status "draft"), staff keep seeing the published version.
 */
export function liveAssignments(rota: Pick<Rota, "published" | "status" | "assignments">): Assignment[] | null {
  if (rota.published) return rota.published;
  return rota.status === "approved" ? rota.assignments : null;
}

export const LOCK_HOURS = 24;

/** Start time of a shift as a Date (store-local clock). */
export function shiftStart(weekStart: string, dayIndex: number, start: string) {
  const [y, m, d] = weekStart.split("-").map(Number);
  const [h, min] = start.split(":").map(Number);
  return new Date(y, m - 1, d + dayIndex, h, min);
}

/** "locked" = starts within 24 hours; "past" = already started. Changes to either need the person's consent or can't happen. */
export function lockState(weekStart: string, dayIndex: number, start: string, now = new Date()): "open" | "locked" | "past" {
  const t = shiftStart(weekStart, dayIndex, start).getTime();
  if (t <= now.getTime()) return "past";
  if (t - now.getTime() < LOCK_HOURS * 3600_000) return "locked";
  return "open";
}

/**
 * The 24-hour rule: once a week is published, changes to shifts starting within 24 hours
 * (or already started) are not applied. Upcoming ones become suggestions the person must
 * accept; past ones stay as they were. Everything else publishes as normal.
 */
export function applyLock(store: Pick<Store, "shiftTemplates" | "openingHours"> & { timezone?: string }, weekStart: string, wanted: Assignment[], published: Assignment[] | null, at = zonedNow(store.timezone)) {
  if (!published) return { live: wanted, suggestions: [] as { shiftId: string; employeeId: string; kind: "add" | "remove" }[], keptPast: 0 };
  const shifts = Object.fromEntries(shiftsForStore(store).map((s) => [s.id, s]));
  const state = (shiftId: string) => {
    const s = shifts[shiftId];
    return s ? lockState(weekStart, DAYS.indexOf(s.day), s.start, at) : "open";
  };
  const key = (a: Assignment) => `${a.shiftId}|${a.employeeId}`;
  const was = new Set(published.map(key));
  const now = new Set(wanted.map(key));
  const live = [...wanted.filter((a) => state(a.shiftId) === "open"), ...published.filter((a) => state(a.shiftId) !== "open")];
  const suggestions: { shiftId: string; employeeId: string; kind: "add" | "remove" }[] = [];
  let keptPast = 0;
  for (const a of wanted) if (!was.has(key(a)) && state(a.shiftId) !== "open") state(a.shiftId) === "locked" ? suggestions.push({ ...a, kind: "add" }) : keptPast++;
  for (const a of published) if (!now.has(key(a)) && state(a.shiftId) !== "open") state(a.shiftId) === "locked" ? suggestions.push({ ...a, kind: "remove" }) : keptPast++;
  return { live, suggestions, keptPast };
}

