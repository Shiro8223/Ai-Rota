"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod/v4";
import { audit } from "@/lib/audit";
import { hasFeature } from "@/lib/roles";
import { requireStaff } from "@/lib/auth";
import { db, newId, now } from "@/lib/db";
import { HolidayInput, vetHoliday } from "@/lib/holiday-server";
import { liveAssignments, lockState } from "@/lib/live";
import { loadStore } from "@/lib/org";
import { zonedNow } from "@/lib/zone";
import { checkRota } from "@/lib/solver";
import { shiftsForStore } from "@/lib/time";
import { DAYS } from "@/lib/types";
import { sendEmail } from "@/lib/email";
import { addTemporaryAvailability, setUsualAvailability, TempInput, WeekSchema } from "@/lib/staff";
import { cancelSwap, offerSwap, postSwap, shiftLabel } from "@/lib/swaps";
import type { WeekWindows } from "@/lib/types";

export type SwapState = { ok?: boolean; error?: string; reasons?: string[] } | undefined;

export async function post(rotaId: string, shiftId: string, _: SwapState, form: FormData): Promise<SwapState> {
  const { employee, store } = await requireStaff();
  const r = await postSwap(employee, store, rotaId, shiftId, String(form.get("note") ?? ""));
  revalidatePath("/me");
  return r;
}

export async function offer(swapId: string, _: SwapState): Promise<SwapState> {
  const { employee, store } = await requireStaff();
  const r = await offerSwap(employee, store, swapId);
  revalidatePath("/me");
  return r;
}

export async function cancel(swapId: string) {
  const { employee } = await requireStaff();
  await cancelSwap(employee, swapId);
  revalidatePath("/me");
}

/** Agree or decline a shift the manager put you on outside your availability. */
export async function respondToAsk(rotaId: string, shiftId: string, agree: boolean) {
  const { employee, store } = await requireStaff();
  const d = await db();
  const rota = await d.get("rotas", rotaId);
  if (!rota || rota.storeId !== store.id) return;
  const ex = (rota.exceptions ?? []).find((x) => x.shiftId === shiftId && x.employeeId === employee.id && x.status === "pending");
  if (!ex) return;
  await d.update("rotas", rotaId, {
    exceptions: rota.exceptions.map((x) => (x === ex ? { ...x, status: agree ? "agreed" : "declined", respondedAt: now() } : x)),
    updatedAt: now(),
  });
  await audit(store.id, employee.name, agree ? "rota.ask_agreed" : "rota.ask_declined", { rotaId, shiftId });
  if (!agree) {
    // The rota itself only changes when a manager edits and re-approves it.
    for (const m of await d.list("store_members", { storeId: store.id })) {
      await sendEmail(store.id, m.email, `${employee.name} can't do ${shiftLabel(store, rota, shiftId)}`, `${employee.name} declined ${shiftLabel(store, rota, shiftId)}, which was outside their availability. Unlock that week's rota and reassign it.`);
    }
  }
  revalidatePath("/me");
}

/**
 * Accept or decline a change the manager suggested to a shift starting within 24 hours.
 * Accepting re-runs the rule check on the live rota first: it never makes the week illegal.
 */
export async function respondToChange(changeId: string, accept: boolean) {
  const { employee, store: home } = await requireStaff();
  const d = await db();
  const c = await d.get("change_requests", changeId);
  if (!c || c.employeeId !== employee.id || c.status !== "pending") return { ok: false, error: "That change is no longer open." };
  // The change may be at a sister site this person also works at.
  if (c.storeId !== home.id && !(employee.allowedStoreIds ?? []).includes(c.storeId)) return { ok: false, error: "That change is no longer open." };
  const store = c.storeId === home.id ? home : await loadStore(c.storeId);
  if (!store) return { ok: false, error: "That change is no longer open." };
  const rota = await d.get("rotas", c.rotaId);
  const shift = shiftsForStore(store).find((s) => s.id === c.shiftId);
  if (!rota || !shift || lockState(rota.weekStart, DAYS.indexOf(shift.day), shift.start, zonedNow(store.timezone)) === "past") {
    await d.update("change_requests", changeId, { status: "expired", respondedAt: now() });
    return { ok: false, error: "That shift has already started." };
  }
  if (!accept) {
    await d.update("change_requests", changeId, { status: "declined", respondedAt: now() });
    await audit(store.id, employee.name, "rota.change_declined", { changeId, shiftId: c.shiftId, kind: c.kind });
    for (const m of await d.list("store_members", { storeId: store.id })) {
      await sendEmail(store.id, m.email, `${employee.name} declined a change`, `${employee.name} declined your suggestion to ${c.kind === "add" ? "add them to" : "take them off"} ${shiftLabel(store, rota, c.shiftId)}. The rota stays as it was.`);
    }
    revalidatePath("/me");
    return { ok: true };
  }
  const live = liveAssignments(rota) ?? [];
  const next = c.kind === "add"
    ? live.some((a) => a.shiftId === c.shiftId && a.employeeId === employee.id) ? live : [...live, { shiftId: c.shiftId, employeeId: employee.id }]
    : live.filter((a) => !(a.shiftId === c.shiftId && a.employeeId === employee.id));
  const [before, after] = await Promise.all([checkRota(store, rota.weekStart, live, rota.exceptions ?? []), checkRota(store, rota.weekStart, next, rota.exceptions ?? [])]);
  const known = new Set(before.issues.map((i) => i.message));
  const fresh = after.issues.filter((i) => (i.legal || i.blocking) && i.severity === "error" && !known.has(i.message));
  if (fresh.length) return { ok: false, error: `This would break a legal or contract rule: ${fresh.map((i) => i.message).join("; ")}` };
  const draftToo = rota.status === "draft"
    ? c.kind === "add" ? [...rota.assignments.filter((a) => !(a.shiftId === c.shiftId && a.employeeId === employee.id)), { shiftId: c.shiftId, employeeId: employee.id }] : rota.assignments.filter((a) => !(a.shiftId === c.shiftId && a.employeeId === employee.id))
    : next;
  await d.update("rotas", rota.id, { published: next, assignments: draftToo, version: rota.version + 1, updatedAt: now() });
  await d.insert("rota_history", { id: newId(), storeId: store.id, rotaId: rota.id, version: rota.version + 1, status: "approved", assignments: next, by: employee.name, reason: `Accepted suggested change: ${c.kind} ${c.shiftId}`, at: now() });
  await d.update("change_requests", changeId, { status: "accepted", respondedAt: now() });
  await audit(store.id, employee.name, "rota.change_accepted", { changeId, shiftId: c.shiftId, kind: c.kind });
  revalidatePath("/me");
  return { ok: true };
}

