import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Db, ListOpts, TableName, Tables, Where } from "./index";

// Postgres columns are snake_case; the app is camelCase. Only top-level keys are mapped -
// JSONB columns (shift templates, constraints, assignments...) are stored as-is.
const toSnake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const mapKeys = (o: Record<string, unknown>, f: (k: string) => string) => Object.fromEntries(Object.entries(o).map(([k, v]) => [f(k), v]));
const out = <T>(row: Record<string, unknown>) => mapKeys(row, toCamel) as T;

/**
 * Server-side only. Uses the service-role key, so every call site must have passed an
 * access check in lib/auth.ts first (they all go through requireStore / requireStaff).
 * RLS policies in supabase/migrations protect the tables from the browser-side anon key.
 */
export class SupabaseDb implements Db {
  private sb: SupabaseClient;

  constructor() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    this.sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  async list<N extends TableName>(table: N, where?: Where<Tables[N]>, opts: ListOpts<Tables[N]> = {}) {
    let q = this.sb.from(table).select("*");
    if (where && Object.keys(where).length) q = q.match(mapKeys(where as Record<string, unknown>, toSnake));
    if (opts.orderBy) q = q.order(toSnake(opts.orderBy), { ascending: !opts.desc });
    if (opts.limit) q = q.limit(opts.limit);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data ?? []).map((r) => out<Tables[N]>(r));
  }

  async get<N extends TableName>(table: N, id: string) {
    const { data, error } = await this.sb.from(table).select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(`${table}: ${error.message}`);
    return data ? out<Tables[N]>(data) : null;
  }

  async insert<N extends TableName>(table: N, row: Tables[N]) {
    const { data, error } = await this.sb.from(table).insert(mapKeys(row as unknown as Record<string, unknown>, toSnake)).select("*").single();
    if (error) throw new Error(`${table}: ${error.message}`);
    return out<Tables[N]>(data);
  }

  async update<N extends TableName>(table: N, id: string, patch: Partial<Tables[N]>) {
    const { data, error } = await this.sb.from(table).update(mapKeys(patch as Record<string, unknown>, toSnake)).eq("id", id).select("*").single();
    if (error) throw new Error(`${table}: ${error.message}`);
    return out<Tables[N]>(data);
  }

  async remove<N extends TableName>(table: N, where: Where<Tables[N]>) {
    if (!where || Object.keys(where).length === 0) throw new Error("refusing to delete without a filter");
    const { error } = await this.sb.from(table).delete().match(mapKeys(where as Record<string, unknown>, toSnake));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

/** Anon-key client used only for manager magic-link sign-in. */
export function authClient() {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set");
  return createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false, flowType: "implicit" } });
}
