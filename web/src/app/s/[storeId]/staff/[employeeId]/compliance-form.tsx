"use client";

import { useActionState } from "react";
import { DateField } from "@/components/date-field";
import { AGE_BANDS } from "@/lib/pay";
import type { Employee } from "@/lib/types";

type State = { ok?: boolean; error?: string } | undefined;

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-xl border border-zinc-200 p-3.5 sm:p-4">
      <legend className="px-1 text-sm font-semibold text-zinc-800">{title}</legend>
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

/** Pay, minimum-wage band, right to work, 48h opt-out, qualification expiry and contact preferences. */
export function ComplianceForm({ action, employee, showPay, qualifications }: { action: (s: State, f: FormData) => Promise<State>; employee: Employee; showPay: boolean; qualifications: { id: string; name: string }[] }) {
  const [state, run, pending] = useActionState<State, FormData>(action, undefined);
  const n = employee.notify ?? { email: true, sms: false, push: true };
  return (
    <form action={run} className="space-y-4">
      <Group title="Pay">
        {showPay && (
          <div>
            <label className="label" htmlFor="c-rate">Hourly pay (£)</label>
            <input id="c-rate" name="hourlyRate" type="number" inputMode="decimal" step="0.01" min={0} className="input" defaultValue={employee.hourlyRate ?? ""} placeholder="Role default" />
          </div>
        )}
        <div>
          <label className="label" htmlFor="c-band">Age band (minimum wage)</label>
          <select id="c-band" name="ageBand" className="input" defaultValue={employee.ageBand ?? ""}>
            <option value="">Not set</option>
            {AGE_BANDS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="c-payroll">Payroll ID</label>
          <input id="c-payroll" name="payrollId" className="input" defaultValue={employee.payrollId ?? ""} maxLength={30} />
        </div>
      </Group>

      <Group title="Right to work">
        <DateField name="rightToWorkCheckedAt" label="Checked on" defaultValue={employee.rightToWorkCheckedAt} />
        <DateField name="rightToWorkExpires" label="Expires (if time-limited)" defaultValue={employee.rightToWorkExpires} />
      </Group>

      <Group title="Working time">
        <DateField name="optOut48SignedAt" label="48-hour opt-out signed" defaultValue={employee.optOut48SignedAt} />
      </Group>

      {qualifications.length > 0 && (
        <Group title="Qualifications">
          {qualifications.map((q) => (
            <DateField key={q.id} name={`qual:${q.id}`} label={`${q.name} expires`} defaultValue={employee.qualificationExpiry?.[q.id]} />
          ))}
        </Group>
      )}

      <Group title="Contact">
        <div>
          <label className="label" htmlFor="c-phone">Mobile (for SMS)</label>
          <input id="c-phone" name="phone" type="tel" className="input" defaultValue={employee.phone ?? ""} placeholder="+447…" />
        </div>
        <div>
          <span className="label">Notify them by</span>
          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1 text-sm">
            <label className="flex min-h-9 items-center gap-2"><input type="checkbox" name="notifyEmail" defaultChecked={n.email} className="size-4 accent-brand-600" />Email</label>
            <label className="flex min-h-9 items-center gap-2"><input type="checkbox" name="notifySms" defaultChecked={n.sms} className="size-4 accent-brand-600" />SMS</label>
            <label className="flex min-h-9 items-center gap-2"><input type="checkbox" name="notifyPush" defaultChecked={n.push} className="size-4 accent-brand-600" />App</label>
          </div>
        </div>
      </Group>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-sm text-emerald-700">Saved.</p>}
      <button className="btn-primary w-full sm:w-auto" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
    </form>
  );
}
