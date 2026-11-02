// Email sign-in codes against real Postgres (TEST_DATABASE_URL; see postgres.test.ts).
import { afterAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const sent: { to: string; subject: string }[] = [];
vi.mock("@/lib/email", () => ({ sendSystemEmail: vi.fn(async (to: string, subject: string) => (sent.push({ to, subject }), { ok: true })) }));

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
if (url) {
  process.env.DATABASE_URL = url;
  process.env.DEMO_MODE = "0";
}

suite("email sign-in codes", () => {
  afterAll(async () => {
    const { db } = await import("@/lib/db");
    const d = (await db()) as unknown as { query(sql: string): Promise<unknown> };
    await d.query("truncate users, login_codes");
  });
  const codeFrom = () => sent.at(-1)!.subject.slice(0, 6);

  it("emails a code, signs in with it once, and creates the user", async () => {
    const { requestLoginCode, verifyLoginCode } = await import("@/lib/login");
    await requestLoginCode("Owner@Example.com");
    expect(sent.at(-1)!.to).toBe("owner@example.com");
    const code = codeFrom();
    expect(code).toMatch(/^\d{6}$/);
    const r = await verifyLoginCode("owner@example.com", code);
    expect(r.ok && r.user.email).toBe("owner@example.com");
    expect((await verifyLoginCode("owner@example.com", code)).ok).toBe(false); // single use
  });

  it("same user next time; wrong codes lock after 5 tries", async () => {
    const { requestLoginCode, verifyLoginCode } = await import("@/lib/login");
    await requestLoginCode("owner@example.com");
    const code = codeFrom();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await verifyLoginCode("owner@example.com", wrong)).ok).toBe(false);
    const locked = await verifyLoginCode("owner@example.com", code);
    expect(locked.ok).toBe(false);
    await requestLoginCode("owner@example.com");
    const again = await verifyLoginCode("owner@example.com", codeFrom());
    expect(again.ok).toBe(true);
    const { db } = await import("@/lib/db");
    expect((await (await db()).list("users", { email: "owner@example.com" })).length).toBe(1);
  });
});
