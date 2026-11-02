-- AI Rota Agent: initial schema, for any Postgres 15+ (local: `npm run db:setup`; hosted: Neon).
-- Applied in order by web/scripts/migrate.mjs (on every build, and by `npm run db:migrate`).
-- Host the project in an EU region (spec: UK/EU hosting).
--
-- Only the web app's server connects (DATABASE_URL), and every query runs after its own
-- per-store access check (web/src/lib/auth.ts). Nothing is exposed to browsers directly.

-- Franchise group: owns several sites; brand defaults and locks apply to all of them.
create table organisations (
  id text primary key,
  name text not null,
  owner_id text not null,
  features jsonb not null default '{}',
  locked_features jsonb not null default '[]',
  holiday_policy jsonb,
  lock_holiday_policy boolean not null default false,
  -- group billing (one subscription for every site, volume-priced); null = each site pays
  plan text check (plan in ('trial', 'starter', 'pro')),
  billing_status text check (billing_status in ('trialing', 'active', 'past_due', 'cancelled')),
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now()
);

-- Group-level access: the owner (every site, everything) or area managers (chosen sites/permissions).
create table org_members (
  id text primary key,
  org_id text not null references organisations(id) on delete cascade,
  user_id text not null default '',
  email text not null,
  role text not null check (role in ('owner', 'manager')),
  permissions jsonb not null default '[]',
  store_ids jsonb, -- null = every site in the group
  unique (org_id, email)
);
create index on org_members (user_id);

create table stores (
  id text primary key,
  org_id text references organisations(id) on delete set null,
  owner_id text not null,
  name text not null,
  timezone text not null default 'Europe/London',
  opening_hours jsonb not null,
  shift_templates jsonb not null default '[]',
  join_code text not null unique,
  plan text not null default 'trial' check (plan in ('trial', 'starter', 'pro')),
  billing_status text not null default 'trialing' check (billing_status in ('trialing', 'active', 'past_due', 'cancelled')),
  trial_ends_at date not null,
  cancelled_at timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  -- site-wide feature switches set by the Account Primary; a missing key means "on"
  features jsonb not null default '{}',
  -- general holiday allowance {allowance, unit, period, startMonth, proRata, fullTimeHours}
  holiday_policy jsonb,
  weekly_labour_budget numeric, -- pounds; labour cost view
  phone text, -- staff can ring it from the app ("Call the store")
  created_at timestamptz not null default now()
);

-- Email sign-in. role 'owner' = the Account Primary (always full access); everyone else gets
-- access from role_ids. user_id is '' until an invited manager first signs in.
create table store_members (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  user_id text not null default '',
  email text not null,
  role text not null check (role in ('owner', 'manager')),
  role_ids jsonb not null default '[]',
  unique (store_id, email)
);
create index on store_members (user_id);

-- Custom roles. category: job | access | contract | qualification | status. permissions: list of permission keys
-- (web/src/lib/roles.ts). system: 'under18' | 'student' for built-in roles that drive the law checks.
create table roles (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  name text not null,
  category text not null check (category in ('job', 'access', 'contract', 'qualification', 'status')),
  color text not null,
  description text not null default '',
  permissions jsonb not null default '[]',
  system text check (system in ('under18', 'student')),
  holiday_policy jsonb, -- overrides the store's for people with this role
  hourly_rate numeric, -- default pay for the role (needs the pay.view permission to see)
  created_at timestamptz not null default now(),
  unique (store_id, name)
);
create unique index roles_system_per_store on roles (store_id, system) where system is not null;

