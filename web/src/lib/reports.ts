import "server-only";
import { paidMinutes } from "./clock";
import { db } from "./db";
import { holidayBalance } from "./holiday-server";
import { dailyHours } from "./holidays";
import { liveAssignments } from "./live";
import { rateFor } from "./pay";
import { hasFeature } from "./roles";
import { storeRoles } from "./team";
import { addDays, dayDate, mondayOf, shiftsForStore, toMin } from "./time";
import type { Store } from "./types";

export interface PersonReport {
  id: string;
  name: string;
  contract: number;
  scheduledMin: number;
  workedMin: number;
  overtimeMin: number;
  closes: number;
  weekends: number;
  shifts: number;
  sickDays: number;
  holidayLeft: number;
  holidayUnit: "days" | "hours";
  /** Holiday not yet taken, valued at their rate (only with the pay permission). */
  liability: number | null;
}

/**
 * Site report over the last `weeks` full weeks (published rotas, plus approved timesheets
 * where clock-in is on): hours, overtime against contract, fairness (closing and weekend
 * shifts), absence and holiday still owed.
 */
export async function siteReport(store: Store, weeks: number, withPay: boolean) {
  const d = await db();
  const end = addDays(mondayOf(), -1);
  const start = addDays(mondayOf(), -7 * weeks);
  const [staff, rotas, entries, absences, roles] = await Promise.all([
    d.list("employees", { storeId: store.id, active: true }, { orderBy: "name" }),
    d.list("rotas", { storeId: store.id }),
    d.list("time_entries", { storeId: store.id, status: "approved" }),
    d.list("absences", { storeId: store.id }),
    storeRoles(store.id),
  ]);
  const shifts = shiftsForStore(store);
  const byId = Object.fromEntries(shifts.map((s) => [s.id, s]));
  // A "close" is the latest-finishing shift of its day.
  const lastEnd: Record<string, number> = {};
  for (const s of shifts) lastEnd[s.day] = Math.max(lastEnd[s.day] ?? 0, toMin(s.start) + s.span);
  const isClose = (id: string) => {
    const s = byId[id];
    return !!s && toMin(s.start) + s.span === lastEnd[s.day];
  };

  const people = new Map<string, PersonReport & { weekMin: Map<string, number> }>();
  for (const e of staff) {
    people.set(e.id, { id: e.id, name: e.name, contract: e.contractedHours, scheduledMin: 0, workedMin: 0, overtimeMin: 0, closes: 0, weekends: 0, shifts: 0, sickDays: 0, holidayLeft: 0, holidayUnit: "days", liability: null, weekMin: new Map() });
  }
  const roleMin = new Map<string, number>();
  for (const r of rotas.filter((x) => x.weekStart >= start && x.weekStart <= end)) {
    for (const a of liveAssignments(r) ?? []) {
      const p = people.get(a.employeeId);
      const s = byId[a.shiftId];
      if (!p || !s) continue;
      p.scheduledMin += s.minutes;
      p.shifts++;
      if (isClose(a.shiftId)) p.closes++;
      if (s.day === "sat" || s.day === "sun") p.weekends++;
      p.weekMin.set(r.weekStart, (p.weekMin.get(r.weekStart) ?? 0) + s.minutes);
      const e = staff.find((x) => x.id === a.employeeId)!;
      for (const role of roles.filter((x) => x.category === "job" && e.roleIds.includes(x.id))) roleMin.set(role.name, (roleMin.get(role.name) ?? 0) + s.minutes);
    }
  }
  const clock = hasFeature(store.features, "clockIn");
  for (const p of people.values()) {
    const mine = entries.filter((t) => t.employeeId === p.id && t.clockIn.slice(0, 10) >= start && t.clockIn.slice(0, 10) <= end);
    if (clock && mine.length) {
      p.workedMin = mine.reduce((n, t) => n + paidMinutes(t), 0);
      p.weekMin = new Map();
      for (const t of mine) p.weekMin.set(t.weekStart, (p.weekMin.get(t.weekStart) ?? 0) + paidMinutes(t));
    } else p.workedMin = p.scheduledMin;
    p.overtimeMin = [...p.weekMin.values()].reduce((n, m) => n + Math.max(0, m - p.contract * 60), 0);
    p.sickDays = new Set(absences.filter((a) => a.employeeId === p.id && a.reason === "sick" && a.date >= start && a.date <= end).map((a) => a.date)).size;
  }
  if (hasFeature(store.features, "holidays")) {
    for (const e of staff) {
      const p = people.get(e.id)!;
      const b = await holidayBalance(store, e);
      p.holidayLeft = Math.max(0, b.remaining);
      p.holidayUnit = b.unit;
      const rate = withPay ? rateFor(e, roles) : null;
      if (rate != null) p.liability = Math.round((b.unit === "hours" ? p.holidayLeft : p.holidayLeft * dailyHours(e)) * rate * 100) / 100;
    }
  }
  const list = [...people.values()].map(({ weekMin: _w, ...rest }) => rest);
  const n = Math.max(1, list.filter((p) => p.shifts).length);
  return {
    start,
    end,
    people: list,
    byRole: [...roleMin.entries()].sort((a, b) => b[1] - a[1]),
    avgCloses: list.reduce((s, p) => s + p.closes, 0) / n,
    avgWeekends: list.reduce((s, p) => s + p.weekends, 0) / n,
    totals: {
      worked: list.reduce((s, p) => s + p.workedMin, 0),
      overtime: list.reduce((s, p) => s + p.overtimeMin, 0),
      sick: list.reduce((s, p) => s + p.sickDays, 0),
      liability: withPay ? list.reduce((s, p) => s + (p.liability ?? 0), 0) : null,
    },
  };
}

/** Week starts for a rolling window, oldest first (for charts). */
export const weekStarts = (weeks: number) => Array.from({ length: weeks }, (_, i) => addDays(mondayOf(), -7 * (weeks - i)));
export { dayDate };
