/**
 * Roles, permissions, feature toggles and their presets. Pure data + helpers (no server
 * imports) so both pages and client components can use them.
 */
import type { ShiftColor } from "./colors";

// ------------------------------------------------------------------ permissions

export const PERMISSIONS = {
  "rota.view": { group: "Rota", label: "See the full team rota", hint: "Read-only access to every week's rota." },
  "rota.edit": { group: "Rota", label: "Build and edit draft rotas", hint: "Generate, drag people around, save drafts." },
  "rota.publish": { group: "Rota", label: "Publish and unlock rotas", hint: "Make a rota live for staff, or reopen it." },
  "approvals.swaps": { group: "Approvals", label: "Approve shift swaps", hint: "Accept or decline swaps between staff." },
  "approvals.availability": { group: "Approvals", label: "Approve availability changes", hint: "Usual and temporary availability requests." },
  "approvals.holiday": { group: "Approvals", label: "Approve holiday", hint: "Accept or decline holiday requests." },
  "timesheets.approve": { group: "Approvals", label: "Shift log & clock-in screen", hint: "Run the clock-in screen, check clock-in, break and clock-out times against the rota, edit them and approve them for payroll." },
  "pay.view": { group: "Team", label: "See and set pay", hint: "Pay rates, labour cost, minimum wage checks and payroll export." },
  "reports.view": { group: "Account", label: "See reports", hint: "Hours, overtime, fairness, absence and holiday reports." },
  "staff.view": { group: "Team", label: "See staff details", hint: "Staff list, availability and roles." },
  "staff.manage": { group: "Team", label: "Add, edit and remove staff", hint: "Details, PINs, availability, imports and non-access roles." },
  "rules.manage": { group: "Setup", label: "Manage scheduling rules", hint: "Add, confirm and delete rules." },
  "shifts.manage": { group: "Setup", label: "Manage shifts and opening hours", hint: "Shift types, times, staffing levels, colours." },
  "account.billing": { group: "Account", label: "Billing and data", hint: "Subscription, data export and the email outbox." },
  "account.admin": { group: "Account", label: "Roles, access and features", hint: "Create roles, grant access, switch features on and off." },
} as const;
export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];
export const PERMISSION_GROUPS = [...new Set(Object.values(PERMISSIONS).map((p) => p.group))];

/** Quick-fill sets for the permission editor. */
export const PERMISSION_PRESETS: { key: string; label: string; hint: string; permissions: Permission[] }[] = [
  { key: "none", label: "No access", hint: "Staff app only: own shifts, swaps, availability.", permissions: [] },
  { key: "supervisor", label: "Supervisor", hint: "Sees the rota and approves swaps.", permissions: ["rota.view", "approvals.swaps", "staff.view"] },
  {
    key: "manager",
    label: "Manager",
    hint: "Runs the rota day to day.",
    permissions: ["rota.view", "rota.edit", "rota.publish", "approvals.swaps", "approvals.availability", "approvals.holiday", "timesheets.approve", "staff.view", "staff.manage", "rules.manage", "shifts.manage", "reports.view"],
  },
  { key: "full", label: "Full access", hint: "Everything, including roles and billing.", permissions: [...ALL_PERMISSIONS] },
];

/** Pages a person with any of these can open in "manager tools". */
export const MANAGER_TOOL_PERMISSIONS: Permission[] = ALL_PERMISSIONS;

// ------------------------------------------------------------------ roles

export const ROLE_CATEGORIES = {
  job: { label: "Job / department", hint: "What they do. Swaps match on these, and rules can target them.", multi: true },
  access: { label: "Access level", hint: "What they can see and do in the app.", multi: true },
  contract: { label: "Contract type", hint: "One per person.", multi: false },
  qualification: { label: "Qualification", hint: "Certificates with an expiry date per person. Shift types can require them; expired ones don't count.", multi: true },
  status: { label: "Status", hint: "Under 18 applies young-worker law. Student unlocks term-time availability.", multi: true },
} as const;
export type RoleCategory = keyof typeof ROLE_CATEGORIES;

