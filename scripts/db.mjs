// Local Postgres for development: see scripts/pg.mjs.
//   npm run db:setup | db:start | db:stop | db:migrate | db:reset | db:status | db:psql
import { PORT, migrate, psql, reset, running, setup, start, stop } from "./pg.mjs";

const commands = { setup, start, stop, migrate, reset, psql, status: () => console.log(running() ? `running on 127.0.0.1:${PORT}` : "stopped") };
const fn = commands[process.argv[2]];
if (fn) fn();
else console.log(`usage: node scripts/db.mjs ${Object.keys(commands).join("|")}`);
