# AI Rota Agent

Weekly rotas for UK restaurants. Managers write rules in plain English, AI turns each one into a structured constraint, an OR-Tools solver builds the rota, and the manager approves it. Staff swap shifts from their phones, and every swap is checked against the same rules.

The full spec is in `MVP_SPEC.md`. All seven milestones are built.

## Run the demo (dummy data, no accounts needed)

```bash
npm run setup   # first time only: Python venv for the solver + npm install
npm run demo    # starts the solver (:8000) and the web app (:3000)
```

Open http://localhost:3000 and click **Enter as manager**, or open "enter as a member of staff". The demo store is **Test Wings, Leeds**:
- 15 staff with mixed tenure, roles and availability, including two under-18s
- 5 confirmed rules (including a `never_together` pair) and 1 rule waiting for confirmation
- this week's rota already approved, with one open swap from Mia

Staff can also use the real login form: store code `WINGS1`, PINs `1001`–`1015` in staff-list order.

Demo mode turns on automatically when `SUPABASE_URL` is not set. Data lives in `web/.data/demo-db.json`. **Settings → Reset demo data** restores it. Emails go to **Settings → View the demo email outbox**, and the billing buttons are simulated. Without an `ANTHROPIC_API_KEY`, rules are read by an offline translator that understands common phrasings. Add a key to use Claude.

### Things to try
1. **Rota →** next week **→ Generate rota.** Switch between **Week** and **Day by hour** (an hourly timeline coloured by shift type, with a staffing-coverage row). Drag people between shifts, and watch the live rule check.
2. Use **+ Add person** to pick someone listed under *Outside availability*. They're flagged until they agree. Publish, then enter as that person on the login page and tap **I agree**.
3. Enter as **Casey** (a server): the swap board shows only servers' shifts. Enter as **Ben** (a cook): he doesn't see it. Take the swap as Casey, then approve it in **Approvals**.
4. **Approvals** has Harry's (student) exam-time request waiting. It shows the change day by day and any published shifts it clashes with. Approved temporary patterns switch back to the usual pattern by themselves.
5. As staff, change your usual availability under **Availability**. It goes to the manager for approval.
6. **Rules →** "Harry can't work Fridays". **Shifts →** change a shift type's colour. **Staff → Import CSV / Excel**.

### Roles, access and features
- **Account Primary** (whoever created the location) always has full access and an **Admin** tab with three areas:
  - **Roles & permissions:** create roles of four types: *job/department* (Front of House, Back of House…), *access level* (Manager, Shift Lead…), *contract* (Full-time/Part-time, one per person) and *status* (Under 18 and Student are built in and drive the law checks and term-time availability). Each role can carry any of 11 permissions. Permission presets: No access, Supervisor, Manager, Full access. Role presets: Restaurant, Café, Bar & pub (these only add missing roles).
  - **Team access:** invite managers by email with access roles; see which PIN staff have manager tools.
  - **Features:** 10 site-wide switches (swaps, same-job swaps, staff availability edits, temporary availability, out-of-availability asks, day view, print, AI rules, import, emails) with presets Standard / Essentials / Manager-led.
- People hold several roles; their access is the union of their roles' permissions. Only people with the admin permission can grant access roles.
- Staff whose roles carry permissions get a **Manager tools** button in their phone app and only see what they're allowed (try Priya or Alex in the demo).
- Rules can target any role ("No more than 2 students on close").

### Franchise groups (several sites)
The demo signs in to **Test Wings Group** (Leeds + York). The group owner gets:
- **Group dashboard** (`/org/...`): every site's this/next week rota status, legal/contract problems, hours vs contracts, holidays, and one approvals list across all sites.
- **Brand & sites**: copy roles, shift types, rules, features and holiday allowance from one site to others; brand feature defaults with **locks** sites can't change; a brand holiday allowance (optionally locked); add a site set up like an existing one; **area managers** with chosen permissions at chosen sites.
- **Shared staff**: on a person's staff page, tick other sites under "Also works at". They then appear on those sites' rotas, and every site's solver counts their shifts elsewhere, so 11h rest, weekly rest, one-shift-a-day, weekly hour limits and under-18 rules hold across sites. Their contract is met at their home site, counting hours worked elsewhere. Their phone shows shifts at every site, labelled by site.

