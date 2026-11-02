import { describe, expect, it } from "vitest";
import fixture from "@fixtures/test-wings-leeds.json";
import { demoTranslate } from "@/lib/ai-demo";
import { describeConstraint, validateConstraint, type RuleContext } from "@/lib/constraints";
import { guessMapping, parseAvailabilityCell, parseDateCell } from "@/lib/import-parse";
import { draftToConstraint } from "@/lib/rule-draft";
import { coversShift, mondayOf, shiftsForStore } from "@/lib/time";
import type { Day, ShiftTemplate } from "@/lib/types";

const templates = fixture.store.shiftTemplates.map((t) => ({ ...t, days: t.days as Day[], requirements: [] })) as unknown as ShiftTemplate[];
const roleNames = ["Manager", "Shift Lead", "Front of House", "Back of House", "Bar", "Full-time", "Part-time", "Under 18", "Student"];
const ctx: RuleContext = { templates, employees: fixture.employees.map((e) => ({ id: e.key, name: e.name, role: e.role })), roleNames };

function translate(text: string) {
  const draft = demoTranslate(text, ctx);
  if (!draft.understood) return { understood: false as const, problem: draft.problem };
  const v = validateConstraint(draftToConstraint(draft), ctx);
  if (!v.ok) throw new Error(`${text}: ${v.error}`);
  return { understood: true as const, constraint: v.constraint, summary: describeConstraint(v.constraint, ctx) };
}

describe("demo translator reproduces the fixture rules", () => {
  for (const r of fixture.rules) {
    it(r.originalText, () => {
      const t = translate(r.originalText);
      expect(t.understood).toBe(true);
      if (t.understood) expect(t.constraint).toEqual(r.constraint);
    });
  }
});

describe("demo translator, other phrasings", () => {
  it("hours cap for under 18s", () => {
    const t = translate("Under 18s no more than 12 hours a week");
    expect(t.understood && t.constraint).toMatchObject({ type: "max_hours", max: 12, filter: { field: "isUnder18", value: true }, hard: true });
  });
  it("named person, day off", () => {
    const t = translate("Harry can't work Fridays");
    expect(t.understood && t.constraint).toMatchObject({ type: "unavailable", employee: "harry", shift: "*", day: "fri" });
  });
  it("soft avoid preference", () => {
    const t = translate("Ben would rather not close on Saturdays");
    expect(t.understood && t.constraint).toMatchObject({ type: "prefer", employee: "ben", shift: "close", day: "sat", avoid: true });
  });
  it("refuses nonsense", () => {
    expect(translate("make the coffee stronger").understood).toBe(false);
  });
});

describe("validation guardrails", () => {
  it("rejects unknown types and extra fields", () => {
    expect(validateConstraint({ type: "delete_everyone" }, ctx).ok).toBe(false);
    expect(validateConstraint({ type: "never_together", employees: ["jordan", "casey"], hard: true, reason: "argument" }, ctx).ok).toBe(false);
  });
  it("rejects unknown people, shifts and roles", () => {
    expect(validateConstraint({ type: "never_together", employees: ["jordan", "nobody"], hard: true }, ctx).ok).toBe(false);
    expect(validateConstraint({ type: "max_count", shift: "brunch", day: "*", filter: null, max: 1, hard: true }, ctx).ok).toBe(false);
    expect(validateConstraint({ type: "min_count", shift: "*", day: "*", filter: { field: "role", op: "eq", value: "Pilot" }, min: 1, hard: true }, ctx).ok).toBe(false);
  });
  it("reads rules back in plain words", () => {
    const v = validateConstraint(fixture.rules[0].constraint, ctx);
    expect(v.ok && describeConstraint(v.constraint, ctx)).toBe("No more than 1 person with under 90 days' service on Close shifts.");
  });
});

describe("spreadsheet import parsing", () => {
  it("dates", () => {
    expect(parseDateCell("14/03/2024")).toBe("2024-03-14");
    expect(parseDateCell("2024-03-14")).toBe("2024-03-14");
    expect(parseDateCell(45365)).toBe("2024-03-14");
    expect(parseDateCell("03/14/2024")).toBeNull();
  });
  it("availability cells", () => {
    expect(parseAvailabilityCell("any")).toEqual([{ from: "00:00", to: "24:00" }]);
    expect(parseAvailabilityCell("off")).toEqual([]);
    expect(parseAvailabilityCell("10-4pm, 6pm-11pm")).toEqual([{ from: "10:00", to: "16:00" }, { from: "18:00", to: "23:00" }]);
    expect(parseAvailabilityCell("whenever")).toBeNull();
  });
  it("guesses column mapping", () => {
    const m = guessMapping(["Full Name", "Job title", "Start Date", "Contracted hrs", "Monday", "Tues"]);
    expect(m).toMatchObject({ name: "Full Name", role: "Job title", startDate: "Start Date", contractedHours: "Contracted hrs", mon: "Monday", tue: "Tues" });
  });
});

describe("time helpers", () => {
  it("builds the same shift ids as the solver", () => {
    const shifts = shiftsForStore({ shiftTemplates: templates, openingHours: fixture.store.openingHours as never });
    expect(shifts).toHaveLength(17);
    expect(shifts[0].id).toBe("open:mon");
  });
  it("availability windows", () => {
    expect(coversShift([{ from: "16:00", to: "23:00" }], "16:00", "23:00")).toBe(true);
    expect(coversShift([{ from: "16:00", to: "22:00" }], "16:00", "23:00")).toBe(false);
    expect(coversShift([{ from: "00:00", to: "24:00" }], "18:00", "02:00")).toBe(true);
  });
  it("mondayOf", () => {
    expect(mondayOf(new Date(2026, 10, 8))).toBe("2026-11-02"); // Sunday -> previous Monday
  });
});
