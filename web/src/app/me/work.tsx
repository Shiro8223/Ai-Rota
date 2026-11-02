"use client";

import { useActionState, useEffect, useState } from "react";
import type { Dict } from "@/lib/i18n";
import type { PushSubscriptionJSON } from "@/lib/types";
import type { WorkState } from "./work-actions";

export function ClaimButton({ action, labels }: { action: (s: WorkState) => Promise<WorkState>; labels: Pick<Dict, "claim" | "checkingRules" | "claimed"> }) {
  const [state, run, pending] = useActionState<WorkState>(action, undefined);
  if (state?.ok) return <p className="text-sm font-medium text-emerald-700">{labels.claimed}</p>;
  return (
    <form action={run}>
      <button className="btn-primary w-full sm:w-auto" disabled={pending}>{pending ? labels.checkingRules : labels.claim}</button>
      {state?.error && (
        <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-800">
          {state.error}
          {state.reasons && <ul className="mt-1 list-disc pl-5">{state.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
        </div>
      )}
    </form>
  );
}

/** Ask for notification permission and register this device for web push. */
export function PushToggle({ vapidKey, save, label }: { vapidKey: string; save: (sub: PushSubscriptionJSON | null, endpoint?: string) => Promise<{ ok: boolean }>; label: string }) {
  const [state, setState] = useState<"unknown" | "on" | "off" | "unsupported">("unknown");
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => setState(s ? "on" : "off")).catch(() => setState("off"));
  }, []);
  if (state === "unsupported" || state === "unknown") return null;
  const toggle = async () => {
    const reg = await navigator.serviceWorker.ready;
    if (state === "on") {
      const s = await reg.pushManager.getSubscription();
      await s?.unsubscribe();
      await save(null, s?.endpoint);
      setState("off");
      return;
    }
    if ((await Notification.requestPermission()) !== "granted") return;
    const b64 = vapidKey.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (vapidKey.length % 4)) % 4);
    const key = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await save(sub.toJSON() as PushSubscriptionJSON);
    setState("on");
  };
  return (
    <button onClick={toggle} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-white/10 px-3 text-sm font-medium" aria-pressed={state === "on"}>
      {state === "on" ? `${label} ✓` : label}
    </button>
  );
}
