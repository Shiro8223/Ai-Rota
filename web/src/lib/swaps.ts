import "server-only";
import { audit } from "./audit";
import { hasFeature } from "./roles";
import { loadStore } from "./org";
import { storeRoles } from "./team";
import { db, newId, now } from "./db";
import { sendEmail } from "./email";
import { availabilityFor, checkRota } from "./solver";
import { coversShift, dayDate, isoDate, prettyDate, shiftsForStore, toMin } from "./time";
import { DAY_NAME, type Assignment, type Employee, type Role, type Issue, type Rota, type ShiftInstance, type Store, type SwapRequest } from "./types";

export function shiftLabel(store: Store, rota: Pick<Rota, "weekStart">, shiftId: string) {
  const s = shiftsForStore(store).find((x) => x.id === shiftId);
  if (!s) return shiftId;
  return `${s.name} on ${DAY_NAME[s.day]} ${prettyDate(dayDate(rota.weekStart, s.day))} (${s.start}–${s.end})`;
}

const applySwap = (a: Assignment[], shiftId: string, from: string, to: string) => a.map((x) => (x.shiftId === shiftId && x.employeeId === from ? { shiftId, employeeId: to } : x));

/**
 * Run check_rota on the rota with the swap applied. Only problems the swap *introduces*
 * block it, so an already-overridden problem elsewhere in the week doesn't block every swap.
 */
export async function swapCheck(store: Store, rota: Rota, shiftId: string, from: string, to: string) {
  const after = applySwap(rota.assignments, shiftId, from, to);
  // The person giving the shift away no longer needs to agree to it; the taker is inside their availability.
  const exceptions = (rota.exceptions ?? []).filter((x) => !(x.shiftId === shiftId && x.employeeId === from));
  const [base, next] = await Promise.all([checkRota(store, rota.weekStart, rota.assignments, rota.exceptions ?? []), checkRota(store, rota.weekStart, after, exceptions)]);
  const known = new Set(base.issues.map((i) => i.message));
  const fresh = next.issues.filter((i) => !known.has(i.message) && i.severity !== "info");
  const blocking = fresh.filter((i) => i.severity === "error");
  return { ok: blocking.length === 0, issues: fresh, blocking, after, exceptions };
}

async function managers(storeId: string) {
  return (await db()).list("store_members", { storeId });
}

function isFuture(rota: Rota, shift: ShiftInstance | undefined) {
  return !!shift && dayDate(rota.weekStart, shift.day) >= isoDate(new Date());
}

export async function postSwap(employee: Employee, store: Store, rotaId: string, shiftId: string, note: string) {
  if (!hasFeature(store.features, "swaps")) return { ok: false, error: "Shift swaps are switched off at this store." };
  const d = await db();
  const rota = await d.get("rotas", rotaId);
  if (!rota || ![store.id, ...(employee.allowedStoreIds ?? [])].includes(rota.storeId) || rota.status !== "approved") return { ok: false, error: "That rota isn't approved." };
  const site = rota.storeId === store.id ? store : ((await loadStore(rota.storeId)) ?? store);
  if (!rota.assignments.some((a) => a.shiftId === shiftId && a.employeeId === employee.id)) return { ok: false, error: "That isn't your shift." };
  if (!isFuture(rota, shiftsForStore(site).find((s) => s.id === shiftId))) return { ok: false, error: "That shift has already happened." };
  const existing = (await d.list("swap_requests", { rotaId, shiftId, fromEmployeeId: employee.id })).filter((s) => s.status === "open" || s.status === "pending_approval");
  if (existing.length) return { ok: false, error: "That shift is already on the swap board." };
  const swap: SwapRequest = {
    id: newId(), storeId: site.id, rotaId, weekStart: rota.weekStart, shiftId, fromEmployeeId: employee.id, toEmployeeId: null, ruleCheck: null,
    status: "open", note: note.trim().slice(0, 200), createdAt: now(), decidedBy: null, decidedAt: null,
  };
  await d.insert("swap_requests", swap);
  await audit(store.id, employee.name, "swap.posted", { swapId: swap.id, shiftId, weekStart: rota.weekStart });
  return { ok: true };
}

