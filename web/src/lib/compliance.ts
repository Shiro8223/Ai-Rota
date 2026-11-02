import { wageProblem } from "./pay";
import { addDays, isoDate } from "./time";
import type { Employee, Role } from "./types";

export interface ComplianceFlag { employeeId: string; name: string; severity: "error" | "warning"; kind: "wage" | "rtw" | "qualification"; message: string }

/**
 * Person-level compliance: minimum wage, right-to-work records and qualification expiry.
 * (Working-time rules are checked on the rota by the solver.)
 */
export function complianceFlags(staff: Employee[], roles: Pick<Role, "id" | "name" | "category" | "hourlyRate">[], today = isoDate(new Date())): ComplianceFlag[] {
  const soon = addDays(today, 30);
  const out: ComplianceFlag[] = [];
  for (const e of staff) {
    const first = e.name.split(" ")[0];
    const w = wageProblem(e, roles, today);
    if (w) out.push({ employeeId: e.id, name: e.name, severity: w.kind === "below" ? "error" : "warning", kind: "wage", message: w.message });
    if (!e.rightToWorkCheckedAt) out.push({ employeeId: e.id, name: e.name, severity: "warning", kind: "rtw", message: `${first} has no right-to-work check recorded` });
    else if (e.rightToWorkExpires && e.rightToWorkExpires < today) out.push({ employeeId: e.id, name: e.name, severity: "error", kind: "rtw", message: `${first}'s right to work expired on ${e.rightToWorkExpires}` });
    else if (e.rightToWorkExpires && e.rightToWorkExpires <= soon) out.push({ employeeId: e.id, name: e.name, severity: "warning", kind: "rtw", message: `${first}'s right to work expires on ${e.rightToWorkExpires}: recheck it` });
    for (const r of roles.filter((x) => x.category === "qualification" && (e.roleIds ?? []).includes(x.id))) {
      const exp = e.qualificationExpiry?.[r.id];
      if (exp && exp < today) out.push({ employeeId: e.id, name: e.name, severity: "error", kind: "qualification", message: `${first}'s ${r.name} expired on ${exp} (no longer counts on the rota)` });
      else if (exp && exp <= soon) out.push({ employeeId: e.id, name: e.name, severity: "warning", kind: "qualification", message: `${first}'s ${r.name} expires on ${exp}` });
    }
  }
  return out.sort((a, b) => (a.severity === b.severity ? a.name.localeCompare(b.name) : a.severity === "error" ? -1 : 1));
}
