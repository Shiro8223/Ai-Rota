"use client";

import { useActionState, useState, useTransition } from "react";
import { RolePicker, type RoleOption } from "@/components/role-picker";
import { DateField } from "@/components/date-field";
import type { Employee } from "@/lib/types";
import type { StaffFormState } from "./actions";

type Action = (state: StaffFormState, form: FormData) => Promise<StaffFormState>;

export function PinNotice({ state }: { state: StaffFormState }) {
  if (!state?.pin) return null;
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
      {state.name}&apos;s PIN is <strong className="font-mono text-lg tracking-[0.2em]">{state.pin}</strong>
      <p className="mt-0.5 text-xs text-emerald-800">Give it to them now. It won&apos;t be shown again.</p>
    </div>
  );
}

export function EmployeeForm({ action, employee, submit, roles, canGrantAccess }: { action: Action; employee?: Employee; submit: string; roles: RoleOption[]; canGrantAccess: boolean }) {
  const [state, run, pending] = useActionState<StaffFormState, FormData>(action, undefined);
  return (
    <form action={run} className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="col-span-2">
          <label className="label">Full name</label>
          <input name="name" className="input" defaultValue={employee?.name} required />
        </div>
        <div className="col-span-2 md:col-span-1">
          <DateField name="startDate" label="Start date" defaultValue={employee?.startDate ?? new Date().toISOString().slice(0, 10)} required />
        </div>
        <div className="col-span-2 md:col-span-1">
          <label className="label">Email (optional)</label>
          <input name="email" type="email" className="input" defaultValue={employee?.email ?? ""} />
        </div>
        <div>
          <label className="label">Contract hours / week</label>
          <input name="contractedHours" type="number" step="0.5" min={0} className="input" defaultValue={employee?.contractedHours ?? 20} required />
        </div>
        <div>
          <label className="label">Max hours / week</label>
          <input name="maxHoursPerWeek" type="number" step="0.5" min={1} className="input" defaultValue={employee?.maxHoursPerWeek ?? 40} required />
        </div>
      </div>
      <div className="rounded-xl border border-zinc-200 p-4">
        <p className="mb-3 text-sm font-semibold">Roles</p>
        <RolePicker roles={roles} initial={employee?.roleIds ?? []} canGrantAccess={canGrantAccess} />
      </div>
      {state?.error && <p className="text-sm whitespace-pre-line text-red-600">{state.error}</p>}
      {state?.ok && !state.pin && <p className="text-sm text-emerald-700">Saved.</p>}
      <PinNotice state={state} />
      <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : submit}</button>
    </form>
  );
}

export function ResetPinButton({ action }: { action: () => Promise<StaffFormState> }) {
  const [state, setState] = useState<StaffFormState>();
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <button className="btn-secondary" disabled={pending} onClick={() => start(async () => setState(await action()))}>{pending ? "…" : "Give a new PIN"}</button>
      <PinNotice state={state} />
    </div>
  );
}

export function ConfirmButton({ action, label, confirm, className = "btn-danger" }: { action: () => Promise<void>; label: string; confirm: string; className?: string }) {
  const [armed, setArmed] = useState(false);
  const [pending, start] = useTransition();
  if (!armed) return <button type="button" className={className} onClick={() => setArmed(true)}>{label}</button>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-sm">
      {confirm}
      <button type="button" className="btn-danger btn-sm" disabled={pending} onClick={() => start(action)}>{pending ? "…" : "Yes"}</button>
      <button type="button" className="btn-ghost btn-sm" onClick={() => setArmed(false)}>Cancel</button>
    </span>
  );
}
