/* Built-in "TV views" launched as Edge app windows.
 *
 * Why Edge and not Electron for DRM streaming sites: the native Netflix/
 * Spotify Windows apps are protected sandboxes (third-party overlays and
 * key remapping into them aren't possible), and stock Electron ships no
 * Widevine — so playback wouldn't work. Edge *is* Chromium with real
 * Widevine, and in --app mode it has no toolbar/tabs (looks native on the
 * TV) and still loads our bundled extension (unlike kiosk mode, which
 * ignores extensions).
 *
 * Each view = an Edge app window + a small MV3 extension that gives it
 * HTLauncher remote semantics (Back steps through the site, Back at root
 * or Home returns to the launcher, cursor hidden).
 *
 * Netflix detail: --window-size/position trick makes the app window cover
 * a 4K display fully including the taskbar strip. Login state lives in a
 * dedicated profile per service (survives restarts, doesn't touch the
 * user's normal Edge profile).
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

function findEdge() {
  for (const p of EDGE_CANDIDATES) if (fs.existsSync(p)) return p;
  return null;   // fall back to PATH
}
function extDir(name) {
  // packaged: resources/app.asar.unpacked/native/extensions/<name>
  // (Chromium cannot --load-extension from inside an asar), dev: source tree
  const cands = [
    path.join(process.resourcesPath || "", "app.asar.unpacked", "native", "extensions", name),
    path.join(process.resourcesPath || "", "native", "extensions", name),
    path.join(__dirname, "extensions", name),
  ];
  for (const c of cands) if (fs.existsSync(path.join(c, "manifest.json"))) return c;
  return null;
}

/* Un-crash the Edge profile before launch.
 * When Edge is killed (our /S install taskkill, sleep/power-off mid-session,
 * or a real crash) it marks the profile exit_type:"Crashed". On the NEXT
 * launch Edge enters extension *safe mode* and refuses to inject
 * --load-extension content scripts — silently killing all our remote
 * semantics (Back/Esc/Home inside Netflix/Spotify) until the flag is cleared.
 * We rewrite exit_type back to "Normal" and drop any safemode state before
 * spawning. Only touches our own dedicated profiles; Edge must not be
 * running (it rewrites the file on clean exit anyway). */
function sanitizeEdgeProfile(profile) {
  try {
    const pref = path.join(
      process.env.LOCALAPPDATA || ".", "HTLauncher", profile, "Default", "Preferences");
    if (!fs.existsSync(pref)) return;
    // tolerate a UTF-8 BOM (some writers add one; JSON.parse would throw on it)
    const j = JSON.parse(fs.readFileSync(pref, "utf8").replace(/^\uFEFF/, ""));
    let dirty = false;
    if (j.profile && j.profile.exit_type === "Crashed") {
      j.profile.exit_type = "Normal"; dirty = true;
    }
    if (j.extensions && (j.extensions.safemode || j.extensions.safe)) {
      delete j.extensions.safemode; delete j.extensions.safe; dirty = true;
    }
    if (dirty) fs.writeFileSync(pref, JSON.stringify(j));
    // Secure Preferences carries the *persistent* extension state: after a
    // safe-mode episode our own --load-extension entry gets recorded with
    // disable_reasons set, and Edge keeps honouring that disable even after
    // the crash flag is cleared. Drop any HTLauncher-path extension entries
    // there (Edge re-registers them fresh from --load-extension on launch).
    const sec = path.join(path.dirname(pref), "Secure Preferences");
    if (fs.existsSync(sec)) {
      const sj = JSON.parse(fs.readFileSync(sec, "utf8").replace(/^\uFEFF/, ""));
      const st = sj.extensions && sj.extensions.settings;
      let sdirty = false;
      if (sj.extensions && sj.extensions.safemode) { delete sj.extensions.safemode; sdirty = true; }
      if (st) {
        for (const k of Object.keys(st)) {
          const p2 = st[k] && st[k].path;
          if (typeof p2 === "string" && p2.includes("HTLauncher")) { delete st[k]; sdirty = true; }
        }
      }
      if (sdirty) fs.writeFileSync(sec, JSON.stringify(sj));
    }
  } catch (e) { /* never block launch on profile surgery */ }
}

/* Chromium's profile singleton is the sneaky one: if ANY msedge process is
 * still alive for our dedicated profile (e.g. mid-teardown after a taskkill
 * from the installer, or a previously hung session), the new spawn just
 * forwards its URL to the dying browser and ALL of our flags — including
 * --load-extension — are silently dropped. So before spawning, force-kill
 * msedge processes whose command line references this profile and wait for
 * them to actually die. Best effort: never block longer than ~6s. */
function killEdgeForProfile(profile) {
  const esc = profile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ps =
    "$m='HTLauncher\\\\" + esc + "';" +
    "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object { $_.CommandLine -match $m } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue };" +
    "$deadline=(Get-Date).AddSeconds(4);" +
    "while((Get-Date) -lt $deadline){" +
    "$n=@(Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object { $_.CommandLine -match $m }).Count;" +
    "if($n -eq 0){break}; Start-Sleep -Milliseconds 250} exit 0";
  try {
    const { execFileSync } = require("child_process");
    execFileSync("powershell.exe", ["-NoProfile", "-Command", ps],
      { timeout: 6000, windowsHide: true, stdio: "ignore" });
  } catch (e) { /* best effort */ }
}

async function openEdgeApp({ url, ext, profile, coverTaskbar }) {
  sanitizeEdgeProfile(profile);
  killEdgeForProfile(profile);
  const exe = findEdge() || "msedge.exe";
  const args = [
    "--app=" + url,
    "--user-data-dir=" + (process.env.LOCALAPPDATA || ".") + "\\HTLauncher\\" + profile,
  ];
  if (coverTaskbar) args.push("--window-size=4096,4096", "--window-position=-16,-16");
  args.push(
    "--start-fullscreen",
    "--no-first-run", "--no-default-browser-check",
    "--disable-features=GlobalMediaControls,MediaRouter",
    "--autoplay-policy=no-user-gesture-required",
  );
  const dir = extDir(ext);
  if (dir) args.push("--load-extension=" + dir);
  try {
    const child = spawn(exe, args, { detached: true, stdio: "ignore", windowsHide: false });
    child.unref();
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

const openNetflix = () => openEdgeApp({
  url: "https://www.netflix.com/browse",
  ext: "netflix-remote", profile: "NetflixProfile", coverTaskbar: true,
});
const openSpotify = () => openEdgeApp({
  url: "https://open.spotify.com/",
  ext: "spotify-remote", profile: "SpotifyProfile", coverTaskbar: true,
});

module.exports = { openNetflix, openSpotify };
