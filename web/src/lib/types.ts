import type { Constraint } from "./constraints";
import type { FeatureKey, Features, Permission, RoleCategory, SystemRole } from "./roles";

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Day = (typeof DAYS)[number];
export const DAY_LABEL: Record<Day, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
export const DAY_NAME: Record<Day, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };

export interface Window { from: string; to: string }
export type WeekWindows = Record<Day, Window[]>;

export interface ShiftTemplate {
  id: string; // slug, e.g. "close"
  name: string;
  start: string; // "16:00"
  end: string; // "23:00" (earlier than start = runs past midnight)
  days: Day[];
  minStaff: number;
  maxStaff: number;
  /** Colour key from lib/colors.ts, used everywhere this shift type appears. */
  color?: string;
  /** Unpaid break inside the shift. Law: 20 min if over 6 working hours (30 min over 4.5h for under-18s). */
  breakMinutes?: number;
  /** Service roles every instance of this shift must have, e.g. 2 x Back of House. */
  requirements?: ShiftRequirement[];
}

export interface ShiftRequirement { roleId: string; min: number }

export type Plan = "trial" | "starter" | "pro";
export type BillingStatus = "trialing" | "active" | "past_due" | "cancelled";

/**
 * A franchise group: owns several sites. Its owner is the Account Primary for every site.
 * Brand defaults (features, holiday policy) apply to all sites; "locked" ones can't be
 * changed by a site.
 */
export interface Organisation {
  id: string;
  name: string;
  ownerId: string;
  features: Partial<Features>;
  lockedFeatures: FeatureKey[];
  holidayPolicy: HolidayPolicy | null;
  lockHolidayPolicy: boolean;
  /** Group billing: one subscription covering every site (volume pricing). */
  plan?: Plan;
  billingStatus?: BillingStatus;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  createdAt: string;
}

/** Group-level access: owner (everything, every site) or e.g. an area manager for some sites. */
export interface OrgMember {
  id: string;
  orgId: string;
  userId: string;
  email: string;
  role: "owner" | "manager";
  permissions: Permission[];
  /** null = every site in the group. */
  storeIds: string[] | null;
}

export interface Store {
  id: string;
  /** The franchise group this site belongs to (null = standalone). */
  orgId?: string | null;
  ownerId: string;
  name: string;
  timezone: string;
  openingHours: Record<Day, { open: string; close: string } | null>;
  shiftTemplates: ShiftTemplate[];
  joinCode: string;
  plan: Plan;
  billingStatus: BillingStatus;
  trialEndsAt: string;
  cancelledAt: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  /** Site-wide feature switches set by the Account Primary. Missing = on. */
  features: Partial<Features>;
  /** General holiday allowance; roles and individuals can override it. */
  holidayPolicy?: HolidayPolicy;
  /** Weekly labour budget in pounds (labour cost view). */
  weeklyLabourBudget?: number | null;
  /** Landline/mobile staff can ring from the app ("Call the store"). */
  phone?: string | null;
  createdAt: string;
}

/** A custom role. People hold several; their access is the union of their roles' permissions. */
export interface Role {
  id: string;
  storeId: string;
  name: string;
  category: RoleCategory;
  color: string;
  description: string;
  permissions: Permission[];
  /** Built-in meaning (under-18 law, student availability). Can be renamed, not deleted. */
  system: SystemRole | null;
  /** Holiday allowance for people with this role (overrides the store's). */
  holidayPolicy?: HolidayPolicy | null;
  /** Default hourly pay for this role (people can have their own). */
  hourlyRate?: number | null;
  createdAt: string;
}

/**
 * Someone who signs in with email. role "owner" = the Account Primary (always full access).
 * Others get their access from roleIds. userId is empty until an invited person first signs in.
 */
export interface StoreMember { id: string; storeId: string; userId: string; email: string; role: "owner" | "manager"; roleIds: string[] }

