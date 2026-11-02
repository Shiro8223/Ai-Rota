import "server-only";
import { audit } from "./audit";
import { db, newId, now } from "./db";
import { liveAssignments } from "./live";
import { notify, notifyManagers } from "./notify";
import { loadStore } from "./org";
import { hasFeature } from "./roles";
import { availabilityFor, checkRota } from "./solver";
import { shiftLabel } from "./swaps";
import { storeRoles } from "./team";
import { coversShift, dayDate, isoDate, shiftsForStore, toMin } from "./time";
import type { Assignment, Employee, OpenShift, Rota, ShiftInstance, Store } from "./types";

/** Write a new published version of a rota (staff see `published`). */
async function publishChange(store: Store, rota: Rota, after: Assignment[], actor: string, reason: string, exceptions = rota.exceptions ?? []) {
  const d = await db();
  const updated = await d.update("rotas", rota.id, { assignments: after, published: after, exceptions, version: rota.version + 1, updatedAt: now() });
  await d.insert("rota_history", { id: newId(), storeId: store.id, rotaId: rota.id, version: updated.version, status: "approved", assignments: after, by: actor, reason, at: now() });
  return updated;
}

/** Only problems a change introduces block it (same idea as swaps). */
async function introducedProblems(store: Store, rota: Rota, after: Assignment[]) {
  const [base, next] = await Promise.all([checkRota(store, rota.weekStart, rota.assignments, rota.exceptions ?? []), checkRota(store, rota.weekStart, after, rota.exceptions ?? [])]);
  const known = new Set(base.issues.map((i) => i.message));
  return next.issues.filter((i) => !known.has(i.message) && i.severity === "error");
}

async function jobNames(e: Pick<Employee, "storeId" | "roleIds">) {
  return (await storeRoles(e.storeId)).filter((r) => r.category === "job" && e.roleIds.includes(r.id)).map((r) => r.name);
}

/**
 * A manager marks someone off sick (staff can't give shifts away themselves): they come off
 * the published rota, the absence is recorded, and the shift is offered to colleagues who
 * can cover it.
 */
export async function markSick(site: Store, actor: string, employee: Employee, rotaId: string, shiftId: string, note: string) {
  const d = await db();
  const rota = await d.get("rotas", rotaId);
  if (!rota || rota.storeId !== site.id) return { ok: false, error: "Shift not found." };
  const live = liveAssignments(rota);
  const shift = shiftsForStore(site).find((s) => s.id === shiftId);
  if (!live || !shift || !live.some((a) => a.shiftId === shiftId && a.employeeId === employee.id)) return { ok: false, error: `${employee.name} isn't on that shift.` };
  const date = dayDate(rota.weekStart, shift.day);
  if (date < isoDate(new Date())) return { ok: false, error: "That shift has already happened." };
  const after = live.filter((a) => !(a.shiftId === shiftId && a.employeeId === employee.id));
  await publishChange(site, rota, after, actor, `Off sick: ${employee.name} (${shiftId})`, (rota.exceptions ?? []).filter((x) => !(x.shiftId === shiftId && x.employeeId === employee.id)));
  await d.insert("absences", { id: newId(), storeId: site.id, employeeId: employee.id, date, rotaId, shiftId, reason: "sick", note: note.trim().slice(0, 200), createdAt: now() });
  // Anything they had on the swap board for that shift is moot now.
  for (const s of await d.list("swap_requests", { rotaId, shiftId, fromEmployeeId: employee.id })) if (s.status === "open" || s.status === "pending_approval") await d.update("swap_requests", s.id, { status: "cancelled", decidedBy: "sickness", decidedAt: now() });
  let offered = false;
  if (hasFeature(site.features, "openShifts")) {
    const [job] = await jobNames(employee);
    const open: OpenShift = { id: newId(), storeId: site.id, rotaId, weekStart: rota.weekStart, shiftId, reason: "sick", fromEmployeeId: employee.id, roleName: job ?? null, note: "", status: "open", claimedBy: null, createdBy: actor, createdAt: now(), decidedBy: null };
    await d.insert("open_shifts", open);
    offered = true;
  }
  await audit(site.id, actor, "absence.sick", { employeeId: employee.id, rotaId, shiftId, date, offered });
  await notify(site.id, employee, `Marked off sick: ${shiftLabel(site, rota, shiftId)}`, `You've been taken off ${shiftLabel(site, rota, shiftId)}. Get well soon.`);
  return { ok: true, offered };
}

