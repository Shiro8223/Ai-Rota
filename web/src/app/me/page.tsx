import Link from "next/link";
import { AvailabilityEditor, TemporaryAvailabilityForm } from "@/components/availability-editor";
import { Icon } from "@/components/icons";
import { LanguagePicker } from "@/components/language-picker";
import { Avatar, Badge, Section } from "@/components/ui";
import { activeTemporary } from "@/lib/availability";
import { requireStaff } from "@/lib/auth";
import { colorOf } from "@/lib/colors";
import { db, isDemo } from "@/lib/db";
import { dateIn, fill } from "@/lib/i18n";
import { getDict } from "@/lib/lang";
import { loadStore } from "@/lib/org";
import { zonedNow } from "@/lib/zone";
import { holidayBalance } from "@/lib/holiday-server";
import { liveAssignments, lockState } from "@/lib/live";
import { hasFeature } from "@/lib/roles";
import { swapsFor } from "@/lib/swaps";
import { permissionsOf, storeRoles } from "@/lib/team";
import { addDays, dayDate, emptyWeek, hours, isoDate, mondayOf, shiftsForStore } from "@/lib/time";
import { DAYS, type Day, type ShiftInstance, type Window } from "@/lib/types";
import { logout } from "../login/actions";
import { cancel, cancelHoliday, offer, post, requestHoliday, requestTemporaryAvailability, requestUsualAvailability, respondToAsk, respondToChange, withdrawRequest } from "./actions";
import { ChangeButtons, HolidayForm, OfferButton, PostSwapForm } from "./forms";
import { ClaimButton, PushToggle } from "./work";
import { claimAction, savePush, unclaimAction } from "./work-actions";
import { openShiftsFor } from "@/lib/open-shifts";
import { pushConfigured } from "@/lib/notify";

export const dynamic = "force-dynamic";
type Tab = "shifts" | "swaps" | "availability" | "holiday";

