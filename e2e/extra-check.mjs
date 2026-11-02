// Scratch check (run after smoke.mjs): someone claims the sick shift, the manager approves it,
// and the compliance form saves. Not part of CI.
import { chromium } from "playwright-core";
const BASE = "http://localhost:3000";
const b = await chromium.launch({ executablePath: "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" });
const errors = [];
const page = async (w, h) => {
  const p = await (await b.newContext({ viewport: { width: w, height: h } })).newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("response", (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
  return p;
};
const m = await page(1440, 900);
await m.goto(`${BASE}/login`);
await m.getByRole("button", { name: /Enter as manager/ }).click();
await m.waitForURL(/\/org\//);
await m.goto(`${BASE}/s/demo-store/approvals`);
console.log("open shift row:", (await m.getByText(/off sick/).allInnerTexts()).join(" | "));

let claimer = null;
for (const name of ["Casey", "Priya", "Jordan", "Sam", "Grace", "Harry", "Mia", "Olivia", "Tom"]) {
  const s = await page(390, 844);
  await s.goto(`${BASE}/login`);
  await s.getByText("Or see the staff phone view").click();
  await s.getByRole("button", { name: new RegExp(` ${name} `) }).first().click();
  await s.waitForURL(/\/me/);
  await s.goto(`${BASE}/me?tab=swaps`);
  const btn = s.getByRole("button", { name: "Take this shift" });
  if (await btn.count()) {
    await btn.first().click();
    const res = await Promise.race([s.getByText("Waiting for manager").first().waitFor({ timeout: 15000 }).then(() => "claimed"), s.locator(".bg-red-50").first().waitFor({ timeout: 15000 }).then(async () => `refused: ${await s.locator(".bg-red-50").first().innerText()}`)]);
    console.log(name, "->", res);
    if (res === "claimed") {
      claimer = name;
      break;
    }
  } else console.log(name, "-> not eligible");
  await s.context().close();
}
if (claimer) {
  await m.goto(`${BASE}/s/demo-store/approvals`);
  const card = m.locator(".card", { hasText: "wants to take it" }).first();
  console.log("claim card:", (await card.innerText()).replace(/\s+/g, " ").slice(0, 160));
  await card.getByRole("button", { name: "Approve" }).click();
  await m.waitForTimeout(2500);
  console.log("after approve, error notice:", await m.locator("text=no longer passes").count(), "| claims left:", await m.getByText("wants to take it").count());
}

await m.goto(`${BASE}/s/demo-store/staff/emp-dan`);
await m.locator('input[name="hourlyRate"]').fill("12.80");
await m.getByRole("button", { name: "Save", exact: true }).click();
await m.getByText("Saved.").waitFor({ timeout: 10000 });
await m.reload();
console.log("Dan wage flag after raise:", await m.getByText(/below the £12.71/).count());
await m.goto(`${BASE}/s/demo-store/admin?tab=holidays`);
console.log("admin balances rows:", await m.locator("table tbody tr").count());
await m.setViewportSize({ width: 390, height: 844 });
await m.goto(`${BASE}/s/demo-store/timesheets`);
await m.screenshot({ path: "e2e/timesheets-mobile.png", fullPage: true });
console.log("errors:", errors.length ? errors : "none");
await b.close();
