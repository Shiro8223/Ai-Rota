import "server-only";
import { db } from "./db";
import { availabilityFor } from "./availability";
import { liveAssignments } from "./live";
import { orgStores, storeStaff } from "./org";
import { DAYS_PER_WEEK, dailyHours, holidayDatesInWeek } from "./holidays";
import { addDays, parseDate, shiftsForStore, toMin } from "./time";
import { DAY_LABEL, DAYS } from "./types";
import type { Assignment, Availability, Employee, Issue, Rule, RotaException, Store } from "./types";

const SOLVER_URL = process.env.SOLVER_URL ?? "http://127.0.0.1:8000";

export class SolverDown extends Error {
  constructor() {
    super("The rota solver isn't running. Start it with `npm run demo` from the project root (or check SOLVER_URL).");
  }
}

export { availabilityFor } from "./availability";

export async function loadProblem(store: Store, weekStart: string) {
  const d = await db();
  // Everyone who can work here: own staff plus visitors from sister sites.
  const staff = await storeStaff(store);
  const homeIds = [...new Set(staff.map((e) => e.storeId))];
  const perHome = await Promise.all(
    homeIds.map(async (id) => ({
      avail: await d.list("availability", { storeId: id }),
      holidays: await d.list("holidays", { storeId: id, status: "approved" }),
      roles: await d.list("roles", { storeId: id }),
    })),
  );
  const avail = perHome.flatMap((h) => h.avail);
  const holidays = perHome.flatMap((h) => h.holidays);
  // Role names from each person's home site (brand roles share names across sites).
  const allRoles = perHome.flatMap((h) => h.roles);
  const names = Object.fromEntries(allRoles.map((r) => [r.id, r.name]));
  const weekEnd = addDays(weekStart, 6);
  // A qualification only counts if it's valid for the whole week.
  const valid = (e: { qualificationExpiry?: Record<string, string> }, roleId: string) => {
    const r = allRoles.find((x) => x.id === roleId);
    if (!r || r.category !== "qualification") return true;
    const exp = e.qualificationExpiry?.[roleId];
    return !exp || exp >= weekEnd;
  };
  const rules = await d.list("rules", { storeId: store.id, status: "confirmed" });
  const availability = availabilityFor(avail, weekStart);
  const withRoles = staff.map((e) => {
    // Approved holiday: unavailable on those days, and the week's mandatory contract hours
    // drop by a day's worth for each holiday day (paid or unpaid).
    const off = holidayDatesInWeek(holidays, e.id, weekStart);
    if (off.size && availability[e.id]) {
      availability[e.id] = { ...availability[e.id] };
      for (const date of off) availability[e.id][DAYS[(parseDate(date).getDay() + 6) % 7]] = [];
    }
    // A contract is met at the person's home site (counting hours they work elsewhere);
    // a visiting site never has to make up someone else's contract.
    const contractedHours = e.visiting ? 0 : Math.max(0, Math.round((e.contractedHours - dailyHours(e) * Math.min(DAYS_PER_WEEK, off.size)) * 10) / 10);
    return { ...e, contractedHours, roleNames: (e.roleIds ?? []).filter((id) => valid(e, id)).map((id) => names[id]).filter(Boolean) };
  });
  // Permanent rules, plus rules set for this week only.
  const weekRules = rules.filter((r) => !r.weekStart || r.weekStart === weekStart);
  // Role names this site's requirements refer to.
  const siteRoleNames = Object.fromEntries((await d.list("roles", { storeId: store.id })).map((r) => [r.id, r.name]));
  return { employees: withRoles, availability, rules: weekRules, roleNames: siteRoleNames, edgeShifts: await edgeShifts(store, weekStart, new Set(staff.map((e) => e.id))) };
}

/**
 * Shifts these people work outside this week's rota here: the neighbouring weeks at this
 * site, and last/this/next week at sister sites. As minutes from this week's Monday, so the
 * solver keeps rest, weekly rest, hours and contracts legal across weeks and across sites.
 */
