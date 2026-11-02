"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { requireStore } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { tempRange } from "@/lib/format";
import { vetHoliday } from "@/lib/holiday-server";
import { decideAvailability } from "@/lib/staff";
import { decideSwap } from "@/lib/swaps";
import { cancelOpenShift, decideOpenShift, postOpenShift } from "@/lib/open-shifts";
import { hasFeature } from "@/lib/roles";
import { shiftsForStore } from "@/lib/time";

export async function decideSwapAction(storeId: string, swapId: string, approve: boolean) {
  const { store, actor } = await requireStore(storeId, "approvals.swaps");
  const r = await decideSwap(store, actor, swapId, approve);
  revalidatePath(`/s/${storeId}`, "layout");
  if (!r.ok) redirect(`/s/${storeId}/approvals?error=${encodeURIComponent([r.error, ...(r.issues ?? []).map((i) => i.message)].join(" "))}`);
}

export async function decideHolidayAction(storeId: string, id: string, approve: boolean) {
  const { store, actor } = await requireStore(storeId, "approvals.holiday");
  const d = await db();
  const h = await d.get("holidays", id);
  if (!h || h.storeId !== storeId || h.status !== "pending") return;
  const emp = await d.get("employees", h.employeeId);
  if (approve && emp) {
    // Re-check: the allowance may have changed since it was requested.
    const r = await vetHoliday(store, emp, { startDate: h.startDate, endDate: h.endDate, paid: h.paid, note: h.note }, h.id);
    if (!r.ok) redirect(`/s/${storeId}/approvals?error=${encodeURIComponent(r.error)}`);
  }
  await d.update("holidays", id, { status: approve ? "approved" : "declined", decidedBy: actor, decidedAt: new Date().toISOString() });
  await audit(storeId, actor, approve ? "holiday.approved" : "holiday.declined", { employeeId: h.employeeId, startDate: h.startDate, endDate: h.endDate, paid: h.paid, amount: h.amount });
  await sendEmail(storeId, emp?.email ?? null, `Holiday ${approve ? "approved" : "declined"}`, `Your ${h.paid ? "paid" : "unpaid"} holiday from ${h.startDate} to ${h.endDate} was ${approve ? "approved. Rotas won't schedule you on those days" : "declined. Speak to your manager"}.`);
  revalidatePath(`/s/${storeId}`, "layout");
}

export async function decideAvailabilityAction(storeId: string, id: string, approve: boolean) {
  const { actor } = await requireStore(storeId, "approvals.availability");
  const row = await decideAvailability(storeId, id, approve, actor);
  if (row) {
    const emp = await (await db()).get("employees", row.employeeId);
    const what = row.kind === "temporary" ? `temporary availability (${row.note || "no note"}, ${tempRange(row)})` : "new usual availability";
    await audit(storeId, actor, approve ? "availability.approved" : "availability.declined", { employeeId: row.employeeId, kind: row.kind, startWeek: row.startWeek, endWeek: row.endWeek });
    await sendEmail(storeId, emp?.email ?? null, `Availability ${approve ? "approved" : "declined"}`, `Your ${what} was ${approve ? "approved. Rotas will use it from now on" : "declined. Speak to your manager if you need to talk it through"}.`);
  }
  revalidatePath(`/s/${storeId}`, "layout");
}

export async function decideOpenShiftAction(storeId: string, id: string, approve: boolean) {
  const { store, actor } = await requireStore(storeId, "approvals.swaps");
  const r = await decideOpenShift(store, actor, id, approve);
  revalidatePath(`/s/${storeId}`, "layout");
  if (!r.ok) redirect(`/s/${storeId}/approvals?error=${encodeURIComponent([r.error, ...(r.issues ?? []).map((i) => i.message)].join(" "))}`);
}

export async function postOpenShiftAction(storeId: string, form: FormData) {
  const { store, actor } = await requireStore(storeId, "rota.edit");
  if (!hasFeature(store.features, "openShifts")) return;
  const [rotaId, shiftId] = String(form.get("slot") ?? "").split("|");
  const rota = rotaId ? await (await db()).get("rotas", rotaId) : null;
  if (!rota || rota.storeId !== storeId || rota.status !== "approved" || !shiftsForStore(store).some((s) => s.id === shiftId)) redirect(`/s/${storeId}/approvals?error=${encodeURIComponent("Pick a shift on a published rota.")}`);
  const roleName = String(form.get("roleName") ?? "").trim().slice(0, 60) || null;
  await postOpenShift(store, actor, rota, shiftId, roleName, String(form.get("note") ?? ""));
  revalidatePath(`/s/${storeId}`, "layout");
}

export async function cancelOpenShiftAction(storeId: string, id: string) {
  const { store, actor } = await requireStore(storeId, "rota.edit");
  await cancelOpenShift(store, actor, id);
  revalidatePath(`/s/${storeId}`, "layout");
}
