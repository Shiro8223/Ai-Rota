"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Icon, type IconName } from "@/components/icons";
import { LanguagePicker } from "@/components/language-picker";
import { fill, type Dict, type Lang } from "@/lib/i18n";
import type { KioskAction, KioskDetail, KioskError, KioskPerson, KioskResult, KioskStatus } from "@/lib/timesheets";
import { act, backToManager, exitKiosk, lookup, refreshBoard } from "./actions";

type Filter = "upcoming" | "working" | "onBreak";
const FILTERS: { key: Filter; label: (t: Dict) => string; icon: IconName; on: string; dot: string }[] = [
  { key: "upcoming", label: (t) => t.kUpcoming, icon: "clock", on: "bg-sky-600 text-white border-sky-600", dot: "bg-sky-500" },
  { key: "working", label: (t) => t.kWorking, icon: "check", on: "bg-brand-600 text-white border-brand-600", dot: "bg-brand-500" },
  { key: "onBreak", label: (t) => t.kOnBreak, icon: "coffee", on: "bg-amber-500 text-white border-amber-500", dot: "bg-amber-500" },
];
const PILL: Record<KioskStatus, string> = {
  upcoming: "bg-sky-50 text-sky-700 ring-sky-200",
  working: "bg-brand-50 text-brand-700 ring-brand-200",
  onBreak: "bg-amber-50 text-amber-800 ring-amber-200",
  done: "bg-zinc-100 text-zinc-500 ring-zinc-200",
  off: "",
};
const AVATAR = ["bg-brand-100 text-brand-700", "bg-sky-100 text-sky-700", "bg-violet-100 text-violet-700", "bg-amber-100 text-amber-800", "bg-rose-100 text-rose-700", "bg-teal-100 text-teal-700"];
const avatarOf = (name: string) => AVATAR[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR.length];
const initials = (name: string) => name.split(" ").map((w) => w[0]).slice(0, 2).join("");
const BUTTON: Record<KioskAction, { cls: string; icon: IconName }> = {
  in: { cls: "bg-brand-600 hover:bg-brand-700 text-white shadow-brand-600/30", icon: "clock" },
  breakStart: { cls: "bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/30", icon: "coffee" },
  breakEnd: { cls: "bg-brand-600 hover:bg-brand-700 text-white shadow-brand-600/30", icon: "check" },
  out: { cls: "bg-brand-900 hover:bg-ink text-white shadow-brand-900/30", icon: "logout" },
};
const actionLabel = (t: Dict, a: KioskAction) => ({ in: t.kClockIn, breakStart: t.kTakeBreak, breakEnd: t.kEndBreak, out: t.kClockOut })[a];
const errorText = (t: Dict, e: KioskError | string) =>
  ({ pin: t.kErrPin, locked: t.kErrLocked, alreadyIn: t.kErrAlreadyIn, notIn: t.kErrNotIn, onBreak: t.kErrOnBreak, notOnBreak: t.kErrNotOnBreak, otherSite: t.kErrOtherSite } as Record<string, string>)[e] ?? t.kErrGeneric;
const IDLE_MS = 30_000; // back to the list if someone walks away mid-way
const RESULT_MS = 8_000;

type View = { step: "list" } | { step: "pin"; person: KioskPerson } | { step: "detail"; person: KioskPerson; pin: string; detail: KioskDetail } | { step: "result"; result: KioskResult };

