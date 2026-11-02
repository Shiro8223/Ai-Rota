import "server-only";
import type { Tables } from "./db/index";
import { pinHash } from "./crypto";
import { DEFAULT_POLICY } from "./holidays";
import { DEFAULT_FEATURES, derivedFields, ROLE_PRESETS } from "./roles";
import { addDays, anyWeek, isoDate } from "./time";
import type { Employee, Role, Store } from "./types";

type Data = { [N in keyof Tables]: Tables[N][] };

export const DEMO_ORG_ID = "demo-org";
export const YORK_STORE_ID = "demo-york";

/**
 * Franchise demo: "Test Wings Group" owns Leeds (the main demo site) and York. York has its
 * own team; three Leeds people can also be rostered there, so cross-site rest, hours and
 * contracts are exercised.
 */
export function seedGroup(data: Data, leeds: Store, ownerId: string, ownerEmail: string) {
  const ts = new Date().toISOString();
  data.organisations.push({
    id: DEMO_ORG_ID, name: "Test Wings Group", ownerId, features: { ...DEFAULT_FEATURES }, lockedFeatures: [],
    holidayPolicy: { ...DEFAULT_POLICY }, lockHolidayPolicy: false, createdAt: ts,
  });
  data.org_members.push({ id: "demo-org-owner", orgId: DEMO_ORG_ID, userId: ownerId, email: ownerEmail, role: "owner", permissions: [], storeIds: null });
  leeds.orgId = DEMO_ORG_ID;

  const york: Store = {
    id: YORK_STORE_ID, orgId: DEMO_ORG_ID, ownerId, name: "Test Wings, York", timezone: "Europe/London",
    openingHours: { ...leeds.openingHours }, shiftTemplates: [], joinCode: "WINGS2", plan: "trial", billingStatus: "trialing",
    trialEndsAt: addDays(isoDate(new Date()), 30), cancelledAt: null, stripeCustomerId: null, stripeSubscriptionId: null,
    features: { ...DEFAULT_FEATURES }, createdAt: ts,
  };
  data.stores.push(york);

  const preset = ROLE_PRESETS.find((p) => p.key === "restaurant")!;
  const roles: Role[] = preset.roles.map((r) => ({
    id: `york-role-${r.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, storeId: york.id, name: r.name, category: r.category, color: r.color,
    description: r.description ?? "", permissions: [...r.permissions], system: r.system ?? null, createdAt: ts,
  }));
  data.roles.push(...roles);
  const rid = (name: string) => roles.find((r) => r.name === name)!.id;
  york.shiftTemplates = [
    { id: "open", name: "Open", start: "10:00", end: "16:00", days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], minStaff: 2, maxStaff: 4, color: "amber", breakMinutes: 30, requirements: [{ roleId: rid("Back of House"), min: 1 }] },
    { id: "close", name: "Close", start: "16:00", end: "23:00", days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], minStaff: 3, maxStaff: 5, color: "indigo", breakMinutes: 30, requirements: [{ roleId: rid("Shift Lead"), min: 1 }, { roleId: rid("Back of House"), min: 1 }] },
  ];

  const team: [string, string[], number][] = [
    ["Aisha Khan", ["Shift Lead", "Front of House"], 32],
    ["Owen Price", ["Shift Lead", "Front of House"], 30],
    ["Lucy Ward", ["Shift Lead", "Front of House"], 26],
    ["Marek Nowak", ["Back of House"], 32],
    ["Sofia Rossi", ["Back of House"], 30],
    ["Kieran Doyle", ["Back of House"], 24],
    ["Ruby Clarke", ["Front of House"], 20],
    ["Theo Bennett", ["Front of House"], 20],
    ["Nia Evans", ["Front of House"], 18],
    ["Jack Holt", ["Front of House"], 16],
  ];
  team.forEach(([name, jobs, contract], i) => {
    const roleIds = [...jobs.map(rid), rid(contract >= 35 ? "Full-time" : "Part-time")];
    const start = new Date();
    start.setDate(start.getDate() - (200 + i * 40));
    const e: Employee = {
      id: `york-emp-${i + 1}`, storeId: york.id, name, roleIds, ...derivedFields(roleIds, roles), startDate: isoDate(start),
      contractedHours: contract, maxHoursPerWeek: 40, email: `${name.split(" ")[0].toLowerCase()}@testwings-york.example`,
      pinHash: pinHash(york.id, String(2001 + i)), active: true, createdAt: ts, ageBand: "21+", rightToWorkCheckedAt: isoDate(start),
    };
    data.employees.push(e);
    data.availability.push({
      id: `york-av-${i + 1}`, storeId: york.id, employeeId: e.id, kind: "default", startWeek: null, endWeek: null, days: anyWeek(),
      status: "approved", note: "", requestedBy: ownerEmail, decidedBy: ownerEmail, decidedAt: ts, updatedAt: ts,
    });
  });

  // Shared staff: these Leeds people can also be rostered at York.
  for (const key of ["casey", "femi", "harry"]) {
    const e = data.employees.find((x) => x.id === `emp-${key}`);
    if (e) e.allowedStoreIds = [york.id];
  }
  data.audit_log.push({ id: "demo-audit-york", storeId: york.id, actor: "system", action: "demo.seeded", details: { employees: team.length, sharedFromLeeds: 3 }, at: ts });
}
