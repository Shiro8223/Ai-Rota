import type { Window } from "./types";

export const IMPORT_FIELDS = [
  ["name", "Name (or first + last below)", false],
  ["firstName", "First name", false],
  ["lastName", "Last name", false],
  ["role", "Role", false],
  ["startDate", "Start date", false],
  ["dateOfBirth", "Date of birth (only used to set under-18 and wage band; not stored)", false],
  ["phone", "Mobile", false],
  ["payrollId", "Payroll / employee ID", false],
  ["contractedHours", "Contracted hours", false],
  ["maxHoursPerWeek", "Max hours", false],
  ["isUnder18", "Under 18", false],
  ["email", "Email", false],
  ["mon", "Mon availability", false],
  ["tue", "Tue availability", false],
  ["wed", "Wed availability", false],
  ["thu", "Thu availability", false],
  ["fri", "Fri availability", false],
  ["sat", "Sat availability", false],
  ["sun", "Sun availability", false],
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number][0];

/** Guess which spreadsheet column feeds each field from its header. */
export function guessMapping(headers: string[]): Partial<Record<ImportField, string>> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const tests: Record<ImportField, RegExp> = {
    // Deputy and RotaCloud exports use "First Name"/"Last Name", "Display Name", "Mobile",
    // "Payroll ID"/"Employee ID", "Roles"/"Training", "Start Date", "Date of Birth".
    name: /^(full|display|preferred)?name$|^employee(name)?$|^staff(name)?$/,
    firstName: /^(first|given|fore)name$|^firstname/,
    lastName: /^(last|sur|family)name$|^surname$/,
    role: /^(roles?|position|positions|jobtitle|title|job|training|areas?|primaryrole|department)$/,
    startDate: /start|joined|hire|employmentdate/,
    dateOfBirth: /birth|dob/,
    phone: /mobile|phone|cell/,
    payrollId: /payroll|employeeid|employeeno|employeenumber|staffid|^ref(erence)?$/,
    contractedHours: /contract/,
    maxHoursPerWeek: /^max/,
    isUnder18: /under18|minor|u18|young/,
    email: /e?mail/,
    mon: /^mon(day)?/,
    tue: /^tue(s|sday)?/,
    wed: /^wed(nesday)?/,
    thu: /^thu(r|rs|rsday)?/,
    fri: /^fri(day)?/,
    sat: /^sat(urday)?/,
    sun: /^sun(day)?/,
  };
  const out: Partial<Record<ImportField, string>> = {};
  for (const [field] of IMPORT_FIELDS) {
    const h = headers.find((x) => tests[field].test(norm(x)) && !Object.values(out).includes(x));
    if (h) out[field] = h;
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "31/01/2025", "2025-01-31", Excel date serial, or a Date -> "2025-01-31". UK order assumed for slashes. */
export function parseDateCell(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (+m[2] > 12) return null;
    return `${y}-${pad(+m[2])}-${pad(+m[1])}`;
  }
  return null;
}

export function parseBool(v: unknown) {
  return /^(y|yes|true|1|x|✓)$/i.test(String(v ?? "").trim());
}

function parseTime(t: string): string | null {
  const m = t.trim().toLowerCase().match(/^(\d{1,2})(?::|\.)?(\d{2})?\s*(am|pm)?$/);
  if (!m) return null;
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (h > 24 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

/** "any", "off", "9-17", "4pm-11pm", "10:00-14:00, 18:00-23:00" -> windows. null = can't read it. */
export function parseAvailabilityCell(v: unknown): Window[] | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s || /^(off|no|n|none|-|x|unavailable|n\/a|not available)$/.test(s)) return [];
  if (/^(any|anytime|any time|all day|all|yes|y|open|flexible)$/.test(s)) return [{ from: "00:00", to: "24:00" }];
  const out: Window[] = [];
  for (const part of s.split(/[,;&]|\band\b/)) {
    if (!part.trim()) continue;
    const [a, b] = part.split(/\s*(?:-|–|to)\s*/);
    const from = a && parseTime(a);
    const to = b && parseTime(b);
    if (!from || !to) return null;
    out.push({ from, to });
  }
  return out;
}
