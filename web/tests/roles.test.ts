import { describe, expect, it } from "vitest";
import { allowedSections, homeSection } from "@/lib/nav";
import { ALL_PERMISSIONS, DEFAULT_FEATURES, derivedFields, FEATURE_KEYS, FEATURE_PRESETS, hasFeature, PERMISSION_PRESETS, ROLE_PRESETS, type Permission } from "@/lib/roles";

const r = (id: string, name: string, category: "job" | "access" | "contract" | "status", system: "under18" | "student" | null = null) => ({ id, name, category, system });
const roles = [r("m", "Manager", "access"), r("foh", "Front of House", "job"), r("boh", "Back of House", "job"), r("ft", "Full-time", "contract"), r("u18", "Under 18", "status", "under18"), r("st", "Student", "status", "student")];

describe("derived employee fields", () => {
  it("joins access and job roles for display", () => {
    expect(derivedFields(["foh", "m", "ft"], roles).role).toBe("Manager · Front of House");
    expect(derivedFields(["ft"], roles).role).toBe("Team member");
  });
  it("sets the legal and student flags from system roles", () => {
    expect(derivedFields(["foh", "u18"], roles)).toMatchObject({ isUnder18: true, isStudent: false });
    expect(derivedFields(["st"], roles)).toMatchObject({ isUnder18: false, isStudent: true });
  });
});

describe("presets", () => {
  it("every role preset has the built-in status roles, one access role and a contract choice", () => {
    for (const p of ROLE_PRESETS) {
      expect(p.roles.filter((x) => x.system).map((x) => x.system).sort()).toEqual(["student", "under18"]);
      expect(p.roles.some((x) => x.category === "access" && x.permissions.length)).toBe(true);
      expect(p.roles.filter((x) => x.category === "contract").length).toBeGreaterThanOrEqual(2);
      expect(new Set(p.roles.map((x) => x.name)).size).toBe(p.roles.length);
    }
  });
  it("permission presets only use real permissions and grow in power", () => {
    for (const p of PERMISSION_PRESETS) for (const x of p.permissions) expect(ALL_PERMISSIONS).toContain(x);
    const sizes = PERMISSION_PRESETS.map((p) => p.permissions.length);
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes);
    expect(PERMISSION_PRESETS.at(-1)!.permissions).toHaveLength(ALL_PERMISSIONS.length);
  });
  it("feature presets set every switch; standard is all on", () => {
    for (const p of FEATURE_PRESETS) expect(Object.keys(p.features).sort()).toEqual([...FEATURE_KEYS].sort());
    expect(Object.values(DEFAULT_FEATURES).every(Boolean)).toBe(true);
  });
});

describe("feature switches", () => {
  it("treats missing keys as on (older stores)", () => {
    expect(hasFeature(undefined, "swaps")).toBe(true);
    expect(hasFeature({}, "swaps")).toBe(true);
    expect(hasFeature({ swaps: false }, "swaps")).toBe(false);
  });
});

describe("navigation by permission", () => {
  const set = (...p: Permission[]) => new Set(p);
  it("a supervisor sees rota, approvals and staff only", () => {
    const sup = PERMISSION_PRESETS.find((p) => p.key === "supervisor")!.permissions;
    expect(allowedSections(new Set(sup))).toEqual(["rota", "approvals", "staff"]);
  });
  it("full access sees everything", () => {
    expect(allowedSections(new Set(ALL_PERMISSIONS))).toEqual(["rota", "approvals", "timesheets", "staff", "reports", "rules", "setup", "admin", "settings"]);
  });
  it("home is the first allowed section", () => {
    expect(homeSection(set("approvals.swaps"))).toBe("approvals");
    expect(homeSection(set())).toBeNull();
  });
});