export interface Employee {
  id: string;
  storeId: string;
  name: string;
  startDate: string; // YYYY-MM-DD
  contractedHours: number;
  maxHoursPerWeek: number;
  /** Source of truth for job, access, contract and status. */
  roleIds: string[];
  /** Derived from roleIds and kept in sync by lib/team.ts: job role names, for display and the solver. */
  role: string;
  /** Derived: holds the Under 18 system role. */
  isUnder18: boolean;
  /** Derived: holds the Student system role. */
  isStudent: boolean;
  email: string | null;
  pinHash: string | null;
  /** Personal holiday allowance (overrides role and store). */
  holidayPolicy?: HolidayPolicy | null;
  /** Other sites in the group this person can also be rostered at (storeId = home site). */
  allowedStoreIds?: string[];
  /** Pay (opt-in; never sent to the AI). */
  hourlyRate?: number | null;
  /** For minimum-wage checks without storing a date of birth. */
  ageBand?: AgeBand | null;
  rightToWorkCheckedAt?: string | null;
  /** Visa / permission expiry, if time-limited. */
  rightToWorkExpires?: string | null;
  /** Signed 48-hour opt-out (Working Time Regulations). */
  optOut48SignedAt?: string | null;
  /** Expiry date per qualification role id (e.g. personal licence, food hygiene). */
  qualificationExpiry?: Record<string, string>;
  phone?: string | null;
  /** Their reference in your payroll software (exports). */
  payrollId?: string | null;
  notify?: { email: boolean; sms: boolean; push: boolean };
  pushSubscriptions?: PushSubscriptionJSON[];
  active: boolean;
  createdAt: string;
}

/**
 * kind "default" = the usual weekly pattern. kind "temporary" = a different pattern from
 * startWeek to endWeek (Mondays, inclusive) that falls back to the usual one by itself.
 * Changes requested by staff stay "pending" until a manager approves them; only
 * "approved" rows reach the solver.
 */
export interface Availability {
  id: string;
  storeId: string;
  employeeId: string;
  kind: "default" | "temporary";
  startWeek: string | null;
  endWeek: string | null;
  days: WeekWindows;
  status: "approved" | "pending" | "declined";
  note: string;
  requestedBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  updatedAt: string;
}

export interface Rule {
  id: string;
  storeId: string;
  originalText: string;
  /** null = permanent. A Monday = applies to that week only (e.g. set by the rota assistant). */
  weekStart?: string | null;
  constraint: Constraint;
  summary: string;
  status: "pending" | "confirmed";
  createdBy: string;
  createdAt: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
}

export interface Assignment { shiftId: string; employeeId: string }

/** Someone put on a shift outside their availability by hand. They must agree to it. */
export interface RotaException {
  shiftId: string;
  employeeId: string;
  status: "pending" | "agreed" | "declined";
  requestedBy: string;
  requestedAt: string;
  respondedAt: string | null;
}

export interface Issue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  shiftId?: string;
  employeeIds?: string[];
  ruleId?: string;
  /** Breaks UK working-time law: can never be approved anyway. */
  legal?: boolean;
  /** Legal problems and unmet contracts: publishing is blocked until fixed. */
  blocking?: boolean;
}

export interface Rota {
  id: string;
  storeId: string;
  weekStart: string;
  assignments: Assignment[];
  exceptions: RotaException[];
  /**
   * What staff currently see. Set when a rota is published and kept while a manager edits
   * an unlocked copy, so a published week never disappears from staff phones.
   */
  published?: Assignment[] | null;
  status: "draft" | "approved";
  version: number;
  approvedBy: string | null;
  approvedAt: string | null;
  generatedAt: string | null;
  updatedAt: string;
}

export interface RotaHistory { id: string; storeId: string; rotaId: string; version: number; status: Rota["status"]; assignments: Assignment[]; by: string; reason: string; at: string }

export type SwapStatus = "open" | "pending_approval" | "approved" | "declined" | "cancelled";
export interface SwapRequest {
  id: string;
  storeId: string;
  rotaId: string;
  weekStart: string;
  shiftId: string;
  fromEmployeeId: string;
  toEmployeeId: string | null;
  ruleCheck: { ok: boolean; issues: Issue[] } | null;
  status: SwapStatus;
  note: string;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
}

