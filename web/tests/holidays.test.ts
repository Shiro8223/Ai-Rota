import { describe, expect, it } from "vitest";
import { amountFor, balance, effectiveAllowance, holidayDatesInWeek, periodOf, policyFor, DEFAULT_POLICY } from "@/lib/holidays";
import { applyLock, lockState } from "@/lib/live";
import type { HolidayPolicy, HolidayRequest, ShiftTemplate } from "@/lib/types";

const P = (o: Partial<HolidayPolicy> = {}): HolidayPolicy => ({ ...DEFAULT_POLICY, ...o });
const req = (o: Partial<HolidayRequest>): HolidayRequest => ({ id: Math.random().toString(36), storeId: "s", employeeId: "e1", startDate: "2026-12-01", endDate: "2026-12-01", paid: true, amount: 1, unit: "days", note: "", status: "approved", createdAt: "", decidedBy: null, decidedAt: null, ...o });

describe("holiday policy", () => {
  const roles = [{ id: "lead", name: "Shift Lead", holidayPolicy: P({ allowance: 30 }) }, { id: "boh", name: "Back of House", holidayPolicy: null }];
  it("most specific wins: person > role > store", () => {
    expect(policyFor({ roleIds: ["boh"], holidayPolicy: null }, roles, {}).from).toBe("store");
    expect(policyFor({ roleIds: ["lead"], holidayPolicy: null }, roles, {}).policy.allowance).toBe(30);
    expect(policyFor({ roleIds: ["lead"], holidayPolicy: P({ allowance: 33 }) }, roles, {}).policy.allowance).toBe(33);
  });
  it("pro rata by contract hours", () => {
    expect(effectiveAllowance(P(), 37.5)).toBe(28);
    expect(effectiveAllowance(P(), 18.75)).toBe(14);
    expect(effectiveAllowance(P({ proRata: false }), 10)).toBe(28);
  });
  it("refresh periods", () => {
    expect(periodOf(P({ period: "year", startMonth: 4 }), "2026-11-02")).toEqual({ start: "2026-04-01", end: "2027-03-31" });
    expect(periodOf(P({ period: "year", startMonth: 4 }), "2026-02-10")).toEqual({ start: "2025-04-01", end: "2026-03-31" });
    expect(periodOf(P({ period: "quarter" }), "2026-11-02")).toEqual({ start: "2026-10-01", end: "2026-12-31" });
    expect(periodOf(P({ period: "month" }), "2026-02-14")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });
  it("amount: max 5 days a week, or days x a day's hours", () => {
    expect(amountFor({ contractedHours: 37.5 }, "days", "2026-11-09", "2026-11-15")).toBe(5); // Mon-Sun
    expect(amountFor({ contractedHours: 37.5 }, "days", "2026-11-13", "2026-11-16")).toBe(4); // Fri-Mon spans 2 weeks
    expect(amountFor({ contractedHours: 30 }, "hours", "2026-11-09", "2026-11-10")).toBe(12);
  });
  it("balance counts approved and pending paid holiday in the current period only", () => {
    const e = { id: "e1", contractedHours: 37.5, holidayPolicy: null, roleIds: [] };
    const reqs = [req({ amount: 5 }), req({ amount: 2, status: "pending", startDate: "2026-12-10", endDate: "2026-12-11" }), req({ amount: 3, paid: false }), req({ amount: 4, startDate: "2025-06-01", endDate: "2025-06-04" })];
    const b = balance(e, [], {}, reqs, "2026-11-02");
    expect(b).toMatchObject({ allowance: 28, used: 5, pending: 2, remaining: 21 });
  });
  it("holiday dates within a week", () => {
    const off = holidayDatesInWeek([req({ startDate: "2026-11-07", endDate: "2026-11-10" })], "e1", "2026-11-09");
    expect([...off]).toEqual(["2026-11-09", "2026-11-10"]);
  });
});

describe("24-hour rule", () => {
  const store = { openingHours: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } as never, shiftTemplates: [] as ShiftTemplate[] };
  store.openingHours = { mon: {}, tue: {}, wed: {}, thu: {}, fri: {}, sat: {}, sun: {} } as never;
  store.shiftTemplates = [{ id: "open", name: "Open", start: "10:00", end: "16:00", days: ["mon", "tue", "wed"], minStaff: 1, maxStaff: 3 }];
  const now = new Date(2026, 10, 9, 12, 0); // Monday 9 Nov 12:00
  it("lock states", () => {
    expect(lockState("2026-11-09", 0, "10:00", now)).toBe("past");
    expect(lockState("2026-11-09", 1, "10:00", now)).toBe("locked"); // Tue 10:00 = 22h away
    expect(lockState("2026-11-09", 2, "10:00", now)).toBe("open");
  });
  it("publishing: open shifts change, <24h become suggestions, started ones stay", () => {
    const published = [{ shiftId: "open:mon", employeeId: "a" }, { shiftId: "open:tue", employeeId: "a" }, { shiftId: "open:wed", employeeId: "a" }];
    const wanted = [{ shiftId: "open:mon", employeeId: "b" }, { shiftId: "open:tue", employeeId: "b" }, { shiftId: "open:wed", employeeId: "b" }];
    const r = applyLock(store, "2026-11-09", wanted, published, now);
    expect(r.live.sort((x, y) => x.shiftId.localeCompare(y.shiftId))).toEqual([
      { shiftId: "open:mon", employeeId: "a" },
      { shiftId: "open:tue", employeeId: "a" },
      { shiftId: "open:wed", employeeId: "b" },
    ]);
    expect(r.suggestions).toEqual(expect.arrayContaining([{ shiftId: "open:tue", employeeId: "b", kind: "add" }, { shiftId: "open:tue", employeeId: "a", kind: "remove" }]));
    expect(r.keptPast).toBe(2);
  });
  it("first publish isn't locked", () => {
    const wanted = [{ shiftId: "open:tue", employeeId: "b" }];
    expect(applyLock(store, "2026-11-09", wanted, null, now)).toMatchObject({ live: wanted, suggestions: [] });
  });
});