/**
 * Can `to` cover `from`'s shift? With "swap only within the same job" on, they must share a
 * job role (a Back of House shift only goes to Back of House). Someone with no job role can
 * be covered by anyone; the rule check still has the final say.
 */
export function canCover(from: Pick<Employee, "roleIds">, to: Pick<Employee, "roleIds">, roles: Role[], store: Pick<Store, "features">) {
  if (!hasFeature(store.features, "roleSwaps")) return true;
  // Compared by name, so it also works between sister sites (each has its own role records).
  const jobs = (e: Pick<Employee, "roleIds">) => roles.filter((r) => r.category === "job" && e.roleIds.includes(r.id)).map((r) => r.name.toLowerCase());
  const want = new Set(jobs(from));
  return want.size === 0 || jobs(to).some((n) => want.has(n));
}

/** Roles of every site these people belong to. */
async function rolesFor(...storeIds: string[]) {
  return (await Promise.all([...new Set(storeIds)].map((id) => storeRoles(id)))).flat();
}

/**
 * Open swaps this person could take: same role as the person giving it up (a cook's shift
 * only goes to cooks), inside their availability, under-18 safe, and not already working that day.
 */
export async function swapsFor(employee: Employee, store: Store) {
  if (!hasFeature(store.features, "swaps")) return [];
  const d = await db();
  // Home site plus sister sites this person also works at.
  const sites = [store, ...(await Promise.all((employee.allowedStoreIds ?? []).map((id) => loadStore(id)))).filter((x): x is Store => !!x)];
  const open = (await Promise.all(sites.map((s) => d.list("swap_requests", { storeId: s.id, status: "open" })))).flat().filter((s) => s.fromEmployeeId !== employee.id);
  const avail = await d.list("availability", { storeId: store.id, employeeId: employee.id });
  // Everything this person already works, at any site, to skip days they're busy.
  const busy = new Set<string>();
  for (const s of sites) {
    const sh = Object.fromEntries(shiftsForStore(s).map((x) => [x.id, x]));
    for (const r of await d.list("rotas", { storeId: s.id })) for (const a of r.assignments) if (a.employeeId === employee.id && sh[a.shiftId]) busy.add(dayDate(r.weekStart, sh[a.shiftId].day));
  }
  const out: { swap: SwapRequest; rota: Rota; shift: ShiftInstance; from: Employee | null }[] = [];
  for (const swap of open) {
    const rota = await d.get("rotas", swap.rotaId);
    const site = sites.find((s) => s.id === swap.storeId);
    const shift = site && shiftsForStore(site).find((s) => s.id === swap.shiftId);
    if (!rota || rota.status !== "approved" || !site || !shift || !isFuture(rota, shift)) continue;
    const windows = availabilityFor(avail, rota.weekStart)[employee.id]?.[shift.day];
    if (!coversShift(windows, shift.start, shift.end)) continue;
    if (employee.isUnder18 && (shift.minutes > 480 || toMin(shift.start) < 360 || toMin(shift.start) + shift.minutes > 1320)) continue;
    if (busy.has(dayDate(rota.weekStart, shift.day))) continue;
    const from = await d.get("employees", swap.fromEmployeeId);
    if (!from || !canCover(from, employee, await rolesFor(from.storeId, employee.storeId), site)) continue;
    out.push({ swap, rota, shift, from });
  }
  return out;
}

