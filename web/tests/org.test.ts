import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { effectiveStore } from "@/lib/org";
import { DEFAULT_POLICY } from "@/lib/holidays";
import type { Organisation, Store } from "@/lib/types";

const store = { id: "s", features: { swaps: true, holidays: true }, holidayPolicy: undefined } as unknown as Store;
const org = (o: Partial<Organisation>): Organisation => ({ id: "o", name: "Group", ownerId: "u", features: {}, lockedFeatures: [], holidayPolicy: null, lockHolidayPolicy: false, createdAt: "", ...o });

describe("brand settings", () => {
  it("standalone sites are unchanged", () => {
    expect(effectiveStore(store, null)).toBe(store);
  });
  it("locked brand features override the site; unlocked ones don't", () => {
    const e = effectiveStore(store, org({ features: { swaps: false, holidays: false }, lockedFeatures: ["swaps"] }));
    expect(e.features.swaps).toBe(false);
    expect(e.features.holidays).toBe(true);
  });
  it("brand holiday policy fills in, or wins when locked", () => {
    const brand = { ...DEFAULT_POLICY, allowance: 30 };
    expect(effectiveStore(store, org({ holidayPolicy: brand })).holidayPolicy?.allowance).toBe(30);
    const own = { ...store, holidayPolicy: { ...DEFAULT_POLICY, allowance: 25 } } as Store;
    expect(effectiveStore(own, org({ holidayPolicy: brand })).holidayPolicy?.allowance).toBe(25);
    expect(effectiveStore(own, org({ holidayPolicy: brand, lockHolidayPolicy: true })).holidayPolicy?.allowance).toBe(30);
  });
});