export default async function MePage({ searchParams }: { searchParams: Promise<{ tab?: string; code?: string }> }) {
  const { tab: tp } = await searchParams;
  const tab: Tab = tp === "swaps" || tp === "availability" || tp === "holiday" ? tp : "shifts";
  const { employee, store } = await requireStaff();
  const { lang, t } = await getDict();
  const d = await db();
  const roles = await storeRoles(store.id);
  const managerTools = permissionsOf(employee.roleIds ?? [], roles).size > 0;
  const f = { swaps: hasFeature(store.features, "swaps"), edit: hasFeature(store.features, "staffAvailability"), temp: hasFeature(store.features, "temporaryAvailability"), holiday: hasFeature(store.features, "holidays"), open: hasFeature(store.features, "openShifts") };
  const today = isoDate(new Date());
  const thisWeek = mondayOf();
  const shifts = Object.fromEntries(shiftsForStore(store).map((s) => [s.id, s]));
  // Shared staff: shifts at every site they work at, each with its own shift types.
  const sites = [store, ...(await Promise.all((employee.allowedStoreIds ?? []).map((id) => loadStore(id)))).filter((x): x is NonNullable<typeof x> => !!x)];
  const siteShifts: Record<string, Record<string, ShiftInstance>> = Object.fromEntries(sites.map((st) => [st.id, Object.fromEntries(shiftsForStore(st).map((x) => [x.id, x]))]));
  const siteName = Object.fromEntries(sites.map((st) => [st.id, st.name]));
  const multiSite = sites.length > 1;

  // Labels in the chosen language.
  const dayName = (day: Day) => t[day];
  const date = (iso: string) => dateIn(lang, iso);
  const shiftText = (weekStart: string, s: ShiftInstance) => `${s.name} · ${dayName(s.day)} ${date(dayDate(weekStart, s.day))} (${s.start}–${s.end})`;
  const windowsLabel = (w: Window[] | undefined) =>
    !w || !w.length ? t.off : w.length === 1 && w[0].from === "00:00" && (w[0].to === "24:00" || w[0].to === "23:59") ? t.anyTime : w.map((x) => `${x.from}–${x.to}`).join(", ");
  const range = (a: { startWeek: string | null; endWeek: string | null }) => (a.startWeek && a.endWeek ? `${date(a.startWeek)} – ${date(addDays(a.endWeek, 6))}` : "");
  const pickWeeks = Array.from({ length: 15 }, (_, i) => {
    const value = addDays(thisWeek, 7 * (i + 1));
    return { value, label: i === 0 ? `${t.nextWeekPick} (${date(value)})` : `${t.wc} ${date(value)}` };
  });

  // Staff always see the published version, even while a manager edits an unlocked copy.
  const allApproved = (await Promise.all(sites.map((st) => d.list("rotas", { storeId: st.id })))).flat().filter((r) => liveAssignments(r)).map((r) => ({ ...r, assignments: liveAssignments(r)! }));
  const rotas = allApproved.filter((r) => r.weekStart >= thisWeek).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  // Changes suggested for shifts starting within 24 hours, waiting for this person.
  const changes = (await Promise.all(sites.map((st) => d.list("change_requests", { storeId: st.id, employeeId: employee.id, status: "pending" })))).flat()
    .map((c) => ({ c, s: siteShifts[c.storeId]?.[c.shiftId] }))
    .filter(({ c, s }) => s && lockState(c.weekStart, DAYS.indexOf(s.day), s.start, zonedNow(store.timezone)) !== "past");
  const holidayList = (await d.list("holidays", { storeId: store.id, employeeId: employee.id })).filter((h) => h.status !== "cancelled" && h.endDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const hb = f.holiday ? await holidayBalance(store, employee) : null;
  const mySwaps = (await d.list("swap_requests", { storeId: store.id, fromEmployeeId: employee.id })).filter((s) => s.status === "open" || s.status === "pending_approval");
  const board = f.swaps ? await swapsFor(employee, store) : [];
  const openBoard = await openShiftsFor(employee, store);
  const openClaimable = openBoard.filter((x) => x.open.status === "open");
  const myOffers = (await d.list("swap_requests", { storeId: store.id, toEmployeeId: employee.id })).filter((s) => s.status === "pending_approval");
  const avail = await d.list("availability", { storeId: store.id, employeeId: employee.id });
  const usual = avail.find((a) => a.kind === "default" && a.status === "approved");
  const pendingUsual = avail.find((a) => a.kind === "default" && a.status === "pending");
  const temps = avail.filter((a) => a.kind === "temporary" && a.endWeek! >= thisWeek).sort((a, b) => a.startWeek!.localeCompare(b.startWeek!));
  const activeTemp = activeTemporary(avail, employee.id, thisWeek);

  const myShifts = rotas
    .flatMap((r) =>
      r.assignments
        .filter((a) => a.employeeId === employee.id && siteShifts[r.storeId]?.[a.shiftId])
        .map((a) => ({ rota: r, shift: siteShifts[r.storeId][a.shiftId], date: dayDate(r.weekStart, siteShifts[r.storeId][a.shiftId].day), ask: (r.exceptions ?? []).find((x) => x.shiftId === a.shiftId && x.employeeId === employee.id) })),
    )
    .filter((x) => x.date >= today)
    .sort((a, b) => (a.date + a.shift.start).localeCompare(b.date + b.shift.start));
  const asks = myShifts.filter((x) => x.ask?.status === "pending");

  // Hours and shifts already worked, from published rotas (a shift counts once it has ended).
  const nowMs = Date.now();
  const worked = allApproved
    .flatMap((r) =>
      r.assignments
        .filter((a) => a.employeeId === employee.id && siteShifts[r.storeId]?.[a.shiftId] && r.exceptions?.find((x) => x.shiftId === a.shiftId && x.employeeId === employee.id)?.status !== "declined")
        .map((a) => ({ shift: siteShifts[r.storeId][a.shiftId], date: dayDate(r.weekStart, siteShifts[r.storeId][a.shiftId].day), week: r.weekStart })),
    )
    .filter((x) => new Date(`${x.date}T${x.shift.start}:00`).getTime() + x.shift.span * 60_000 <= nowMs);
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  const sum = (list: typeof worked) => list.reduce((n, x) => n + x.shift.minutes, 0);
  const last4 = [1, 2, 3, 4].map((n) => addDays(thisWeek, -7 * n));
  const inWeek = worked.filter((x) => x.week === thisWeek);
  const inMonth = worked.filter((x) => x.date.startsWith(month));
  const inYear = worked.filter((x) => x.date.startsWith(year));
  const stats = [
    { label: t.workedThisWeek, value: hours(sum(inWeek)), sub: fill(t.shiftsN, { n: inWeek.length }) },
    { label: t.workedThisMonth, value: hours(sum(inMonth)), sub: fill(t.shiftsN, { n: inMonth.length }) },
    { label: t.thisYear, value: hours(sum(inYear)), sub: fill(t.shiftsN, { n: inYear.length }) },
    { label: t.averageWeek, value: hours(sum(worked.filter((x) => last4.includes(x.week))) / 4), sub: fill(t.last4, { h: employee.contractedHours }) },
  ];
  const next = myShifts.find((x) => x.ask?.status !== "declined");
  // "Call the store" rings the site of their next shift (or their home site).
  const callSite = sites.find((st) => st.id === next?.rota.storeId && st.phone) ?? (store.phone ? store : null);
  const thisWeekHours = myShifts.filter((x) => x.rota.weekStart === thisWeek).reduce((n, x) => n + x.shift.minutes, 0);
  const byWeek = myShifts.reduce<Record<string, typeof myShifts>>((m, x) => ((m[x.rota.weekStart] ??= []).push(x), m), {});

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "shifts", label: t.tabShifts },
    ...(f.swaps || openBoard.length ? [{ key: "swaps" as Tab, label: t.tabSwaps, count: board.length + openClaimable.length }] : []),
    { key: "availability", label: t.tabAvailability },
    ...(f.holiday ? [{ key: "holiday" as Tab, label: t.tabHoliday }] : []),
  ];
  const availLabels = { ...t };

  return (
    <div className="min-h-screen pb-10">
      <header className="bg-brand-900 px-4 pt-[max(env(safe-area-inset-top),1.25rem)] pb-16 text-white">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={employee.name} />
            <div className="min-w-0">
              <p className="truncate text-xs text-white/60">{store.name}</p>
              <h1 className="text-lg font-semibold">{fill(t.hi, { name: employee.name.split(" ")[0] })}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {pushConfigured() && <PushToggle vapidKey={process.env.VAPID_PUBLIC_KEY!} save={savePush} label="🔔" />}
            <LanguagePicker lang={lang} label={t.language} tone="dark" />
            <form action={logout}><button className="grid size-9 place-items-center rounded-md bg-white/10" aria-label={t.signOut}><Icon name="logout" className="size-4" /></button></form>
          </div>
        </div>
        {managerTools && (
          <div className="mx-auto mt-3 max-w-xl">
            <Link href={`/s/${store.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-white px-3 text-sm font-semibold text-brand-900">
              <Icon name="shield" className="size-4" />{t.managerTools}
            </Link>
          </div>
        )}
      </header>

      <main className="mx-auto -mt-12 max-w-xl space-y-5 px-4">
        {next ? (
          (() => {
            const c = colorOf(next.shift.color);
            return (
              <div className="card overflow-hidden p-0 sm:p-0">
                <div className={`h-1.5 ${c.bar}`} />
                <div className="p-5">
                  <p className="eyebrow">{next.date === today ? t.today : t.nextShift}</p>
                  <p className="mt-1 text-2xl font-semibold tracking-tight">{dayName(next.shift.day)} {date(next.date)}</p>
                  <p className="mt-1 flex items-center gap-2 text-zinc-600"><span className={`size-2 rounded-sm ${c.dot}`} />{next.shift.name} · {next.shift.start}–{next.shift.end}</p>
                  <div className="mt-4 flex gap-6 border-t border-zinc-100 pt-4 text-sm">
                    <div><p className="text-xs text-zinc-500">{t.thisWeek}</p><p className="font-semibold">{hours(thisWeekHours)}</p></div>
                    <div><p className="text-xs text-zinc-500">{t.contract}</p><p className="font-semibold">{employee.contractedHours}h</p></div>
                    <div><p className="text-xs text-zinc-500">{t.upcoming}</p><p className="font-semibold">{fill(t.shiftsN, { n: myShifts.length })}</p></div>
                  </div>
                </div>
              </div>
            );
          })()
        ) : (
          <div className="card text-center"><p className="font-semibold">{t.noUpcoming}</p><p className="mt-1 text-sm text-zinc-500">{t.noUpcomingSub}</p></div>
        )}

        {callSite?.phone && (
          <a href={`tel:${callSite.phone.replace(/[^\d+]/g, "")}`} className="btn-secondary w-full">
            <Icon name="phone" className="size-4" />{t.callStore}{multiSite && ` · ${callSite.name}`}
          </a>
        )}

        {asks.map(({ rota, shift }) => (
          <div key={rota.id + shift.id} className="card border-amber-300 bg-amber-50/60">
            <p className="flex items-center gap-2 font-semibold text-amber-950"><Icon name="clock" className="size-4" />{t.askTitle}</p>
            <p className="mt-1 text-sm text-amber-950/80">{fill(t.askBody, { shift: shiftText(rota.weekStart, shift) })}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <form action={respondToAsk.bind(null, rota.id, shift.id, false)}><button className="btn-secondary w-full">{t.iCant}</button></form>
              <form action={respondToAsk.bind(null, rota.id, shift.id, true)}><button className="btn-primary w-full"><Icon name="check" className="size-4" />{t.iAgree}</button></form>
            </div>
          </div>
        ))}

        {changes.map(({ c, s: sh }) => (
          <div key={c.id} className="card border-sky-300 bg-sky-50/60">
            <p className="flex items-center gap-2 font-semibold text-sky-950"><Icon name="swap" className="size-4" />{t.changeTitle}</p>
            <p className="mt-1 text-sm text-sky-950/80">{fill(c.kind === "add" ? t.changeAdd : t.changeRemove, { shift: shiftText(c.weekStart, sh) })}</p>
            <ChangeButtons action={respondToChange.bind(null, c.id)} labels={t} />
          </div>
        ))}

        <div className="sticky top-0 z-20 -mx-4 bg-zinc-50/90 px-4 py-2 backdrop-blur">
          <div className="grid rounded-lg bg-zinc-200/60 p-1" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
            {tabs.map((x) => (
              <Link key={x.key} href={`?tab=${x.key}`} className={`flex min-h-10 items-center justify-center gap-1.5 rounded-md text-sm font-medium ${tab === x.key ? "bg-white shadow-[var(--shadow-card)]" : "text-zinc-600"}`}>
                {x.label}
                {!!x.count && <span className="rounded-md bg-amber-500 px-1.5 text-[11px] font-semibold text-white">{x.count}</span>}
              </Link>
            ))}
          </div>
        </div>

        {tab === "shifts" && (
          <div className="space-y-6">
            <section>
              <h2 className="eyebrow mb-2">{t.statsTitle}</h2>
              <div className="grid grid-cols-2 gap-2">
                {stats.map((x) => (
                  <div key={x.label} className="rounded-lg border border-zinc-200 bg-white p-3">
                    <p className="text-xs text-zinc-500">{x.label}</p>
                    <p className="text-xl font-semibold tabular-nums">{x.value}</p>
                    <p className="text-[11px] text-zinc-500">{x.sub}</p>
                  </div>
                ))}
              </div>
            </section>
            {Object.entries(byWeek).map(([ws, list]) => (
              <section key={ws}>
                <h2 className="eyebrow mb-2">{ws === thisWeek ? t.thisWeek : ws === addDays(thisWeek, 7) ? t.nextWeek : `${t.wc} ${date(ws)}`} · {hours(list.reduce((n, x) => n + x.shift.minutes, 0))}</h2>
                <div className="card divide-y divide-zinc-100 p-0 sm:p-0">
                  {list.map(({ rota, shift, date: day, ask }) => {
                    const c = colorOf(shift.color);
                    const posted = mySwaps.find((s) => s.rotaId === rota.id && s.shiftId === shift.id);
                    return (
                      <div key={rota.id + shift.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
                        <div className={`flex size-12 shrink-0 flex-col items-center justify-center rounded-lg ${c.chip} ring-1`}>
                          <span className="text-[10px] font-semibold uppercase">{dayName(shift.day).slice(0, 3)}</span>
                          <span className="text-lg leading-none font-semibold">{Number(day.slice(8))}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{shift.name}{multiSite && <span className="ml-1.5 rounded bg-teal-50 px-1.5 py-0.5 text-[11px] font-semibold text-teal-800">{siteName[rota.storeId]}</span>}</p>
                          <p className="text-sm text-zinc-500">{shift.start}–{shift.end} · {hours(shift.minutes)}</p>
                        </div>
                        {ask?.status === "pending" ? (
                          <Badge tone="amber">{t.needsOk}</Badge>
                        ) : ask?.status === "declined" ? (
                          <Badge tone="red">{t.youDeclined}</Badge>
                        ) : posted ? (
                          <div className="flex items-center gap-2">
                            <Badge tone={posted.status === "open" ? "blue" : "amber"}>{posted.status === "open" ? t.onSwapBoard : t.awaitingManager}</Badge>
                            <form action={cancel.bind(null, posted.id)}><button className="text-xs text-zinc-500 underline">{t.cancel}</button></form>
                          </div>
                        ) : f.swaps ? (
                          <PostSwapForm action={post.bind(null, rota.id, shift.id)} labels={t} />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
            {!myShifts.length && <p className="text-center text-sm text-zinc-500">{t.noShiftsPublished}</p>}
          </div>
        )}

        {tab === "swaps" && (f.swaps || openBoard.length > 0) && (
          <div className="space-y-5">
            {openBoard.length > 0 && (
              <section className="space-y-3">
                <h2 className="eyebrow">{t.openShiftsTitle}</h2>
                <p className="text-sm text-zinc-600">{t.openShiftsIntro}</p>
                {openBoard.map(({ open, site, rota, shift }) => {
                  const c = colorOf(shift.color);
                  return (
                    <div key={open.id} className="card overflow-hidden p-0 sm:p-0">
                      <div className={`h-1.5 ${c.bar}`} />
                      <div className="p-5">
                        <p className="font-semibold">{shiftText(rota.weekStart, shift)}{multiSite && <span className="ml-1.5 rounded bg-teal-50 px-1.5 py-0.5 text-[11px] font-semibold text-teal-800">{site.name}</span>}</p>
                        {(open.roleName || open.note) && <p className="mt-1 text-sm text-zinc-600">{[open.roleName, open.note].filter(Boolean).join(" · ")}</p>}
                        <div className="mt-4">
                          {open.status === "claimed" ? (
                            <div className="flex items-center gap-3"><Badge tone="amber">{t.claimed}</Badge><form action={unclaimAction.bind(null, open.id)}><button className="text-xs text-zinc-500 underline">{t.cancel}</button></form></div>
                          ) : (
                            <ClaimButton action={claimAction.bind(null, open.id)} labels={t} />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </section>
            )}
            {f.swaps && <h2 className="eyebrow">{t.tabSwaps}</h2>}
            <p className="text-sm text-zinc-600">{t.swapsIntro}</p>
            {board.map(({ swap, rota, shift, from }) => {
              const c = colorOf(shift.color);
              return (
                <div key={swap.id} className="card overflow-hidden p-0 sm:p-0">
                  <div className={`h-1.5 ${c.bar}`} />
                  <div className="p-5">
                    <p className="font-semibold">{shiftText(rota.weekStart, shift)}</p>
                    <p className="mt-1 mb-4 flex items-center gap-2 text-sm text-zinc-600">
                      <Avatar name={from?.name ?? "?"} size="sm" />
                      {fill(t.from, { name: from?.name.split(" ")[0] ?? "" })}{swap.note && <>: “{swap.note}”</>}
                    </p>
                    <OfferButton action={offer.bind(null, swap.id)} labels={t} />
                  </div>
                </div>
              );
            })}
            {!board.length && <div className="card text-center text-sm text-zinc-500">{t.nothingOnBoard}</div>}
            {myOffers.length > 0 && (
              <section>
                <h2 className="eyebrow mb-2">{t.myOffers}</h2>
                <div className="card divide-y divide-zinc-100 p-0 sm:p-0">
                  {myOffers.map((o) => {
                    const r = rotas.find((x) => x.id === o.rotaId);
                    const s = shifts[o.shiftId];
                    return (
                      <div key={o.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
                        <span>{r && s ? shiftText(r.weekStart, s) : o.shiftId}</span>
                        <Badge tone="amber">{t.waitingApproval}</Badge>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}

        {tab === "availability" && (
          <div className="space-y-5">
            {activeTemp && (
              <div className="rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-950">{fill(t.tempActive, { note: activeTemp.note || t.temporary, range: range(activeTemp) })}</div>
            )}
            <Section title={t.usualTitle} sub={t.usualSub}>
              {pendingUsual && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {t.changeWaiting}
                  <form action={withdrawRequest.bind(null, pendingUsual.id)}><button className="text-xs underline">{t.withdraw}</button></form>
                </div>
              )}
              {f.edit ? (
                <AvailabilityEditor key={usual?.updatedAt ?? "none"} initial={(pendingUsual ?? usual)?.days ?? emptyWeek()} onSave={requestUsualAvailability} submitLabel={t.sendForApproval} labels={availLabels} />
              ) : (
                <>
                  <dl className="divide-y divide-zinc-100 text-sm">
                    {DAYS.map((day) => <div key={day} className="flex justify-between py-2"><dt className="font-medium">{dayName(day)}</dt><dd className="text-zinc-600">{windowsLabel(usual?.days[day])}</dd></div>)}
                  </dl>
                  <p className="mt-3 text-xs text-zinc-500">{t.askManagerChange}</p>
                </>
              )}
            </Section>

            {f.temp && f.edit && (
              <Section title={employee.isStudent ? t.tempTitleStudent : t.tempTitle} sub={t.tempSub}>
                {temps.length > 0 && (
                  <ul className="mb-5 space-y-2">
                    {temps.map((x) => (
                      <li key={x.id} className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 px-3 py-2.5 text-sm">
                        <span className="font-medium">{x.note || t.temporary}</span>
                        <span className="text-zinc-500">{range(x)}</span>
                        <Badge tone={x.status === "approved" ? "green" : x.status === "pending" ? "amber" : "red"}>{x.status === "pending" ? t.waitingApproval : x.status === "approved" ? t.statusApproved : t.statusDeclined}</Badge>
                        {x.status === "pending" && <form action={withdrawRequest.bind(null, x.id)} className="ml-auto"><button className="text-xs text-zinc-500 underline">{t.withdraw}</button></form>}
                      </li>
                    ))}
                  </ul>
                )}
                <TemporaryAvailabilityForm weeks={pickWeeks} initial={usual?.days ?? emptyWeek()} onSubmit={requestTemporaryAvailability} submitLabel={t.sendForApproval} labels={availLabels} />
              </Section>
            )}
          </div>
        )}
        {tab === "holiday" && f.holiday && hb && (
          <div className="space-y-5">
            <div className="card">
              <p className="eyebrow">{t.holidayLeft}</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">{Math.max(0, hb.remaining)} <span className="text-base font-medium text-zinc-500">{hb.unit === "days" ? t.unitDays : t.unitHours}</span></p>
              <p className="text-sm text-zinc-600">{fill(t.holidayOf, { left: Math.max(0, hb.remaining), total: hb.allowance, unit: hb.unit === "days" ? t.unitDays : t.unitHours })} · {fill(t.holidayUntil, { date: date(hb.period.end) })}</p>
              <div className="mt-3 h-2 rounded-sm bg-zinc-200"><div className="h-2 rounded-sm bg-brand-500" style={{ width: `${hb.allowance ? Math.min(100, ((hb.used + hb.pending) / hb.allowance) * 100) : 0}%` }} /></div>
            </div>
            <Section title={t.bookHoliday}>
              <HolidayForm action={requestHoliday} contractedHours={employee.contractedHours} unit={hb.unit} labels={t} locale={lang === "en" ? "en-GB" : lang} />
            </Section>
            <section>
              <h2 className="eyebrow mb-2">{t.myHoliday}</h2>
              <div className="card divide-y divide-zinc-100 p-0 sm:p-0">
                {holidayList.map((h) => (
                  <div key={h.id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
                    <span className="font-medium">{date(h.startDate)} – {date(h.endDate)}</span>
                    <span className="text-zinc-500">{h.paid ? `${t.paidHoliday} · ${h.amount} ${h.unit === "days" ? t.unitDays : t.unitHours}` : t.unpaidHoliday}</span>
                    <span className="ml-auto flex items-center gap-2">
                      <Badge tone={h.status === "approved" ? "green" : h.status === "pending" ? "amber" : "red"}>{h.status === "approved" ? t.statusApproved : h.status === "pending" ? t.waitingApproval : t.statusDeclined}</Badge>
                      {h.status === "pending" && <form action={cancelHoliday.bind(null, h.id)}><button className="text-xs text-zinc-500 underline">{t.withdraw}</button></form>}
                    </span>
                  </div>
                ))}
                {!holidayList.length && <p className="px-4 py-4 text-sm text-zinc-500">{t.noHoliday}</p>}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
