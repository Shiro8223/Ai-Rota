import "server-only";
import { audit } from "./audit";
import { breakRemaining, breakTotal, minutesBetween, paidMinutes, wallNow } from "./clock";
import { pinHash, safeEqual } from "./crypto";
import { blocked, limit } from "./rate-limit";
import { db, newId } from "./db";
import { dailyHours, holidayDatesInWeek } from "./holidays";
import { liveAssignments } from "./live";
import { notifyManagers } from "./notify";
import { storeStaff } from "./org";
import { rateFor } from "./pay";
import { hasFeature } from "./roles";
import { storeRoles } from "./team";
import { addDays, dayDate, mondayOf, parseDate, shiftsForStore } from "./time";
import type { Employee, ShiftInstance, Store, TimeEntry } from "./types";

/** The person's published shift at this site today that's nearest to now (for matching a clock-in). */
export async function shiftToday(site: Store, employeeId: string, wall: string) {
  return (await shiftsToday(site, wall)).filter((x) => x.employeeId === employeeId).map((x) => x.shift).sort((a, b) => Math.abs(toMinutes(a.start) - nowMin(wall)) - Math.abs(toMinutes(b.start) - nowMin(wall)))[0] ?? null;
}

const toMinutes = (hm: string) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);
const nowMin = (wall: string) => +wall.slice(11, 13) * 60 + +wall.slice(14, 16);

/** Everyone's published shifts at this site today. */
async function shiftsToday(site: Store, wall: string) {
  const date = wall.slice(0, 10);
  const week = mondayOf(parseDate(date));
  const rota = (await (await db()).list("rotas", { storeId: site.id, weekStart: week }))[0];
  const live = rota ? liveAssignments(rota) : null;
  if (!live) return [];
  const byId = Object.fromEntries(shiftsForStore(site).filter((s) => dayDate(week, s.day) === date).map((s) => [s.id, s]));
  return live.filter((a) => byId[a.shiftId]).map((a) => ({ employeeId: a.employeeId, shift: byId[a.shiftId] }));
}

export async function openEntry(employeeId: string, siteIds: string[]) {
  const d = await db();
  return (await Promise.all(siteIds.map((id) => d.list("time_entries", { storeId: id, employeeId, status: "open" })))).flat()[0] ?? null;
}

// ---------------------------------------------------------------- clock-in screen (kiosk)

export type KioskStatus = "working" | "onBreak" | "upcoming" | "done" | "off";
export interface KioskPerson { id: string; name: string; status: KioskStatus; shift: string | null; since: string | null; visiting: boolean }

