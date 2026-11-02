import "server-only";
import { db } from "./db";
import { liveAssignments } from "./live";
import { addDays, dayDate, shiftsForStore } from "./time";
import type { Employee, Store } from "./types";

/**
 * Minutes a person actually worked between two dates (inclusive), across every site they
 * work at: approved timesheets where there are any for a day, otherwise the published shifts
 * that have ended (minus breaks).
 */
export async function workedMinutes(e: Pick<Employee, "id" | "storeId" | "allowedStoreIds">, start: string, end: string) {
  const d = await db();
  const siteIds = [e.storeId, ...(e.allowedStoreIds ?? [])];
  const sites = (await Promise.all(siteIds.map((id) => d.get("stores", id)))).filter((s): s is Store => !!s);
  const byDay = new Map<string, number>();
  const timesheetDays = new Set<string>();
  for (const site of sites) {
    for (const t of await d.list("time_entries", { storeId: site.id, employeeId: e.id, status: "approved" })) {
      const day = t.clockIn.slice(0, 10);
      if (day < start || day > end || !t.clockOut) continue;
      timesheetDays.add(day);
      const mins = Math.max(0, (new Date(t.clockOut).getTime() - new Date(t.clockIn).getTime()) / 60000 - t.breakMinutes);
      byDay.set(day, (byDay.get(day) ?? 0) + mins);
    }
  }
  const now = Date.now();
  for (const site of sites) {
    const shifts = Object.fromEntries(shiftsForStore(site).map((s) => [s.id, s]));
    for (const r of await d.list("rotas", { storeId: site.id })) {
      if (r.weekStart > end || addDays(r.weekStart, 6) < start) continue;
      for (const a of liveAssignments(r) ?? []) {
        const s = shifts[a.shiftId];
        if (a.employeeId !== e.id || !s) continue;
        const day = dayDate(r.weekStart, s.day);
        if (day < start || day > end || timesheetDays.has(day)) continue;
        if (new Date(`${day}T${s.start}:00`).getTime() + s.span * 60_000 > now) continue;
        byDay.set(day, (byDay.get(day) ?? 0) + s.minutes);
      }
    }
  }
  return [...byDay.values()].reduce((n, m) => n + m, 0);
}