/** Manager posts an unfilled or extra shift for anyone eligible to claim. */
export async function postOpenShift(store: Store, actor: string, rota: Rota, shiftId: string, roleName: string | null, note: string) {
  const d = await db();
  const open: OpenShift = { id: newId(), storeId: store.id, rotaId: rota.id, weekStart: rota.weekStart, shiftId, reason: "unfilled", fromEmployeeId: null, roleName, note: note.trim().slice(0, 200), status: "open", claimedBy: null, createdBy: actor, createdAt: now(), decidedBy: null };
  await d.insert("open_shifts", open);
  await audit(store.id, actor, "open_shift.posted", { id: open.id, shiftId, weekStart: rota.weekStart });
  return open;
}

/**
 * Open shifts this person could take: right job, inside availability, under-18 safe,
 * not already working that day, not already on it.
 */
export async function openShiftsFor(employee: Employee, store: Store) {
  const d = await db();
  const sites = [store, ...(await Promise.all((employee.allowedStoreIds ?? []).map((id) => loadStore(id)))).filter((x): x is Store => !!x)].filter((s) => hasFeature(s.features, "openShifts"));
  const mine = new Set((await jobNames(employee)).map((n) => n.toLowerCase()));
  const avail = await d.list("availability", { storeId: employee.storeId, employeeId: employee.id });
  const busy = new Set<string>();
  const rotasBySite = new Map<string, Rota[]>();
  for (const s of sites) {
    const sh = Object.fromEntries(shiftsForStore(s).map((x) => [x.id, x]));
    const rotas = await d.list("rotas", { storeId: s.id });
    rotasBySite.set(s.id, rotas);
    for (const r of rotas) for (const a of liveAssignments(r) ?? []) if (a.employeeId === employee.id && sh[a.shiftId]) busy.add(dayDate(r.weekStart, sh[a.shiftId].day));
  }
  const out: { open: OpenShift; site: Store; rota: Rota; shift: ShiftInstance }[] = [];
  const today = isoDate(new Date());
  for (const site of sites) {
    for (const open of await d.list("open_shifts", { storeId: site.id })) {
      if (open.status !== "open" && !(open.status === "claimed" && open.claimedBy === employee.id)) continue;
      if (open.fromEmployeeId === employee.id) continue;
      const rota = rotasBySite.get(site.id)?.find((r) => r.id === open.rotaId);
      const shift = shiftsForStore(site).find((s) => s.id === open.shiftId);
      if (!rota || !shift) continue;
      const date = dayDate(rota.weekStart, shift.day);
      if (date < today) continue;
      if (open.status === "open") {
        if (open.roleName && hasFeature(site.features, "roleSwaps") && !mine.has(open.roleName.toLowerCase())) continue;
        if (!coversShift(availabilityFor(avail, rota.weekStart)[employee.id]?.[shift.day], shift.start, shift.end)) continue;
        if (employee.isUnder18 && (shift.minutes > 480 || toMin(shift.start) < 360 || toMin(shift.start) + shift.minutes > 1320)) continue;
        if (busy.has(date)) continue;
      }
      out.push({ open, site, rota, shift });
    }
  }
  return out.sort((a, b) => (dayDate(a.rota.weekStart, a.shift.day) + a.shift.start).localeCompare(dayDate(b.rota.weekStart, b.shift.day) + b.shift.start));
}