/** Roles with built-in meaning. They can be renamed but not deleted. */
export const SYSTEM_ROLES = {
  under18: { name: "Under 18", category: "status", color: "amber", description: "Max 8h a day and 40h a week, nothing 22:00–06:00, 12h rest, 48h weekly break." },
  student: { name: "Student", category: "status", color: "violet", description: "Can request term-time or exam availability that resets on its own." },
} as const;
export type SystemRole = keyof typeof SYSTEM_ROLES;

export interface RoleSeed { name: string; category: RoleCategory; color: ShiftColor; permissions: Permission[]; description?: string; system?: SystemRole }

const perm = (key: string) => PERMISSION_PRESETS.find((p) => p.key === key)!.permissions;
const statusRoles: RoleSeed[] = (Object.keys(SYSTEM_ROLES) as SystemRole[]).map((k) => ({ ...SYSTEM_ROLES[k], category: "status", permissions: [], system: k }));
const qualificationRoles: RoleSeed[] = [
  { name: "Personal Licence Holder", category: "qualification", color: "rose", permissions: [], description: "Licensing Act 2003: needed to authorise alcohol sales." },
  { name: "Food Hygiene L2", category: "qualification", color: "emerald", permissions: [] },
  { name: "First Aider", category: "qualification", color: "teal", permissions: [] },
];
const contractRoles: RoleSeed[] = [
  { name: "Full-time", category: "contract", color: "teal", permissions: [] },
  { name: "Part-time", category: "contract", color: "sky", permissions: [] },
];

export const ROLE_PRESETS: { key: string; label: string; hint: string; roles: RoleSeed[] }[] = [
  {
    key: "restaurant",
    label: "Restaurant",
    hint: "Front and back of house with shift leads.",
    roles: [
      { name: "Manager", category: "access", color: "indigo", permissions: perm("manager"), description: "Runs the rota day to day." },
      { name: "Shift Lead", category: "access", color: "violet", permissions: perm("supervisor"), description: "Leads a shift, approves swaps." },
      { name: "Front of House", category: "job", color: "sky", permissions: [] },
      { name: "Back of House", category: "job", color: "orange", permissions: [] },
      { name: "Bar", category: "job", color: "rose", permissions: [] },
      ...contractRoles,
      ...statusRoles,
      ...qualificationRoles,
    ],
  },
  {
    key: "cafe",
    label: "Café",
    hint: "Small team, baristas and kitchen.",
    roles: [
      { name: "Manager", category: "access", color: "indigo", permissions: perm("manager") },
      { name: "Supervisor", category: "access", color: "violet", permissions: perm("supervisor") },
      { name: "Barista", category: "job", color: "amber", permissions: [] },
      { name: "Kitchen", category: "job", color: "orange", permissions: [] },
      ...contractRoles,
      ...statusRoles,
    ],
  },
  {
    key: "bar",
    label: "Bar & pub",
    hint: "Bar, floor and kitchen, with supervisors.",
    roles: [
      { name: "Manager", category: "access", color: "indigo", permissions: perm("manager") },
      { name: "Supervisor", category: "access", color: "violet", permissions: perm("supervisor") },
      { name: "Bar Staff", category: "job", color: "rose", permissions: [] },
      { name: "Floor", category: "job", color: "sky", permissions: [] },
      { name: "Kitchen", category: "job", color: "orange", permissions: [] },
      { name: "Door", category: "job", color: "emerald", permissions: [] },
      ...contractRoles,
      ...statusRoles,
      ...qualificationRoles,
    ],
  },
];

// ------------------------------------------------------------------ features

