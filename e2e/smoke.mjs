// End-to-end smoke test of the demo (no Supabase): run `npm run demo` first, then
//   npm --prefix e2e install && node e2e/smoke.mjs
// CHROME_PATH points at an installed Chrome/Chromium; BASE defaults to http://localhost:3000.
// The demo data must be fresh (delete web/.data first) because the test changes it.
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3000";
const CHROME =
  process.env.CHROME_PATH ?? (process.platform === "win32" ? "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe" : process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "/usr/bin/google-chrome");
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const failures = [];
const errors = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(name);
};
async function newPage(w, h, mobile = false) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`pageerror ${p.url()}: ${e.message}`));
  p.on("response", (r) => r.status() >= 500 && errors.push(`${r.status()} ${r.url()}`));
  p.on("dialog", (d) => d.accept());
  return p;
}
const text = async (p) => (await p.locator("main").innerText()).replace(/\s+/g, " ");

try {
  // ---------------------------------------------------------------- manager
  const m = await newPage(1440, 900);
  await m.goto(`${BASE}/login`);
  await m.getByRole("button", { name: /Enter as manager/ }).click();
  await m.waitForURL(/\/org\//);
  const dash = await text(m);
  check("group dashboard lists people compliance", /People compliance · [1-9]/i.test(dash));
  check("minimum wage problem found (Dan)", /Dan .*below the £12\.71/.test(dash) || dash.includes("below the £12.71"));
  check("expired food hygiene found (Chloe)", /Chloe.*Food Hygiene L2 expired/.test(dash));

  await m.goto(`${BASE}/s/demo-store/rota`);
  const rota = await text(m);
  check("rota shows labour cost against budget", /Labour cost/.test(rota) && /% of the £4,200 weekly budget/.test(rota));

  await m.goto(`${BASE}/s/demo-store/staff`);
  check("staff list shows compliance badges", (await m.getByText(/\d compliance$/).count()) >= 3);

  // Shift log calendar: last Monday's shifts are approved.
  const lastMonday = await m.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7);
    return d.toISOString().slice(0, 10);
  });
  await m.goto(`${BASE}/s/demo-store/timesheets?day=${lastMonday}`);
  check("shift log is a calendar", (await m.getByRole("region", { name: "Calendar" }).locator("a[aria-current=date]").count()) === 1);
  check("selecting a day shows that day's staff with approved shifts", (await m.getByText("Approved", { exact: true }).count()) >= 3);

  const csv = await m.request.get(`${BASE}/api/payroll/demo-store?from=2020-01-01&to=2020-02-01&format=generic`);
  check("payroll export returns CSV", csv.ok() && (csv.headers()["content-type"] ?? "").includes("text/csv"));

  await m.goto(`${BASE}/s/demo-store/reports`);
  check("site report renders", /Hours by job/.test(await text(m)));
  await m.goto(`${BASE}/org/demo-org/reports`);
  check("group report lists both sites", (await m.locator("tbody tr").count()) >= 2);

  await m.goto(`${BASE}/s/demo-store/start`);
  check("getting-started checklist", /of \d+ done|all set up/.test(await text(m)));

  // Copy last week into next week (draft)
  const next = await m.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 7);
    return d.toISOString().slice(0, 10);
  });
  await m.goto(`${BASE}/s/demo-store/rota?week=${next}`);
  await m.getByRole("button", { name: /Copy & templates/ }).click();
  await m.getByRole("button", { name: "Copy last week" }).click();
  await m.getByText(/Copied last week: \d+ shifts? filled/).waitFor({ timeout: 15000 });
  check("copy last week fills the draft", true);

  // ---------------------------------------------------------------- staff phone: no self clock-in, no sick button
  const s = await newPage(390, 844, true);
  await s.goto(`${BASE}/login`);
  await s.getByText("Or see the staff phone view").click();
  await s.getByRole("button", { name: / Alex / }).first().click();
  await s.waitForURL(/\/me/);
  check("staff can't call in sick or clock in from their phone", (await s.getByRole("button", { name: /Call in sick|Clock in/ }).count()) === 0);
  const call = s.getByRole("link", { name: /Call the store/ });
  check("staff get a Call the store button", (await call.count()) === 1 && (await call.getAttribute("href")).startsWith("tel:"));

  // ---------------------------------------------------------------- clock-in screen (kiosk)
  const k = await newPage(1024, 1366);
  await k.goto(`${BASE}/login`);
  await k.getByRole("button", { name: /Enter as manager/ }).click();
  await k.waitForURL(/\/org\//);
  await k.goto(`${BASE}/s/demo-store/timesheets`);
  await k.getByRole("button", { name: /Start clock-in screen/ }).click();
  await k.waitForURL(/\/kiosk\/demo-store/);
  check("manager starts the clock-in screen", true);
  check("clock-in screen is friendly and translated", /Good (morning|afternoon|evening)!/.test(await k.locator("header").innerText()) && (await k.getByRole("combobox", { name: "Language" }).count()) === 1);
  const blocked = await k.goto(`${BASE}/s/demo-store/rota`);
  check("the clock-in device can't open manager pages", !/\/s\/demo-store\/rota/.test(k.url()) || blocked.status() === 404);
  await k.goto(`${BASE}/kiosk/demo-store`);
  check("search bar and three filters", (await k.getByPlaceholder("Find your name").count()) === 1 && (await k.getByRole("group", { name: "Filter" }).getByRole("button").count()) === 3);
  await k.getByRole("button", { name: /^Working/ }).click();
  const workingRows = await k.locator("main ul li").allInnerTexts();
  check("Working filter shows only people working", workingRows.every((r) => /Working|No one matches/.test(r)), `${workingRows.length} rows`);
  await k.getByRole("button", { name: /^Working/ }).click();

  const pinPad = async (pin) => { for (const dgt of pin) await k.getByRole("button", { name: dgt, exact: true }).click(); };
  const openPerson = async (name, pin) => {
    await k.getByPlaceholder("Find your name").fill(name);
    await k.locator("main ul li button").first().click();
    await pinPad(pin);
    await k.getByText("Today's shift").waitFor({ timeout: 10000 });
  };
  await k.getByPlaceholder("Find your name").fill("Alex");
  await k.locator("main ul li button").first().click();
  await pinPad("9999");
  check("wrong PIN is refused", await k.getByText("That PIN isn't right.").waitFor({ timeout: 10000 }).then(() => true, () => false));
  await k.getByRole("button", { name: "Back", exact: true }).click();
  await openPerson("Alex", "1001");
  check("PIN shows the shift info", true);
  // Walk through whatever state Alex is in until clocked out: in -> break -> end break -> out.
  const seen = {};
  for (let i = 0; i < 5; i++) {
    const btns = await k.locator("main button").allInnerTexts();
    // Once a break has been taken, finish with Clock out rather than another break.
    const order = seen.breakEnd ? ["Clock in", "End break", "Clock out"] : ["Clock in", "End break", "Take break", "Clock out"];
    const pick = order.find((x) => btns.some((b) => b.includes(x)));
    if (!pick) break;
    await k.getByRole("button", { name: pick }).click();
    await k.getByRole("status").waitFor({ timeout: 10000 });
    const r = (await k.getByRole("status").innerText()).replace(/\s+/g, " ");
    if (pick === "Clock in") seen.in = /Clocked in \d\d:\d\d/.test(r);
    if (pick === "Take break") seen.breakStart = /Break started \d\d:\d\d/.test(r);
    if (pick === "End break") seen.breakEnd = /Break ended \d\d:\d\d/.test(r) && /Break taken/.test(r);
    if (pick === "Clock out") seen.out = /Started \d\d:\d\d/.test(r) && /Finished \d\d:\d\d/.test(r) && /Break deducted/.test(r) && /Total worked/.test(r);
    await k.getByRole("button", { name: "Done" }).click();
    await k.getByPlaceholder("Find your name").waitFor();
    if (pick === "Clock out") break;
    await openPerson("Alex", "1001");
  }
  check("clock in shows the time", seen.in !== false, JSON.stringify(seen));
  check("break start and end show times and total", seen.breakStart !== false && seen.breakEnd === true);
  check("clock out shows start, end, break deducted and total", seen.out === true);

  // Demo only: straight back to the manager view.
  await k.getByRole("button", { name: "Back to manager" }).click();
  await k.waitForURL(/\/s\/demo-store\/timesheets/);
  check("demo back button returns to the shift log", true);

  await m.goto(`${BASE}/s/demo-store/timesheets`);
  const log = await text(m);
  check("shift log shows Alex's break and filters", /Breaks remaining/.test(log) && /On break/.test(log) && /To approve/.test(log));
  await m.goto(`${BASE}/s/demo-store/timesheets?show=breaksLeft`);
  check("breaks remaining filter works", /min break left|No one: breaks remaining/.test(await text(m)));

  // A manager (not the staff member) marks someone off sick: the shift is offered to others.
  await m.goto(`${BASE}/s/demo-store/timesheets`);
  const sick = m.getByRole("button", { name: "Mark off sick" }).first();
  if (await sick.count()) {
    await sick.click();
    await m.waitForLoadState("networkidle");
    await m.goto(`${BASE}/s/demo-store/approvals`);
    check("manager marks off sick -> open shift", /off sick/.test(await text(m)));
  } else console.log("SKIP  mark off sick (no upcoming rostered shift without a clock-in this week)");

  // ---------------------------------------------------------------- public bits
  const pub = await newPage(1024, 800);
  await pub.goto(`${BASE}/legal/privacy`);
  check("draft privacy notice is public", /Draft for solicitor review/.test(await text(pub)));
  const man = await pub.request.get(`${BASE}/manifest.webmanifest`);
  check("PWA manifest", man.ok() && (await man.json()).start_url === "/me");
} catch (e) {
  failures.push(`crashed: ${e.message.split("\n")[0]}`);
  console.error(e);
} finally {
  await browser.close();
}
console.log(errors.length ? `\nBrowser/server errors:\n${errors.join("\n")}` : "\nNo page errors or 5xx responses.");
if (failures.length || errors.length) {
  console.log(`\n${failures.length} failed: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("\nAll checks passed.");
