"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requireStore } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasFeature } from "@/lib/roles";
import { parseAvailabilityCell, parseBool, parseDateCell, type ImportField } from "@/lib/import-parse";
import { createEmployee, EmployeeInput, setUsualAvailability } from "@/lib/staff";
import { roleByName, storeRoles } from "@/lib/team";
import { anyWeek } from "@/lib/time";
import { DAYS, type WeekWindows } from "@/lib/types";

export interface PreviewRow {
  line: number;
  ok: boolean;
  errors: string[];
  name: string;
  role: string;
  startDate: string;
  contractedHours: number;
  maxHoursPerWeek: number;
  isUnder18: boolean;
  email: string;
  phone: string;
  payrollId: string;
  ageBand: "21+" | "18-20" | "16-17" | null;
  availability: WeekWindows | null;
}

/** Age on a date from a date of birth (the birth date itself is never stored). */
function ageOn(dob: string, on: string) {
  const [y, m, d] = dob.split("-").map(Number);
  const [Y, M, D] = on.split("-").map(Number);
  return Y - y - (M < m || (M === m && D < d) ? 1 : 0);
}

function convert(rows: Record<string, unknown>[], mapping: Partial<Record<ImportField, string>>): PreviewRow[] {
  const cell = (r: Record<string, unknown>, f: ImportField) => (mapping[f] ? r[mapping[f]!] : undefined);
  const hasDays = DAYS.some((d) => mapping[d]);
  return rows.slice(0, 500).map((r, i) => {
    const errors: string[] = [];
    const today = new Date().toISOString().slice(0, 10);
    const rawStart = cell(r, "startDate");
    const startDate = rawStart === undefined || rawStart === "" ? today : parseDateCell(rawStart);
    if (!startDate) errors.push("start date not recognised (use DD/MM/YYYY)");
    const rawDob = cell(r, "dateOfBirth");
    const dob = rawDob === undefined || rawDob === "" ? null : parseDateCell(rawDob);
    if (rawDob && !dob) errors.push("date of birth not recognised (use DD/MM/YYYY)");
    const age = dob ? ageOn(dob, today) : null;
    if (age !== null && (age < 13 || age > 100)) errors.push("date of birth looks wrong");
    const num = (f: ImportField, dflt: number) => {
      const raw = cell(r, f);
      if (raw === undefined || raw === "") return dflt;
      const n = Number(String(raw).replace(/[^\d.]/g, ""));
      if (!Number.isFinite(n)) errors.push(`${f} isn't a number`);
      return n;
    };
    let availability: WeekWindows | null = null;
    if (hasDays) {
      availability = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
      for (const d of DAYS) {
        const w = mapping[d] ? parseAvailabilityCell(cell(r, d)) : [];
        if (w === null) errors.push(`${d} availability "${String(cell(r, d))}" not understood (try "any", "off" or "16:00-23:00")`);
        else availability[d] = w;
      }
    }
    const full = String(cell(r, "name") ?? "").trim() || `${String(cell(r, "firstName") ?? "").trim()} ${String(cell(r, "lastName") ?? "").trim()}`.trim();
    if (!full) errors.push("no name");
    const row = {
      name: full,
      // Several roles in one cell ("Cook, Bar"): the first is their job here.
      role: String(cell(r, "role") ?? "").split(/[,;|/]/)[0].trim() || "Team member",
      startDate: startDate ?? "",
      contractedHours: num("contractedHours", 0),
      maxHoursPerWeek: num("maxHoursPerWeek", 40),
      isUnder18: age !== null ? age < 18 : parseBool(cell(r, "isUnder18")),
      email: String(cell(r, "email") ?? "").trim(),
    };
    const phone = String(cell(r, "phone") ?? "").replace(/[^\d+]/g, "");
    const extra = {
      phone: /^\+?\d{7,15}$/.test(phone) ? (phone.startsWith("0") ? `+44${phone.slice(1)}` : phone) : "",
      payrollId: String(cell(r, "payrollId") ?? "").trim().slice(0, 30),
      ageBand: age === null ? null : age >= 21 ? ("21+" as const) : age >= 18 ? ("18-20" as const) : ("16-17" as const),
    };
    const v = EmployeeInput.safeParse(row);
    if (!v.success) for (const issue of v.error.issues) errors.push(`${issue.path.join(".")}: ${issue.message}`);
    return { line: i + 2, ok: errors.length === 0, errors: [...new Set(errors)], ...row, ...extra, availability };
  });
}

export async function previewImport(storeId: string, rows: Record<string, unknown>[], mapping: Partial<Record<ImportField, string>>) {
  await requireStore(storeId, "staff.manage");
  if (!mapping.name && !mapping.firstName) return { error: "Map the Name column (or First name)." };
  return { rows: convert(rows, mapping) };
}

export async function runImport(storeId: string, rows: Record<string, unknown>[], mapping: Partial<Record<ImportField, string>>, defaultAny: boolean) {
  const { actor, store } = await requireStore(storeId, "staff.manage");
  if (!hasFeature(store.features, "csvImport")) return { error: "Spreadsheet import is switched off." };
  const converted = convert(rows, mapping);
  if (converted.some((r) => !r.ok)) return { error: "Fix the highlighted rows first." };
  const pins: { name: string; pin: string }[] = [];
  for (const r of converted) {
    // Role column -> job role (created if new); under-18 flag -> the Under 18 status role;
    // 35h+ contract -> Full-time, otherwise Part-time (when those roles exist).
    const roles = await storeRoles(storeId);
    const roleIds: string[] = [];
    if (r.role) roleIds.push((await roleByName(storeId, r.role)).id);
    if (r.isUnder18) {
      const u18 = roles.find((x) => x.system === "under18");
      if (u18) roleIds.push(u18.id);
    }
    const contract = roles.find((x) => x.category === "contract" && x.name.toLowerCase() === (r.contractedHours >= 35 ? "full-time" : "part-time"));
    if (contract) roleIds.push(contract.id);
    const input = EmployeeInput.parse({ ...r, roleIds });
    const { employee, pin } = await createEmployee(storeId, input);
    if (r.phone || r.payrollId || r.ageBand) await (await db()).update("employees", employee.id, { phone: r.phone || null, payrollId: r.payrollId || null, ageBand: r.ageBand });
    pins.push({ name: employee.name, pin });
    const av = r.availability ?? (defaultAny ? anyWeek() : null);
    if (av) await setUsualAvailability(storeId, employee.id, av, actor, true);
  }
  await audit(storeId, actor, "employee.imported", { count: pins.length });
  revalidatePath(`/s/${storeId}/staff`);
  return { pins };
}

export type PreviewResult = Awaited<ReturnType<typeof previewImport>>;
export type ImportResult = Awaited<ReturnType<typeof runImport>>;