export function Kiosk({ storeId, storeName, timeZone, initial, lang, t, demo }: { storeId: string; storeName: string; timeZone: string; initial: KioskPerson[]; lang: Lang; t: Dict; demo: boolean }) {
  const [people, setPeople] = useState(initial);
  const [view, setView] = useState<View>({ step: "list" });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [now, setNow] = useState(() => new Date());
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const min = (n: number) => fill(t.kMin, { n });
  const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : min(m));

  const home = useCallback(() => {
    setView({ step: "list" });
    setPin("");
    setError(null);
    setQuery("");
    refreshBoard(storeId).then(setPeople).catch(() => {});
  }, [storeId]);

  // Clock, list refresh, and the walk-away timer.
  useEffect(() => {
    const c = setInterval(() => setNow(new Date()), 1000);
    const r = setInterval(() => view.step === "list" && refreshBoard(storeId).then(setPeople).catch(() => {}), 30_000);
    return () => {
      clearInterval(c);
      clearInterval(r);
    };
  }, [storeId, view.step]);
  useEffect(() => {
    if (idle.current) clearTimeout(idle.current);
    if (view.step === "list") return;
    idle.current = setTimeout(home, view.step === "result" ? RESULT_MS : IDLE_MS);
    return () => {
      if (idle.current) clearTimeout(idle.current);
    };
  }, [view, pin, home]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((p) => (!q || p.name.toLowerCase().includes(q)) && (!filter || p.status === filter));
  }, [people, query, filter]);
  const count = (f: Filter) => people.filter((p) => p.status === f).length;

  const press = (digit: string) => {
    if (view.step !== "pin" || busy) return;
    setError(null);
    const next = (pin + digit).slice(0, 4);
    setPin(next);
    if (next.length === 4) {
      start(async () => {
        const r = await lookup(storeId, view.person.id, next);
        if (r.ok) setView({ step: "detail", person: view.person, pin: next, detail: r.detail });
        else {
          setError(errorText(t, r.error));
          setPin("");
        }
      });
    }
  };
  const run = (a: KioskAction) => {
    if (view.step !== "detail") return;
    start(async () => {
      const r = await act(storeId, view.person.id, view.pin, a);
      if (r.ok) setView({ step: "result", result: r.result });
      else setError(errorText(t, r.error));
    });
  };

  const hour = +now.toLocaleTimeString("en-GB", { hour: "2-digit", hour12: false, timeZone });
  const greeting = hour < 12 ? t.kMorning : hour < 18 ? t.kAfternoon : t.kEvening;
  const locale = lang === "en" ? "en-GB" : lang;
  const clock = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
  const date = now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", timeZone });
  const statusLabel = (p: KioskPerson) => ({ upcoming: t.kUpcoming, working: t.kWorking, onBreak: t.kOnBreak, done: t.kFinished, off: "" })[p.status];

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-brand-50 via-white to-white">
      <header className="relative overflow-hidden bg-gradient-to-br from-brand-900 via-brand-700 to-brand-500 px-5 pt-5 pb-20 text-white sm:px-8">
        <div className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-32 left-10 size-72 rounded-full bg-brand-200/20 blur-3xl" />
        <div className="relative mx-auto flex max-w-4xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/15"><Icon name="calendar" className="size-5" /></span>
            <span className="truncate text-sm font-medium text-white/80">{storeName} · {t.kTitle}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {demo && (
              <form action={backToManager.bind(null, storeId)}>
                <button className="inline-flex h-9 items-center gap-1.5 rounded-md bg-white/15 px-3 text-sm font-medium hover:bg-white/25" title="Demo only">
                  <Icon name="left" className="size-4" />Back to manager
                </button>
              </form>
            )}
            <LanguagePicker lang={lang} label="Language" tone="dark" />
          </div>
        </div>
        <div className="relative mx-auto mt-8 flex max-w-4xl flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-3xl font-semibold tracking-tight sm:text-4xl">{greeting}</p>
            <p className="mt-1 text-lg text-white/80">{t.kTapName}</p>
          </div>
          <div className="text-right">
            <p className="text-5xl font-semibold tabular-nums sm:text-6xl">{clock}</p>
            <p className="text-white/80 first-letter:uppercase">{date}</p>
          </div>
        </div>
      </header>

      <main className="relative mx-auto -mt-12 w-full max-w-4xl flex-1 px-5 pb-8 sm:px-8">
        {view.step === "list" && (
          <div className="rounded-2xl bg-white p-4 shadow-xl shadow-brand-900/10 ring-1 ring-zinc-100 sm:p-6">
            <div className="relative">
              <Icon name="search" className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-brand-600" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.kFind} aria-label={t.kFind} className="h-14 w-full rounded-xl border-2 border-brand-100 bg-brand-50/40 pr-4 pl-12 text-lg outline-none placeholder:text-zinc-400 focus:border-brand-500 focus:bg-white" />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label="Filter">
              {FILTERS.map((f) => (
                <button key={f.key} onClick={() => setFilter(filter === f.key ? null : f.key)} aria-pressed={filter === f.key} className={`flex h-14 items-center justify-center gap-2 rounded-xl border-2 px-2 text-sm font-semibold transition sm:text-base ${filter === f.key ? f.on : "border-zinc-100 bg-white text-zinc-700 hover:border-zinc-200"}`}>
                  <Icon name={f.icon} className="size-4 shrink-0" />
                  <span className="truncate">{f.label(t)}</span>
                  <span className={`rounded-md px-1.5 text-xs ${filter === f.key ? "bg-white/25" : "bg-zinc-100 text-zinc-600"}`}>{count(f.key)}</span>
                </button>
              ))}
            </div>
            <ul className="mt-5 grid gap-2 sm:grid-cols-2">
              {shown.map((p) => (
                <li key={p.id}>
                  <button onClick={() => { setView({ step: "pin", person: p }); setPin(""); setError(null); }} className="flex min-h-[72px] w-full items-center gap-3 rounded-xl border border-zinc-100 bg-white px-4 py-3 text-left transition hover:border-brand-200 hover:bg-brand-50/50 active:scale-[0.99]">
                    <span className={`grid size-12 shrink-0 place-items-center rounded-xl text-base font-semibold ${avatarOf(p.name)}`}>{initials(p.name)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-lg font-semibold">{p.name}</span>
                      <span className="block truncate text-sm text-zinc-500">
                        {p.since ? fill(p.status === "onBreak" ? t.kBreakSince : t.kSince, { time: p.since }) : p.shift ?? t.kNoShift}
                        {p.since && p.shift ? ` · ${p.shift}` : ""}
                      </span>
                    </span>
                    {statusLabel(p) && <span className={`shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold ring-1 ${PILL[p.status]}`}>{statusLabel(p)}</span>}
                  </button>
                </li>
              ))}
              {!shown.length && <li className="col-span-full px-5 py-10 text-center text-zinc-500">{t.kNoMatch}</li>}
            </ul>
          </div>
        )}

        {view.step === "pin" && (
          <div className="mx-auto max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl shadow-brand-900/10 ring-1 ring-zinc-100">
            <button onClick={home} className="mb-4 inline-flex items-center gap-1 self-start text-zinc-500"><Icon name="left" className="size-5" />{t.kBack}</button>
            <span className={`mx-auto grid size-16 place-items-center rounded-2xl text-xl font-semibold ${avatarOf(view.person.name)}`}>{initials(view.person.name)}</span>
            <p className="mt-3 text-2xl font-semibold">{view.person.name}</p>
            <p className="mt-1 text-zinc-500">{t.kEnterPin}</p>
            <div className="my-6 flex justify-center gap-3" aria-label={`${pin.length}/4`}>
              {[0, 1, 2, 3].map((i) => <span key={i} className={`size-4 rounded-md transition ${i < pin.length ? "scale-110 bg-brand-600" : "bg-brand-100"}`} />)}
            </div>
            {error && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-rose-700" role="alert">{error}</p>}
            <div className="grid grid-cols-3 gap-3">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => (
                <button key={n} onClick={() => press(n)} disabled={busy} className="h-20 rounded-2xl bg-brand-50 text-3xl font-semibold text-brand-900 transition active:scale-95 active:bg-brand-100">{n}</button>
              ))}
              <button onClick={() => setPin("")} disabled={busy} className="h-20 rounded-2xl text-base text-zinc-500 active:bg-zinc-100">{t.kClear}</button>
              <button onClick={() => press("0")} disabled={busy} className="h-20 rounded-2xl bg-brand-50 text-3xl font-semibold text-brand-900 transition active:scale-95 active:bg-brand-100">0</button>
              <button onClick={() => setPin(pin.slice(0, -1))} disabled={busy} className="grid h-20 place-items-center rounded-2xl text-zinc-500 active:bg-zinc-100" aria-label={t.kDelete}><Icon name="left" className="size-6" /></button>
            </div>
          </div>
        )}

        {view.step === "detail" && (
          <div className="mx-auto max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl shadow-brand-900/10 ring-1 ring-zinc-100">
            <div className="h-2 bg-gradient-to-r from-brand-500 via-sky-400 to-amber-400" />
            <div className="p-6">
              <button onClick={home} className="mb-4 inline-flex items-center gap-1 text-zinc-500"><Icon name="left" className="size-5" />{t.kNotYou}</button>
              <div className="flex items-center gap-3">
                <span className={`grid size-14 place-items-center rounded-2xl text-lg font-semibold ${avatarOf(view.detail.name)}`}>{initials(view.detail.name)}</span>
                <p className="text-2xl font-semibold">{view.detail.name}</p>
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-3">
                <div className="col-span-2 rounded-xl bg-sky-50 p-4">
                  <dt className="flex items-center gap-1.5 text-sm font-medium text-sky-700"><Icon name="calendar" className="size-4" />{t.kTodayShift}</dt>
                  <dd className="mt-1 text-xl font-semibold text-sky-950">{view.detail.shift ? `${view.detail.shift.name} · ${view.detail.shift.start}–${view.detail.shift.end}` : t.kNotRostered}</dd>
                  {view.detail.shift && view.detail.shift.breakMinutes > 0 && <dd className="text-sm text-sky-800/70">{fill(t.kUnpaidBreak, { n: view.detail.shift.breakMinutes })}</dd>}
                </div>
                {view.detail.clockIn && (
                  <div className="rounded-xl bg-brand-50 p-4">
                    <dt className="text-sm font-medium text-brand-700">{t.kClockedIn}</dt>
                    <dd className="mt-1 text-2xl font-semibold text-brand-900 tabular-nums">{view.detail.clockIn}</dd>
                  </div>
                )}
                {view.detail.clockIn && (
                  <div className="rounded-xl bg-amber-50 p-4">
                    {/* On a break: since when. Break still owed: how long. Break done: how long it was. */}
                    <dt className="text-sm font-medium text-amber-700">{view.detail.onBreakSince ? t.kOnBreak : view.detail.breakLeft || !view.detail.breakTaken ? t.kBreakLeft : t.kBreakTaken}</dt>
                    <dd className="mt-1 text-2xl font-semibold text-amber-950 tabular-nums">{view.detail.onBreakSince ?? (view.detail.breakLeft ? min(view.detail.breakLeft) : view.detail.breakTaken ? hm(view.detail.breakTaken) : t.kNone)}</dd>
                  </div>
                )}
              </dl>
              {error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-rose-700" role="alert">{error}</p>}
              <div className={`mt-6 grid gap-3 ${view.detail.actions.length > 1 ? "grid-cols-2" : ""}`}>
                {view.detail.actions.map((a) => (
                  <button key={a} onClick={() => run(a)} disabled={busy} className={`flex h-[72px] items-center justify-center gap-2 rounded-2xl text-lg font-semibold shadow-lg transition active:scale-[0.98] disabled:opacity-60 ${BUTTON[a].cls}`}>
                    <Icon name={BUTTON[a].icon} className="size-6" />{busy ? "…" : actionLabel(t, a)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {view.step === "result" && <Result r={view.result} done={home} t={t} hm={hm} />}
      </main>

      {view.step === "list" && (
        <footer className="px-5 pb-4 text-center sm:px-8">
          <form action={exitKiosk.bind(null, storeId)}>
            <button className="text-xs text-zinc-400 underline">{t.kExit}</button>
          </form>
        </footer>
      )}
    </div>
  );
}

const MOOD: Record<KioskAction, { emoji: string; ring: string; bg: string }> = {
  in: { emoji: "👋", ring: "ring-brand-200", bg: "bg-brand-100" },
  breakStart: { emoji: "☕", ring: "ring-amber-200", bg: "bg-amber-100" },
  breakEnd: { emoji: "💪", ring: "ring-sky-200", bg: "bg-sky-100" },
  out: { emoji: "🎉", ring: "ring-violet-200", bg: "bg-violet-100" },
};

function Result({ r, done, t, hm }: { r: KioskResult; done: () => void; t: Dict; hm: (m: number) => string }) {
  const name = r.name.split(" ")[0];
  const rows: [string, string][] =
    r.action === "in"
      ? [[t.kClockedIn, r.clockIn!]]
      : r.action === "breakStart"
        ? [[t.kBreakStarted, r.breakStart!]]
        : r.action === "breakEnd"
          ? [[t.kBreakStarted, r.breakStart!], [t.kBreakEnded, r.breakEnd!], [t.kBreakTaken, hm(r.breakMinutes!)]]
          : [[t.kStarted, r.clockIn!], [t.kFinished, r.clockOut!], [t.kBreakDeducted, r.breakMinutes ? hm(r.breakMinutes) : t.kNone], [t.kTotalWorked, hm(r.workedMinutes!)]];
  const title = fill(r.action === "in" ? t.kHiIn : r.action === "breakStart" ? t.kHiBreak : r.action === "breakEnd" ? t.kHiBack : t.kHiOut, { name });
  const m = MOOD[r.action];
  const total = rows.length > 1;
  return (
    <div className="mx-auto max-w-md rounded-2xl bg-white p-8 text-center shadow-xl shadow-brand-900/10 ring-1 ring-zinc-100" role="status">
      <span className={`mx-auto grid size-24 place-items-center rounded-full text-5xl ring-8 ${m.bg} ${m.ring}`} aria-hidden>{m.emoji}</span>
      <p className="mt-5 text-3xl font-semibold tracking-tight">{title}</p>
      {r.late ? <p className="mt-2 text-amber-700">{fill(t.kLate, { n: r.late })}</p> : null}
      <dl className="mt-6 divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-100 text-left">
        {rows.map(([k, v], i) => {
          const last = total && i === rows.length - 1;
          return (
            <div key={k} className={`flex items-center justify-between px-5 py-3.5 ${last ? "bg-brand-50" : ""}`}>
              <dt className={last ? "font-semibold text-brand-900" : "text-zinc-500"}>{k}</dt>
              <dd className={`text-xl tabular-nums ${last ? "font-semibold text-brand-900" : "font-medium"}`}>{v}</dd>
            </div>
          );
        })}
      </dl>
      <button onClick={done} className="mt-6 h-14 w-full rounded-2xl bg-brand-600 text-lg font-semibold text-white shadow-lg shadow-brand-600/30 hover:bg-brand-700">{t.kDone}</button>
      <p className="mt-2 text-sm text-zinc-400">{t.kReturning}</p>
    </div>
  );
}
