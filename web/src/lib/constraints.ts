import { z } from "zod/v4";
import type { Day, Employee, ShiftTemplate } from "./types";
import { DAY_NAME } from "./types";

/** The closed list of constraint shapes the solver understands. Mirrors solver/app/domain.py. */
export const CONSTRAINT_TYPES = ["max_count", "min_count", "never_together", "unavailable", "max_hours", "min_rest_hours", "prefer"] as const;
export const DAY_SELECTORS = ["*", "weekend", "weekday", "mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export const FILTER_FIELDS = ["role", "tenureDays", "isUnder18", "contractedHours", "name"] as const;
export const FILTER_OPS = ["eq", "neq", "lt", "lte", "gt", "gte"] as const;

export const FilterSchema = z.strictObject({
  field: z.enum(FILTER_FIELDS),
  op: z.enum(FILTER_OPS),
  value: z.union([z.boolean(), z.number(), z.string().min(1).max(60)]),
});
export type Filter = z.infer<typeof FilterSchema>;

const DaySel = z.enum(DAY_SELECTORS);
const ShiftSel = z.string().min(1).max(40);

export const ConstraintSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("max_count"), shift: ShiftSel, day: DaySel, filter: FilterSchema.nullable(), max: z.number().int().min(0).max(50), hard: z.boolean() }),
  z.strictObject({ type: z.literal("min_count"), shift: ShiftSel, day: DaySel, filter: FilterSchema.nullable(), min: z.number().int().min(0).max(50), hard: z.boolean() }),
  z.strictObject({ type: z.literal("never_together"), employees: z.tuple([z.string(), z.string()]), hard: z.literal(true) }),
  z.strictObject({ type: z.literal("unavailable"), employee: z.string(), shift: ShiftSel, day: DaySel, hard: z.boolean() }),
  z.strictObject({ type: z.literal("max_hours"), employee: z.string().nullable(), filter: FilterSchema.nullable(), max: z.number().min(0).max(80), hard: z.boolean() }),
  z.strictObject({ type: z.literal("min_rest_hours"), employee: z.string().nullable(), filter: FilterSchema.nullable(), hours: z.number().min(0).max(48), hard: z.boolean() }),
  z.strictObject({
    type: z.literal("prefer"),
    employee: z.string().nullable(),
    filter: FilterSchema.nullable(),
    shift: ShiftSel,
    day: DaySel,
    avoid: z.boolean(),
    weight: z.number().int().min(1).max(10),
    hard: z.literal(false),
  }),
]);
export type Constraint = z.infer<typeof ConstraintSchema>;

export interface RuleContext {
  templates: ShiftTemplate[];
  employees: Pick<Employee, "id" | "name" | "role">[];
  /** Every role name at the store (job, access, contract, status). Rules can target any of them. */
  roleNames: string[];
}

/** Schema check plus reference check: every shift and person named must exist. */
export function validateConstraint(raw: unknown, ctx: RuleContext): { ok: true; constraint: Constraint } | { ok: false; error: string } {
  const parsed = ConstraintSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: z.prettifyError(parsed.error) };
  const c = parsed.data;
  const shiftIds = new Set(ctx.templates.map((t) => t.id));
  const empIds = new Set(ctx.employees.map((e) => e.id));
  if ("shift" in c && c.shift !== "*" && !shiftIds.has(c.shift)) return { ok: false, error: `Unknown shift "${c.shift}"` };
  const people = c.type === "never_together" ? c.employees : "employee" in c && c.employee ? [c.employee] : [];
  for (const p of people) if (!empIds.has(p)) return { ok: false, error: `Unknown employee "${p}"` };
  if (c.type === "never_together" && c.employees[0] === c.employees[1]) return { ok: false, error: "Pick two different people" };
  if ((c.type === "max_hours" || c.type === "prefer") && !c.employee && !c.filter) return { ok: false, error: "Say who the rule applies to" };
  const filter = "filter" in c ? c.filter : null;
  if (filter?.field === "role") {
    const match = ctx.roleNames.find((r) => r.toLowerCase() === String(filter.value).toLowerCase());
    if (!match) return { ok: false, error: `There's no role called "${filter.value}"` };
    filter.value = match; // store the role's exact name
  }
  return { ok: true, constraint: c };
}

// ----------------------------------------------------------------------------- plain words

function shiftWords(sel: string, ctx: RuleContext, plural = true) {
  if (sel === "*") return plural ? "every shift" : "any shift";
  const t = ctx.templates.find((x) => x.id === sel);
  return `${t?.name ?? sel} shift${plural ? "s" : ""}`;
}

function dayWords(sel: string) {
  if (sel === "*") return "";
  if (sel === "weekend") return " at weekends";
  if (sel === "weekday") return " on weekdays";
  return ` on ${DAY_NAME[sel as Day]}s`;
}

function filterWords(f: Filter | null, count: number) {
  const person = count === 1 ? "person" : "people";
  if (!f) return count === 1 ? "person" : "people";
  const v = f.value;
  switch (f.field) {
    case "tenureDays":
      if (f.op === "lt" || f.op === "lte") return `${person} with under ${v} days' service`;
      return `${person} with over ${v} days' service`;
    case "isUnder18":
      return (v === true || v === "true") === (f.op === "eq") ? `under-18${count === 1 ? "" : "s"}` : `adult${count === 1 ? "" : "s"}`;
    case "role":
      return f.op === "eq" ? `${String(v)}${count === 1 ? "" : "s"}` : `${person} who aren't ${String(v)}s`;
    case "contractedHours":
      return `${person} contracted ${f.op.startsWith("l") ? "under" : "over"} ${v}h`;
    case "name":
      return String(v);
  }
}

function whoWords(employee: string | null, f: Filter | null, ctx: RuleContext) {
  if (employee) return firstName(ctx, employee);
  if (!f) return "everyone";
  return filterWords(f, 2);
}

export function firstName(ctx: RuleContext, id: string) {
  return ctx.employees.find((e) => e.id === id)?.name.split(" ")[0] ?? "someone";
}

/** "no more than 1 person with under 90 days' service on Close shifts" */
export function describeConstraint(c: Constraint, ctx: RuleContext): string {
  const strength = c.hard ? "" : " (preference)";
  switch (c.type) {
    case "max_count":
      return `No more than ${c.max} ${filterWords(c.filter, c.max)} on ${shiftWords(c.shift, ctx)}${dayWords(c.day)}${strength}.`;
    case "min_count":
      return `At least ${c.min} ${filterWords(c.filter, c.min)} on ${shiftWords(c.shift, ctx)}${dayWords(c.day)}${strength}.`;
    case "never_together":
      return `${firstName(ctx, c.employees[0])} and ${firstName(ctx, c.employees[1])} are never on shift at the same time.`;
    case "unavailable":
      return c.shift === "*"
        ? `${firstName(ctx, c.employee)} doesn't work${dayWords(c.day) || " at all"}${strength}.`
        : `${firstName(ctx, c.employee)} is never put on ${shiftWords(c.shift, ctx)}${dayWords(c.day)}${strength}.`;
    case "max_hours":
      return `${cap(whoWords(c.employee, c.filter, ctx))} work at most ${c.max}h a week${strength}.`;
    case "min_rest_hours":
      return `${cap(whoWords(c.employee, c.filter, ctx))} get at least ${c.hours}h rest between shifts${strength}.`;
    case "prefer":
      return `${cap(whoWords(c.employee, c.filter, ctx))} ${c.avoid ? "are kept off" : "are given"} ${shiftWords(c.shift, ctx)}${dayWords(c.day)} where possible (weight ${c.weight}/10).`;
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
