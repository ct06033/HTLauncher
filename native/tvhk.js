/* TV-view input hook manager.
 *
 * Compiles native/tvhk.cs once with the .NET Framework csc that ships with
 * Windows (no npm deps, no bundle-size cost; same pattern services.js used
 * for Core Audio before it moved to Add-Type) and runs the helper for the
 * lifetime of the shell. The helper remaps, ONLY while a Netflix/Spotify
 * Edge app window is the foreground window:
 *   Escape -> Alt+Left (browser back); same-screen double-press closes the
 *            window (= back to launcher)
 *   Home   -> close the window
 *   Backspace/Delete and all other keys pass through untouched, so the
 *   sites' own in-page back/typing keeps working.
 * Plain OS input remapping — no browser profile or policy edits.
 *
 * Failure-tolerant by design: no csc, compile error, or spawn failure just
 * leaves the hook absent (the Edge extension still provides Back/Home when
 * it injects). Boot must never break over this. */
const { spawn, execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const CSC = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";
const CSC_DIR = path.dirname(CSC);
// UIA refs live in the WPF subfolder of the framework dir, not csc's
// default lib path — pass absolute /r: so the compile works everywhere.
const REFS = ["WindowsBase.dll", "UIAutomationClient.dll", "UIAutomationTypes.dll"];
function refArgs() {
  return REFS.map((r) => {
    for (const d of [CSC_DIR, path.join(CSC_DIR, "WPF")]) {
      const p = path.join(d, r);
      if (fs.existsSync(p)) return "/r:" + p;
    }
    return "/r:" + r;  // let csc try its own resolution
  });
}
let helper = null;
let helperPid = 0;

function helperPaths() {
  const dir = path.join(process.env.LOCALAPPDATA || ".", "HTLauncher");
  // csc.exe is a separate process: it cannot read source inside app.asar.
  // native/tvhk.cs is asarUnpacked alongside the extensions; prefer that
  // path when packaged, fall back to the source tree in dev.
  const cands = [
    path.join(process.resourcesPath || "", "app.asar.unpacked", "native", "tvhk.cs"),
    path.join(process.resourcesPath || "", "native", "tvhk.cs"),
    path.join(__dirname, "tvhk.cs"),
  ];
  let src = cands[cands.length - 1];
  for (const c of cands) if (fs.existsSync(c)) { src = c; break; }
  return { dir, exe: path.join(dir, "tvhk.exe"), src };
}

function build(exe, src, cb) {
  if (!fs.existsSync(CSC)) return cb("no csc");
  try { fs.mkdirSync(path.dirname(exe), { recursive: true }); } catch (e) {}
  // rebuild whenever the bundled source is newer than the cached exe
  let stale = true;
  try {
    stale = fs.existsSync(src) &&
      fs.statSync(src).mtimeMs > (fs.existsSync(exe) ? fs.statSync(exe).mtimeMs : Infinity);
  } catch (e) {}
  if (!stale && fs.existsSync(exe)) return cb(null, "cached");
  execFile(CSC, ["/nologo", "/optimize", "/out:" + exe].concat(refArgs()).concat([src]),
    { timeout: 60000, windowsHide: true },
    (err) => cb(err ? ("csc: " + String(err.message || err)) : null, "built"));
}

function start() {
  if (helper && !helper.killed) return;
  const dbg = (s) => { try { fs.appendFileSync(path.join(process.env.LOCALAPPDATA || ".", "HTLauncher", "tvhk-boot.log"), new Date().toISOString().slice(11, 19) + " " + s + "\n"); } catch (e) {} };
  if (process.platform !== "win32" || !fs.existsSync(CSC)) { dbg("skip: not win32 or no csc at " + CSC); return; }
  const { exe, src } = helperPaths();
  dbg("src=" + src + " exists=" + fs.existsSync(src) + " exe=" + exe);
  build(exe, src, (err, how) => {
    if (err) { dbg("COMPILE_FAIL " + err); console.warn("[tvhk] compile failed:", err); return; }
    try {
      helper = spawn(exe, [], { detached: true, stdio: "ignore", windowsHide: true });
      helperPid = helper.pid || 0;
      helper.on("error", (e) => dbg("SPAWN_ERR " + e.message));
      helper.on("exit", (code) => { helper = null; dbg("HELPER_EXIT code=" + code); });
      helper.unref();
      dbg("started (" + how + ") pid=" + helperPid);
      console.log("[tvhk] helper started (" + how + ")");
    } catch (e) { dbg("SPAWN_THROW " + e.message); console.warn("[tvhk] spawn failed:", e.message); }
  });
}

function stop() {
  if (!helper) return;
  try { helper.kill(); } catch (e) {}
  helper = null;
  // detached child may ignore the parent's kill; target our own pid only
  if (helperPid) {
    try { execFile("taskkill.exe", ["/PID", String(helperPid), "/F"], { windowsHide: true, timeout: 5000 }, () => {}); } catch (e) {}
    helperPid = 0;
  }
}

module.exports = { start, stop };
