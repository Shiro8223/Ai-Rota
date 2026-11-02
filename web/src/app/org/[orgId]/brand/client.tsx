"use client";

import { useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { PERMISSION_GROUPS, PERMISSION_PRESETS, PERMISSIONS, type Permission } from "@/lib/roles";
import type { HolidayPolicy } from "@/lib/types";
import { inviteAreaManager, pushBrandSetup, setBrandFeature, setBrandHoliday } from "../actions";

type Result = { ok: boolean; error?: string; info?: string };
const Msg = ({ r }: { r: Result | null }) => (r ? <p className={`text-sm ${r.ok ? "text-emerald-700" : "text-red-600"}`}>{r.ok ? r.info ?? "Saved." : r.error}</p> : null);

export function PushForm({ orgId, sites, items }: { orgId: string; sites: { id: string; name: string }[]; items: Record<string, string> }) {
  const [source, setSource] = useState(sites[0]?.id ?? "");
  const [targets, setTargets] = useState<string[]>([]);
  const [what, setWhat] = useState<string[]>(Object.keys(items));
  const [res, setRes] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className="label" htmlFor="src">Copy from</label>
          <select id="src" className="input" value={source} onChange={(e) => { setSource(e.target.value); setTargets(targets.filter((t) => t !== e.target.value)); }}>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <span className="label">To</span>
          <div className="space-y-1.5">
            {sites.filter((s) => s.id !== source).map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-600" checked={targets.includes(s.id)} onChange={() => toggle(targets, setTargets, s.id)} />{s.name}</label>
            ))}
          </div>
        </div>
        <div>
          <span className="label">What</span>
          <div className="space-y-1.5">
            {Object.entries(items).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-600" checked={what.includes(k)} onChange={() => toggle(what, setWhat, k)} />{label}</label>
            ))}
          </div>
        </div>
      </div>
      <p className="text-xs text-zinc-500">Roles are matched by name and updated or added, never removed. Rules that name a specific person aren&apos;t copied.</p>
      <button className="btn-primary" disabled={pending || !targets.length} onClick={() => start(async () => setRes(await pushBrandSetup(orgId, { sourceId: source, targetIds: targets, items: what })))}>
        {pending ? "Copying…" : `Copy to ${targets.length || "selected"} site${targets.length === 1 ? "" : "s"}`}
      </button>
      <Msg r={res} />
    </div>
  );
}

export function BrandFeatureRow({ orgId, k, label, hint, value, locked }: { orgId: string; k: string; label: string; hint: string; value: boolean; locked: boolean }) {
  const [v, setV] = useState(value);
  const [l, setL] = useState(locked);
  const [pending, start] = useTransition();
  const save = (nv: boolean, nl: boolean) => start(async () => { setV(nv); setL(nl); await setBrandFeature(orgId, k, nv, nl); });
  return (
    <div className="flex items-start gap-4 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-zinc-500">{hint}</p>
      </div>
      <button type="button" role="switch" aria-checked={v} aria-label={label} disabled={pending} onClick={() => save(!v, l)} className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition ${v ? "bg-brand-600" : "bg-zinc-300"}`}>
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${v ? "left-[22px]" : "left-0.5"}`} />
      </button>
      <button type="button" disabled={pending} onClick={() => save(v, !l)} className={`flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-semibold ring-1 ${l ? "bg-ink text-white ring-ink" : "bg-white text-zinc-500 ring-zinc-300"}`} aria-pressed={l} title={l ? "Sites can't change this" : "Sites can change this"}>
        <Icon name="lock" className="size-3.5" />{l ? "Locked" : "Lock"}
      </button>
    </div>
  );
}

export function BrandHolidayForm({ orgId, initial, locked }: { orgId: string; initial: HolidayPolicy; locked: boolean }) {
  const [p, setP] = useState(initial);
  const [l, setL] = useState(locked);
  const [res, setRes] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  const set = (x: Partial<HolidayPolicy>) => setP({ ...p, ...x });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div><label className="label">Allowance</label><input type="number" min={0} step={0.5} className="input" value={p.allowance} onChange={(e) => set({ allowance: +e.target.value })} /></div>
        <div>
          <label className="label">Measured in</label>
          <select className="input" value={p.unit} onChange={(e) => set({ unit: e.target.value as HolidayPolicy["unit"] })}><option value="days">Days</option><option value="hours">Hours</option></select>
        </div>
        <div>
          <label className="label">Refreshes every</label>
          <select className="input" value={p.period} onChange={(e) => set({ period: e.target.value as HolidayPolicy["period"] })}><option value="year">Year</option><option value="quarter">Quarter</option><option value="month">Month</option></select>
        </div>
        <div><label className="label">Year starts (month)</label><input type="number" min={1} max={12} className="input" value={p.startMonth} onChange={(e) => set({ startMonth: +e.target.value })} /></div>
      </div>
      <div className="flex flex-wrap items-center gap-5 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-brand-600" checked={p.proRata} onChange={(e) => set({ proRata: e.target.checked })} />Pro rata by contract hours</label>
        <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-brand-600" checked={l} onChange={(e) => setL(e.target.checked)} />Lock for every site (sites can still give individuals more)</label>
      </div>
      <button className="btn-primary btn-sm" disabled={pending} onClick={() => start(async () => setRes(await setBrandHoliday(orgId, p, l)))}>{pending ? "Saving…" : "Save brand allowance"}</button>
      <Msg r={res} />
    </div>
  );
}

export function AreaManagerForm({ orgId, sites }: { orgId: string; sites: { id: string; name: string }[] }) {
  const [email, setEmail] = useState("");
  const [perms, setPerms] = useState<Permission[]>(PERMISSION_PRESETS.find((p) => p.key === "manager")!.permissions);
  const [all, setAll] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [res, setRes] = useState<Result | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4">
      <div className="max-w-md"><label className="label" htmlFor="am-email">Email</label><input id="am-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="area.manager@yourgroup.co.uk" /></div>
      <div>
        <span className="label">Sites</span>
        <label className="mb-1.5 flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-600" checked={all} onChange={(e) => setAll(e.target.checked)} />Every site (including ones added later)</label>
        {!all && sites.map((s) => (
          <label key={s.id} className="ml-6 flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-600" checked={picked.includes(s.id)} onChange={() => setPicked(picked.includes(s.id) ? picked.filter((x) => x !== s.id) : [...picked, s.id])} />{s.name}</label>
        ))}
      </div>
      <div>
        <span className="label">Permissions at those sites</span>
        <div className="mb-2 flex flex-wrap gap-2">
          {PERMISSION_PRESETS.map((p) => <button key={p.key} type="button" className="btn-secondary btn-sm" onClick={() => setPerms([...p.permissions])}>{p.label}</button>)}
        </div>
        <div className="grid gap-x-6 gap-y-1 md:grid-cols-2">
          {PERMISSION_GROUPS.flatMap((g) => (Object.keys(PERMISSIONS) as Permission[]).filter((k) => PERMISSIONS[k].group === g)).map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand-600" checked={perms.includes(k)} onChange={() => setPerms(perms.includes(k) ? perms.filter((x) => x !== k) : [...perms, k])} />{PERMISSIONS[k].label}</label>
          ))}
        </div>
      </div>
      <button className="btn-primary" disabled={pending || !email} onClick={() => start(async () => { const r = await inviteAreaManager(orgId, { email, permissions: perms, storeIds: all ? null : picked }); setRes(r); if (r.ok) setEmail(""); })}>
        <Icon name="plus" className="size-4" />{pending ? "Inviting…" : "Invite area manager"}
      </button>
      <Msg r={res} />
    </div>
  );
}