/** The list on the clock-in screen. Names and today's status only: no PINs, pay or contact details. */
export async function kioskBoard(store: Store): Promise<KioskPerson[]> {
  const wall = wallNow(store.timezone);
  const today = wall.slice(0, 10);
  const d = await db();
  const [staff, todays, entries] = await Promise.all([storeStaff(store), shiftsToday(store, wall), d.list("time_entries", { storeId: store.id, weekStart: mondayOf(parseDate(today)) })]);
  return staff
    .filter((e) => e.active && (!e.visiting || todays.some((t) => t.employeeId === e.id)))
    .map((e) => {
      const mine = entries.filter((t) => t.employeeId === e.id && t.clockIn.startsWith(today));
      const open = mine.find((t) => !t.clockOut);
      const shifts = todays.filter((t) => t.employeeId === e.id).map((t) => t.shift).sort((a, b) => a.start.localeCompare(b.start));
      const later = shifts.filter((s) => toMinutes(s.start) + s.span > nowMin(wall));
      let status: KioskStatus = "off";
      let since: string | null = null;
      if (open) {
        const br = (open.breaks ?? []).find((b) => !b.end);
        status = br ? "onBreak" : "working";
        since = (br?.start ?? open.clockIn).slice(11, 16);
      } else if (later.length && !(mine.length && mine.every((t) => t.clockOut) && later.every((s) => mine.some((t) => t.shiftId === s.id)))) status = "upcoming";
      else if (mine.length) status = "done";
      const show = open ? shifts.find((s) => s.id === open.shiftId) ?? shifts[0] : later[0] ?? shifts[0];
      return { id: e.id, name: e.name, status, shift: show ? `${show.name} ${show.start}–${show.end}` : null, since, visiting: !!e.visiting };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type KioskAction = "in" | "out" | "breakStart" | "breakEnd";
export interface KioskDetail {
  name: string;
  shift: { name: string; start: string; end: string; breakMinutes: number } | null;
  clockIn: string | null;
  onBreakSince: string | null;
  breakTaken: number;
  breakLeft: number;
  actions: KioskAction[];
}
/** Errors are codes; the clock-in screen shows them in the chosen language. */
export type KioskError = "pin" | "locked" | "otherSite" | "alreadyIn" | "notIn" | "onBreak" | "notOnBreak";
export interface KioskResult {
  action: KioskAction;
  name: string;
  clockIn?: string;
  clockOut?: string;
  breakStart?: string;
  breakEnd?: string;
  breakMinutes?: number;
  workedMinutes?: number;
  late?: number;
}

/** Check the person's PIN (keyed to their home site). Five wrong tries locks that person out for 10 minutes. */
async function verify(store: Store, employeeId: string, pin: string) {
  // Only wrong PINs count towards the limit, so normal use never locks anyone out.
  const key = `${store.id}:${employeeId}`;
  if (blocked("kioskPin", key)) return { error: "locked" as const };
  const e = (await storeStaff(store)).find((x) => x.id === employeeId && x.active);
  if (!e || !/^\d{4,6}$/.test(pin) || !e.pinHash || !safeEqual(e.pinHash, pinHash(e.storeId, pin))) {
    limit("kioskPin", key);
    return { error: "pin" as const };
  }
  return { employee: e };
}

async function detailFor(store: Store, e: Employee): Promise<KioskDetail> {
  const wall = wallNow(store.timezone);
  const open = await openEntry(e.id, [store.id]);
  const shift = open?.shiftId ? shiftsForStore(store).find((s) => s.id === open.shiftId) ?? null : await shiftToday(store, e.id, wall);
  const taken = open ? breakTotal(open.breaks, wall) : 0;
  const br = open?.breaks?.find((b) => !b.end);
  const worked = open ? minutesBetween(open.clockIn, wall) : 0;
  const left = open ? breakRemaining({ shiftBreak: shift?.breakMinutes ?? 0, shiftMinutes: Math.max(worked, shift?.span ?? 0), under18: e.isUnder18, taken }) : 0;
  return {
    name: e.name,
    shift: shift ? { name: shift.name, start: shift.start, end: shift.end, breakMinutes: shift.breakMinutes } : null,
    clockIn: open?.clockIn.slice(11, 16) ?? null,
    onBreakSince: br?.start.slice(11, 16) ?? null,
    breakTaken: taken,
    breakLeft: left,
    actions: !open ? ["in"] : br ? ["breakEnd"] : ["breakStart", "out"],
  };
}

/** After the PIN: what's their shift and what can they do now. */
export async function kioskLookup(store: Store, employeeId: string, pin: string): Promise<{ ok: true; detail: KioskDetail } | { ok: false; error: KioskError }> {
  const v = await verify(store, employeeId, pin);
  if ("error" in v) return { ok: false, error: v.error! };
  return { ok: true, detail: await detailFor(store, v.employee) };
}

/** Clock in / start break / end break / clock out. The PIN is checked again every time. */
export async function kioskAct(store: Store, employeeId: string, pin: string, action: KioskAction): Promise<{ ok: true; result: KioskResult } | { ok: false; error: KioskError }> {
  const v = await verify(store, employeeId, pin);
  if ("error" in v) return { ok: false, error: v.error! };
  const e = v.employee;
  const d = await db();
  const wall = wallNow(store.timezone);
  const siteIds = [e.storeId, ...(e.allowedStoreIds ?? [])];
  const open = await openEntry(e.id, [...new Set([store.id, ...siteIds])]);
  if (open && open.storeId !== store.id) return { ok: false, error: "otherSite" };
  const br = open?.breaks?.find((b) => !b.end);
  const short = (s: string) => s.slice(11, 16);

  if (action === "in") {
    if (open) return { ok: false, error: "alreadyIn" };
    const shift = await shiftToday(store, e.id, wall);
    const entry: TimeEntry = { id: newId(), storeId: store.id, employeeId: e.id, weekStart: mondayOf(parseDate(wall.slice(0, 10))), shiftId: shift?.id ?? null, clockIn: wall, clockOut: null, breaks: [], breakMinutes: 0, source: "kiosk", status: "open", note: "", approvedBy: null };
    await d.insert("time_entries", entry);
    await audit(store.id, e.name, "clock.in", { entryId: entry.id, shiftId: entry.shiftId });
    const late = shift ? minutesBetween(`${wall.slice(0, 10)}T${shift.start}:00`, wall) : 0;
    return { ok: true, result: { action, name: e.name, clockIn: short(wall), late: late > 5 ? late : 0 } };
  }
  if (!open) return { ok: false, error: "notIn" };
  if (action === "breakStart") {
    if (br) return { ok: false, error: "onBreak" };
    await d.update("time_entries", open.id, { breaks: [...(open.breaks ?? []), { start: wall, end: null }] });
    await audit(store.id, e.name, "clock.break_start", { entryId: open.id });
    return { ok: true, result: { action, name: e.name, breakStart: short(wall) } };
  }
  if (action === "breakEnd") {
    if (!br) return { ok: false, error: "notOnBreak" };
    const breaks = (open.breaks ?? []).map((b) => (b === br ? { ...b, end: wall } : b));
    await d.update("time_entries", open.id, { breaks, breakMinutes: breakTotal(breaks) });
    await audit(store.id, e.name, "clock.break_end", { entryId: open.id, minutes: minutesBetween(br.start, wall) });
    return { ok: true, result: { action, name: e.name, breakStart: short(br.start), breakEnd: short(wall), breakMinutes: minutesBetween(br.start, wall) } };
  }
  // Clocking out ends any break still running.
  const breaks = (open.breaks ?? []).map((b) => (b.end ? b : { ...b, end: wall }));
  const breakMinutes = breakTotal(breaks);
  await d.update("time_entries", open.id, { clockOut: wall, breaks, breakMinutes, status: "submitted" });
  const worked = Math.max(0, minutesBetween(open.clockIn, wall) - breakMinutes);
  await audit(store.id, e.name, "clock.out", { entryId: open.id, minutes: worked });
  return { ok: true, result: { action, name: e.name, clockIn: short(open.clockIn), clockOut: short(wall), breakMinutes, workedMinutes: worked } };
}

/** Scheduled vs actual for a site's week: one row per person per day that has either. */
export async function weekTimesheet(store: Store, week: string) {
  const d = await db();
  const [entries, rotas] = await Promise.all([d.list("time_entries", { storeId: store.id, weekStart: week }), d.list("rotas", { storeId: store.id, weekStart: week })]);
  const shifts = Object.fromEntries(shiftsForStore(store).map((s) => [s.id, s]));
  const live = rotas[0] ? (liveAssignments(rotas[0]) ?? []) : [];
  const key = (emp: string, date: string) => `${emp}|${date}`;
  const rows = new Map<string, { employeeId: string; date: string; rotaId: string | null; scheduled: ShiftInstance[]; entries: TimeEntry[] }>();
  const row = (emp: string, date: string) => {
    const k = key(emp, date);
    if (!rows.has(k)) rows.set(k, { employeeId: emp, date, rotaId: rotas[0]?.id ?? null, scheduled: [], entries: [] });
    return rows.get(k)!;
  };
  for (const a of live) if (shifts[a.shiftId]) row(a.employeeId, dayDate(week, shifts[a.shiftId].day)).scheduled.push(shifts[a.shiftId]);
  for (const t of entries) row(t.employeeId, t.clockIn.slice(0, 10)).entries.push(t);
  return [...rows.values()].sort((a, b) => (a.date + a.employeeId).localeCompare(b.date + b.employeeId));
}

export type PayrollFormat = "generic" | "sage" | "xero" | "brightpay";
export const PAYROLL_FORMATS: Record<PayrollFormat, string> = { generic: "Generic CSV", sage: "Sage 50 Payroll (hours import)", xero: "Xero Payroll (timesheet lines)", brightpay: "BrightPay (hours & rates)" };

/**
 * Hours to pay per person for a date range at one site: approved timesheets where clock-in is
 * on, otherwise published shifts that have ended. Plus paid holiday hours and sick days.
 * Pay columns only when `withPay` (the pay permission).
 */
export async function payrollRows(store: Store, from: string, to: string, withPay: boolean) {
  const d = await db();
  const [staff, roles, entries, rotas, holidays, absences] = await Promise.all([
    d.list("employees", { storeId: store.id }, { orderBy: "name" }),
    storeRoles(store.id),
    d.list("time_entries", { storeId: store.id, status: "approved" }),
    d.list("rotas", { storeId: store.id }),
    d.list("holidays", { storeId: store.id, status: "approved" }),
    d.list("absences", { storeId: store.id }),
  ]);
  const useClock = hasFeature(store.features, "clockIn");
  const shifts = Object.fromEntries(shiftsForStore(store).map((s) => [s.id, s]));
  const nowMs = Date.now();
  const worked = new Map<string, number>();
  if (useClock) {
    for (const t of entries) {
      const day = t.clockIn.slice(0, 10);
      if (day >= from && day <= to) worked.set(t.employeeId, (worked.get(t.employeeId) ?? 0) + paidMinutes(t));
    }
  } else {
    for (const r of rotas) {
      if (r.weekStart > to || addDays(r.weekStart, 6) < from) continue;
      for (const a of liveAssignments(r) ?? []) {
        const s = shifts[a.shiftId];
        if (!s) continue;
        const day = dayDate(r.weekStart, s.day);
        if (day < from || day > to || new Date(`${day}T${s.start}:00`).getTime() + s.span * 60_000 > nowMs) continue;
        worked.set(a.employeeId, (worked.get(a.employeeId) ?? 0) + s.minutes);
      }
    }
  }
  const rows = staff
    .map((e) => {
      let holidayDays = 0;
      for (let w = mondayOf(parseDate(from)); w <= to; w = addDays(w, 7)) {
        for (const day of holidayDatesInWeek(holidays.filter((h) => h.paid), e.id, w)) if (day >= from && day <= to) holidayDays++;
      }
      const holidayHours = Math.round(holidayDays * dailyHours(e) * 100) / 100;
      const sickDays = new Set(absences.filter((a) => a.employeeId === e.id && a.reason === "sick" && a.date >= from && a.date <= to).map((a) => a.date)).size;
      const hrs = Math.round(((worked.get(e.id) ?? 0) / 60) * 100) / 100;
      const rate = withPay ? rateFor(e, roles) : null;
      return { e, hours: hrs, holidayHours, sickDays, rate, gross: rate != null ? Math.round((hrs + holidayHours) * rate * 100) / 100 : null };
    })
    .filter((r) => r.hours || r.holidayHours || r.sickDays);
  return { rows, source: useClock ? "approved shift log" : "published shifts" };
}

const csvCell = (v: string | number | null) => {
  const s = v == null ? "" : String(v);
  // Quote, and neutralise spreadsheet formulas.
  const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/**
 * The column layouts follow each product's documented hours-import style, but every payroll
 * setup maps codes differently: check one export against your payroll before relying on it.
 */
export function payrollCsv(format: PayrollFormat, data: Awaited<ReturnType<typeof payrollRows>>, from: string, to: string, withPay: boolean) {
  const lines: (string | number | null)[][] = [];
  const split = (name: string) => {
    const parts = name.trim().split(/\s+/);
    return { first: parts.slice(0, -1).join(" ") || parts[0], last: parts.length > 1 ? parts[parts.length - 1] : "" };
  };
  if (format === "sage") {
    lines.push(["Reference", "Surname", "Forename", "Payment", "Hours", ...(withPay ? ["Rate"] : [])]);
    for (const r of data.rows) {
      const n = split(r.e.name);
      if (r.hours) lines.push([r.e.payrollId ?? r.e.id.slice(0, 8), n.last, n.first, "Basic Hours", r.hours, ...(withPay ? [r.rate] : [])]);
      if (r.holidayHours) lines.push([r.e.payrollId ?? r.e.id.slice(0, 8), n.last, n.first, "Holiday Hours", r.holidayHours, ...(withPay ? [r.rate] : [])]);
    }
  } else if (format === "xero") {
    lines.push(["Employee", "Earnings Rate", "Period Start", "Period End", "Hours"]);
    for (const r of data.rows) {
      if (r.hours) lines.push([r.e.name, "Ordinary Hours", from, to, r.hours]);
      if (r.holidayHours) lines.push([r.e.name, "Holiday", from, to, r.holidayHours]);
    }
  } else if (format === "brightpay") {
    lines.push(["Employee ID", "Employee Name", "Hours Worked", "Holiday Hours", "Sick Days", ...(withPay ? ["Hourly Rate"] : [])]);
    for (const r of data.rows) lines.push([r.e.payrollId ?? r.e.id.slice(0, 8), r.e.name, r.hours, r.holidayHours, r.sickDays, ...(withPay ? [r.rate] : [])]);
  } else {
    lines.push(["Employee ID", "Name", "From", "To", "Hours worked", "Paid holiday hours", "Sick days", ...(withPay ? ["Hourly rate", "Gross (before deductions)"] : []), "Source"]);
    for (const r of data.rows) lines.push([r.e.payrollId ?? r.e.id, r.e.name, from, to, r.hours, r.holidayHours, r.sickDays, ...(withPay ? [r.rate, r.gross] : []), data.source]);
  }
  return lines.map((l) => l.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Shifts that started over 15 minutes ago with nobody clocked in (for late/no-show alerts). */
export async function noShows(store: Store) {
  if (!hasFeature(store.features, "clockIn")) return [];
  const wall = wallNow(store.timezone);
  const date = wall.slice(0, 10);
  const week = mondayOf(parseDate(date));
  const d = await db();
  const rota = (await d.list("rotas", { storeId: store.id, weekStart: week }))[0];
  const live = rota ? liveAssignments(rota) : null;
  if (!live) return [];
  const entries = (await d.list("time_entries", { storeId: store.id, weekStart: week })).filter((t) => t.clockIn.startsWith(date));
  const alerted = new Set((await d.list("audit_log", { storeId: store.id })).filter((l) => l.action === "clock.no_show_alert" && String(l.at).startsWith(new Date().toISOString().slice(0, 10))).map((l) => `${(l.details as { employeeId?: string }).employeeId}|${(l.details as { shiftId?: string }).shiftId}`));
  const out: { employeeId: string; shift: ShiftInstance }[] = [];
  for (const s of shiftsForStore(store).filter((x) => dayDate(week, x.day) === date)) {
    const late = minutesBetween(`${date}T${s.start}:00`, wall);
    if (late < 15 || late > 180) continue;
    for (const a of live.filter((x) => x.shiftId === s.id)) {
      if (entries.some((t) => t.employeeId === a.employeeId) || alerted.has(`${a.employeeId}|${s.id}`)) continue;
      out.push({ employeeId: a.employeeId, shift: s });
    }
  }
  return out;
}

export async function alertNoShows(store: Store) {
  const list = await noShows(store);
  if (!list.length) return 0;
  const d = await db();
  for (const n of list) {
    const e = await d.get("employees", n.employeeId);
    await notifyManagers(store.id, `Not clocked in: ${e?.name ?? "someone"} (${n.shift.name} ${n.shift.start})`, `${e?.name ?? "Someone"} was due at ${n.shift.start} for ${n.shift.name} and hasn't clocked in.`);
    await audit(store.id, "system", "clock.no_show_alert", { employeeId: n.employeeId, shiftId: n.shift.id });
  }
  return list.length;
}
