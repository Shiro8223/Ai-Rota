import { colorOf } from "@/lib/colors";
import type { Role } from "@/lib/types";
import { Icon } from "./icons";

export function RoleChip({ role }: { role: Pick<Role, "name" | "color" | "permissions"> }) {
  const c = colorOf(role.color);
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${c.chip}`}>
      <span className={`size-1.5 rounded-full ${c.dot}`} />
      {role.name}
      {role.permissions.length > 0 && <Icon name="shield" className="size-3 opacity-60" />}
    </span>
  );
}
