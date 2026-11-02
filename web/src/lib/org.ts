import "server-only";
import { db } from "./db";
import type { Employee, Organisation, Store } from "./types";

/**
 * A site as its staff and managers experience it: brand-locked features and the brand
 * holiday policy (when locked, or when the site has none of its own) applied on top.
 */
export function effectiveStore(store: Store, org: Organisation | null): Store {
  if (!org) return store;
  const features = { ...store.features };
  for (const k of org.lockedFeatures ?? []) if (k in (org.features ?? {})) features[k] = org.features[k];
  const holidayPolicy = org.lockHolidayPolicy && org.holidayPolicy ? org.holidayPolicy : (store.holidayPolicy ?? org.holidayPolicy ?? undefined);
  // A group subscription covers every site.
  const billing = org.billingStatus === "active" || org.billingStatus === "past_due" ? { billingStatus: org.billingStatus, plan: org.plan ?? store.plan, cancelledAt: null } : {};
  return { ...store, features, holidayPolicy, ...billing };
}

export async function orgOf(store: Pick<Store, "orgId">) {
  return store.orgId ? (await db()).get("organisations", store.orgId) : null;
}

/** Load a site with its group's brand settings applied. */
export async function loadStore(storeId: string) {
  const store = await (await db()).get("stores", storeId);
  if (!store) return null;
  return effectiveStore(store, await orgOf(store));
}

export async function orgStores(orgId: string) {
  return (await db()).list("stores", { orgId }, { orderBy: "createdAt" });
}

/** Availability rows and approved holidays for staff whose home sites may differ. */
export async function staffRecords(staff: Pick<Employee, "storeId">[]) {
  const d = await db();
  const homes = [...new Set(staff.map((e) => e.storeId))];
  const avail = (await Promise.all(homes.map((id) => d.list("availability", { storeId: id })))).flat();
  const holidays = (await Promise.all(homes.map((id) => d.list("holidays", { storeId: id, status: "approved" })))).flat();
  return { avail, holidays };
}

/** Everyone who can be rostered at this site: its own staff plus visitors from sister sites. */
export async function storeStaff(store: Pick<Store, "id" | "orgId">): Promise<(Employee & { visiting: boolean })[]> {
  const d = await db();
  const own = await d.list("employees", { storeId: store.id, active: true }, { orderBy: "name" });
  if (!store.orgId) return own.map((e) => ({ ...e, visiting: false }));
  const sisters = (await orgStores(store.orgId)).filter((s) => s.id !== store.id);
  const visitors: Employee[] = [];
  for (const s of sisters) visitors.push(...(await d.list("employees", { storeId: s.id, active: true })).filter((e) => (e.allowedStoreIds ?? []).includes(store.id)));
  return [...own.map((e) => ({ ...e, visiting: false })), ...visitors.map((e) => ({ ...e, visiting: true }))].sort((a, b) => a.name.localeCompare(b.name));
}
