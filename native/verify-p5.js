/* P5 verification harness: load the REAL native/services.js, but route its
 * PowerShell through ssh to the Windows test box. Exercises the exact shipped
 * code paths. Usage: node native/verify-p5.js [fnName ...] */
const fs = require("fs");
const path = require("path");

let src = fs.readFileSync(path.join(__dirname, "services.js"), "utf8");
src = src.replace('const IS_WIN = process.platform === "win32";',
                  'const IS_WIN = true;');
src = src.replace('execFile(PS_EXE, [...PS_ARGS, "-EncodedCommand", encoded],\n      { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },',
  'execFile("ssh", ["-o","BatchMode=yes","htpc@192.168.50.123", "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand " + encoded],\n      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },');
// spawn-based launchers would run locally on Linux — no-op them for this test
src = src.replace(/const child = spawn\("cmd\.exe",[\s\S]*?return \{ ok: true \};/g,
                  'return { ok: true, simulated: true };');
src = src.replace(/const child = spawn\("msedge\.exe",[\s\S]*?lastWebApp = child;\n    return \{ ok: true \};/g,
                  'return { ok: true, simulated: true };');

const tmp = path.join(require("os").tmpdir(), "services-remote.js");
fs.writeFileSync(tmp, src);
const svc = require(tmp);

const TARGETS = process.argv.slice(2);
(async () => {
  const all = {
    volumeGet: () => svc.volumeGet(),
    volumeSetMax: () => svc.volumeSetMax(),
    netStatus: () => svc.netStatus(),
    netScan: () => svc.netScan(),
    btStatus: () => svc.btStatus(),
    btKnown: () => svc.btKnown(),
    listStartMenu: async () => { const l = await svc.listStartMenu(); return { count: l.length, sample: l.slice(0, 5).map(a => a.name) }; },
    appIconFor: async () => { const l = await svc.listStartMenu(); const hit = l.find(a => /notepad/i.test(a.name)) || l[0];
      if (!hit) return "no apps"; return svc.appIconFor(hit.path); },
    faviconFor: () => svc.faviconFor("https://www.youtube.com/tv"),
  };
  const names = TARGETS.length ? TARGETS : Object.keys(all);
  for (const n of names) {
    if (!all[n]) { console.log(n, "unknown"); continue; }
    try {
      const r = await all[n]();
      console.log("### " + n + ":");
      console.log(JSON.stringify(r, null, 1).slice(0, 800));
    } catch (e) { console.log("### " + n + " FAILED:", String(e.message).slice(0, 300)); }
  }
  process.exit(0);
})();