export const FEATURES = {
  swaps: { group: "Staff app", label: "Shift swaps", hint: "Staff post shifts they can't make and colleagues offer to cover. You approve every swap." },
  roleSwaps: { group: "Staff app", label: "Swap only within the same job", hint: "A Back of House shift only goes to Back of House staff." },
  staffAvailability: { group: "Staff app", label: "Staff edit their own availability", hint: "Changes are sent to you for approval." },
  temporaryAvailability: { group: "Staff app", label: "Temporary availability", hint: "Term time, exams or holidays for a set number of weeks, resetting on its own." },
  clockIn: { group: "Staff app", label: "Clock in & shift log", hint: "Staff clock in, take breaks and clock out on a shared screen with their PIN; you approve the shift log for payroll." },
  openShifts: { group: "Staff app", label: "Open shifts & calling in sick", hint: "Unfilled or sick-cover shifts offered to eligible staff; you approve who takes them." },
  reminders: { group: "Notifications", label: "Shift reminders", hint: "Reminder the evening before each shift (push, SMS or email)." },
  labourCost: { group: "Scheduling", label: "Labour cost & budget", hint: "Pay rates, weekly labour cost against budget, minimum wage checks." },
  holidays: { group: "Staff app", label: "Holiday booking", hint: "Staff request paid or unpaid holiday against their allowance; you approve it." },
  outOfHours: { group: "Scheduling", label: "Ask staff to work outside availability", hint: "Add someone by hand outside their hours. They must agree." },
  dayView: { group: "Scheduling", label: "Day-by-hour view", hint: "Hourly timeline of each day, coloured by shift type." },
  print: { group: "Scheduling", label: "Printable A4 rota", hint: "A print-ready rota for the staff room wall." },
  aiRules: { group: "Automation", label: "Plain-English rules", hint: "Type rules as sentences; AI turns them into rota rules." },
  assistant: { group: "Automation", label: "Rota assistant", hint: "Chat on the rota page: ask what-if questions and add rules for this week or for good." },
  csvImport: { group: "Automation", label: "Spreadsheet import", hint: "Import staff from CSV or Excel." },
  emails: { group: "Notifications", label: "Email notifications", hint: "Swap decisions, availability decisions and out-of-hours asks. Off = in-app only." },
} as const;
export type FeatureKey = keyof typeof FEATURES;
export type Features = Record<FeatureKey, boolean>;
export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];
export const FEATURE_GROUPS = [...new Set(Object.values(FEATURES).map((f) => f.group))];

const all = (on: boolean) => Object.fromEntries(FEATURE_KEYS.map((k) => [k, on])) as Features;
export const FEATURE_PRESETS: { key: string; label: string; hint: string; features: Features }[] = [
  { key: "standard", label: "Standard", hint: "Everything on. Recommended.", features: all(true) },
  { key: "essentials", label: "Essentials", hint: "The core rota and swaps, nothing extra to learn.", features: { ...all(true), temporaryAvailability: false, outOfHours: false, dayView: false, csvImport: false } },
  { key: "managerLed", label: "Manager-led", hint: "Managers set everything; staff just see their shifts.", features: { ...all(true), swaps: false, staffAvailability: false, temporaryAvailability: false } },
];
export const DEFAULT_FEATURES: Features = FEATURE_PRESETS[0].features;

/** Old stores have no feature map: anything missing counts as on. */
export const hasFeature = (features: Partial<Features> | undefined, key: FeatureKey) => features?.[key] !== false;

// ------------------------------------------------------------------ pure helpers (used by seed and server code)

type RoleLike = { id: string; name: string; category: RoleCategory; system: SystemRole | null };

/** Fields on Employee derived from their roles: display/job string and the two legal/status flags. */
export function derivedFields(roleIds: string[], roles: RoleLike[]) {
  const mine = roles.filter((r) => roleIds.includes(r.id));
  const access = mine.filter((r) => r.category === "access").map((r) => r.name);
  const jobs = mine.filter((r) => r.category === "job").map((r) => r.name);
  return {
    role: [...access, ...jobs].join(" · ") || "Team member",
    isUnder18: mine.some((r) => r.system === "under18"),
    isStudent: mine.some((r) => r.system === "student"),
  };
}
