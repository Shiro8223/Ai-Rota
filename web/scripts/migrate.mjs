// Applies db/migrations/*.sql that haven't run yet, in order, each in a transaction.
// Runs before every build (so a Vercel deploy migrates Neon) and from `npm run db:migrate`.
// No DATABASE_URL = nothing to do (demo JSON file).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("migrate: no DATABASE_URL, skipping (demo file database)");
  process.exit(0);
}
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("select pg_advisory_lock(72432)"); // one migrator at a time
  await client.query("create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await client.query("select name from _migrations")).rows.map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let applied = 0;
  for (const f of files) {
    if (done.has(f)) continue;
    await client.query("begin");
    try {
      await client.query(fs.readFileSync(path.join(dir, f), "utf8"));
      await client.query("insert into _migrations (name) values ($1)", [f]);
      await client.query("commit");
      console.log(`migrate: applied ${f}`);
      applied++;
    } catch (e) {
      await client.query("rollback");
      console.error(`migrate: ${f} failed: ${e.message}`);
      process.exitCode = 1;
      break;
    }
  }
  if (!applied && !process.exitCode) console.log(`migrate: up to date (${files.length} migrations)`);
} finally {
  await client.end();
}
