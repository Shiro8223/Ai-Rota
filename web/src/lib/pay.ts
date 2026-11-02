import type { AgeBand, Assignment, Employee, Role, ShiftInstance } from "./types";

/**
 * UK National Minimum / Living Wage, £ per hour, by the date each rate starts.
 * Rates change every April: add the new row when they're announced.
 */
export const MINIMUM_WAGE: { from: string; rates: Record<AgeBand, number> }[] = [
  { from: "2025-04-01", rates: { "21+": 12.21, "18-20": 10.0, "16-17": 7.55, apprentice: 7.55 } },
  { from: "2026-04-01", rates: { "21+": 12.71, "18-20": 10.85, "16-17": 8.0, apprentice: 8.0 } },
];
export const AGE_BANDS: { key: AgeBand; label: string }[] = [
  { key: "21+", label: "21 or over (National Living Wage)" },
  { key: "18-20", label: "18 to 20" },
  { key: "16-17", label: "16 to 17" },
  { key: "apprentice", label: "Apprentice (under 19, or first year)" },
];

export function minimumWage(band: AgeBand, on: string = new Date().toISOString().slice(0, 10)) {
  const row = [...MINIMUM_WAGE].reverse().find((r) => r.from <= on) ?? MINIMUM_WAGE[0];
  return row.rates[band];
}

/** Person's own rate, else the highest rate among their roles. */
export function rateFor(e: Pick<Employee, "hourlyRate" | "roleIds">, roles: Pick<Role, "id" | "hourlyRate">[]) {
  if (e.hourlyRate != null) return e.hourlyRate;
  const fromRoles = roles.filter((r) => (e.roleIds ?? []).includes(r.id) && r.hourlyRate != null).map((r) => r.hourlyRate!);
  return fromRoles.length ? Math.max(...fromRoles) : null;
}

/** A minimum-wage problem for this person, or null. Under-18s default to the 16-17 band. */
export function wageProblem(e: Pick<Employee, "name" | "hourlyRate" | "roleIds" | "ageBand" | "isUnder18">, roles: Pick<Role, "id" | "hourlyRate">[], on?: string) {
  const rate = rateFor(e, roles);
  if (rate == null) return null;
  const band: AgeBand | null = e.ageBand ?? (e.isUnder18 ? "16-17" : null);
  if (!band) return { kind: "noBand" as const, message: `${e.name.split(" ")[0]} has a pay rate but no age band, so minimum wage can't be checked` };
  const min = minimumWage(band, on);
  return rate + 1e-9 < min ? { kind: "below" as const, message: `${e.name.split(" ")[0]} is paid £${rate.toFixed(2)}/h, below the £${min.toFixed(2)} minimum for ${band}` } : null;
}

export const money = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Labour cost of a set of assignments: paid hours x rate. People without a rate are listed. */
export function labourCost(assignments: Assignment[], shifts: Record<string, ShiftInstance>, people: Pick<Employee, "id" | "name" | "hourlyRate" | "roleIds">[], roles: Pick<Role, "id" | "hourlyRate">[]) {
  const byPerson = new Map(people.map((p) => [p.id, p]));
  let total = 0;
  const perShift: Record<string, number> = {};
  const missing = new Set<string>();
  for (const a of assignments) {
    const s = shifts[a.shiftId];
    const p = byPerson.get(a.employeeId);
    if (!s || !p) continue;
    const rate = rateFor(p, roles);
    if (rate == null) {
      missing.add(p.name);
      continue;
    }
    const cost = (s.minutes / 60) * rate;
    total += cost;
    perShift[a.shiftId] = (perShift[a.shiftId] ?? 0) + cost;
  }
  return { total: Math.round(total * 100) / 100, perShift, missing: [...missing] };
}
