import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { breakRemaining, breakTotal, onBreak, paidMinutes, statutoryBreak } from "@/lib/clock";
import { complianceFlags } from "@/lib/compliance";
import { labourCost, minimumWage, rateFor, wageProblem } from "@/lib/pay";
import { hit } from "@/lib/rate-limit";
import { payrollCsv } from "@/lib/timesheets";
import { balance, DEFAULT_POLICY } from "@/lib/holidays";
import type { Employee, Role, ShiftInstance } from "@/lib/types";

const roles = [
  { id: "foh", name: "Front of House", category: "job", hourlyRate: 12.75 },
  { id: "lead", name: "Shift Lead", category: "job", hourlyRate: 13.75 },
  { id: "plh", name: "Personal Licence Holder", category: "qualification", hourlyRate: null },
] as unknown as Role[];
const person = (o: Partial<Employee> = {}): Employee =>
  ({ id: "e1", storeId: "s", name: "Sam Test", roleIds: ["foh"], role: "Front of House", isUnder18: false, isStudent: false, startDate: "2024-01-01", contractedHours: 20, maxHoursPerWeek: 40, email: null, active: true, createdAt: "", ageBand: "21+", rightToWorkCheckedAt: "2024-01-01", ...o }) as Employee;

describe("pay and minimum wage", () => {
  it("uses the rate in force on the day", () => {
    expect(minimumWage("21+", "2026-03-31")).toBe(12.21);
    expect(minimumWage("21+", "2026-04-01")).toBe(12.71);
  });
  it("own rate beats role rate; otherwise the best role rate", () => {
    expect(rateFor(person(), roles)).toBe(12.75);
    expect(rateFor(person({ roleIds: ["foh", "lead"] }), roles)).toBe(13.75);
    expect(rateFor(person({ hourlyRate: 15 }), roles)).toBe(15);
  });
  it("flags pay below the band's minimum, and a missing band", () => {
    expect(wageProblem(person({ hourlyRate: 11.5 }), roles, "2026-11-02")?.kind).toBe("below");
    expect(wageProblem(person(), roles, "2026-11-02")).toBeNull();
    expect(wageProblem(person({ ageBand: null }), roles, "2026-11-02")?.kind).toBe("noBand");
    // Under-18s default to the 16-17 band.
    expect(wageProblem(person({ ageBand: null, isUnder18: true, hourlyRate: 8 }), roles, "2026-11-02")).toBeNull();
  });
  it("labour cost = paid hours x rate, and lists people with no rate", () => {
    const s = { id: "close:mon", minutes: 450 } as ShiftInstance;
    const c = labourCost([{ shiftId: "close:mon", employeeId: "e1" }, { shiftId: "close:mon", employeeId: "e2" }], { "close:mon": s }, [person(), person({ id: "e2", name: "No Rate", roleIds: [] })], roles);
    expect(c.total).toBeCloseTo(7.5 * 12.75, 2);
    expect(c.missing).toEqual(["No Rate"]);
  });
});

describe("compliance flags", () => {
  const today = "2026-11-02";
  it("right to work: missing, expiring and expired", () => {
    expect(complianceFlags([person({ rightToWorkCheckedAt: null })], roles, today)[0]).toMatchObject({ kind: "rtw", severity: "warning" });
    expect(complianceFlags([person({ rightToWorkExpires: "2026-11-20" })], roles, today)[0]).toMatchObject({ kind: "rtw", severity: "warning" });
    expect(complianceFlags([person({ rightToWorkExpires: "2026-10-01" })], roles, today)[0]).toMatchObject({ kind: "rtw", severity: "error" });
  });
  it("qualifications: expired is an error, expiring soon a warning, far away nothing", () => {
    const q = (d: string) => complianceFlags([person({ roleIds: ["foh", "plh"], qualificationExpiry: { plh: d } })], roles, today);
    expect(q("2026-10-01")[0]).toMatchObject({ kind: "qualification", severity: "error" });
    expect(q("2026-11-20")[0]).toMatchObject({ kind: "qualification", severity: "warning" });
    expect(q("2028-01-01")).toEqual([]);
  });
  it("errors sort before warnings", () => {
    const f = complianceFlags([person({ id: "a", name: "A", rightToWorkCheckedAt: null }), person({ id: "b", name: "B", hourlyRate: 9 })], roles, today);
    expect(f.map((x) => x.severity)).toEqual(["error", "warning"]);
  });
});

