"use client";

import { useState } from "react";
import { colorOf } from "@/lib/colors";
import { ROLE_CATEGORIES, type RoleCategory } from "@/lib/roles";
import { Icon } from "./icons";

export interface RoleOption { id: string; name: string; category: RoleCategory; color: string; description: string; permissionCount: number }

/**
 * Pick several roles, grouped by type. Contract type is one-per-person. Access roles are
 * locked unless the signed-in person may grant access. Submits as repeated "roleIds" fields.
 */
export function RolePicker({ roles, initial, canGrantAccess, name = "roleIds" }: { roles: RoleOption[]; initial: string[]; canGrantAccess: boolean; name?: string }) {
  const [picked, setPicked] = useState<string[]>(initial);
  const toggle = (r: RoleOption) => {
    if (r.category === "access" && !canGrantAccess) return;
    setPicked((p) => {
      if (p.includes(r.id)) return p.filter((x) => x !== r.id);
      if (!ROLE_CATEGORIES[r.category].multi) return [...p.filter((x) => roles.find((o) => o.id === x)?.category !== r.category), r.id];
      return [...p, r.id];
    });
  };
  return (
    <div className="space-y-4">
      {picked.map((id) => <input key={id} type="hidden" name={name} value={id} />)}
      {(Object.keys(ROLE_CATEGORIES) as RoleCategory[]).map((cat) => {
        const list = roles.filter((r) => r.category === cat);
        if (!list.length) return null;
        const locked = cat === "access" && !canGrantAccess;
        return (
          <div key={cat}>
            <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-zinc-700">
              {ROLE_CATEGORIES[cat].label}
              {!ROLE_CATEGORIES[cat].multi && <span className="text-xs font-normal text-zinc-400">(pick one)</span>}
              {locked && <span className="flex items-center gap-1 text-xs font-normal text-zinc-400"><Icon name="lock" className="size-3" />Only role admins can change</span>}
            </p>
            <div className="flex flex-wrap gap-2">
              {list.map((r) => {
                const on = picked.includes(r.id);
                const c = colorOf(r.color);
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => toggle(r)}
                    disabled={locked}
                    title={r.description || undefined}
                    aria-pressed={on}
                    className={`flex min-h-9 items-center gap-2 rounded-md border px-3 text-sm transition ${on ? `${c.chip} border-transparent font-medium ring-1` : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300"} ${locked ? "cursor-not-allowed opacity-60" : ""}`}
                  >
                    <span className={`size-2 rounded-full ${on ? c.dot : "bg-zinc-300"}`} />
                    {r.name}
                    {r.permissionCount > 0 && <Icon name="shield" className="size-3.5 opacity-60" />}
                    {on && <Icon name="check" className="size-3.5" />}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
