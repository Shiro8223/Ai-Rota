import type { Availability, WeekWindows } from "./types";

/**
 * Availability that applies in a given week, per employee: an approved temporary pattern
 * covering that week wins, otherwise the approved usual pattern. Pending and declined
 * requests never count. Temporary patterns need no clean-up: once endWeek passes, the
 * usual pattern applies again by itself.
 */
export function availabilityFor(rows: Availability[], weekStart: string): Record<string, WeekWindows> {
  const map: Record<string, WeekWindows> = {};
  for (const r of rows) if (r.kind === "default" && r.status === "approved") map[r.employeeId] = r.days;
  const temps = rows
    .filter((r) => r.kind === "temporary" && r.status === "approved" && r.startWeek! <= weekStart && r.endWeek! >= weekStart)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  for (const r of temps) map[r.employeeId] = r.days;
  return map;
}

/** Which pattern applies this week, for labelling ("Exam timetable until 7 Dec"). */
export function activeTemporary(rows: Availability[], employeeId: string, weekStart: string) {
  return rows.find((r) => r.employeeId === employeeId && r.kind === "temporary" && r.status === "approved" && r.startWeek! <= weekStart && r.endWeek! >= weekStart) ?? null;
}
