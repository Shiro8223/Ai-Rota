"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { requireStore } from "@/lib/auth";
import { breakTotal, minutesBetween } from "@/lib/clock";
import { db, newId } from "@/lib/db";
import { markSick } from "@/lib/open-shifts";
import { mondayOf, parseDate } from "@/lib/time";
import type { BreakPeriod } from "@/lib/types";

/** Back to the shift log on the day being worked on. */
const back = (storeId: string, day: string, error?: string): never => redirect(`/s/${storeId}/timesheets?day=${day}${error ? `&error=${encodeURIComponent(error)}` : ""}`);

export async function approveEntries(storeId: string, ids: string[]) {
  const { actor } = await requireStore(storeId, "timesheets.approve");
  const d = await db();
  let n = 0;
  for (const id of ids) {
    const t = await d.get("time_entries", id);
    if (!t || t.storeId !== storeId || t.status !== "submitted") continue;
    await d.update("time_entries", id, { status: "approved", approvedBy: actor });
    n++;
  }
  await audit(storeId, actor, "timesheets.approved", { count: n });
  revalidatePath(`/s/${storeId}`, "layout");
}

export async function rejectEntry(storeId: string, id: string) {
  const { actor } = await requireStore(storeId, "timesheets.approve");
  const d = await db();
  const t = await d.get("time_entries", id);
  if (!t || t.storeId !== storeId || t.status === "open") return;
  await d.update("time_entries", id, { status: "rejected", approvedBy: actor });
  await audit(storeId, actor, "timesheets.rejected", { id, employeeId: t.employeeId });
  revalidatePath(`/s/${storeId}`, "layout");
}

const nextDay = (date: string) => {
  const n = new Date(parseDate(date).getTime() + 86_400_000);
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
};

/** "HH:MM" on the shift's date; anything earlier than the clock-in is after midnight. */
function at(date: string, hm: string, after?: string) {
  if (!/^\d{2}:\d{2}$/.test(hm)) return null;
  const s = `${date}T${hm}:00`;
  return after && s < after ? `${nextDay(date)}T${hm}:00` : s;
}

/**
 * Manager edit from the shift log: clock in/out and each break. Saved as approved, with the
 * before and after kept in the audit log. Leaving "out" empty keeps a live entry open.
 */
export async function saveEntry(storeId: string, form: FormData) {
  const { actor } = await requireStore(storeId, "timesheets.approve");
  const d = await db();
  const id = String(form.get("id") ?? "");
  const date = String(form.get("date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) back(storeId, mondayOf(), "Pick a date.");
  const week = mondayOf(parseDate(date));
  const inAt = at(date, String(form.get("in") ?? ""));
  if (!inAt) back(storeId, date, "Enter a start time.");
  const outRaw = String(form.get("out") ?? "");
  const outAt = outRaw ? at(date, outRaw, inAt!) : null;
  if (outRaw && !outAt) back(storeId, date, "The finish time isn't valid.");
  if (outAt && minutesBetween(inAt!, outAt) > 16 * 60) back(storeId, date, "That's over 16 hours. Check the times.");

  const breaks: BreakPeriod[] = [];
  for (let i = 0; i < 3; i++) {
    const bs = String(form.get(`b${i}s`) ?? "");
    const be = String(form.get(`b${i}e`) ?? "");
    if (!bs && !be) continue;
    const start = at(date, bs, inAt!);
    const end = be ? at(date, be, start ?? inAt!) : null;
    if (!start || (be && !end)) back(storeId, date, `Break ${i + 1} has an invalid time.`);
    if (!end && outAt) back(storeId, date, `Break ${i + 1} needs an end time.`);
    if ((outAt && end! > outAt) || start! < inAt!) back(storeId, date, `Break ${i + 1} must be inside the shift.`);
    breaks.push({ start: start!, end });
  }
  if (breaks.filter((b) => !b.end).length > 1) back(storeId, date, "Only one break can still be running.");
  const breakMinutes = breakTotal(breaks);
  const note = String(form.get("note") ?? "").trim().slice(0, 200);

  if (id) {
    const t = await d.get("time_entries", id);
    if (!t || t.storeId !== storeId) back(storeId, date, "Entry not found.");
    await d.update("time_entries", id, { clockIn: inAt!, clockOut: outAt, breaks, breakMinutes, status: outAt ? "approved" : "open", approvedBy: outAt ? actor : null, note: note || t!.note });
    await audit(storeId, actor, "timesheets.edited", { id, employeeId: t!.employeeId, before: { in: t!.clockIn, out: t!.clockOut, breaks: t!.breaks }, after: { in: inAt, out: outAt, breaks } });
  } else {
    const employeeId = String(form.get("employeeId") ?? "");
    const e = await d.get("employees", employeeId);
    if (!e || ![e.storeId, ...(e.allowedStoreIds ?? [])].includes(storeId)) back(storeId, date, "Pick a person.");
    if (!outAt) back(storeId, date, "Hours added by hand need a finish time.");
    await d.insert("time_entries", { id: newId(), storeId, employeeId, weekStart: week, shiftId: null, clockIn: inAt!, clockOut: outAt, breaks, breakMinutes, source: "manual", status: "approved", note, approvedBy: actor });
    await audit(storeId, actor, "timesheets.added", { employeeId, date });
  }
  revalidatePath(`/s/${storeId}`, "layout");
  back(storeId, date);
}

/** Someone rostered who isn't coming in: off the rota, absence recorded, shift offered to others. */
export async function markSickAction(storeId: string, employeeId: string, rotaId: string, shiftId: string, day: string) {
  const { store, actor } = await requireStore(storeId, ["timesheets.approve", "rota.publish"]);
  const e = await (await db()).get("employees", employeeId);
  if (!e) back(storeId, day, "Person not found.");
  const r = await markSick(store, actor, e!, rotaId, shiftId, "");
  revalidatePath(`/s/${storeId}`, "layout");
  back(storeId, day, r.ok ? undefined : r.error);
}
