/* Built-in Netflix view.
 *
 * The user asked (a) to make our navigation work over the native Netflix
 * Windows app, and if not possible (b) build a Chrome extension for the
 * Netflix website experience. (a) is genuinely impossible — the Netflix
 * Store app is a protected sandbox (PlayReady DRM, no injection surface).
 * So this is (b), and better than the obvious "open Edge kiosk" route:
 * Edge kiosk mode ignores extensions. Instead we open Edge in *app window*
 * mode with the HTLauncher Netflix extension loaded:
 *
 *   - Edge/Chrome ships real Widevine => Netflix playback actually works
 *   - extension provides remote semantics (Back/Home/Escape, hidden cursor)
 *   - --no-first-run keeps Edge's own UI noise off the TV
 *   - app window has no toolbar/tabs => looks like a native TV app
 *   - login state = the user's normal Edge profile (no extra sign-in)
 *
 * When the app window's last tab closes (extension "back to launcher", or
 * Alt+F4 equivalent), focus returns to HTLauncher since it owns the desktop.
 */
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
function extDir() {
  // packaged: resources/app.asar.unpacked/native/extensions/netflix-remote
  // (Chromium cannot --load-extension from inside an asar), dev: source tree
  const cands = [
    path.join(process.resourcesPath || "", "app.asar.unpacked", "native", "extensions", "netflix-remote"),
    path.join(process.resourcesPath || "", "native", "extensions", "netflix-remote"),
    path.join(__dirname, "extensions", "netflix-remote"),
  ];
  for (const c of cands) if (fs.existsSync(path.join(c, "manifest.json"))) return c;
  return null;
}

async function openNetflix() {
  const exe = findEdge() || "msedge.exe";
  const args = [
    "--app=https://www.netflix.com/browse",
    "--user-data-dir=" + (process.env.LOCALAPPDATA || ".") + "\\HTLauncher\\NetflixProfile",
    "--window-size=4096,4096", "--window-position=-16,-16",   // cover a 4K screen incl. taskbar edge
    "--start-fullscreen",
    "--no-first-run", "--no-default-browser-check",
    "--disable-features=GlobalMediaControls,MediaRouter",
    "--autoplay-policy=no-user-gesture-required",
  ];
  const ext = extDir();
  if (ext) args.push("--load-extension=" + ext);
  try {
    const child = require("child_process").spawn(exe, args,
      { detached: true, stdio: "ignore", windowsHide: false });
    child.unref();
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

module.exports = { openNetflix };
