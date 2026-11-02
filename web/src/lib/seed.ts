import "server-only";
import { seedOps } from "./seed-ops";
import fixture from "@fixtures/test-wings-leeds.json";
import { describeConstraint, validateConstraint, type RuleContext } from "./constraints";
import { pinHash } from "./crypto";
import { addDays, anyWeek, emptyWeek, isoDate, mondayOf } from "./time";
import type { Tables } from "./db/index";
import { amountFor, DEFAULT_POLICY } from "./holidays";
import { seedGroup } from "./seed-york";
import { DEFAULT_FEATURES, derivedFields, ROLE_PRESETS } from "./roles";
import { DAYS, type Day, type Employee, type Role, type Rota, type Rule, type Store, type SwapRequest, type WeekWindows } from "./types";

export const DEMO_STORE_ID = "demo-store";
export { DEMO_ORG_ID } from "./seed-york";
export const DEMO_MANAGER = { id: "demo-manager", email: "manager@testwings.example" };
/** Demo staff PINs: 1001, 1002, ... in fixture order. */
export const demoPin = (index: number) => String(1001 + index);

type Fx = typeof fixture;
type FxAvailability = Fx["employees"][number]["availability"];

function windows(av: FxAvailability): WeekWindows {
  if (av === "any") return anyWeek();
  const out = emptyWeek();
  for (const d of DAYS) {
    const spec = (av as Record<string, unknown>)[d];
    if (spec === "any") out[d] = [{ from: "00:00", to: "24:00" }];
    else if (Array.isArray(spec)) out[d] = (spec as [string, string][]).map(([from, to]) => ({ from, to }));
  }
  return out;
}

type Data = { [N in keyof Tables]: Tables[N][] };

