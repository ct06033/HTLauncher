// Headless run of test/harness/back-harness.html in real Chromium.
// Usage: node test/run-back-harness.js  (needs python3 -m http.server 8123 at repo root)
const { chromium } = require("/home/caspar/.hermes/hermes-agent/node_modules/playwright-core");
(async () => {
  const browser = await chromium.launch({
    executablePath: "/home/caspar/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("PAGEERROR:", String(e)));
  await page.goto("http://127.0.0.1:8123/test/harness/back-harness.html");
  const res = await page.evaluate("window.__harness()");
  console.log(res);
  // assert
  const steps = JSON.parse(res).steps;
  const ok =
    steps[0].modalOpen === false && steps[0].closed === false &&   // A: overlay closed only
    steps[1].frag_before !== steps[1].frag_after && steps[1].closed === false && // B: history.back moved
    steps[2].closed === true &&                                     // C: root -> launcher
    steps[3].closed === true &&                                     // D: Home -> launcher
    steps[4].closed === false;                                      // E: OSK owns Esc
  console.log(ok ? "ALL_PASS" : "FAIL");
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
