# AI Rota Agent

Weekly rota builder for UK restaurants: plain-English rules → AI-translated constraints → OR-Tools solver → manager approval. See `README.md` for running it and `MVP_SPEC.md` (copied from https://claude.ai/artifact/NYzjjUmBfQngN68VwvateY) for the spec.

- Status: all 7 milestones implemented. Demo mode (no `SUPABASE_URL`) runs on the Test Wings fixture and is tested end to end. The Supabase path is untested against a live project.
- `npm run demo` starts both services; `npm test` runs vitest + pytest.
- `check_rota` (solver/app/check.py) is the ONLY rule checker: the solver output, the editor's live warnings and swaps all use it via `POST /check`. Don't add a second checker in TypeScript.
- Constraint types are a closed list, mirrored in `web/src/lib/constraints.ts` (Zod) and `solver/app/domain.py` (Pydantic). Change both together.
- Shift ids are `<templateId>:<day>`, built identically by `shiftsForStore()` (TS) and `Problem` (Python).
- Data minimal: no addresses, dates of birth, NI numbers or bank details. Pay rates are optional, gated by `pay.view`, and never sent to the AI. No free-text reasons on `never_together` rules.
- After changing the fixture, regenerate `demoRota` with `solver/.venv/Scripts/python -m scripts.make_demo_rota` and delete `web/.data/`.
- Availability rows: kind default|temporary, status approved|pending|declined. Only approved rows reach the solver (`lib/availability.ts`). Staff edits are always pending; manager edits are approved.
- Rotas carry `exceptions` (people put outside their availability by hand). The server owns their status; the client only sends which assignments are exceptions.
- Issues with `legal: true` (rest, weekly_rest, under18) block approval with no override.
- Swaps are only shown to and allowed between people with the same role.
- UI: shared classes in `globals.css` (`@utility`), shift colours in `lib/colors.ts`, icons in `components/icons.tsx`. Manager nav = top bar on desktop, bottom tab bar on mobile.
- Roles: `lib/roles.ts` (permissions, role/feature catalogues and presets, pure helpers) and `lib/team.ts` (server helpers). `Employee.roleIds` is the source of truth; `role`, `isUnder18`, `isStudent` are derived and must be refreshed with `setEmployeeRoles` / `resyncEmployees` after role changes.
- Access: every manager page/action calls `requireStore(storeId, permission)`; it accepts email managers (store_members) and PIN staff whose roles carry permissions. `role: "owner"` member = Account Primary = all permissions. Nav sections come from `lib/nav.ts`.
- Feature switches live in `store.features`; check with `hasFeature()` on both the page and the server action. Missing key = on.
- Shift types carry `breakMinutes` (unpaid; `ShiftInstance.minutes` = paid, `.span` = clock time) and `requirements` (role id + count). The solver gets role names.
- Rest rules span weeks: `loadProblem` sends neighbouring weeks' shifts as `edgeShifts` (minutes from this Monday). Contracts are hard constraints; `blocking` issues (legal + contract) stop publishing.
- Rules may have `weekStart` (week-only). The rota assistant lives in `lib/assistant.ts` (shared tools; Claude tool-use loop or offline parser).
- i18n: `lib/i18n.ts` (dictionaries, English fallback) + `lib/lang.ts` (cookie/Accept-Language). Covered: login, staff app, nav. Add keys to `en` first; `tests/i18n.test.ts` checks every language.
- Pills/chips use `rounded-md` (box style), not `rounded-full`.
- 24h rule: `lib/live.ts` (`liveAssignments`, `lockState`, `applyLock`). Rotas keep `published` (what staff see). Changes to published shifts <24h become `change_requests` the person accepts in /me.
- Holidays: `lib/holidays.ts` (pure policy/balance maths), `lib/holiday-server.ts` (validation). Policies on store/role/employee (`holidayPolicy`). Approved holiday removes availability and reduces the week's contract in `loadProblem`.
- Franchise layer: `organisations` + `org_members` (owner / area manager with permissions + storeIds). `Store.orgId`; `Employee.allowedStoreIds`. `lib/org.ts` (`effectiveStore` applies brand locks, `loadStore`, `storeStaff` = own + visiting), `lib/org-admin.ts` (`requireOrg`, `pushSetup`, `addSite`). Group UI under `app/org/[orgId]`.
- Cross-site legality: `loadProblem` sends shifts at sister sites (and neighbouring weeks) as `edgeShifts`; the solver treats ones inside the week as fixed commitments (`Problem.fixed`, `clash_with_edges`). Visitors have contract 0 at a visited site.
- Pay & compliance: `lib/pay.ts` (NMW table by April date, `rateFor`, `labourCost`), `lib/compliance.ts` (wage / right-to-work / qualification flags). Qualification roles have expiry dates on the employee (`qualificationExpiry`); `loadProblem` drops expired ones.
- Time & attendance: clock-in only happens on the site's kiosk (`app/kiosk/[storeId]`, session kind "kiosk" which `getAccess` rejects for every manager/staff page). Staff pick their name + PIN; the PIN is re-checked on every action (`lib/timesheets.ts` `kioskLookup`/`kioskAct`; only wrong PINs count towards the limit). `TimeEntry.breaks` holds break periods; `breakMinutes` is their total. `lib/clock.ts` has the break maths. No phone clock-in, geofence or daily codes: removed on purpose (spoofable).
- Open shifts & sickness: `lib/open-shifts.ts`. Only managers mark someone sick (`markSick`, from the shift log); staff get "Call the store" (`Store.phone`). Sick = off the published rota + absence + open shift; claims are rule-checked on claim and on approval.
- Notifications go through `lib/notify.ts` (email + web push + SMS by the person's prefs). Scheduled work is in `lib/jobs.ts`, called by `/api/cron/daily` and `/api/cron/frequent`.
- AI, email login and clock codes are rate-limited (`lib/rate-limit.ts`, in-memory).
- Nav sections now include Timesheets (`timesheets.approve`) and Reports (`reports.view`). New staff-app strings must be added to all 8 languages.
- `e2e/smoke.mjs` is the end-to-end check (fresh demo data required).
- Database: `lib/db/index.ts` picks Postgres (`DATABASE_URL`, `lib/db/postgres.ts`, `pg` pool) > Supabase > demo JSON file. Local dev Postgres lives in `.pgdata` on port 5433 (`scripts/pg.mjs`, `npm run db:*`); `npm run demo` starts it. Schema = `supabase/migrations/*.sql` (`*_rls.sql` is Supabase-only). New columns: add a migration file AND the field in `types.ts` (snake_case column = camelCase field). The demo seeds into an empty Postgres on first `db()` (`lib/db/pg-seed.ts`, advisory-locked).
