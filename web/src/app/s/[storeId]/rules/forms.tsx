"use client";

import { useActionState, useRef, useState } from "react";
import type { RuleFormState } from "./actions";

type Action = (state: RuleFormState, form: FormData) => Promise<RuleFormState>;

const EXAMPLES = [
  "Never put two new starters on closing",
  "At least one cook on every shift",
  "Harry can't work Fridays",
  "Under 18s no more than 12 hours a week",
  "Ben would rather not close on Saturdays",
];

export function RuleBox({ action, initial = "", compact = false }: { action: Action; initial?: string; compact?: boolean }) {
  const ref = useRef<HTMLFormElement>(null);
  const [text, setText] = useState(initial);
  const [state, run, pending] = useActionState<RuleFormState, FormData>(async (s, f) => {
    const r = await action(s, f);
    if (r?.ok && !initial) setText("");
    return r;
  }, undefined);
  return (
    <form ref={ref} action={run} className="space-y-2">
      <textarea
        name="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={compact ? 2 : 3}
        maxLength={500}
        placeholder="e.g. Never put two new starters on closing"
        className="input"
        required
      />
      {!compact && (
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" className="rounded-md bg-stone-100 px-2.5 py-1 text-xs text-stone-600 hover:bg-stone-200" onClick={() => setText(ex)}>
              {ex}
            </button>
          ))}
        </div>
      )}
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button className="btn-primary" disabled={pending || !text.trim()}>{pending ? "Reading your rule…" : compact ? "Re-translate" : "Translate rule"}</button>
    </form>
  );
}