-- Data minimisation: no addresses, dates of birth, NI numbers or bank details. Pay rates are
-- optional, only visible with the pay.view permission and never sent to the AI.
create table employees (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  name text not null,
  role_ids jsonb not null default '[]',
  -- role / is_under18 / is_student are derived from role_ids by the app (web/src/lib/team.ts)
  role text not null default 'Team member',
  start_date date not null,
  contracted_hours numeric not null default 0,
  max_hours_per_week numeric not null default 40,
  is_under18 boolean not null default false,
  is_student boolean not null default false,
  email text,
  pin_hash text,
  holiday_policy jsonb, -- personal override
  allowed_store_ids jsonb not null default '[]', -- sister sites this person can also be rostered at
  hourly_rate numeric,
  age_band text check (age_band in ('21+', '18-20', '16-17', 'apprentice')), -- minimum wage band
  right_to_work_checked_at date,
  right_to_work_expires date,
  opt_out48_signed_at date, -- 48-hour week opt-out signed
  qualification_expiry jsonb not null default '{}', -- role id -> expiry date
  phone text, -- for SMS, opt-in
  payroll_id text,
  notify jsonb, -- {email, sms, push}
  push_subscriptions jsonb not null default '[]',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on employees (store_id);
create unique index employees_pin_per_store on employees (store_id, pin_hash) where pin_hash is not null;

-- kind 'default' = usual weekly pattern; 'temporary' = start_week..end_week (Mondays, inclusive),
-- after which the usual pattern applies again by itself. Staff requests stay 'pending' until a
-- manager approves them; only 'approved' rows reach the solver.
create table availability (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  employee_id text not null references employees(id) on delete cascade,
  kind text not null check (kind in ('default', 'temporary')),
  start_week date,
  end_week date,
  days jsonb not null,
  status text not null check (status in ('approved', 'pending', 'declined')),
  note text not null default '',
  requested_by text not null,
  decided_by text,
  decided_at timestamptz,
  updated_at timestamptz not null default now(),
  check (kind = 'default' or (start_week is not null and end_week is not null and end_week >= start_week))
);
create index on availability (store_id, employee_id);
create index on availability (store_id, status);

-- "constraint" holds only the structured rule. Rules never store a free-text reason.
create table rules (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  original_text text not null,
  -- null = permanent; a Monday = applies to that week only (e.g. added via the rota assistant)
  week_start date,
  "constraint" jsonb not null,
  summary text not null,
  status text not null check (status in ('pending', 'confirmed')),
  created_by text not null,
  created_at timestamptz not null default now(),
  confirmed_by text,
  confirmed_at timestamptz
);
create index on rules (store_id);

create table rotas (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  week_start date not null,
  assignments jsonb not null default '[]',
  -- people placed outside their availability by hand: [{shiftId, employeeId, status pending|agreed|declined, ...}]
  exceptions jsonb not null default '[]',
  -- what staff see: kept while a manager edits an unlocked copy
  published jsonb,
  status text not null check (status in ('draft', 'approved')),
  version integer not null default 1,
  approved_by text,
  approved_at timestamptz,
  generated_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (store_id, week_start)
);

create table rota_history (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  rota_id text not null references rotas(id) on delete cascade,
  version integer not null,
  status text not null,
  assignments jsonb not null,
  by text not null,
  reason text not null,
  at timestamptz not null default now()
);
create index on rota_history (rota_id);

create table swap_requests (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  rota_id text not null references rotas(id) on delete cascade,
  week_start date not null,
  shift_id text not null,
  from_employee_id text not null,
  to_employee_id text,
  rule_check jsonb,
  status text not null check (status in ('open', 'pending_approval', 'approved', 'declined', 'cancelled')),
  note text not null default '',
  created_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz
);
create index on swap_requests (store_id, status);

create table holidays (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  employee_id text not null references employees(id) on delete cascade,
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  paid boolean not null,
  amount numeric not null default 0,
  unit text not null check (unit in ('days', 'hours')),
  note text not null default '',
  status text not null check (status in ('pending', 'approved', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz
);
create index on holidays (store_id, status);
create index on holidays (employee_id, start_date);

-- Changes to published shifts starting within 24 hours: applied only if the person accepts.
create table change_requests (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  rota_id text not null references rotas(id) on delete cascade,
  week_start date not null,
  shift_id text not null,
  employee_id text not null,
  kind text not null check (kind in ('add', 'remove')),
  status text not null check (status in ('pending', 'accepted', 'declined', 'expired')),
  proposed_by text not null,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create index on change_requests (store_id, employee_id, status);

create table audit_log (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  actor text not null,
  action text not null,
  details jsonb not null default '{}',
  at timestamptz not null default now()
);
create index on audit_log (store_id, at desc);

create table ai_calls (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  model text not null,
  input_tokens integer not null,
  output_tokens integer not null,
  cost_usd numeric not null,
  ok boolean not null,
  demo boolean not null default false,
  at timestamptz not null default now()
);
create index on ai_calls (store_id, at);

create table emails (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  "to" text not null,
  subject text not null,
  body text not null,
  sent boolean not null,
  at timestamptz not null default now()
);
create index on emails (store_id, at desc);

-- Shift log: clock in/out and breaks from the site's clock-in screen (kiosk), or added by a manager.
-- Times are wall-clock in the site's timezone ("YYYY-MM-DDTHH:MM:SS"). break_minutes = total of breaks.
create table time_entries (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  employee_id text not null references employees(id) on delete cascade,
  week_start date not null,
  shift_id text,
  clock_in text not null,
  clock_out text,
  breaks jsonb not null default '[]', -- [{start, end}], end null while on a break
  break_minutes integer not null default 0,
  source text not null check (source in ('kiosk', 'manual')),
  status text not null check (status in ('open', 'submitted', 'approved', 'rejected')),
  note text not null default '',
  approved_by text
);
create index on time_entries (store_id, week_start);
create index on time_entries (employee_id, status);

create table absences (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  employee_id text not null references employees(id) on delete cascade,
  date date not null,
  rota_id text,
  shift_id text,
  reason text not null check (reason in ('sick', 'other')),
  note text not null default '',
  created_at timestamptz not null default now()
);
create index on absences (store_id, date);

-- Shifts offered to anyone eligible (after sickness, or unfilled); a manager approves the claim.
create table open_shifts (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  rota_id text not null references rotas(id) on delete cascade,
  week_start date not null,
  shift_id text not null,
  reason text not null check (reason in ('sick', 'unfilled', 'extra')),
  from_employee_id text,
  role_name text,
  note text not null default '',
  status text not null check (status in ('open', 'claimed', 'filled', 'cancelled')),
  claimed_by text,
  created_by text not null,
  created_at timestamptz not null default now(),
  decided_by text
);
create index on open_shifts (store_id, status);

create table rota_templates (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  name text not null,
  assignments jsonb not null,
  created_by text not null,
  created_at timestamptz not null default now()
);
