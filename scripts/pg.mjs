// Local Postgres for development, kept inside the project (.pgdata), separate from any
// Postgres service already on the machine. No password: it only listens on 127.0.0.1.
//
//   npm run db:setup   create the database, apply migrations, point web/.env.local at it
//   npm run db:start   start it            npm run db:stop    stop it
//   npm run db:migrate apply new migrations (web/db/migrations)
//   npm run db:reset   wipe everything (the app re-seeds the demo on next start)
//   npm run db:psql    SQL shell           npm run db:status  is it running?
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { root } from "./py.mjs";

export const DATA = path.join(root, ".pgdata");
export const PORT = Number(process.env.ROTA_PG_PORT ?? 5433);
const USER = "rota";
const NAME = "rota";
export const URL = `postgres://${USER}@127.0.0.1:${PORT}/${NAME}`;
const ENV_FILE = path.join(root, "web", ".env.local");

/** Postgres programs: PG_BIN, then PATH, then the usual Windows / macOS install folders. */
function bin(tool) {
  const exe = process.platform === "win32" ? `${tool}.exe` : tool;
  const dirs = [process.env.PG_BIN, ...(process.env.PATH ?? "").split(path.delimiter)];
  if (process.platform === "win32") {
    const base = "C:\\Program Files\\PostgreSQL";
    if (fs.existsSync(base)) for (const v of fs.readdirSync(base).sort((a, b) => Number(b) - Number(a))) dirs.push(path.join(base, v, "bin"));
  } else dirs.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/lib/postgresql/18/bin", "/usr/lib/postgresql/17/bin", "/usr/lib/postgresql/16/bin");
  for (const d of dirs.filter(Boolean)) if (fs.existsSync(path.join(d, exe))) return path.join(d, exe);
  console.error(`Can't find ${tool}. Install PostgreSQL 15+ or set PG_BIN to its bin folder.`);
  process.exit(1);
}

const run = (tool, args, opts = {}) => {
  const r = spawnSync(bin(tool), args, { stdio: opts.quiet ? "pipe" : "inherit", encoding: "utf8", ...opts });
  if (r.status !== 0 && !opts.allowFail) {
    if (opts.quiet) process.stderr.write(r.stderr ?? "");
    process.exit(r.status ?? 1);
  }
  return r;
};
const sql = (query) => run("psql", ["-h", "127.0.0.1", "-p", String(PORT), "-U", USER, "-d", NAME, "-v", "ON_ERROR_STOP=1", "-qtAc", query], { quiet: true }).stdout.trim();

export const psql = () => run("psql", ["-h", "127.0.0.1", "-p", String(PORT), "-U", USER, "-d", NAME]);

export function running() {
  return fs.existsSync(DATA) && run("pg_ctl", ["-D", DATA, "status"], { quiet: true, allowFail: true }).status === 0;
}

export function start() {
  if (!fs.existsSync(DATA)) {
    console.error("No local database yet. Run `npm run db:setup` first.");
    process.exit(1);
  }
  if (running()) return;
  // stdio "ignore": the server inherits pg_ctl's handles on Windows, so a pipe would never close.
  run("pg_ctl", ["-D", DATA, "-l", path.join(DATA, "server.log"), "-o", `-p ${PORT} -c listen_addresses=127.0.0.1`, "-w", "start"], { stdio: "ignore" });
  console.log(`Postgres running on 127.0.0.1:${PORT}`);
}

export function stop() {
  if (running()) run("pg_ctl", ["-D", DATA, "-m", "fast", "-w", "stop"]);
  else console.log("Not running.");
}

/** Apply new migrations with the same runner the deploy build uses (web/scripts/migrate.mjs). */
export function migrate() {
  const r = spawnSync(process.execPath, [path.join(root, "web", "scripts", "migrate.mjs")], { cwd: path.join(root, "web"), stdio: "inherit", env: { ...process.env, DATABASE_URL: URL } });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/** Point the web app at this database, keeping any other settings in .env.local. */
function writeEnv() {
  const lines = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/) : [];
  const kept = lines.filter((l) => !/^\s*(DATABASE_URL|DEMO_MODE)\s*=/.test(l));
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  // Local development keeps the one-click demo logins and dummy data.
  kept.push(`DATABASE_URL=${URL}`, "DEMO_MODE=1", "");
  fs.writeFileSync(ENV_FILE, kept.join("\n"));
  console.log(`web/.env.local -> DATABASE_URL=${URL}`);
}

export function setup() {
  if (!fs.existsSync(DATA)) {
    console.log("Creating local Postgres in .pgdata ...");
    run("initdb", ["-D", DATA, "-U", USER, "-A", "trust", "-E", "UTF8", "--no-locale"], { quiet: true });
  }
  start();
  const exists = run("psql", ["-h", "127.0.0.1", "-p", String(PORT), "-U", USER, "-d", "postgres", "-qtAc", `select 1 from pg_database where datname = '${NAME}'`], { quiet: true }).stdout.trim();
  if (exists !== "1") run("createdb", ["-h", "127.0.0.1", "-p", String(PORT), "-U", USER, NAME]);
  migrate();
  writeEnv();
  console.log("\nDone. `npm run demo` starts it with the app; the demo data loads on first visit.");
}

export function reset() {
  start();
  sql("drop schema public cascade; create schema public;");
  migrate();
  console.log("Wiped. The demo data reloads the next time the app starts.");
}
