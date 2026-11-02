import "server-only";
import { db, newId, now } from "./db";
import { derivedFields, ROLE_PRESETS, SYSTEM_ROLES, type Permission, type RoleCategory, type RoleSeed, type SystemRole } from "./roles";
import type { Employee, Role } from "./types";

/** Fields on Employee that are derived from their roles (kept for display, the solver and law checks). */
export const derived = (roleIds: string[], roles: Role[]): Pick<Employee, "role" | "isUnder18" | "isStudent"> => derivedFields(roleIds, roles);

/** Names of every role a person holds, sent to the solver so rules can target any role. */
export const roleNames = (e: Pick<Employee, "roleIds">, roles: Role[]) => roles.filter((r) => e.roleIds.includes(r.id)).map((r) => r.name);

export const jobRoleIds = (e: Pick<Employee, "roleIds">, roles: Role[]) => roles.filter((r) => r.category === "job" && e.roleIds.includes(r.id)).map((r) => r.id);

export function permissionsOf(roleIds: string[], roles: Role[]): Set<Permission> {
  return new Set(roles.filter((r) => roleIds.includes(r.id)).flatMap((r) => r.permissions));
}

export async function storeRoles(storeId: string) {
  return (await db()).list("roles", { storeId }, { orderBy: "createdAt" });
}

/** Contract roles are one-per-person; drop ids that don't belong to this store. */
export function cleanRoleIds(roleIds: string[], roles: Role[]) {
  const valid = roleIds.filter((id, i) => roles.some((r) => r.id === id) && roleIds.indexOf(id) === i);
  const contracts = valid.filter((id) => roles.find((r) => r.id === id)!.category === "contract");
  return contracts.length > 1 ? valid.filter((id) => !contracts.slice(0, -1).includes(id)) : valid;
}

export async function setEmployeeRoles(storeId: string, employeeId: string, roleIds: string[]) {
  const roles = await storeRoles(storeId);
  const ids = cleanRoleIds(roleIds, roles);
  return (await db()).update("employees", employeeId, { roleIds: ids, ...derived(ids, roles) });
}

/** After renaming or deleting a role, refresh everyone's derived fields. */
export async function resyncEmployees(storeId: string) {
  const d = await db();
  const roles = await storeRoles(storeId);
  for (const e of await d.list("employees", { storeId })) {
    const ids = cleanRoleIds(e.roleIds ?? [], roles);
    const next = derived(ids, roles);
    if (ids.length !== (e.roleIds ?? []).length || next.role !== e.role || next.isUnder18 !== e.isUnder18 || next.isStudent !== e.isStudent) {
      await d.update("employees", e.id, { roleIds: ids, ...next });
    }
  }
  for (const m of await d.list("store_members", { storeId })) {
    const ids = (m.roleIds ?? []).filter((id) => roles.some((r) => r.id === id));
    if (ids.length !== (m.roleIds ?? []).length) await d.update("store_members", m.id, { roleIds: ids });
  }
}

export function roleFromSeed(storeId: string, s: RoleSeed, id = newId()): Role {
  return { id, storeId, name: s.name, category: s.category, color: s.color, description: s.description ?? "", permissions: [...s.permissions], system: s.system ?? null, createdAt: now() };
}

/** Add a preset's roles that don't exist yet (matched by name). Never removes anything. */
export async function applyRolePreset(storeId: string, presetKey: string) {
  const preset = ROLE_PRESETS.find((p) => p.key === presetKey);
  if (!preset) return [];
  const d = await db();
  const existing = await storeRoles(storeId);
  const added: Role[] = [];
  for (const s of preset.roles) {
    const clash = existing.find((r) => (s.system && r.system === s.system) || r.name.toLowerCase() === s.name.toLowerCase());
    if (clash) continue;
    const role = roleFromSeed(storeId, s);
    await d.insert("roles", role);
    added.push(role);
  }
  return added;
}

/** System roles must always exist (legal limits depend on Under 18). */
export async function ensureSystemRoles(storeId: string) {
  const d = await db();
  const existing = await storeRoles(storeId);
  for (const key of Object.keys(SYSTEM_ROLES) as SystemRole[]) {
    if (!existing.some((r) => r.system === key)) await d.insert("roles", roleFromSeed(storeId, { ...SYSTEM_ROLES[key], category: "status", permissions: [], system: key }));
  }
}

/** For spreadsheet import: find a role by name, creating a job role if missing. */
export async function roleByName(storeId: string, name: string, category: RoleCategory = "job") {
  const roles = await storeRoles(storeId);
  const found = roles.find((r) => r.name.toLowerCase() === name.trim().toLowerCase());
  if (found) return found;
  const role = roleFromSeed(storeId, { name: name.trim(), category, color: "sky", permissions: [] });
  await (await db()).insert("roles", role);
  return role;
}

/** Invited managers have no userId until they first sign in with that email. */
export async function claimInvites(userId: string, email: string) {
  const d = await db();
  for (const m of await d.list("store_members", { userId: "" })) {
    if (m.email.toLowerCase() === email.toLowerCase()) await d.update("store_members", m.id, { userId });
  }
  for (const m of await d.list("org_members", { userId: "" })) {
    if (m.email.toLowerCase() === email.toLowerCase()) await d.update("org_members", m.id, { userId });
  }
}

/** Shape the role picker needs (client component). */
export const roleOptions = (roles: Role[]) =>
  roles.map((r) => ({ id: r.id, name: r.name, category: r.category, color: r.color, description: r.description, permissionCount: r.permissions.length }));