### Legal compliance (UK Working Time Regulations)
Checked on every rota and swap; legal problems and unmet contracts block publishing and can't be overridden:
- **Contracted hours are mandatory**: the solver gives everyone at least their contract. If availability makes that impossible it says so ("Harry's availability this week only allows 11h, below his 16h contract").
- **11h rest between shifts** (12h for under-18s), including **across weeks**: Sunday's close is checked against Monday's open using the neighbouring weeks' rotas, so rolling rotas never break it.
- **Weekly rest**: a 24h break each week (48h for under-18s), counted from last week's final shift.
- **Rest breaks**: shift types carry an unpaid break; 20 minutes is required over 6 working hours, and under-18s need 30 minutes over 4.5 hours. Paid hours exclude breaks.
- **Under-18s**: no work 22:00–06:00, max 8h a day and 40h a week.
- Over 48h in a week shows a signed-opt-out warning.
When a week can't be built, the solver names the short list of requirements that clash (e.g. "Dan's 24h contract, Grace's 20h contract, Rule: never put two new starters on closing").

### The 24-hour rule
Once a week is published, changes to shifts starting within 24 hours can't be made directly. When you republish, those changes go to the staff affected as **suggestions** in their app; nothing changes unless they accept (accepting re-runs the legal checks). Shifts that have already started can't be changed. Changes further out apply normally. While you edit an unlocked week, staff keep seeing the last published version.

### Holiday booking
Staff request a date range, paid or unpaid, from the **Holiday** tab in their app. Paid holiday comes out of an allowance of X days or hours that refreshes every year (from a chosen month), quarter or month, optionally pro rata by contract hours. The Account Primary sets it in **Admin → Holidays**: generally, per role, or per person (most specific wins), with a balances table and a warning below the UK 5.6-week statutory minimum. Requests appear in **Approvals → Holiday requests** (below shift swaps and availability changes) with the balance before/after, clashing published shifts and who else is off. Approved holiday makes the person unavailable on the rota and reduces that week's mandatory contract hours by a day's worth per holiday day.

### Other features
- **Shift types** (Shifts page): pick one to edit times, unpaid break, colour, days, staffing levels and **required service roles** (e.g. Close needs 1 Shift Lead + 2 Back of House). Each rota shift shows whether they're met.
- **Rota assistant** (button on the rota page, managers/admins): "Can John have this weekend off?" re-solves the week to answer with who would cover and whether the contract is still met; "Add a rule for this week: …" drafts week-only or permanent rules for you to confirm. Uses Claude when `ANTHROPIC_API_KEY` is set, otherwise an offline demo mode.
- **Staff search** with role/status filters, sorting and pagination.
- **Staff stats**: hours and shifts worked this week, month and year, and average week vs contract.
- **Languages**: English, Polski, Română, Español, Português, Italiano, Français, Українська for login, the staff app and navigation (manager pages beyond navigation are English for now).