/** Holiday allowance: `allowance` days/hours per period, optionally pro rata by contract hours. */
export type AgeBand = "21+" | "18-20" | "16-17" | "apprentice";

export interface PushSubscriptionJSON { endpoint: string; keys: { p256dh: string; auth: string } }

export interface BreakPeriod { start: string; end: string | null }

/**
 * Clock-in/out record, made on the site's clock-in screen (kiosk) or added by a manager.
 * Times are wall-clock in the site timezone. `breakMinutes` = total of `breaks` (unpaid).
 * Approved entries feed the shift log, payroll and holiday accrual.
 */
export interface TimeEntry {
  id: string;
  storeId: string;
  employeeId: string;
  weekStart: string;
  shiftId: string | null;
  clockIn: string;
  clockOut: string | null;
  breaks: BreakPeriod[];
  breakMinutes: number;
  source: "kiosk" | "manual";
  status: "open" | "submitted" | "approved" | "rejected";
  note: string;
  approvedBy: string | null;
}

/** Sickness or other absence from a shift. */
export interface Absence {
  id: string;
  storeId: string;
  employeeId: string;
  date: string;
  rotaId: string | null;
  shiftId: string | null;
  reason: "sick" | "other";
  note: string;
  createdAt: string;
}

/** A shift offered to anyone eligible: after sickness, or unfilled. Manager approves the claim. */
export interface OpenShift {
  id: string;
  storeId: string;
  rotaId: string;
  weekStart: string;
  shiftId: string;
  reason: "sick" | "unfilled" | "extra";
  /** Who called in sick (their job decides who may cover), if any. */
  fromEmployeeId: string | null;
  /** Job role needed (by name, so it works across sister sites); null = anyone. */
  roleName: string | null;
  note: string;
  status: "open" | "claimed" | "filled" | "cancelled";
  claimedBy: string | null;
  createdBy: string;
  createdAt: string;
  decidedBy: string | null;
}

/** Saved week of assignments to reuse. */
export interface RotaTemplate { id: string; storeId: string; name: string; assignments: Assignment[]; createdBy: string; createdAt: string }

export interface HolidayPolicy {
  /** "fixed" = X per period; "accrual" = 12.07% of hours worked (irregular-hours / part-year workers). */
  mode?: "fixed" | "accrual";
  allowance: number;
  unit: "days" | "hours";
  period: "year" | "quarter" | "month";
  /** For yearly periods: the month the holiday year starts (1 = January). */
  startMonth: number;
  proRata: boolean;
  /** Full-time hours a week, used for pro rata. */
  fullTimeHours: number;
}

export interface HolidayRequest {
  id: string;
  storeId: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  paid: boolean;
  /** Days or hours taken from the allowance (0 when unpaid). */
  amount: number;
  unit: "days" | "hours";
  note: string;
  status: "pending" | "approved" | "declined" | "cancelled";
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
}

/**
 * A change to a published shift starting within 24 hours. It isn't applied until the
 * person affected accepts it.
 */
export interface ChangeRequest {
  id: string;
  storeId: string;
  rotaId: string;
  weekStart: string;
  shiftId: string;
  employeeId: string;
  kind: "add" | "remove";
  status: "pending" | "accepted" | "declined" | "expired";
  proposedBy: string;
  createdAt: string;
  respondedAt: string | null;
}

export interface AuditEntry { id: string; storeId: string; actor: string; action: string; details: Record<string, unknown>; at: string }
export interface AiCall { id: string; storeId: string; model: string; inputTokens: number; outputTokens: number; costUsd: number; ok: boolean; demo: boolean; at: string }
export interface EmailMsg { id: string; storeId: string; to: string; subject: string; body: string; sent: boolean; at: string }

export interface ShiftInstance {
  id: string; // "<templateId>:<day>"
  templateId: string;
  name: string;
  day: Day;
  start: string;
  end: string;
  /** Paid working minutes (clock time minus the unpaid break). */
  minutes: number;
  /** Clock minutes from start to end. */
  span: number;
  breakMinutes: number;
  minStaff: number;
  maxStaff: number;
  color: string;
  requirements: ShiftRequirement[];
}