export function seedDemo(data: Data) {
  const ts = new Date().toISOString();
  const today = new Date();
  const fs = fixture.store;
  const store: Store = {
    id: DEMO_STORE_ID,
    ownerId: DEMO_MANAGER.id,
    name: fs.name,
    timezone: fs.timezone,
    openingHours: fs.openingHours as Store["openingHours"],
    shiftTemplates: fs.shiftTemplates.map(({ requirements: _r, ...t }) => ({ ...t, days: t.days as Day[], requirements: [] })),
    joinCode: fs.joinCode,
    plan: "trial",
    billingStatus: "trialing",
    trialEndsAt: addDays(isoDate(today), 30),
    cancelledAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    features: { ...DEFAULT_FEATURES },
    holidayPolicy: { ...DEFAULT_POLICY },
    createdAt: ts,
  };
  data.stores.push(store);
  data.store_members.push({ id: "demo-member", storeId: store.id, userId: DEMO_MANAGER.id, email: DEMO_MANAGER.email, role: "owner", roleIds: [] });

  // Roles from the Restaurant preset, with stable ids so the demo is predictable.
  const preset = ROLE_PRESETS.find((p) => p.key === "restaurant")!;
  const roles: Role[] = preset.roles.map((r) => ({
    id: `role-${r.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, storeId: store.id, name: r.name, category: r.category, color: r.color,
    description: r.description ?? "", permissions: [...r.permissions], system: r.system ?? null, createdAt: ts,
  }));
  // Shift leads get a bit more holiday than the general policy (role override example).
  const lead = roles.find((r) => r.name === "Shift Lead");
  if (lead) lead.holidayPolicy = { ...DEFAULT_POLICY, allowance: 30 };
  data.roles.push(...roles);
  const rid = (name: string) => roles.find((r) => r.name === name)!.id;
  // Required service roles per shift type (fixture names them; the store stores role ids).
  store.shiftTemplates.forEach((t) => {
    t.requirements = (fs.shiftTemplates.find((x) => x.id === t.id)?.requirements ?? []).map((r) => ({ roleId: rid(r.role), min: r.min }));
  });
  // Old single job titles -> roles. Shift leads also work front of house.
  const JOB: Record<string, string[]> = { "Shift Lead": ["Shift Lead", "Front of House"], Cook: ["Back of House"], Server: ["Front of House"] };

  const idOf = (key: string) => `emp-${key}`;
  fixture.employees.forEach((e, i) => {
    const start = new Date(today);
    start.setDate(start.getDate() - e.startDaysAgo);
    const roleIds = [
      ...(JOB[e.role] ?? []).map(rid),
      rid(e.contractedHours >= 35 ? "Full-time" : "Part-time"),
      ...(e.isUnder18 ? [rid("Under 18")] : []),
      ...(e.isStudent ? [rid("Student")] : []),
    ];
    const emp: Employee = {
      id: idOf(e.key),
      storeId: store.id,
      name: e.name,
      roleIds,
      ...derivedFields(roleIds, roles),
      startDate: isoDate(start),
      contractedHours: e.contractedHours,
      maxHoursPerWeek: e.maxHoursPerWeek,
      email: `${e.key}@testwings.example`,
      pinHash: pinHash(store.id, demoPin(i)),
      active: true,
      createdAt: ts,
    };
    data.employees.push(emp);
    data.availability.push({
      id: `av-${e.key}`, storeId: store.id, employeeId: emp.id, kind: "default", startWeek: null, endWeek: null, days: windows(e.availability),
      status: "approved", note: "", requestedBy: DEMO_MANAGER.email, decidedBy: DEMO_MANAGER.email, decidedAt: ts, updatedAt: ts,
    });
  });

  // Holiday: two requests waiting for approval and one already approved.
  const hol = (key: string, fromWeeks: number, startDay: number, days: number, paid: boolean, status: "pending" | "approved", note: string) => {
    const startDate = addDays(mondayOf(today), 7 * fromWeeks + startDay);
    const endDate = addDays(startDate, days - 1);
    const e = data.employees.find((x) => x.id === idOf(key))!;
    data.holidays.push({
      id: `hol-${key}`, storeId: store.id, employeeId: e.id, startDate, endDate, paid, amount: paid ? amountFor(e, "days", startDate, endDate) : 0, unit: "days", note, status,
      createdAt: ts, decidedBy: status === "approved" ? DEMO_MANAGER.email : null, decidedAt: status === "approved" ? ts : null,
    });
  };
  hol("mia", 3, 0, 3, true, "pending", "Family wedding");
  hol("tom", 2, 5, 2, false, "pending", "School trip");
  hol("ben", 5, 0, 7, true, "approved", "Summer break");

  // Students: one exam-period request waiting for approval, one approved reading week.
  fixture.temporaryAvailability.forEach((t, i) => {
    const startWeek = addDays(mondayOf(today), 7 * t.startWeeksFromNow);
    const approved = t.status === "approved";
    data.availability.push({
      id: `av-temp-${i}`, storeId: store.id, employeeId: idOf(t.employee), kind: "temporary", startWeek, endWeek: addDays(startWeek, 7 * (t.weeks - 1)),
      days: windows(t.availability as FxAvailability), status: approved ? "approved" : "pending", note: t.note,
      requestedBy: fixture.employees.find((e) => e.key === t.employee)!.name, decidedBy: approved ? DEMO_MANAGER.email : null, decidedAt: approved ? ts : null, updatedAt: ts,
    });
  });

  const ctx: RuleContext = { templates: store.shiftTemplates, employees: data.employees, roleNames: roles.map((r) => r.name) };
  const remap = (c: Record<string, unknown>) => {
    const out: Record<string, unknown> = { ...c };
    if (typeof out.employee === "string") out.employee = idOf(out.employee);
    if (Array.isArray(out.employees)) out.employees = (out.employees as string[]).map(idOf);
    return out;
  };
  fixture.rules.forEach((r, i) => {
    const v = validateConstraint(remap(r.constraint), ctx);
    if (!v.ok) throw new Error(`fixture rule ${i} invalid: ${v.error}`);
    const rule: Rule = {
      id: `rule-${i + 1}`,
      storeId: store.id,
      originalText: r.originalText,
      constraint: v.constraint,
      summary: describeConstraint(v.constraint, ctx),
      status: r.status as Rule["status"],
      createdBy: DEMO_MANAGER.email,
      createdAt: ts,
      confirmedBy: r.status === "confirmed" ? DEMO_MANAGER.email : null,
      confirmedAt: r.status === "confirmed" ? ts : null,
    };
    data.rules.push(rule);
  });

  // A ready-made approved rota for this week (built by the solver from this fixture),
  // and one open swap, so staff screens have something to show straight away.
  const week = mondayOf(today);
  const demoRota = (fixture as unknown as { demoRota?: { shiftId: string; employee: string }[] }).demoRota;
  if (demoRota) {
    const rota: Rota = {
      id: "demo-rota",
      storeId: store.id,
      weekStart: week,
      assignments: demoRota.map((a) => ({ shiftId: a.shiftId, employeeId: idOf(a.employee) })),
      exceptions: [],
      status: "approved",
      version: 1,
      approvedBy: DEMO_MANAGER.email,
      approvedAt: ts,
      generatedAt: ts,
      updatedAt: ts,
    };
    data.rotas.push(rota);
    data.rota_history.push({ id: "demo-rota-v1", storeId: store.id, rotaId: rota.id, version: 1, status: "approved", assignments: rota.assignments, by: DEMO_MANAGER.email, reason: "Approved", at: ts });
    // Four past weeks of published rotas (the same valid pattern) so staff see hours worked so far.
    // The pattern ends Sunday no later than 23:00 and starts Monday no earlier than 10:00, so the
    // 11h rest holds across every week boundary.
    for (let w = 1; w <= 4; w++) {
      data.rotas.push({ ...rota, id: `demo-rota-past-${w}`, weekStart: addDays(week, -7 * w), assignments: rota.assignments.map((a) => ({ ...a })) });
    }
    // Pick a shift of Mia's (a server) on a day Casey (also a server, available any time) is free,
    // as late in the week as possible so it's still in the future.
    const caseyDays = new Set(rota.assignments.filter((a) => a.employeeId === idOf("casey")).map((a) => a.shiftId.split(":")[1]));
    const miaShift = [...rota.assignments]
      .filter((a) => a.employeeId === idOf("mia") && !caseyDays.has(a.shiftId.split(":")[1]))
      .sort((a, b) => DAYS.indexOf(b.shiftId.split(":")[1] as Day) - DAYS.indexOf(a.shiftId.split(":")[1] as Day))[0];
    if (miaShift) {
      const swap: SwapRequest = {
        id: "demo-swap",
        storeId: store.id,
        rotaId: rota.id,
        weekStart: week,
        shiftId: miaShift.shiftId,
        fromEmployeeId: idOf("mia"),
        toEmployeeId: null,
        ruleCheck: null,
        status: "open",
        note: "Family birthday - can anyone take this?",
        createdAt: ts,
        decidedBy: null,
        decidedAt: null,
      };
      data.swap_requests.push(swap);
    }
  }
  // Pay, compliance records and timesheets.
  seedOps(data, store, DEMO_MANAGER.email);
  // Franchise group: Leeds + York, with shared staff.
  seedGroup(data, store, DEMO_MANAGER.id, DEMO_MANAGER.email);
  data.audit_log.push({ id: "demo-audit-1", storeId: store.id, actor: "system", action: "demo.seeded", details: { employees: data.employees.length, rules: data.rules.length }, at: ts });
}
