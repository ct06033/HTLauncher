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

async function openEdgeApp({ url, ext, profile, coverTaskbar }) {
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
