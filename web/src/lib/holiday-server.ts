import "server-only";
import { z } from "zod/v4";
import { db } from "./db";
import { amountFor, balance, periodOf, policyFor } from "./holidays";
import { workedMinutes } from "./worked";
import { storeRoles } from "./team";
import { isoDate } from "./time";
import type { Employee, HolidayPolicy, Store } from "./types";

export const PolicySchema = z.object({
  mode: z.enum(["fixed", "accrual"]).default("fixed"),
  allowance: z.coerce.number().min(0).max(400),
  unit: z.enum(["days", "hours"]),
  period: z.enum(["year", "quarter", "month"]),
  startMonth: z.coerce.number().int().min(1).max(12),
  proRata: z.coerce.boolean(),
  fullTimeHours: z.coerce.number().min(1).max(80),
}) satisfies z.ZodType<HolidayPolicy>;

export const HolidayInput = z
  .object({
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    paid: z.coerce.boolean(),
    note: z.string().trim().max(120).default(""),
  })
  .refine((v) => v.endDate >= v.startDate, { message: "The end date is before the start date." })
  .refine((v) => v.startDate >= isoDate(new Date()), { message: "Holiday can't start in the past." })
  .refine((v) => (new Date(v.endDate).getTime() - new Date(v.startDate).getTime()) / 86_400_000 < 60, { message: "Book at most 60 days at a time." });

export async function holidayBalance(store: Store, e: Employee, day?: string) {
  const d = await db();
  const [roles, requests] = await Promise.all([storeRoles(store.id), d.list("holidays", { storeId: store.id, employeeId: e.id })]);
  const src = policyFor(e, roles, store);
  // Accrual policies earn holiday from hours actually worked so far this period.
  const worked = src.policy.mode === "accrual" ? (await workedMinutes(e, periodOf(src.policy, day).start, isoDate(new Date()))) / 60 : 0;
  return balance(e, roles, store, requests, day, worked);
}

/** Validate a request against overlaps and the allowance. Returns the amount it uses. */
export async function vetHoliday(store: Store, e: Employee, v: z.infer<typeof HolidayInput>, ignoreId?: string) {
  const d = await db();
  const mine = (await d.list("holidays", { storeId: store.id, employeeId: e.id })).filter((r) => r.id !== ignoreId && (r.status === "pending" || r.status === "approved"));
  if (mine.some((r) => r.startDate <= v.endDate && r.endDate >= v.startDate)) return { ok: false as const, error: "You already have holiday booked or requested on some of those dates." };
  const b = await holidayBalance(store, e, v.startDate);
  const amount = v.paid ? (b.accrual ? Math.round(amountFor(e, "days", v.startDate, v.endDate) * (e.contractedHours / 5) * 10) / 10 : amountFor(e, b.unit, v.startDate, v.endDate)) : 0;
  // When approving, this request's own pending amount is already counted in b.pending.
  const own = ignoreId ? (await d.get("holidays", ignoreId))?.amount ?? 0 : 0;
  if (v.paid && amount > b.remaining + own + 1e-9) {
    return { ok: false as const, error: `That's ${amount} ${b.unit} of paid holiday, but only ${Math.max(0, b.remaining + own)} ${b.unit} are left until ${b.period.end}. Book some of it as unpaid, or pick fewer days.` };
  }
  return { ok: true as const, amount, unit: b.unit };
}