describe("clock-in", () => {
  it("break total counts finished breaks, and a running one up to now", () => {
    const breaks = [{ start: "2026-11-02T12:00:00", end: "2026-11-02T12:20:00" }, { start: "2026-11-02T15:00:00", end: null }];
    expect(breakTotal(breaks)).toBe(20);
    expect(breakTotal(breaks, "2026-11-02T15:10:00")).toBe(30);
    expect(onBreak({ clockOut: null, breaks })).toBe(true);
    expect(onBreak({ clockOut: "2026-11-02T18:00:00", breaks })).toBe(false);
  });
  it("break remaining: the rota break or the legal minimum, whichever is longer", () => {
    expect(breakRemaining({ shiftBreak: 30, shiftMinutes: 480, under18: false, taken: 10 })).toBe(20);
    expect(breakRemaining({ shiftBreak: 0, shiftMinutes: 420, under18: false, taken: 0 })).toBe(20);
    expect(breakRemaining({ shiftBreak: 0, shiftMinutes: 300, under18: true, taken: 0 })).toBe(30);
    expect(breakRemaining({ shiftBreak: 30, shiftMinutes: 480, under18: false, taken: 45 })).toBe(0);
  });
  it("statutory breaks: 20 min over 6h, 30 min over 4.5h for under-18s", () => {
    expect(statutoryBreak(360, false)).toBe(0);
    expect(statutoryBreak(361, false)).toBe(20);
    expect(statutoryBreak(271, true)).toBe(30);
  });
  it("paid minutes span midnight and subtract the break", () => {
    expect(paidMinutes({ clockIn: "2026-11-01T18:00:00", clockOut: "2026-11-02T01:00:00", breakMinutes: 30 })).toBe(390);
    expect(paidMinutes({ clockIn: "2026-11-01T18:00:00", clockOut: null, breakMinutes: 0 })).toBe(0);
  });
});

describe("payroll CSV", () => {
  const data = { source: "approved timesheets", rows: [{ e: person({ name: "=cmd Evil", payrollId: "P1" }), hours: 20.5, holidayHours: 8, sickDays: 1, rate: 12.75, gross: 363.38 }] };
  it("generic export includes pay only with permission, and neutralises formulas", () => {
    const withPay = payrollCsv("generic", data, "2026-10-26", "2026-11-01", true);
    expect(withPay).toContain("Hourly rate");
    expect(withPay).toContain("'=cmd Evil");
    expect(payrollCsv("generic", data, "2026-10-26", "2026-11-01", false)).not.toContain("12.75");
  });
  it("Sage-style puts basic and holiday hours on separate lines", () => {
    const lines = payrollCsv("sage", data, "2026-10-26", "2026-11-01", false).trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("Basic Hours");
    expect(lines[2]).toContain("Holiday Hours");
  });
});

describe("holiday accrual (irregular hours)", () => {
  it("accrues 12.07% of hours worked", () => {
    const b = balance(person(), roles, { holidayPolicy: { ...DEFAULT_POLICY, mode: "accrual" } }, [], "2026-11-02", 100);
    expect(b.unit).toBe("hours");
    expect(b.allowance).toBeCloseTo(12.1, 1);
  });
});

describe("rate limit", () => {
  it("allows up to the limit in a window", () => {
    const key = `t-${Math.random()}`;
    expect([1, 2, 3].map(() => hit(key, 2, 60_000).ok)).toEqual([true, true, false]);
  });
});
