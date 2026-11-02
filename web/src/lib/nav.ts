import type { IconName } from "@/components/icons";
import type { Permission } from "./roles";

/** Which manager-tool sections a set of permissions opens. Order = nav order. */
const SECTIONS: { seg: "rota" | "approvals" | "timesheets" | "staff" | "reports" | "rules" | "setup" | "admin" | "settings"; any: Permission[] }[] = [
  { seg: "rota", any: ["rota.view", "rota.edit", "rota.publish"] },
  { seg: "approvals", any: ["approvals.swaps", "approvals.availability", "approvals.holiday"] },
  { seg: "timesheets", any: ["timesheets.approve"] },
  { seg: "staff", any: ["staff.view", "staff.manage"] },
  { seg: "reports", any: ["reports.view"] },
  { seg: "rules", any: ["rules.manage"] },
  { seg: "setup", any: ["shifts.manage"] },
  { seg: "admin", any: ["account.admin"] },
  { seg: "settings", any: ["account.billing", "account.admin"] },
];

export function allowedSections(perms: Set<Permission>) {
  return SECTIONS.filter((s) => s.any.some((p) => perms.has(p))).map((s) => s.seg);
}

export function homeSection(perms: Set<Permission>) {
  return allowedSections(perms)[0] ?? null;
}

export const NAV = [
  { seg: "rota", label: "Rota", icon: "calendar" },
  { seg: "approvals", label: "Approvals", icon: "inbox" },
  { seg: "timesheets", label: "Shift log", icon: "clock" },
  { seg: "staff", label: "Staff", icon: "users" },
  { seg: "reports", label: "Reports", icon: "bars" },
  { seg: "rules", label: "Rules", icon: "sparkles" },
  { seg: "setup", label: "Shifts", icon: "grid" },
  { seg: "admin", label: "Admin", icon: "shield" },
  { seg: "settings", label: "Settings", icon: "settings" },
] as const satisfies readonly { seg: string; label: string; icon: IconName }[];
export type NavSeg = (typeof NAV)[number]["seg"];
