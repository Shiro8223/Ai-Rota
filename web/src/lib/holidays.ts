import { addDays, isoDate, parseDate } from "./time";
import type { Employee, HolidayPolicy, HolidayRequest, Role, Store } from "./types";

/**
 * UK statutory minimum is 5.6 weeks a year (28 days for someone working 5 days a week),
 * pro rata for part-time. This is the default for new stores.
 */
export const DEFAULT_POLICY: HolidayPolicy = { allowance: 28, unit: "days", period: "year", startMonth: 1, proRata: true, fullTimeHours: 37.5 };
export const STATUTORY_WEEKS = 5.6;
/** Working days assumed per week when converting contract hours into a day's worth. */
export const DAYS_PER_WEEK = 5;
/** UK irregular-hours / part-year workers (leave years from April 2024): 12.07% of hours worked. */
export const ACCRUAL_RATE = 0.1207;

export type PolicySource = { policy: HolidayPolicy; from: "person" | "role" | "store"; roleName?: string };

/** Most specific wins: the person's own policy, else their roles' (largest allowance), else the store's. */
export function policyFor(e: Pick<Employee, "holidayPolicy" | "roleIds">, roles: Pick<Role, "id" | "name" | "holidayPolicy">[], store: Pick<Store, "holidayPolicy">): PolicySource {
  if (e.holidayPolicy) return { policy: e.holidayPolicy, from: "person" };
  const fromRoles = roles.filter((r) => (e.roleIds ?? []).includes(r.id) && r.holidayPolicy).sort((a, b) => b.holidayPolicy!.allowance - a.holidayPolicy!.allowance);
  if (fromRoles.length) return { policy: fromRoles[0].holidayPolicy!, from: "role", roleName: fromRoles[0].name };
  return { policy: store.holidayPolicy ?? DEFAULT_POLICY, from: "store" };
}

/** Allowance after pro rata (e.g. 28 days x 20h/37.5h = 14.9 days). */
export function effectiveAllowance(p: HolidayPolicy, contractedHours: number) {
  const factor = p.proRata && p.fullTimeHours > 0 ? Math.min(1, contractedHours / p.fullTimeHours) : 1;
  return Math.round(p.allowance * factor * 10) / 10;
}

/** The allowance period containing `day`: [start, end] inclusive, as YYYY-MM-DD. */
export function periodOf(p: HolidayPolicy, day: string = isoDate(new Date())) {
  const d = parseDate(day);
  let start: Date;
  let months: number;
  if (p.period === "month") {
    start = new Date(d.getFullYear(), d.getMonth(), 1);
    months = 1;
  } else if (p.period === "quarter") {
    start = new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
    months = 3;
  } else {
    const m = Math.min(12, Math.max(1, p.startMonth)) - 1;
    start = new Date(d.getMonth() >= m ? d.getFullYear() : d.getFullYear() - 1, m, 1);
    months = 12;
  }
  const end = new Date(start.getFullYear(), start.getMonth() + months, 0);
  return { start: isoDate(start), end: isoDate(end) };
}

export function datesIn(startDate: string, endDate: string) {
  const out: string[] = [];
  for (let d = startDate; d <= endDate && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** A day's worth of hours for this person (contract spread over a 5-day week). */
export const dailyHours = (e: Pick<Employee, "contractedHours">) => e.contractedHours / DAYS_PER_WEEK;

/**
 * How much allowance a request uses: weekdays-equivalent days in the range (max 5 per
 * calendar week, so a 7-day trip costs a week's worth), or those days x a day's hours.
 */
export function amountFor(e: Pick<Employee, "contractedHours">, unit: HolidayPolicy["unit"], startDate: string, endDate: string) {
  const byWeek = new Map<string, number>();
  for (const d of datesIn(startDate, endDate)) {
    const dt = parseDate(d);
    const monday = addDays(d, -((dt.getDay() + 6) % 7));
    byWeek.set(monday, (byWeek.get(monday) ?? 0) + 1);
  }
  const days = [...byWeek.values()].reduce((n, c) => n + Math.min(DAYS_PER_WEEK, c), 0);
  return unit === "days" ? days : Math.round(days * dailyHours(e) * 10) / 10;
}

/** `workedHours` = hours worked so far this period (needed for accrual policies). */
export function balance(e: Pick<Employee, "id" | "contractedHours" | "holidayPolicy" | "roleIds">, roles: Pick<Role, "id" | "name" | "holidayPolicy">[], store: Pick<Store, "holidayPolicy">, requests: HolidayRequest[], day?: string, workedHours = 0) {
  const src = policyFor(e, roles, store);
  const period = periodOf(src.policy, day);
  const accrual = src.policy.mode === "accrual";
  const inPeriod = requests.filter((r) => r.employeeId === e.id && r.paid && r.startDate >= period.start && r.startDate <= period.end);
  const used = inPeriod.filter((r) => r.status === "approved").reduce((n, r) => n + r.amount, 0);
  const pending = inPeriod.filter((r) => r.status === "pending").reduce((n, r) => n + r.amount, 0);
  const allowance = accrual ? Math.round(workedHours * ACCRUAL_RATE * 10) / 10 : effectiveAllowance(src.policy, e.contractedHours);
  return { ...src, period, allowance, used, pending, remaining: Math.round((allowance - used - pending) * 10) / 10, unit: accrual ? ("hours" as const) : src.policy.unit, accrual };
}

/** Approved holiday dates for one person within a week (Mon..Sun). */
export function holidayDatesInWeek(requests: HolidayRequest[], employeeId: string, weekStart: string) {
  const weekEnd = addDays(weekStart, 6);
  const out = new Set<string>();
  for (const r of requests) {
    if (r.employeeId !== employeeId || r.status !== "approved" || r.endDate < weekStart || r.startDate > weekEnd) continue;
    for (const d of datesIn(r.startDate > weekStart ? r.startDate : weekStart, r.endDate < weekEnd ? r.endDate : weekEnd)) out.add(d);
  }
  return out;
}

export function statutoryNote(p: HolidayPolicy) {
  const perYear = p.period === "year" ? p.allowance : p.period === "quarter" ? p.allowance * 4 : p.allowance * 12;
  const minimum = p.unit === "days" ? STATUTORY_WEEKS * DAYS_PER_WEEK : STATUTORY_WEEKS * p.fullTimeHours;
  return perYear + 1e-9 < minimum ? `Below the UK statutory minimum of 5.6 weeks a year (${Math.round(minimum * 10) / 10} ${p.unit} for full-time).` : null;
}
