"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import type { AssistantAction, ChatTurn } from "@/lib/assistant";
import { addSuggestedRule, askAssistant, decideAssistantRule } from "./assistant-actions";

type Msg = ChatTurn & { actions?: AssistantAction[] };

const SUGGESTIONS = ["Who's below their contract hours?", "Who is working Saturday?", "Can Casey have this weekend off?", "Add a rule for this week: Sam can't work Friday"];

export function RotaAssistant({ storeId, week, weekLabel, canRules }: { storeId: string; week: string; weekLabel: string; canRules: boolean }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [decided, setDecided] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Don't return scrollIntoView's result: newer browsers return a Promise, which React rejects.
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, pending]);

  const send = (q: string) => {
    const question = q.trim();
    if (!question || pending) return;
    const history: Msg[] = [...msgs, { role: "user", text: question }];
    setMsgs(history);
    setText("");
    start(async () => {
      const r = await askAssistant(storeId, week, history.map(({ role, text }) => ({ role, text })));
      setMsgs([...history, { role: "assistant", text: r.reply, actions: r.actions }]);
    });
  };

  const ActionView = ({ a, i }: { a: AssistantAction; i: string }) => {
    if (a.kind === "rule") {
      const state = decided[a.ruleId];
      return (
        <div className="mt-2 rounded-md border border-brand-200 bg-white p-3 text-sm">
          <p className="eyebrow mb-1">{a.scope === "week" ? `Rule for w/c ${a.weekStart?.slice(8)}/${a.weekStart?.slice(5, 7)} only` : "Permanent rule"}</p>
          <p className="font-medium text-zinc-900">{a.summary}</p>
          {state ? (
            <p className={`mt-2 text-xs font-medium ${state === "confirmed" ? "text-emerald-700" : "text-zinc-500"}`}>{state === "confirmed" ? "Confirmed. Regenerate the rota to apply it." : state === "discarded" ? "Discarded." : state}</p>
          ) : (
            <div className="mt-2 flex gap-2">
              <button className="btn-primary btn-sm" disabled={!canRules} onClick={() => start(async () => { const r = await decideAssistantRule(storeId, a.ruleId, true); setDecided((d) => ({ ...d, [a.ruleId]: r.ok ? "confirmed" : r.error ?? "Couldn't confirm" })); })}>
                <Icon name="check" className="size-4" />Confirm
              </button>
              <button className="btn-ghost btn-sm" onClick={() => start(async () => { await decideAssistantRule(storeId, a.ruleId, false); setDecided((d) => ({ ...d, [a.ruleId]: "discarded" })); })}>Discard</button>
            </div>
          )}
        </div>
      );
    }
    const key = `s-${i}`;
    return decided[key] ? (
      <p className="mt-2 text-xs text-zinc-500">{decided[key]}</p>
    ) : (
      <button
        className="btn-secondary btn-sm mt-2"
        disabled={!canRules || pending}
        onClick={() =>
          start(async () => {
            const r = await addSuggestedRule(storeId, week, a.text, a.scope);
            if (r.ok && "action" in r) {
              setDecided((d) => ({ ...d, [key]: "Rule drafted below." }));
              setMsgs((m) => [...m, { role: "assistant", text: `Drafted: “${r.summary}”`, actions: [r.action] }]);
            } else setDecided((d) => ({ ...d, [key]: "error" in r ? r.error : "Couldn't add it." }));
          })
        }
      >
        <Icon name="plus" className="size-4" />{a.label}
      </button>
    );
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="no-print fixed right-4 bottom-24 z-30 flex h-12 items-center gap-2 rounded-lg bg-ink px-4 text-sm font-semibold text-white shadow-[var(--shadow-float)] hover:bg-zinc-800 md:bottom-6"
        aria-label="Open the rota assistant"
      >
        <Icon name="sparkles" className="size-5" />
        Assistant
      </button>

      {open && (
        <div className="no-print fixed inset-0 z-40 flex justify-end bg-black/20 md:bg-transparent" onClick={() => setOpen(false)}>
          <section
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-full flex-col border-l border-zinc-200 bg-zinc-50 shadow-[var(--shadow-float)] md:my-4 md:mr-4 md:h-[calc(100%-2rem)] md:w-[420px] md:rounded-lg md:border"
            aria-label="Rota assistant"
          >
            <header className="flex items-center gap-3 border-b border-zinc-200 bg-white px-4 py-3 md:rounded-t-lg">
              <span className="grid size-9 place-items-center rounded-md bg-brand-600 text-white"><Icon name="sparkles" className="size-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Rota assistant</p>
                <p className="truncate text-xs text-zinc-500">Week of {weekLabel}. Answers come from your live data.</p>
              </div>
              <button className="btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Close"><Icon name="x" className="size-5" /></button>
            </header>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {!msgs.length && (
                <div>
                  <p className="mb-3 text-sm text-zinc-600">Ask about this week, test time-off requests, or add rules for this week or for good. Rules wait for your confirmation.</p>
                  <div className="flex flex-col gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button key={s} onClick={() => send(s)} className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-left text-sm hover:border-brand-500">{s}</button>
                    ))}
                  </div>
                </div>
              )}
              {msgs.map((m, i) => (
                <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                  <div className={`max-w-[90%] rounded-lg px-3.5 py-2.5 text-sm whitespace-pre-line ${m.role === "user" ? "bg-brand-600 text-white" : "border border-zinc-200 bg-white text-zinc-800"}`}>
                    {m.text}
                    {m.actions?.map((a, n) => <ActionView key={n} a={a} i={`${i}-${n}`} />)}
                  </div>
                </div>
              ))}
              {pending && (
                <div className="flex items-center gap-2 text-sm text-zinc-500">
                  <span className="size-3 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />Checking the rota…
                </div>
              )}
              <div ref={end} />
            </div>

            <form
              className="flex gap-2 border-t border-zinc-200 bg-white p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] md:rounded-b-lg"
              onSubmit={(e) => {
                e.preventDefault();
                send(text);
              }}
            >
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. John wants this weekend off. Can we do it?" className="input flex-1" aria-label="Message" maxLength={1000} />
              <button className="btn-primary" disabled={pending || !text.trim()} aria-label="Send"><Icon name="right" className="size-4" /></button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