export async function requestHoliday(input: unknown) {
  const { employee, store } = await requireStaff();
  if (!hasFeature(store.features, "holidays")) return { ok: false, error: "Holiday booking is switched off." };
  const v = HolidayInput.safeParse(input);
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? "Check the dates." };
  const r = await vetHoliday(store, employee, v.data);
  if (!r.ok) return r;
  await (await db()).insert("holidays", { id: newId(), storeId: store.id, employeeId: employee.id, ...v.data, amount: r.amount, unit: r.unit, status: "pending", createdAt: now(), decidedBy: null, decidedAt: null });
  await audit(store.id, employee.name, "holiday.requested", { startDate: v.data.startDate, endDate: v.data.endDate, paid: v.data.paid, amount: r.amount });
  for (const m of await (await db()).list("store_members", { storeId: store.id })) {
    await sendEmail(store.id, m.email, `Holiday request: ${employee.name}`, `${employee.name} has asked for ${v.data.paid ? "paid" : "unpaid"} holiday from ${v.data.startDate} to ${v.data.endDate}. Approve or decline it in Rota Agent → Approvals.`);
  }
  revalidatePath("/me");
  return { ok: true };
}

export async function cancelHoliday(id: string) {
  const { employee } = await requireStaff();
  const d = await db();
  const h = await d.get("holidays", id);
  if (!h || h.employeeId !== employee.id || h.status !== "pending") return;
  await d.update("holidays", id, { status: "cancelled", decidedBy: employee.name, decidedAt: now() });
  revalidatePath("/me");
}

/** Staff changes to their usual pattern wait for a manager to approve them. */
export async function requestUsualAvailability(days: WeekWindows) {
  const { employee, store } = await requireStaff();
  if (!hasFeature(store.features, "staffAvailability")) return { ok: false, error: "Ask your manager to change your availability." };
  const parsed = WeekSchema.safeParse(days);
  if (!parsed.success) return { ok: false, error: "Times must be HH:MM" };
  await setUsualAvailability(store.id, employee.id, parsed.data, employee.name, false);
  await audit(store.id, employee.name, "availability.requested", { employeeId: employee.id, kind: "default" });
  revalidatePath("/me");
  return { ok: true, info: "Sent to your manager for approval." };
}

export async function requestTemporaryAvailability(input: unknown, days: WeekWindows) {
  const { employee, store } = await requireStaff();
  if (!hasFeature(store.features, "temporaryAvailability") || !hasFeature(store.features, "staffAvailability")) return { ok: false, error: "Temporary availability is switched off." };
  const i = TempInput.safeParse(input);
  const w = WeekSchema.safeParse(days);
  if (!i.success) return { ok: false, error: z.prettifyError(i.error) };
  if (!w.success) return { ok: false, error: "Times must be HH:MM" };
  await addTemporaryAvailability(store.id, employee.id, i.data, w.data, employee.name, false);
  await audit(store.id, employee.name, "availability.requested", { employeeId: employee.id, kind: "temporary", startWeek: i.data.startWeek, weeks: i.data.weeks });
  revalidatePath("/me");
  return { ok: true, info: "Sent to your manager for approval." };
}

export async function withdrawRequest(id: string) {
  const { employee } = await requireStaff();
  const d = await db();
  const row = await d.get("availability", id);
  if (!row || row.employeeId !== employee.id || row.status !== "pending") return;
  await d.remove("availability", { id });
  revalidatePath("/me");
}
