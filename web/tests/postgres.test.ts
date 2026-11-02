// Integration test for the Postgres adapter. Runs only when TEST_DATABASE_URL points at a
// database with the schema applied (e.g. postgres://rota@127.0.0.1:5433/rota_test after
// `npm run db:setup` + creating rota_test). It wipes that database: never point it at real data.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PostgresDb, TABLE_ORDER } from "@/lib/db/postgres";
import { reseed } from "@/lib/db/pg-seed";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("Postgres adapter", () => {
  let db: PostgresDb;
  beforeAll(async () => {
    db = new PostgresDb(url);
    await reseed(db);
  }, 60_000);
  afterAll(async () => {
    await db.query(`truncate ${TABLE_ORDER.map((t) => `"${t}"`).join(", ")} cascade`);
    await (globalThis as unknown as { __rotaPg?: { end(): Promise<void> } }).__rotaPg?.end();
  });

  it("seeds the whole demo group through the real schema", async () => {
    const stores = await db.list("stores", {}, { orderBy: "name" });
    expect(stores.map((s) => s.id).sort()).toEqual(["demo-store", "demo-york"]);
    expect((await db.list("employees", { storeId: "demo-store" })).length).toBe(15);
    expect((await db.list("time_entries", { storeId: "demo-store" })).length).toBeGreaterThan(10);
  });

  it("reads values back in the app's shapes (dates, numbers, JSON, camelCase)", async () => {
    const e = (await db.get("employees", "emp-alex"))!;
    expect(e.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof e.contractedHours).toBe("number");
    expect(Array.isArray(e.roleIds)).toBe(true);
    expect(e.isUnder18).toBe(false);
    const s = (await db.get("stores", "demo-store"))!;
    expect(s.shiftTemplates.length).toBeGreaterThan(0);
    expect(s.createdAt).toMatch(/Z$/);
    expect(typeof s.weeklyLabourBudget).toBe("number");
    const t = (await db.list("time_entries", { storeId: "demo-store" }, { limit: 1 }))[0];
    expect(Array.isArray(t.breaks)).toBe(true);
  });

  it("filters, orders, limits and handles null filters", async () => {
    const two = await db.list("employees", { storeId: "demo-store", active: true }, { orderBy: "name", limit: 2 });
    expect(two.map((e) => e.name)).toEqual([...two.map((e) => e.name)].sort());
    expect(two).toHaveLength(2);
    const open = await db.list("time_entries", { storeId: "demo-store", clockOut: null });
    expect(open.every((x) => x.clockOut === null)).toBe(true);
  });

  it("insert, update (incl. JSON arrays) and remove", async () => {
    const id = "test-template";
    await db.insert("rota_templates", { id, storeId: "demo-store", name: "Test", assignments: [{ shiftId: "open:mon", employeeId: "emp-alex" }], createdBy: "test", createdAt: new Date().toISOString() });
    const u = await db.update("rota_templates", id, { name: "Renamed", assignments: [] });
    expect(u.name).toBe("Renamed");
    expect(u.assignments).toEqual([]);
    await db.remove("rota_templates", { id });
    expect(await db.get("rota_templates", id)).toBeNull();
  });

  it("never runs a delete without a filter, and rejects odd column names", async () => {
    await expect(db.remove("rotas", {})).rejects.toThrow(/without a filter/);
    await expect(db.list("rotas", { ["x; drop table rotas" as "id"]: "1" })).rejects.toThrow(/bad column/);
  });
});
