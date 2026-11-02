import "server-only";
import type { Absence, AiCall, AuditEntry, Availability, ChangeRequest, OpenShift, RotaTemplate, TimeEntry, EmailMsg, Employee, LoginCode, User, HolidayRequest, Organisation, OrgMember, Role, Rota, RotaHistory, Rule, Store, StoreMember, SwapRequest } from "../types";

export interface Tables {
  organisations: Organisation;
  org_members: OrgMember;
  stores: Store;
  store_members: StoreMember;
  roles: Role;
  employees: Employee;
  availability: Availability;
  rules: Rule;
  rotas: Rota;
  rota_history: RotaHistory;
  swap_requests: SwapRequest;
  holidays: HolidayRequest;
  time_entries: TimeEntry;
  absences: Absence;
  open_shifts: OpenShift;
  rota_templates: RotaTemplate;
  change_requests: ChangeRequest;
  audit_log: AuditEntry;
  ai_calls: AiCall;
  emails: EmailMsg;
  users: User;
  login_codes: LoginCode;
}
export type TableName = keyof Tables;
export type Where<T> = Partial<{ [K in keyof T]: T[K] }>;
export interface ListOpts<T> { orderBy?: keyof T & string; desc?: boolean; limit?: number }

/**
 * Tiny generic data API over Postgres (DATABASE_URL) or, for the demo, a JSON file. Every query from a page is scoped by storeId after an access check
 * in lib/auth.ts.
 */
export interface Db {
  list<N extends TableName>(table: N, where?: Where<Tables[N]>, opts?: ListOpts<Tables[N]>): Promise<Tables[N][]>;
  get<N extends TableName>(table: N, id: string): Promise<Tables[N] | null>;
  insert<N extends TableName>(table: N, row: Tables[N]): Promise<Tables[N]>;
  update<N extends TableName>(table: N, id: string, patch: Partial<Tables[N]>): Promise<Tables[N]>;
  remove<N extends TableName>(table: N, where: Where<Tables[N]>): Promise<void>;
}

/**
 * Demo/dev conveniences (one-click logins with dummy data, simulated billing, emails kept in
 * the outbox) are on with DEMO_MODE=1, and always when there's no database (the JSON file is
 * demo-only). A real deployment sets DATABASE_URL and leaves DEMO_MODE unset.
 */
export const isDemo = () => /^(1|true|yes)$/i.test(process.env.DEMO_MODE ?? "") || !process.env.DATABASE_URL;

/** Where data lives: Postgres (DATABASE_URL: local, Neon or any host) or the demo JSON file. */
export const dbKind = (): "postgres" | "file" => (process.env.DATABASE_URL ? "postgres" : "file");

let instance: Db | null = null;
export async function db(): Promise<Db> {
  if (instance) return instance;
  const kind = dbKind();
  if (kind === "postgres") {
    const { PostgresDb } = await import("./postgres");
    const pgdb = new PostgresDb();
    if (isDemo()) await (await import("./pg-seed")).seedIfEmpty(pgdb);
    instance = pgdb;
  } else {
    const { FileDb } = await import("./file");
    instance = new FileDb();
  }
  return instance;
}

/** Settings → Reset demo data: wipe and re-seed whichever demo store is in use. */
export async function resetDemoData() {
  if (!isDemo()) throw new Error("Only in demo/dev mode");
  if (dbKind() === "postgres") {
    const { PostgresDb } = await import("./postgres");
    await (await import("./pg-seed")).reseed(new PostgresDb());
  } else {
    (await import("./file")).resetDemo();
  }
}

export const newId = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