/** Staff claims an open shift. It's rule-checked now and again when the manager approves. */
export async function claimOpenShift(employee: Employee, store: Store, id: string) {
  const d = await db();
  const match = (await openShiftsFor(employee, store)).find((x) => x.open.id === id && x.open.status === "open");
  if (!match) return { ok: false, error: "That shift has gone, or you can't take it (role, availability, or you're already working that day)." };
  const live = liveAssignments(match.rota) ?? match.rota.assignments;
  const problems = await introducedProblems(match.site, { ...match.rota, assignments: live }, [...live, { shiftId: match.open.shiftId, employeeId: employee.id }]);
  if (problems.length) return { ok: false, error: "Taking this shift would break a rule:", reasons: problems.map((p) => p.message) };
  await d.update("open_shifts", id, { status: "claimed", claimedBy: employee.id });
  await audit(match.site.id, employee.name, "open_shift.claimed", { id });
  await notifyManagers(match.site.id, `Open shift claimed: ${shiftLabel(match.site, match.rota, match.open.shiftId)}`, `${employee.name} wants to take ${shiftLabel(match.site, match.rota, match.open.shiftId)}. It passes every rule. Approve it under Approvals → Open shifts.`);
  return { ok: true };
}

export async function unclaimOpenShift(employee: Employee, id: string) {
  const d = await db();
  const open = await d.get("open_shifts", id);
  if (!open || open.claimedBy !== employee.id || open.status !== "claimed") return;
  await d.update("open_shifts", id, { status: "open", claimedBy: null });
  await audit(open.storeId, employee.name, "open_shift.unclaimed", { id });
}

/** Manager approves (adds them to the published rota) or declines (back on the board). */
export async function decideOpenShift(store: Store, actor: string, id: string, approve: boolean) {
  const d = await db();
  const open = await d.get("open_shifts", id);
  if (!open || open.storeId !== store.id || open.status !== "claimed" || !open.claimedBy) return { ok: false, error: "That claim isn't waiting for approval." };
  const [rota, who] = await Promise.all([d.get("rotas", open.rotaId), d.get("employees", open.claimedBy)]);
  if (!rota || !who) return { ok: false, error: "The rota or person no longer exists." };
  const label = shiftLabel(store, rota, open.shiftId);
  if (!approve) {
    await d.update("open_shifts", id, { status: "open", claimedBy: null });
    await audit(store.id, actor, "open_shift.declined", { id, employeeId: who.id });
    await notify(store.id, who, `Not this time: ${label}`, `Your manager gave ${label} to someone else or doesn't need it covered.`);
    return { ok: true };
  }
  const live = liveAssignments(rota) ?? rota.assignments;
  if (live.some((a) => a.shiftId === open.shiftId && a.employeeId === who.id)) return { ok: false, error: `${who.name} is already on that shift.` };
  const after = [...live, { shiftId: open.shiftId, employeeId: who.id }];
  const problems = await introducedProblems(store, { ...rota, assignments: live }, after);
  if (problems.length) return { ok: false, error: "It no longer passes the rules.", issues: problems };
  const updated = await publishChange(store, rota, after, actor, `Open shift filled by ${who.name} (${open.shiftId})`);
  await d.update("open_shifts", id, { status: "filled", decidedBy: actor });
  await audit(store.id, actor, "open_shift.filled", { id, employeeId: who.id, rotaVersion: updated.version });
  await notify(store.id, who, `You're on: ${label}`, `Your manager approved it. You're now working ${label}. Thanks!`);
  return { ok: true };
}

export async function cancelOpenShift(store: Store, actor: string, id: string) {
  const d = await db();
  const open = await d.get("open_shifts", id);
  if (!open || open.storeId !== store.id || !["open", "claimed"].includes(open.status)) return;
  await d.update("open_shifts", id, { status: "cancelled", decidedBy: actor });
  await audit(store.id, actor, "open_shift.cancelled", { id });
}
