"use client";

import { useActionState } from "react";
import { dict, type Dict } from "@/lib/i18n";
import { managerEmailLogin, staffLogin, verifyEmailCode, type FormState } from "./actions";

type L = Pick<Dict, "workEmail" | "emailLink" | "storeCode" | "yourPin" | "seeMyShifts" | "signingIn">;
const EN = dict("en");

export function ManagerEmailForm({ labels = EN }: { labels?: L }) {
  const [state, send, pending] = useActionState<FormState, FormData>(managerEmailLogin, undefined);
  const [codeState, verify, verifying] = useActionState<FormState, FormData>(verifyEmailCode, undefined);
  const s = codeState ?? state;
  if (s?.step === "code") {
    return (
      <form action={verify} className="space-y-3">
        <p className="text-sm text-stone-600">{s.info ?? `We sent a code to ${s.email}.`}</p>
        <input type="hidden" name="email" value={s.email} />
        <div>
          <label className="label" htmlFor="code">6-digit code</label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" className="input" required />
        </div>
        {codeState?.error && <p className="text-sm text-red-600">{codeState.error}</p>}
        <button className="btn-primary w-full" disabled={verifying}>{verifying ? "Checking…" : "Sign in"}</button>
      </form>
    );
  }
  return (
    <form action={send} className="space-y-3">
      <div>
        <label className="label" htmlFor="email">{labels.workEmail}</label>
        <input id="email" name="email" type="email" autoComplete="email" className="input" required />
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button className="btn-primary w-full" disabled={pending}>{pending ? "…" : labels.emailLink}</button>
    </form>
  );
}

export function StaffForm({ labels = EN }: { labels?: L }) {
  const [state, send, pending] = useActionState<FormState, FormData>(staffLogin, undefined);
  return (
    <form action={send} className="space-y-3">
      <div>
        <label className="label" htmlFor="joinCode">{labels.storeCode}</label>
        <input id="joinCode" name="joinCode" className="input uppercase" autoCapitalize="characters" required />
      </div>
      <div>
        <label className="label" htmlFor="pin">{labels.yourPin}</label>
        <input id="pin" name="pin" type="password" inputMode="numeric" pattern="\d{4,6}" className="input" required />
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button className="btn-primary w-full" disabled={pending}>{pending ? labels.signingIn : labels.seeMyShifts}</button>
    </form>
  );
}
