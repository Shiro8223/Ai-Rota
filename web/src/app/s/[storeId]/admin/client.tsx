"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { RolePicker, type RoleOption } from "@/components/role-picker";
import { COLOR_KEYS, SHIFT_COLORS } from "@/lib/colors";
import { PERMISSION_GROUPS, PERMISSION_PRESETS, PERMISSIONS, ROLE_CATEGORIES, type Permission, type RoleCategory } from "@/lib/roles";
import { applyPreset, deleteRole, inviteManager, saveRole, setFeature, setMemberRoles } from "./actions";

type Result = { ok: boolean; error?: string; info?: string };
const Msg = ({ r }: { r: Result | null }) => (r ? <span className={`text-sm ${r.ok ? "text-emerald-700" : "text-red-600"}`}>{r.ok ? r.info ?? "Saved." : r.error}</span> : null);

export interface RoleDraft { id: string | null; name: string; category: RoleCategory; color: string; description: string; permissions: Permission[]; system: string | null; people: number; hourlyRate: number | null }

export function RoleEditor({ storeId, role, onDoneHref }: { storeId: string; role: RoleDraft; onDoneHref: string }) {
  const router = useRouter();
  const [v, setV] = useState(role);
  const [res, setRes] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const togglePerm = (p: Permission) => setV({ ...v, permissions: v.permissions.includes(p) ? v.permissions.filter((x) => x !== p) : [...v.permissions, p] });
  const presetOn = PERMISSION_PRESETS.find((p) => p.permissions.length === v.permissions.length && p.permissions.every((x) => v.permissions.includes(x)))?.key;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="rname">Role name</label>
          <input id="rname" className="input" value={v.name} maxLength={40} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Front of House" />
        </div>
        <div>
          <label className="label" htmlFor="rcat">Type</label>
          <select id="rcat" className="input" value={v.category} disabled={!!v.system} onChange={(e) => setV({ ...v, category: e.target.value as RoleCategory })}>
            {(Object.keys(ROLE_CATEGORIES) as RoleCategory[]).map((c) => <option key={c} value={c}>{ROLE_CATEGORIES[c].label}</option>)}
          </select>
          <p className="mt-1 text-xs text-zinc-500">{v.system ? "Built-in role: its type is fixed." : ROLE_CATEGORIES[v.category].hint}</p>
        </div>
        <div>
          <label className="label" htmlFor="rrate">Default hourly pay (£, optional)</label>
          <input id="rrate" type="number" step="0.01" min={0} className="input" value={v.hourlyRate ?? ""} onChange={(e) => setV({ ...v, hourlyRate: e.target.value === "" ? null : +e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="rdesc">Description (optional)</label>
          <input id="rdesc" className="input" value={v.description} maxLength={160} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <span className="label">Colour</span>
          <div className="flex flex-wrap gap-2">
            {COLOR_KEYS.map((k) => (
              <button key={k} type="button" aria-label={SHIFT_COLORS[k].name} onClick={() => setV({ ...v, color: k })} className={`size-7 rounded-full ${SHIFT_COLORS[k].bar} ${v.color === k ? "ring-2 ring-zinc-900 ring-offset-2" : ""}`} />
            ))}
          </div>
        </div>
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="font-semibold">What this role can do</p>
            <p className="text-sm text-zinc-500">Everyone can always use the staff app for their own shifts. These add access to manager tools.</p>
          </div>
        </div>
        <div className="mb-4 grid gap-2 sm:grid-cols-4">
          {PERMISSION_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setV({ ...v, permissions: [...p.permissions] })}
              className={`rounded-xl border p-3 text-left transition ${presetOn === p.key ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "border-zinc-200 bg-white hover:border-zinc-300"}`}
            >
              <p className="text-sm font-semibold">{p.label}</p>
              <p className="mt-0.5 text-xs text-zinc-500">{p.hint}</p>
            </button>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {PERMISSION_GROUPS.map((g) => (
            <div key={g} className="rounded-xl border border-zinc-200 p-3">
              <p className="eyebrow mb-2">{g}</p>
              <div className="space-y-1">
                {(Object.keys(PERMISSIONS) as Permission[]).filter((p) => PERMISSIONS[p].group === g).map((p) => (
                  <label key={p} className="flex cursor-pointer gap-3 rounded-lg p-2 hover:bg-zinc-50">
                    <input type="checkbox" className="mt-0.5 size-4 accent-brand-600" checked={v.permissions.includes(p)} onChange={() => togglePerm(p)} />
                    <span className="text-sm">
                      <span className="font-medium">{PERMISSIONS[p].label}</span>
                      <span className="block text-xs text-zinc-500">{PERMISSIONS[p].hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-5">
        <button
          className="btn-primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await saveRole(storeId, v.id, { name: v.name, category: v.category, color: v.color, description: v.description, permissions: v.permissions, hourlyRate: v.hourlyRate });
              setRes(r);
              if (r.ok && !v.id && r.id) router.replace(`?tab=roles&edit=${r.id}`);
            })
          }
        >
          {pending ? "Saving…" : v.id ? "Save role" : "Create role"}
        </button>
        <a href={onDoneHref} className="btn-ghost">Done</a>
        {v.id && !v.system && (
          <button
            className="btn-ghost ml-auto text-red-600"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await deleteRole(storeId, v.id!);
                if (r.ok) router.replace(onDoneHref);
                else setRes(r);
              })
            }
          >
            Delete role{v.people ? ` (removes it from ${v.people} ${v.people === 1 ? "person" : "people"})` : ""}
          </button>
        )}
        <Msg r={res} />
      </div>
    </div>
  );
}

export function PresetApply({ storeId, presetKey, label }: { storeId: string; presetKey: string; label: string }) {
  const [res, setRes] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <button className="btn-secondary btn-sm w-full" disabled={pending} onClick={() => start(async () => setRes(await applyPreset(storeId, presetKey)))}>
        {pending ? "Adding…" : `Add ${label} roles`}
      </button>
      {res && <p className={`mt-2 text-xs ${res.ok ? "text-emerald-700" : "text-red-600"}`}>{res.info ?? res.error}</p>}
    </div>
  );
}

export function FeatureSwitch({ storeId, k, on, label, hint, lockedBy }: { storeId: string; k: string; on: boolean; label: string; hint: string; lockedBy?: string }) {
  const [value, setValue] = useState(on);
  const [pending, start] = useTransition();
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-3.5">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-zinc-500">{hint}</span>
        {lockedBy && <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-600"><Icon name="lock" className="size-3" />Set by {lockedBy} for every site</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        disabled={pending || !!lockedBy}
        onClick={() =>
          start(async () => {
            setValue(!value);
            const r = await setFeature(storeId, k, !value);
            if (!r.ok) setValue(value);
          })
        }
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${value ? "bg-brand-600" : "bg-zinc-300"}`}
      >
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${value ? "left-[22px]" : "left-0.5"}`} />
      </button>
    </label>
  );
}

export function InviteForm({ storeId, roles }: { storeId: string; roles: RoleOption[] }) {
  const [email, setEmail] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [res, setRes] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const ids = new FormData(e.currentTarget).getAll("roleIds").map(String);
        setRoleIds(ids);
        start(async () => {
          const r = await inviteManager(storeId, { email, roleIds: ids });
          setRes(r);
          if (r.ok) setEmail("");
        });
      }}
    >
      <div>
        <label className="label" htmlFor="inv-email">Email</label>
        <input id="inv-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="manager@yourrestaurant.co.uk" required />
      </div>
      <RolePicker key={res?.ok ? email : "form"} roles={roles.filter((r) => r.category === "access")} initial={roleIds} canGrantAccess />
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={pending}><Icon name="plus" className="size-4" />{pending ? "Inviting…" : "Invite"}</button>
        <Msg r={res} />
      </div>
    </form>
  );
}

export function MemberRoles({ storeId, memberId, roles, initial }: { storeId: string; memberId: string; roles: RoleOption[]; initial: string[] }) {
  const [res, setRes] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const ids = new FormData(e.currentTarget).getAll("roleIds").map(String);
        start(async () => setRes(await setMemberRoles(storeId, memberId, ids)));
      }}
    >
      <RolePicker roles={roles.filter((r) => r.category === "access")} initial={initial} canGrantAccess />
      <div className="flex items-center gap-3">
        <button className="btn-secondary btn-sm" disabled={pending}>{pending ? "Saving…" : "Save access"}</button>
        <Msg r={res} />
      </div>
    </form>
  );
}
