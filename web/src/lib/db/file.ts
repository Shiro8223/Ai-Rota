import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { Db, ListOpts, TableName, Tables, Where } from "./index";
import { seedDemo } from "../seed";

type Data = { [N in TableName]: Tables[N][] };
const EMPTY: Data = { organisations: [], org_members: [], stores: [], store_members: [], roles: [], employees: [], availability: [], rules: [], rotas: [], rota_history: [], swap_requests: [], holidays: [], change_requests: [], time_entries: [], absences: [], open_shifts: [], rota_templates: [], audit_log: [], ai_calls: [], emails: [] };

const FILE = process.env.DEMO_DB_FILE ?? path.join(process.cwd(), ".data", "demo-db.json");

// Kept on globalThis so dev-server hot reloads share one copy.
const g = globalThis as unknown as { __rotaDemo?: Data };

function load(): Data {
  if (g.__rotaDemo) return g.__rotaDemo;
  let data: Data;
  if (fs.existsSync(FILE)) {
    data = { ...EMPTY, ...JSON.parse(fs.readFileSync(FILE, "utf8")) };
  } else {
    data = structuredClone(EMPTY);
    seedDemo(data);
    persist(data);
  }
  g.__rotaDemo = data;
  return data;
}

function persist(data: Data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, FILE);
}

const matches = <T>(row: T, where?: Where<T>) => !where || Object.entries(where).every(([k, v]) => (row as Record<string, unknown>)[k] === v);

export class FileDb implements Db {
  async list<N extends TableName>(table: N, where?: Where<Tables[N]>, opts: ListOpts<Tables[N]> = {}) {
    let rows = (load()[table] as Tables[N][]).filter((r) => matches(r, where));
    if (opts.orderBy) {
      const k = opts.orderBy;
      rows = [...rows].sort((a, b) => {
        const av = a[k] as unknown as string | number;
        const bv = b[k] as unknown as string | number;
        return (av < bv ? -1 : av > bv ? 1 : 0) * (opts.desc ? -1 : 1);
      });
    }
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return structuredClone(rows);
  }

  async get<N extends TableName>(table: N, id: string) {
    const row = (load()[table] as (Tables[N] & { id: string })[]).find((r) => r.id === id);
    return row ? structuredClone(row) : null;
  }

  async insert<N extends TableName>(table: N, row: Tables[N]) {
    const data = load();
    (data[table] as Tables[N][]).push(structuredClone(row));
    persist(data);
    return row;
  }

  async update<N extends TableName>(table: N, id: string, patch: Partial<Tables[N]>) {
    const data = load();
    const rows = data[table] as (Tables[N] & { id: string })[];
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) throw new Error(`${table} ${id} not found`);
    rows[i] = { ...rows[i], ...structuredClone(patch) };
    persist(data);
    return structuredClone(rows[i]);
  }

  async remove<N extends TableName>(table: N, where: Where<Tables[N]>) {
    if (!where || Object.keys(where).length === 0) throw new Error("refusing to delete without a filter");
    const data = load();
    (data as Record<string, unknown[]>)[table] = (data[table] as Tables[N][]).filter((r) => !matches(r, where));
    persist(data);
  }
}

/** Wipe and re-seed the demo database (Settings → Reset demo). */
export function resetDemo() {
  const data = structuredClone(EMPTY);
  seedDemo(data);
  persist(data);
  g.__rotaDemo = data;
}
