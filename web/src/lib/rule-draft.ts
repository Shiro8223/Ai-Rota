import { z } from "zod/v4";
import { CONSTRAINT_TYPES, DAY_SELECTORS, FILTER_FIELDS, FILTER_OPS } from "./constraints";

/**
 * The flat shape the model fills in. It is deliberately simple (no unions) so structured
 * outputs can enforce it; draftToConstraint() then builds the real constraint, which is
 * validated against the strict schema before anyone sees it.
 */
export const RuleDraftSchema = z.object({
  understood: z.boolean().describe("false if the text is not a scheduling rule this app can express"),
  problem: z.string().nullable().describe("when understood=false: one short sentence telling the manager what to rephrase"),
  type: z.enum(CONSTRAINT_TYPES).nullable(),
  shift: z.string().nullable().describe("a shift id from the list, or * for every shift"),
  day: z.enum(DAY_SELECTORS).nullable(),
  filterField: z.enum(FILTER_FIELDS).nullable(),
  filterOp: z.enum(FILTER_OPS).nullable(),
  filterValue: z.string().nullable().describe("role name, number of days/hours, or true/false"),
  employeeIds: z.array(z.string()).describe("employee ids from the list; two for never_together, one for a named person, else empty"),
  max: z.number().nullable(),
  min: z.number().nullable(),
  hours: z.number().nullable(),
  avoid: z.boolean().nullable(),
  weight: z.number().nullable(),
  hard: z.boolean().nullable().describe("true for must/never/always; false for prefer/try/would rather"),
});
export type RuleDraft = z.infer<typeof RuleDraftSchema>;

function filterValue(field: string | null, raw: string | null): string | number | boolean | null {
  if (raw === null) return null;
  if (field === "isUnder18") return /^(true|yes|1)$/i.test(raw.trim());
  if (field === "tenureDays" || field === "contractedHours") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  return raw.trim();
}

/** Build the canonical constraint object. It still has to pass validateConstraint(). */
export function draftToConstraint(d: RuleDraft): unknown {
  const filter = d.filterField && d.filterOp && d.filterValue !== null ? { field: d.filterField, op: d.filterOp, value: filterValue(d.filterField, d.filterValue) } : null;
  const shift = d.shift || "*";
  const day = d.day || "*";
  const hard = d.hard ?? true;
  const one = d.employeeIds[0] ?? null;
  switch (d.type) {
    case "max_count":
      return { type: d.type, shift, day, filter, max: d.max ?? 0, hard };
    case "min_count":
      return { type: d.type, shift, day, filter, min: d.min ?? 1, hard };
    case "never_together":
      return { type: d.type, employees: d.employeeIds.slice(0, 2), hard: true };
    case "unavailable":
      return { type: d.type, employee: one, shift, day, hard };
    case "max_hours":
      return { type: d.type, employee: one, filter: one ? null : filter, max: d.max ?? d.hours ?? 0, hard };
    case "min_rest_hours":
      return { type: d.type, employee: one, filter: one ? null : filter, hours: d.hours ?? d.min ?? 11, hard };
    case "prefer":
      return { type: d.type, employee: one, filter: one ? null : filter, shift, day, avoid: d.avoid ?? false, weight: Math.min(10, Math.max(1, Math.round(d.weight ?? 3))), hard: false };
    default:
      return { type: null };
  }
}
