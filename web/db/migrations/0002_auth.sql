-- Manager sign-in without a third-party auth service: one-time email codes, then the app's
-- own signed session cookie (web/src/lib/session.ts).
create table users (
  id text primary key,
  email text not null unique, -- stored lower-case
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

-- A 6-digit code is emailed; only its HMAC is stored. Codes expire after 10 minutes and
-- allow 5 tries. Old rows are purged by the daily job.
create table login_codes (
  id text primary key,
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index on login_codes (email, created_at desc);