### Pay, labour cost and compliance
- **Pay rates** per role (Admin → Roles) or per person (staff page → Compliance & pay). Only people with the `pay.view` permission see them, and they're never sent to the AI.
- **Labour cost** panel on the rota (feature "Labour cost"): cost per day and against the weekly budget set in Settings.
- **Minimum wage** check by age band (rates by April date in `web/src/lib/pay.ts`: add each year's new row).
- **Right to work**, **48-hour opt-out** dates and **qualifications with expiry** (Personal Licence Holder, Food Hygiene, First Aider). Expired qualifications stop counting towards shift requirements. Problems show on the staff list, each person's page and the group dashboard.
- **Holiday accrual** mode (12.07% of hours worked) for irregular-hours staff, alongside fixed allowances.

### Time & attendance and payroll
- **Clock-in screen** (Shift log → Start clock-in screen): a tablet by the door, in the brand colours and the 8 staff languages. Staff search for their name (filters: Upcoming shift = rostered today but not clocked in yet, Working, On break), enter their 4-digit PIN, see today's shift, and Clock in / Take break / End break / Clock out. Each action shows its times (break start/end and total; on clock-out the start, finish, break deducted and total worked) and then returns to the list. Starting it signs the manager out on that device, so it can only be used for clocking in (in demo mode a "Back to manager" button skips signing in again). The PIN is checked on every action; 5 wrong PINs lock that person out for 10 minutes. There is no clock-in from personal phones (no location or code to spoof).
- **Shift log**: a month calendar (dots for who's in now, shifts to approve and missed clock-ins); pick a day to see that day's staff with rostered vs clocked times and every break, filters (Working now, On break, Breaks remaining, To approve, No clock-in), "short of legal break" flags, approve all or one by one, edit clock-in/out and breaks, hand-added hours (all audited with before/after), and **Mark off sick**.
- **Payroll export** CSV: generic, Sage-style, Xero-style and BrightPay-style layouts, with paid holiday hours and sick days. Check the first export against your payroll setup: codes differ.
- **Sickness**: staff can't give shifts away from the app; they use **Call the store** (rings the number set in Settings). A manager then marks them off sick in the shift log: they come off the rota, the absence is recorded and the shift becomes an **open shift**.
- **Open shifts**: offered to colleagues with the right job who are available (including sister sites); claims are rule-checked and a manager approves them in Approvals. Managers can also post unfilled shifts.

### Day to day
- **Copy last week**, saved **rota templates**, and **clear day/week** (Rota → Copy & templates). Locked shifts (within 24h) are kept.
- **Reports** (site and group): hours by job, hours over contract, fair share of closes and weekends, sick days, holiday still owed (valued with pay permission). CSV download.
- **Notifications**: email always; **web push** when `VAPID_*` keys are set and the person allows it (bell in the staff app); **SMS** via Twilio when configured and the person opts in. Evening-before **shift reminders** and **no-show alerts** run from the cron jobs.
- **Installable staff app** (PWA manifest + service worker; nothing personal is cached offline).
- **Getting started** checklist for new sites (Settings → Getting started, or the banner on an empty rota).
- **Import** recognises staff exports from Deputy, RotaCloud and similar (first/last name, mobile, payroll ID; date of birth only sets under-18 and wage band and isn't stored).

### What always needs a manager
- Publishing a rota, and any change to a published one (unlock, edit, republish).
- Every shift swap (rule-checked first, and only offered to people with the same role).
- Staff changes to their usual or temporary availability.
- Shifts outside someone's availability can only be added by hand, and the person must agree. If they decline, the manager is told and must reassign the shift.

UK working-time rules are always checked and can never be overridden: 11h between shifts (12h under 18), a 24h break each week (48h under 18), and under-18s not working 22:00–06:00 or over 8h a day / 40h a week. Over 48h a week shows a signed-opt-out warning.

## Database

Two options, picked automatically:

| | When | Data lives in |
| --- | --- | --- |
| **Postgres** | `DATABASE_URL` is set | Any Postgres 15+: the local one below, or Neon on Vercel |
| **Demo file** | no `DATABASE_URL` | `web/.data/demo-db.json` |

**Local Postgres (recommended for development):**

```bash
npm run db:setup   # once: creates .pgdata, applies supabase/migrations, writes DATABASE_URL to web/.env.local
npm run demo       # starts Postgres too; the demo group (Leeds + York) loads on first visit
```

It's a private cluster inside the project on `127.0.0.1:5433` (no password, not reachable from other machines), separate from any Postgres service you already run. It uses the PostgreSQL programs on your machine (`PG_BIN` to point elsewhere). Other commands: `db:start`, `db:stop`, `db:status`, `db:migrate` (applies new files in `web/db/migrations`), `db:reset` (wipe; the demo reloads on next start), `db:psql`. **Settings → Reset demo data** also works on Postgres.

`db:setup` also sets `DEMO_MODE=1` locally, which keeps the one-click demo logins and simulated billing. Leave it unset in production (see Deployment).

Adapter tests: `TEST_DATABASE_URL=postgres://rota@127.0.0.1:5433/rota_test npm --prefix web test` (create `rota_test` and run `DATABASE_URL=…/rota_test node web/scripts/migrate.mjs` first; the tests wipe it).

## Layout

| Path | What |
| --- | --- |
| `solver/` | Python FastAPI + OR-Tools CP-SAT. `POST /solve` builds a rota; `POST /check` runs `check_rota`, the one rule checker used for solver output, live warnings and swaps. |
| `web/` | Next.js 15 (App Router, TypeScript, Tailwind 4). Server actions call the solver and Claude. |
| `web/fixtures/test-wings-leeds.json` | Demo store and staff, shared by the solver tests and the web seed. `demoRota` is generated by `solver/scripts/make_demo_rota.py`. |
| `supabase/migrations/` | Production schema with row-level security per store. |

## Tests

```bash
npm test        # web unit tests (vitest) + solver tests (pytest)
# end to end, against a fresh demo (delete web/.data, then npm run demo):
npm --prefix e2e install && node e2e/smoke.mjs
```

CI (`.github/workflows/ci.yml`) runs type-checking, both unit suites and the e2e smoke test.

## Deployment (Vercel)

Two Vercel projects, both deployed from this repo:

| Project | Folder | URL |
| --- | --- | --- |
| `rota-agent` | `web/` (Next.js) | https://rota-agent.vercel.app |
| `rota-agent-solver` | `solver/` (FastAPI on Vercel's Python runtime) | https://rota-agent-solver.vercel.app |

Deploy from each folder: `cd solver && npx vercel@latest deploy --prod`, then `cd web && npx vercel@latest deploy --prod`. To deploy on every push instead, connect the GitHub repo to each project in the Vercel dashboard and set its **Root Directory** to `web` or `solver`.

Environment variables (Vercel → Project → Settings → Environment Variables):

- **rota-agent-solver:** `SOLVER_API_KEY` (random; same value as on the web project).
- **rota-agent:** `SESSION_SECRET` (random, 32+ characters), `SOLVER_URL` (the solver URL), `SOLVER_API_KEY`, and either:
  - **Demo:** `DEMO_MODE=1`. Without a database it also needs `DEMO_DB_FILE=/tmp/demo-db.json`, which is per server instance and resets on cold starts. Add Neon (below) for demo data that persists.
  - **Real use:** `DATABASE_URL` (Neon) with `DEMO_MODE` unset, plus `RESEND_API_KEY` and `EMAIL_FROM` for sign-in codes. `CRON_SECRET` for the scheduled jobs.

**Database: Neon Postgres.** Vercel → Storage → Create → Neon (free tier, pick an EU region) → connect it to `rota-agent`. That adds `DATABASE_URL`; the next deploy runs the migrations (`web/scripts/migrate.mjs` runs before every build) and, in demo mode, loads the demo data on first visit. Remove `DEMO_DB_FILE` once `DATABASE_URL` is there.

Scheduled jobs (`web/vercel.json`, times in UTC): `/api/cron/daily` at 03:00 (expire stale change requests, 30-day purge, old sign-in codes) and `/api/cron/frequent` at 17:00 (evening-before reminders). On the Hobby plan crons can only run daily; on Pro change `frequent` to `*/15 * * * *` to get no-show alerts too. Set `MONITORING_WEBHOOK` to receive server errors (route and message only).

**Sign-in:** managers sign in with a one-time 6-digit code emailed through Resend (no passwords, no third-party auth service). Codes are stored only as an HMAC, last 10 minutes and allow 5 tries. Staff sign in with the store code and their PIN, as before.

**Before the first paying customer:**
1. Switch off demo mode (`DEMO_MODE` unset) with Neon and Resend configured; create your account by signing in with your email at `/login`, then add your first site.
2. Stripe: create Starter (£39) and Pro (£79) monthly prices, set the price IDs, and point a webhook at `/api/stripe/webhook` for `checkout.session.completed` and `customer.subscription.*`.
3. Register with the ICO, and get a solicitor to review the **draft** terms, privacy notice and DPA at `/legal/terms`, `/legal/privacy`, `/legal/dpa`.

## Notes and limits
- The solver stops after 10 seconds per week (`SOLVER_TIME_LIMIT`) and returns the best rota found, which has always been fine for teams under 50.
- Only the web server talks to the database, after its own per-store access check (`lib/auth.ts`); nothing in the browser can reach it.
- Tested end to end: demo mode locally and on Vercel (with the deployed solver). The Postgres adapter and email sign-in are covered by tests against real Postgres. Real (non-demo) mode with Neon + Resend hasn't been run against live accounts yet.
- Web push, SMS (Twilio), Resend sign-in emails, Stripe group billing and the payroll layouts are written against the providers' documented APIs/formats but not exercised against live accounts.
- Rate limiting is in memory per server instance; on multi-instance hosting put a shared store (e.g. Upstash Redis) behind `lib/rate-limit.ts`.
- Manager pages beyond navigation are still English only.
