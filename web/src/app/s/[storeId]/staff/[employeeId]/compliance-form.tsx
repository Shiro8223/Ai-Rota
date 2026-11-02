"use client";

import { useActionState } from "react";
import { AGE_BANDS } from "@/lib/pay";
import type { Employee } from "@/lib/types";

type State = { ok?: boolean; error?: string } | undefined;

/** Pay, minimum-wage band, right to work, 48h opt-out, qualification expiry and contact preferences. */
export function ComplianceForm({ action, employee, showPay, qualifications }: { action: (s: State, f: FormData) => Promise<State>; employee: Employee; showPay: boolean; qualifications: { id: string; name: string }[] }) {
  const [state, run, pending] = useActionState<State, FormData>(action, undefined);
  const n = employee.notify ?? { email: true, sms: false, push: true };
  return (
    <form action={run} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {showPay && (
          <div>
            <label className="label">Hourly pay (£)</label>
            <input name="hourlyRate" type="number" step="0.01" min={0} className="input" defaultValue={employee.hourlyRate ?? ""} placeholder="Role default" />
          </div>
        )}
        <div>
          <label className="label">Age band (minimum wage)</label>
          <select name="ageBand" className="input" defaultValue={employee.ageBand ?? ""}>
            <option value="">Not set</option>
            {AGE_BANDS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Right to work checked</label>
          <input name="rightToWorkCheckedAt" type="date" className="input" defaultValue={employee.rightToWorkCheckedAt ?? ""} />
        </div>
        <div>
          <label className="label">Right to work expires (if time-limited)</label>
          <input name="rightToWorkExpires" type="date" className="input" defaultValue={employee.rightToWorkExpires ?? ""} />
        </div>
        <div>
          <label className="label">48-hour opt-out signed</label>
          <input name="optOut48SignedAt" type="date" className="input" defaultValue={employee.optOut48SignedAt ?? ""} />
        </div>
        <div>
          <label className="label">Payroll ID</label>
          <input name="payrollId" className="input" defaultValue={employee.payrollId ?? ""} maxLength={30} />
        </div>
        <div>
          <label className="label">Mobile (for SMS)</label>
          <input name="phone" type="tel" className="input" defaultValue={employee.phone ?? ""} placeholder="+447…" />
        </div>
      </div>
      {qualifications.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {qualifications.map((q) => (
            <div key={q.id}>
              <label className="label">{q.name} expires</label>
              <input name={`qual:${q.id}`} type="date" className="input" defaultValue={employee.qualificationExpiry?.[q.id] ?? ""} />
            </div>
          ))}
        </div>
      )}
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="label">Notify them by</legend>
        <label className="flex items-center gap-2"><input type="checkbox" name="notifyEmail" defaultChecked={n.email} className="size-4 accent-brand-600" />Email</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="notifySms" defaultChecked={n.sms} className="size-4 accent-brand-600" />SMS</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="notifyPush" defaultChecked={n.push} className="size-4 accent-brand-600" />App notifications</label>
      </fieldset>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p className="text-sm text-emerald-700">Saved.</p>}
      <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
    </form>
  );
}