export async function offerSwap(employee: Employee, store: Store, swapId: string) {
  const d = await db();
  const swap = await d.get("swap_requests", swapId);
  if (!swap || swap.storeId !== store.id || swap.status !== "open") return { ok: false, error: "That swap is no longer open." };
  if (!(await swapsFor(employee, store)).some((x) => x.swap.id === swapId)) return { ok: false, error: "You can't take that shift (availability or you're already working that day)." };
  const rota = (await d.get("rotas", swap.rotaId))!;
  const site = swap.storeId === store.id ? store : ((await loadStore(swap.storeId)) ?? store);
  const check = await swapCheck(site, rota, swap.shiftId, swap.fromEmployeeId, employee.id);
  if (!check.ok) {
    await audit(store.id, employee.name, "swap.offer_blocked", { swapId, reasons: check.blocking.map((i) => i.message) });
    return { ok: false, error: "This swap would break a rule:", reasons: check.blocking.map((i) => i.message) };
  }
  await d.update("swap_requests", swapId, { toEmployeeId: employee.id, status: "pending_approval", ruleCheck: { ok: true, issues: check.issues } });
  await audit(store.id, employee.name, "swap.offered", { swapId });
  const from = await d.get("employees", swap.fromEmployeeId);
  for (const m of await managers(site.id)) {
    await sendEmail(site.id, m.email, `Swap to approve: ${shiftLabel(site, rota, swap.shiftId)}`, `${employee.name} has offered to take ${from?.name ?? "a colleague"}'s ${shiftLabel(store, rota, swap.shiftId)}.\nIt passes every rule. Approve or decline it in Rota Agent → Swaps.`);
  }
  return { ok: true };
}

export async function cancelSwap(employee: Employee, swapId: string) {
  const d = await db();
  const swap = await d.get("swap_requests", swapId);
  if (!swap || swap.fromEmployeeId !== employee.id || !["open", "pending_approval"].includes(swap.status)) return;
  await d.update("swap_requests", swapId, { status: "cancelled", decidedBy: employee.name, decidedAt: now() });
  await audit(swap.storeId, employee.name, "swap.cancelled", { swapId });
}

export async function decideSwap(store: Store, actor: string, swapId: string, approve: boolean): Promise<{ ok: boolean; error?: string; issues?: Issue[] }> {
  const d = await db();
  const swap = await d.get("swap_requests", swapId);
  if (!swap || swap.storeId !== store.id || swap.status !== "pending_approval" || !swap.toEmployeeId) return { ok: false, error: "That swap isn't waiting for approval." };
  const rota = await d.get("rotas", swap.rotaId);
  const [from, to] = await Promise.all([d.get("employees", swap.fromEmployeeId), d.get("employees", swap.toEmployeeId)]);
  if (!rota || rota.status !== "approved") return { ok: false, error: "The rota has changed since this swap was offered." };
  const label = shiftLabel(store, rota, swap.shiftId);

  if (!approve) {
    await d.update("swap_requests", swapId, { status: "declined", decidedBy: actor, decidedAt: now() });
    await audit(store.id, actor, "swap.declined", { swapId });
    await sendEmail(store.id, from?.email ?? null, `Swap declined: ${label}`, `Your manager declined the swap for ${label}. You're still working it.`);
    await sendEmail(store.id, to?.email ?? null, `Swap declined: ${label}`, `Your manager declined your offer to take ${label}.`);
    return { ok: true };
  }

  // Re-check against the rota as it is now: things may have changed since the offer.
  const check = await swapCheck(store, rota, swap.shiftId, swap.fromEmployeeId, swap.toEmployeeId);
  if (!check.ok) return { ok: false, error: "The swap no longer passes the rules.", issues: check.blocking };
  if (!from || !to || !canCover(from, to, await rolesFor(from.storeId, to.storeId), store)) return { ok: false, error: "Swaps are only between people with the same job role." };
  const updated = await d.update("rotas", rota.id, { assignments: check.after, published: check.after, exceptions: check.exceptions, version: rota.version + 1, updatedAt: now() });
  await d.insert("rota_history", { id: newId(), storeId: store.id, rotaId: rota.id, version: updated.version, status: "approved", assignments: check.after, by: actor, reason: `Swap: ${from?.name} → ${to?.name} (${swap.shiftId})`, at: now() });
  await d.update("swap_requests", swapId, { status: "approved", decidedBy: actor, decidedAt: now(), ruleCheck: { ok: true, issues: check.issues } });
  await audit(store.id, actor, "swap.approved", { swapId, rotaVersion: updated.version });
  await sendEmail(store.id, from?.email ?? null, `Swap approved: ${label}`, `${to?.name} is now working ${label}. You're off that shift.`);
  await sendEmail(store.id, to?.email ?? null, `Swap approved: ${label}`, `You're now working ${label}. Thanks for covering!`);
  return { ok: true };
}
