import "server-only";
import { seedDemo } from "../seed";
import type { TableName, Tables } from "./index";
import { PostgresDb, TABLE_ORDER } from "./postgres";

type Data = { [N in TableName]: Tables[N][] };
const empty = () => Object.fromEntries(TABLE_ORDER.map((t) => [t, []])) as unknown as Data;
const SEED_LOCK = 72_431; // any fixed number: stops two first requests seeding at once

async function seed(db: PostgresDb) {
  const data = empty();
  seedDemo(data);
  for (const t of TABLE_ORDER) for (const row of data[t]) await db.insert(t, row as never);
}

/** Run `fn` holding the seed lock on one connection (session locks belong to a connection). */
async function locked(db: PostgresDb, fn: () => Promise<void>) {
  const c = await db.connect();
  try {
    await c.query("select pg_advisory_lock($1)", [SEED_LOCK]);
    try {
      await fn();
    } finally {
      await c.query("select pg_advisory_unlock($1)", [SEED_LOCK]);
    }
  } finally {
    c.release();
  }
}

/** First run in dev: load the demo group (Leeds + York) into an empty database. */
export async function seedIfEmpty(db: PostgresDb) {
  await locked(db, async () => {
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from stores");
    if (rows[0].n === 0) await seed(db);
  });
}

export async function reseed(db: PostgresDb) {
  await locked(db, async () => {
    await db.query(`truncate ${TABLE_ORDER.map((t) => `"${t}"`).join(", ")} cascade`);
    await seed(db);
  });
}