async function edgeShifts(store: Store, weekStart: string, people: Set<string>) {
  const d = await db();
  const sites = store.orgId ? await orgStores(store.orgId) : [store];
  const out: { employeeId: string; label: string; start: number; end: number; minutes: number }[] = [];
  for (const site of sites) {
    const shifts = Object.fromEntries(shiftsForStore(site).map((s) => [s.id, s]));
    for (const offset of [-7, 0, 7]) {
      if (site.id === store.id && offset === 0) continue; // that's the rota being solved
      const [rota] = await d.list("rotas", { storeId: site.id, weekStart: addDays(weekStart, offset) });
      if (!rota) continue;
      // Here: what's planned. Elsewhere: what's published, else the draft (so two drafts can't double-book).
      const list = site.id === store.id ? rota.assignments : (liveAssignments(rota) ?? rota.assignments);
      for (const a of list) {
        const s = shifts[a.shiftId];
        if (!s || !people.has(a.employeeId)) continue;
        const start = (offset / 7) * 7 * 1440 + DAYS.indexOf(s.day) * 1440 + toMin(s.start);
        const when = offset < 0 ? "last " : offset > 0 ? "next " : "";
        const where = site.id === store.id ? "" : `${site.name}: `;
        out.push({ employeeId: a.employeeId, label: `${where}${when}${DAY_LABEL[s.day]} ${s.name}`, start, end: start + s.span, minutes: s.minutes });
      }
    }
  }
  return out;
}

type Loaded = Awaited<ReturnType<typeof loadProblem>>;
function payload(store: Store, weekStart: string, p: Loaded, assignments: Assignment[] = [], exceptions: RotaException[] = []) {
  const { employees, availability, rules, roleNames, edgeShifts } = p;
  return {
    edgeShifts,
    weekStart,
    store: {
      id: store.id,
      name: store.name,
      openingHours: store.openingHours,
      shiftTemplates: store.shiftTemplates.map((t) => ({
        ...t,
        breakMinutes: t.breakMinutes ?? 0,
        requirements: (t.requirements ?? []).filter((r) => roleNames[r.roleId]).map((r) => ({ role: roleNames[r.roleId], min: r.min })),
      })),
    },
    employees: employees.map((e) => ({
      id: e.id,
      name: e.name,
      role: e.role,
      roles: e.roleNames ?? [],
      startDate: e.startDate,
      contractedHours: e.contractedHours,
      maxHoursPerWeek: e.maxHoursPerWeek,
      isUnder18: e.isUnder18,
      optedOut48: !!e.optOut48SignedAt,
    })),
    availability,
    rules: rules.map((r) => ({ id: r.id, summary: r.originalText, constraint: r.constraint })),
    // Drop assignments for people who have left, so old rotas still check cleanly.
    assignments: assignments.filter((a) => employees.some((e) => e.id === a.employeeId)),
    exceptions: exceptions
      .filter((x) => assignments.some((a) => a.shiftId === x.shiftId && a.employeeId === x.employeeId))
      .map((x) => ({ shiftId: x.shiftId, employeeId: x.employeeId, status: x.status })),
  };
}

async function call<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${SOLVER_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(process.env.SOLVER_API_KEY ? { "x-solver-key": process.env.SOLVER_API_KEY } : {}) },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new SolverDown();
  }
  if (!res.ok) throw new Error(`Solver error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

export interface SolveResult {
  status: "ok" | "infeasible" | "error";
  reasons?: string[];
  assignments: Assignment[];
  issues: Issue[];
  stats?: { seconds: number };
}

export async function solveWeek(store: Store, weekStart: string) {
  const p = await loadProblem(store, weekStart);
  const missing = p.employees.filter((e) => !p.availability[e.id]).map((e) => e.name);
  const result = await call<SolveResult>("/solve", payload(store, weekStart, p));
  return { ...result, missingAvailability: missing };
}

/** Solve a week with extra, unsaved rules (e.g. "what if John has Saturday off?"). Nothing is stored. */
export async function solveWhatIf(store: Store, weekStart: string, extra: Pick<Rule, "id" | "originalText" | "constraint">[]) {
  const p = await loadProblem(store, weekStart);
  return call<SolveResult>("/solve", payload(store, weekStart, { ...p, rules: [...p.rules, ...(extra as Rule[])] }));
}

/** The single rule checker (solver/app/check.py) - used for live warnings and swaps. */
export async function checkRota(store: Store, weekStart: string, assignments: Assignment[], exceptions: RotaException[] = []) {
  const p = await loadProblem(store, weekStart);
  return call<{ issues: Issue[]; summary: { ok: boolean; legal: number; blocking: number; errors: number; warnings: number } }>(
    "/check",
    payload(store, weekStart, p, assignments, exceptions),
  );
}

export async function solverHealthy() {
  try {
    const r = await fetch(`${SOLVER_URL}/health`, { cache: "no-store", signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}
