import "server-only";
import { z } from "zod/v4";
import { pinHash } from "./crypto";
import { db, newId, now } from "./db";
import { cleanRoleIds, derived, storeRoles } from "./team";
import { addDays, isMonday } from "./time";
import type { Availability, Employee, WeekWindows } from "./types";

const HM = z.string().regex(/^([01]\d|2[0-4]):[0-5]\d$/);
const W = z.array(z.object({ from: HM, to: HM })).max(4);
export const WeekSchema = z.object({ mon: W, tue: W, wed: W, thu: W, fri: W, sat: W, sun: W });

/** Only what scheduling needs. No addresses, NI numbers or pay rates (spec: data minimisation). */
export const EmployeeInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  startDate: z.iso.date("Start date must be YYYY-MM-DD"),
  contractedHours: z.coerce.number().min(0).max(60),
  maxHoursPerWeek: z.coerce.number().min(1).max(80),
  email: z.union([z.literal(""), z.email()]).transform((v) => v || null),
  roleIds: z.array(z.string().max(80)).max(30).default([]),
});
export type EmployeeInputT = z.infer<typeof EmployeeInput>;

/** Random PIN that no one else at the store has. Returned once to show the manager. */
export async function freshPin(storeId: string) {
  const d = await db();
  for (let i = 0; i < 50; i++) {
    const pin = String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));
    if (!(await d.list("employees", { storeId, pinHash: pinHash(storeId, pin) })).length) return pin;
  }
  throw new Error("Couldn't find a free PIN");
}

export async function createEmployee(storeId: string, input: EmployeeInputT) {
  const pin = await freshPin(storeId);
  const roles = await storeRoles(storeId);
  const roleIds = cleanRoleIds(input.roleIds, roles);
  const e: Employee = { id: newId(), storeId, ...input, roleIds, ...derived(roleIds, roles), pinHash: pinHash(storeId, pin), active: true, createdAt: now() };
  await (await db()).insert("employees", e);
  return { employee: e, pin };
}

/**
 * Set someone's usual pattern. A manager's change applies straight away; a change from the
 * member of staff waits as "pending" until a manager approves it.
 */
export async function setUsualAvailability(storeId: string, employeeId: string, days: WeekWindows, by: string, approved: boolean) {
  const d = await db();
  const rows = await d.list("availability", { storeId, employeeId, kind: "default" });
  for (const r of rows.filter((r) => r.status === "pending")) await d.remove("availability", { id: r.id });
  if (approved) {
    for (const r of rows.filter((r) => r.status === "approved")) await d.remove("availability", { id: r.id });
  }
  const row: Availability = {
    id: newId(), storeId, employeeId, kind: "default", startWeek: null, endWeek: null, days,
    status: approved ? "approved" : "pending", note: "", requestedBy: by, decidedBy: approved ? by : null, decidedAt: approved ? now() : null, updatedAt: now(),
  };
  await d.insert("availability", row);
  return row;
}

export const TempInput = z.object({
  startWeek: z.string().refine(isMonday, "Pick a week starting on a Monday"),
  weeks: z.coerce.number().int().min(1, "At least 1 week").max(26, "26 weeks at most"),
  note: z.string().trim().max(80).default(""),
});

/** A different pattern for a few weeks (exams, term time, holidays) that reverts by itself. */
export async function addTemporaryAvailability(storeId: string, employeeId: string, input: z.infer<typeof TempInput>, days: WeekWindows, by: string, approved: boolean) {
  const row: Availability = {
    id: newId(), storeId, employeeId, kind: "temporary", startWeek: input.startWeek, endWeek: addDays(input.startWeek, 7 * (input.weeks - 1)), days,
    status: approved ? "approved" : "pending", note: input.note, requestedBy: by, decidedBy: approved ? by : null, decidedAt: approved ? now() : null, updatedAt: now(),
  };
  await (await db()).insert("availability", row);
  return row;
}

/** Manager approves or declines a request from staff. */
export async function decideAvailability(storeId: string, id: string, approve: boolean, by: string) {
  const d = await db();
  const row = await d.get("availability", id);
  if (!row || row.storeId !== storeId || row.status !== "pending") return null;
  if (approve && row.kind === "default") {
    for (const r of await d.list("availability", { storeId, employeeId: row.employeeId, kind: "default", status: "approved" })) await d.remove("availability", { id: r.id });
  }
  return d.update("availability", id, { status: approve ? "approved" : "declined", decidedBy: by, decidedAt: now() });
}
