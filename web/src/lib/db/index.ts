import "server-only";
import type { Absence, AiCall, AuditEntry, Availability, ChangeRequest, OpenShift, RotaTemplate, TimeEntry, EmailMsg, Employee, HolidayRequest, Organisation, OrgMember, Role, Rota, RotaHistory, Rule, Store, StoreMember, SwapRequest } from "../types";

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
}
export type TableName = keyof Tables;
export type Where<T> = Partial<{ [K in keyof T]: T[K] }>;
export interface ListOpts<T> { orderBy?: keyof T & string; desc?: boolean; limit?: number }

/**
 * Tiny generic data API. Demo mode keeps everything in a JSON file; production uses
 * Supabase Postgres. Every query from a page is scoped by storeId after an access check
 * in lib/auth.ts, and Postgres row-level security (supabase/migrations) backs that up.
 */
export interface Db {
  list<N extends TableName>(table: N, where?: Where<Tables[N]>, opts?: ListOpts<Tables[N]>): Promise<Tables[N][]>;
  get<N extends TableName>(table: N, id: string): Promise<Tables[N] | null>;
  insert<N extends TableName>(table: N, row: Tables[N]): Promise<Tables[N]>;
  update<N extends TableName>(table: N, id: string, patch: Partial<Tables[N]>): Promise<Tables[N]>;
  remove<N extends TableName>(table: N, where: Where<Tables[N]>): Promise<void>;
}

export const isDemo = () => !process.env.SUPABASE_URL;

let instance: Db | null = null;
export async function db(): Promise<Db> {
  if (instance) return instance;
  if (isDemo()) {
    const { FileDb } = await import("./file");
    instance = new FileDb();
  } else {
    const { SupabaseDb } = await import("./supabase");
    instance = new SupabaseDb();
  }
  return instance;
}

export const newId = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
