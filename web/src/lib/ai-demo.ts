import type { RuleContext } from "./constraints";
import type { RuleDraft } from "./rule-draft";

/**
 * Offline stand-in for the AI, used when no Anthropic credentials are configured.
 * It understands the common phrasings managers use; anything else is politely refused.
 * Output goes through exactly the same validation as the real model's.
 */

const DAY_WORDS: Record<string, RuleDraft["day"]> = {
  monday: "mon", mondays: "mon", mon: "mon",
  tuesday: "tue", tuesdays: "tue", tue: "tue",
  wednesday: "wed", wednesdays: "wed", wed: "wed",
  thursday: "thu", thursdays: "thu", thu: "thu",
  friday: "fri", fridays: "fri", fri: "fri",
  saturday: "sat", saturdays: "sat", sat: "sat",
  sunday: "sun", sundays: "sun", sun: "sun",
  weekend: "weekend", weekends: "weekend",
  weekday: "weekday", weekdays: "weekday",
};
const NUM: Record<string, number> = { no: 0, zero: 0, one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

const blank = (): RuleDraft => ({
  understood: true, problem: null, type: null, shift: null, day: null, filterField: null, filterOp: null, filterValue: null,
  employeeIds: [], max: null, min: null, hours: null, avoid: null, weight: null, hard: true,
});

function toNum(s: string | undefined) {
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NUM[s.toLowerCase()] ?? null;
}

function findShift(text: string, ctx: RuleContext): string | null {
  const t = text.toLowerCase();
  for (const tpl of ctx.templates) {
    const n = tpl.name.toLowerCase();
    if (new RegExp(`\\b(${tpl.id}|${n})(s|ing)?\\b`).test(t)) return tpl.id;
  }
  const byStart = [...ctx.templates].sort((a, b) => a.start.localeCompare(b.start));
  const byEnd = [...ctx.templates].sort((a, b) => a.end.localeCompare(b.end));
  if (/\b(morning|mornings|opening|opens?|early|earlies)\b/.test(t)) return byStart[0]?.id ?? null;
  if (/\b(evening|evenings|night|nights|closing|closes?|late|lates)\b/.test(t)) return byEnd[byEnd.length - 1]?.id ?? null;
  return null;
}

function findDay(text: string): RuleDraft["day"] {
  const m = text.toLowerCase().match(/\b(mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|weekends?|weekdays?)\b/);
  return m ? DAY_WORDS[m[1]] : "*";
}

function findPeople(text: string, ctx: RuleContext): string[] {
  const t = text.toLowerCase();
  const hits: { id: string; at: number }[] = [];
  for (const e of ctx.employees) {
    const first = e.name.split(" ")[0].toLowerCase();
    const full = e.name.toLowerCase();
    const at = t.indexOf(full) >= 0 ? t.indexOf(full) : t.search(new RegExp(`\\b${first}\\b`));
    if (at >= 0) hits.push({ id: e.id, at });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.id);
}

function findGroup(text: string, ctx: RuleContext): Pick<RuleDraft, "filterField" | "filterOp" | "filterValue"> | null {
  const t = text.toLowerCase();
  if (/\bnew (starters?|staff|people|hires?|joiners?)\b|\btrainees?\b/.test(t)) {
    const days = t.match(/(\d+)\s*days/);
    return { filterField: "tenureDays", filterOp: "lt", filterValue: days ? days[1] : "90" };
  }
  if (/\bunder[- ]?18s?\b|\bunder eighteens?\b|\bminors?\b|\bjuniors?\b/.test(t)) return { filterField: "isUnder18", filterOp: "eq", filterValue: "true" };
  const roles = [...ctx.roleNames].sort((a, b) => b.length - a.length);
  for (const role of roles) {
    if (new RegExp(`\\b${role.toLowerCase()}s?\\b`).test(t)) return { filterField: "role", filterOp: "eq", filterValue: role };
  }
  return null;
}

const refuse = (problem: string): RuleDraft => ({ ...blank(), understood: false, problem });

export function demoTranslate(text: string, ctx: RuleContext): RuleDraft {
  const t = text.toLowerCase().replace(/[’']/g, "'").trim();
  const d = blank();
  const people = findPeople(t, ctx);
  const shift = findShift(t, ctx) ?? "*";
  const day = findDay(t);
  const group = findGroup(t, ctx);
  const soft = /\b(prefer|prefers|would rather|rather|ideally|try to|where possible|if possible|likes?)\b/.test(t);

  // never together
  if (people.length >= 2 && /\b(together|same shift|apart|separate|at the same time|with each other)\b/.test(t)) {
    return { ...d, type: "never_together", employeeIds: people.slice(0, 2), hard: true };
  }

  // rest between shifts
  const rest = t.match(/(\d+)\s*(?:hours?|hrs?|h)\s*(?:of\s+)?(?:rest|break|gap|off)\b/);
  if (rest && /\bbetween\b|\brest\b/.test(t)) {
    return { ...d, type: "min_rest_hours", hours: Number(rest[1]), employeeIds: people.slice(0, 1), ...(people.length ? {} : group ?? {}), hard: !soft };
  }

  // hours cap
  const hrs = t.match(/(?:max(?:imum)?|no more than|not more than|at most|up to|limit(?:ed)? to|cap(?:ped)? at)\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/)
    ?? t.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\s*(?:a|per)\s*week\s*(?:max|maximum|at most)/);
  if (hrs && (people.length || group)) {
    return { ...d, type: "max_hours", max: Number(hrs[1]), employeeIds: people.slice(0, 1), ...(people.length ? {} : group!), hard: !soft };
  }

  // preference
  if (soft && people.length) {
    const avoid = /\b(not|n't|avoid|off|fewer|less)\b/.test(t);
    return { ...d, type: "prefer", employeeIds: people.slice(0, 1), shift, day, avoid, weight: 3, hard: false };
  }

  // one person can't do a shift/day
  if (people.length === 1 && /\b(can't|cannot|can not|won't|isn't able|is not able|never|not available|unavailable|no)\b/.test(t)) {
    return { ...d, type: "unavailable", employeeIds: people, shift, day, hard: !soft };
  }

  // counts: "never put two new starters on closing", "no more than 2 ...", "at least one shift lead on every shift"
  if (group) {
    const atLeast = t.match(/\b(?:at least|minimum(?: of)?|always (?:have )?(?:at least )?)\s*(\d+|one|two|three|four|a|an)\b/);
    if (atLeast || /\balways\b/.test(t)) {
      return { ...d, type: "min_count", min: toNum(atLeast?.[1]) ?? 1, shift, day, ...group, hard: !soft };
    }
    const never = t.match(/\bnever (?:put|have|schedule|roster)?\s*(\d+|two|three|four)\b/);
    if (never) return { ...d, type: "max_count", max: Math.max(0, (toNum(never[1]) ?? 2) - 1), shift, day, ...group, hard: !soft };
    const most = t.match(/\b(?:no more than|not more than|at most|max(?:imum)?(?: of)?|only)\s*(\d+|one|two|three|four|a|an)\b/);
    if (most) return { ...d, type: "max_count", max: toNum(most[1]) ?? 1, shift, day, ...group, hard: !soft };
    if (/\b(no|never)\b/.test(t)) return { ...d, type: "max_count", max: 0, shift, day, ...group, hard: !soft };
  }

  return refuse(
    "The offline demo translator didn't recognise that. Try e.g. “Never put two new starters on closing”, “Sam can't work Sundays”, or add an Anthropic API key for full AI translation.",
  );
}
