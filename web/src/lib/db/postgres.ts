import "server-only";
import pg from "pg";
import type { Db, ListOpts, TableName, Tables, Where } from "./index";

// Postgres returns DATE as a JS Date, NUMERIC and BIGINT as strings. The app works in
// "YYYY-MM-DD" strings, ISO timestamps and numbers, so read them that way.
pg.types.setTypeParser(1082, (v) => v); // date
pg.types.setTypeParser(1184, (v) => new Date(v).toISOString()); // timestamptz
pg.types.setTypeParser(1114, (v) => new Date(`${v}Z`).toISOString()); // timestamp
pg.types.setTypeParser(1700, (v) => Number(v)); // numeric
pg.types.setTypeParser(20, (v) => Number(v)); // int8

// Columns are snake_case, the app is camelCase. Only top-level keys are mapped: JSONB
// columns (shift templates, assignments, breaks...) are stored as-is.
const toSnake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const SAFE = /^[a-z_][a-z0-9_]*$/;
const ident = (k: string) => {
  const s = toSnake(k);
  if (!SAFE.test(s)) throw new Error(`bad column name: ${k}`);
  return `"${s}"`;
};
const TABLES = new Set<TableName>(["organisations", "org_members", "stores", "store_members", "roles", "employees", "availability", "rules", "rotas", "rota_history", "swap_requests", "holidays", "time_entries", "absences", "open_shifts", "rota_templates", "change_requests", "audit_log", "ai_calls", "emails", "users", "login_codes"]);
const table = (t: TableName) => {
  if (!TABLES.has(t)) throw new Error(`unknown table: ${t}`);
  return `"${t}"`;
};
/** Objects and arrays go into JSONB columns as JSON (pg would otherwise send arrays as Postgres arrays). */
const value = (v: unknown) => (v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v);
const out = <T>(row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([k, v]) => [toCamel(k), v])) as T;
const defined = (o: object) => Object.entries(o).filter(([, v]) => v !== undefined);

function whereSql(where: object | undefined, params: unknown[]) {
  const parts = defined(where ?? {}).map(([k, v]) => {
    if (v === null) return `${ident(k)} is null`;
    params.push(value(v));
    return `${ident(k)} = $${params.length}`;
  });
  return parts.length ? ` where ${parts.join(" and ")}` : "";
}

/**
 * Plain Postgres (local or any hosted Postgres), via DATABASE_URL. Server-side only; every
 * call site has passed an access check in lib/auth.ts first. All values are parameterised
 * and table/column names come from a fixed list or a strict pattern.
 */
export class PostgresDb implements Db {
  private pool: pg.Pool;

  constructor(url = process.env.DATABASE_URL!) {
    // One pool per server process, kept across dev hot reloads.
    const g = globalThis as unknown as { __rotaPg?: pg.Pool };
    this.pool = g.__rotaPg ??= new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000 });
  }

  /** A dedicated connection (for session-level locks); release it when done. */
  connect() {
    return this.pool.connect();
  }

  async query<R extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    return this.pool.query<R>(sql, params);
  }

  async list<N extends TableName>(t: N, where?: Where<Tables[N]>, opts: ListOpts<Tables[N]> = {}) {
    const params: unknown[] = [];
    let sql = `select * from ${table(t)}${whereSql(where, params)}`;
    if (opts.orderBy) sql += ` order by ${ident(opts.orderBy)} ${opts.desc ? "desc" : "asc"}`;
    if (opts.limit) {
      params.push(Math.max(1, Math.floor(opts.limit)));
      sql += ` limit $${params.length}`;
    }
    const r = await this.pool.query(sql, params);
    return r.rows.map((row) => out<Tables[N]>(row));
  }

  async get<N extends TableName>(t: N, id: string) {
    const r = await this.pool.query(`select * from ${table(t)} where id = $1`, [id]);
    return r.rows[0] ? out<Tables[N]>(r.rows[0]) : null;
  }

  async insert<N extends TableName>(t: N, row: Tables[N]) {
    const cols = defined(row);
    const sql = `insert into ${table(t)} (${cols.map(([k]) => ident(k)).join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning *`;
    const r = await this.pool.query(sql, cols.map(([, v]) => value(v)));
    return out<Tables[N]>(r.rows[0]);
  }

  async update<N extends TableName>(t: N, id: string, patch: Partial<Tables[N]>) {
    const cols = defined(patch).filter(([k]) => k !== "id");
    if (!cols.length) {
      const row = await this.get(t, id);
      if (!row) throw new Error(`${t} ${id} not found`);
      return row;
    }
    const sql = `update ${table(t)} set ${cols.map(([k], i) => `${ident(k)} = $${i + 1}`).join(", ")} where id = $${cols.length + 1} returning *`;
    const r = await this.pool.query(sql, [...cols.map(([, v]) => value(v)), id]);
    if (!r.rows[0]) throw new Error(`${t} ${id} not found`);
    return out<Tables[N]>(r.rows[0]);
  }

  async remove<N extends TableName>(t: N, where: Where<Tables[N]>) {
    if (!where || defined(where).length === 0) throw new Error("refusing to delete without a filter");
    const params: unknown[] = [];
    await this.pool.query(`delete from ${table(t)}${whereSql(where, params)}`, params);
  }
}

/** Tables in foreign-key order (parents first), for seeding and wiping. */
export const TABLE_ORDER: TableName[] = ["organisations", "stores", "org_members", "store_members", "roles", "employees", "availability", "rules", "rotas", "rota_history", "swap_requests", "holidays", "change_requests", "time_entries", "absences", "open_shifts", "rota_templates", "audit_log", "ai_calls", "emails", "users", "login_codes"];
