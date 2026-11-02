import "server-only";
import { notFound, redirect } from "next/navigation";
import { db } from "./db";
import { loadStore } from "./org";
import { ALL_PERMISSIONS, type Permission } from "./roles";
import { getSession } from "./session";
import { permissionsOf, storeRoles } from "./team";
import type { Employee, Store, StoreMember } from "./types";

export async function requireManager() {
  const s = await getSession();
  if (!s || s.kind !== "manager") redirect("/login");
  return s;
}

export interface Access {
  store: Store;
  /** Name shown in the audit log. */
  actor: string;
  perms: Set<Permission>;
  /** The account owner: always full access, the only one who can't be locked out. */
  isPrimary: boolean;
  member: StoreMember | null;
  employee: Employee | null;
}

/** Who is signed in for this store and what they may do: email managers and PIN staff alike. */
export async function getAccess(storeId: string): Promise<Access | null> {
  const s = await getSession();
  if (!s) return null;
  const d = await db();
  const store = await loadStore(storeId);
  if (!store) return null;
  const roles = await storeRoles(storeId);
  if (s.kind === "manager") {
    const [member] = await d.list("store_members", { storeId, userId: s.userId });
    if (member) {
      const isPrimary = member.role === "owner";
      return { store, actor: s.email, perms: isPrimary ? new Set(ALL_PERMISSIONS) : permissionsOf(member.roleIds ?? [], roles), isPrimary, member, employee: null };
    }
    // Group access: the group owner runs every site; area managers get the sites and permissions they're given.
    if (store.orgId) {
      const [om] = await d.list("org_members", { orgId: store.orgId, userId: s.userId });
      if (om && (om.storeIds === null || om.storeIds.includes(storeId))) {
        const owner = om.role === "owner";
        return { store, actor: s.email, perms: owner ? new Set(ALL_PERMISSIONS) : new Set(om.permissions), isPrimary: owner, member: null, employee: null };
      }
    }
    return null;
  }
  if (s.kind !== "staff" || s.storeId !== storeId) return null; // kiosk devices get no manager or staff access
  const employee = await d.get("employees", s.employeeId);
  if (!employee || !employee.active || employee.storeId !== storeId) return null;
  return { store, actor: employee.name, perms: permissionsOf(employee.roleIds ?? [], roles), isPrimary: false, member: null, employee };
}

/**
 * Gate for every manager page and action. `need` = one permission, or a list where any one
 * is enough. With no `need`, any access permission at all lets you in.
 */
export async function requireStore(storeId: string, need?: Permission | Permission[]): Promise<Access> {
  const a = await getAccess(storeId);
  if (!a) {
    const s = await getSession();
    if (!s) redirect("/login");
    notFound();
  }
  const list = need === undefined ? [] : Array.isArray(need) ? need : [need];
  const ok = list.length ? list.some((p) => a.perms.has(p)) : a.perms.size > 0;
  if (!ok) notFound();
  return a;
}

export const can = (a: Pick<Access, "perms">, p: Permission) => a.perms.has(p);

export async function requireStaff(): Promise<{ employee: Employee; store: Store }> {
  const s = await getSession();
  if (!s || s.kind !== "staff") redirect("/login?as=staff");
  const d = await db();
  const employee = await d.get("employees", s.employeeId);
  const store = await loadStore(s.storeId);
  if (!employee || !store || !employee.active || employee.storeId !== store.id) redirect("/login?as=staff");
  return { employee, store };
}

/** The site's shared clock-in screen. Only a kiosk session for that site gets in. */
export async function requireKiosk(storeId: string): Promise<{ store: Store; startedBy: string }> {
  const s = await getSession();
  if (!s || s.kind !== "kiosk" || s.storeId !== storeId) redirect("/login");
  const store = await loadStore(storeId);
  if (!store) redirect("/login");
  return { store, startedBy: s.startedBy };
}

/** Billing gate: trial running or subscription active. */
export function storeActive(store: Store) {
  if (store.cancelledAt) return false;
  if (store.billingStatus === "active") return true;
  if (store.billingStatus === "trialing") return store.trialEndsAt >= new Date().toISOString().slice(0, 10);
  return store.billingStatus === "past_due";
}
