"use client";

import { useActionState, useState, useTransition } from "react";
import { Icon } from "@/components/icons";
import { amountFor } from "@/lib/holidays";
import { DateRangePicker } from "@/components/date-range-picker";
import { dict, fill, type Dict } from "@/lib/i18n";
import type { SwapState } from "./actions";

type L = Pick<Dict, "swap" | "postToBoard" | "noteForColleagues" | "posted" | "cancel" | "illTakeIt" | "checkingRules" | "offerSent">;
const EN = dict("en");

export function PostSwapForm({ action, labels = EN }: { action: (s: SwapState, f: FormData) => Promise<SwapState>; labels?: L }) {
  const [open, setOpen] = useState(false);
  const [state, run, pending] = useActionState<SwapState, FormData>(action, undefined);
  if (state?.ok) return <span className="text-xs font-medium text-emerald-700">{labels.posted}</span>;
  if (!open)
    return (
      <button className="btn-ghost btn-sm -mr-2 text-brand-700" onClick={() => setOpen(true)}>
        <Icon name="swap" className="size-4" />{labels.swap}
      </button>
    );
  return (
    <form action={run} className="mt-3 flex w-full flex-col gap-2 sm:flex-row">
      <input name="note" maxLength={200} placeholder={labels.noteForColleagues} className="input flex-1" />
      <div className="flex gap-2">
        <button type="button" className="btn-secondary flex-1" onClick={() => setOpen(false)}>{labels.cancel}</button>
        <button className="btn-primary flex-1" disabled={pending}>{pending ? "…" : labels.postToBoard}</button>
      </div>
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

export function OfferButton({ action, labels = EN }: { action: (s: SwapState) => Promise<SwapState>; labels?: L }) {
  const [state, run, pending] = useActionState<SwapState>(action, undefined);
  if (state?.ok) return <p className="text-sm font-medium text-emerald-700">{labels.offerSent}</p>;
  return (
    <form action={run}>
      <button className="btn-primary w-full sm:w-auto" disabled={pending}>{pending ? labels.checkingRules : labels.illTakeIt}</button>
      {state?.error && (
        <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-800">
          {state.error}
          {state.reasons && <ul className="mt-1 list-disc pl-5">{state.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
        </div>
      )}
    </form>
  );
}

type HL = Pick<Dict, "bookHoliday" | "fromDate" | "toDate" | "paidHoliday" | "unpaidHoliday" | "holidayNote" | "request" | "holidayUses" | "holidaySent" | "unitDays" | "unitHours" | "sending" | "pickDates" | "pickStart" | "pickEnd" | "clearDates" | "prevMonth" | "nextMonth">;

/** Holiday request: date range + paid/unpaid, previewing how much allowance it uses. */
export function HolidayForm({ action, contractedHours, unit, labels = EN as HL, locale = "en-GB" }: { action: (input: unknown) => Promise<{ ok: boolean; error?: string }>; contractedHours: number; unit: "days" | "hours"; labels?: HL; locale?: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [paid, setPaid] = useState(true);
  const [note, setNote] = useState("");
  const [res, setRes] = useState<{ ok: boolean; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const uses = from && to && to >= from && paid ? amountFor({ contractedHours }, unit, from, to) : 0;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await action({ startDate: from, endDate: to, paid, note });
          setRes(r);
          if (r.ok) { setFrom(""); setTo(""); setNote(""); }
        });
      }}
    >
      <DateRangePicker from={from} to={to} min={today} locale={locale} labels={labels} onChange={(f, t2) => { setFrom(f); setTo(t2); setRes(null); }} />
      <div className="grid grid-cols-2 rounded-md bg-zinc-100 p-1">
        {[true, false].map((v) => (
          <button key={String(v)} type="button" onClick={() => setPaid(v)} className={`min-h-9 rounded-md text-sm font-medium ${paid === v ? "bg-white shadow-[var(--shadow-card)]" : "text-zinc-600"}`}>
            {v ? labels.paidHoliday : labels.unpaidHoliday}
          </button>
        ))}
      </div>
      <input className="input" maxLength={120} placeholder={labels.holidayNote} value={note} onChange={(e) => setNote(e.target.value)} />
      {uses > 0 && <p className="text-sm text-zinc-600">{fill(labels.holidayUses, { n: uses, unit: unit === "days" ? labels.unitDays : labels.unitHours })}</p>}
      {res && <p className={`text-sm ${res.ok ? "text-emerald-700" : "text-red-600"}`}>{res.ok ? labels.holidaySent : res.error}</p>}
      <button className="btn-primary w-full" disabled={pending || !from || !to}>{pending ? labels.sending : labels.request}</button>
    </form>
  );
}

/** Accept / decline a change suggested for a shift starting within 24 hours. */
export function ChangeButtons({ action, labels }: { action: (accept: boolean) => Promise<{ ok: boolean; error?: string }>; labels: Pick<Dict, "accept" | "decline"> }) {
  const [res, setRes] = useState<{ ok: boolean; error?: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button className="btn-secondary w-full" disabled={pending} onClick={() => start(async () => setRes(await action(false)))}>{labels.decline}</button>
        <button className="btn-primary w-full" disabled={pending} onClick={() => start(async () => setRes(await action(true)))}><Icon name="check" className="size-4" />{labels.accept}</button>
      </div>
      {res && !res.ok && <p className="mt-2 text-sm text-red-700">{res.error}</p>}
    </div>
  );
}
