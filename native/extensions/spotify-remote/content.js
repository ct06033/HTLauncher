/* HTLauncher remote semantics for open.spotify.com (Edge extension inside
 * the HTLauncher app window).
 *
 * The Spotify web player is already fully keyboard-navigable (arrows + Tab +
 * Enter on its own focus model), so we don't re-implement focus movement —
 * we add launcher integration:
 *  - Delete/Backspace/Escape = "Back": step out of the current view one
 *    level; at the library root, close the tab => back to HTLauncher.
 *  - Home = always close (=> back to HTLauncher).
 *  - Space: the web player uses Space to play/pause but standard controls
 *    (buttons/links) activate on Enter — normalize so the remote OK plays
 *    whatever is under focus.
 * Typing in search: Backspace behaves normally.
 *
 * Back engine is byte-compatible with netflix-remote/content.js except
 * ROOT_RE/selectors: trusted close-button click -> history.back() ->
 * home link -> close tab. (Synthetic Escape was useless: sites ignore
 * isTrusted=false key events.) */
const ROOT_RE = /^https:\/\/open\.spotify\.com\/(?:intl-[a-z-]+)?\/?(?:#.*)?$/;

function closeToLauncher() {
  try { chrome.runtime.sendMessage({ close: true }); } catch (e) {}
}
function typingInField() {
  const t = document.activeElement;
  return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function visible(el) {
  try {
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" &&
           parseFloat(cs.opacity || "1") > 0.05;
  } catch (e) { return false; }
}
/* Spotify-style: a real, visible "close/back" control inside an open overlay. */
function findCloseBtn() {
  const sel = [
    '[role="dialog"] button[aria-label*="close" i]',
    '[role="dialog"] button[aria-label*="back" i]',
    '[aria-modal="true"] button[aria-label*="close" i]',
    '[aria-modal="true"] button[aria-label*="back" i]',
    'button[data-testid="close-button"]',
    'button[aria-label="Close"]',
  ].join(",");
  let nodes = [];
  try { nodes = document.querySelectorAll(sel); } catch (e) { return null; }
  for (const n of nodes) if (visible(n)) return n;
  return null;
}
function homeLink() {
  let a = null;
  try {
    a = document.querySelector('a[href="' + location.origin + '/"]') ||
        document.querySelector('nav a[href="/"]') ||
        document.querySelector('a[href="/"]');
  } catch (e) {}
  return a && visible(a) ? a : null;
}

let backBusy = false;
async function stepBack() {
  if (backBusy) return;
  backBusy = true;
  try {
    if (ROOT_RE.test(location.href)) { closeToLauncher(); return; }
    const url0 = location.href, hist0 = history.length;
    // 1) open overlay? click its real close button (trusted, works on React)
    const btn = findCloseBtn();
    if (btn) {
      try { btn.click(); } catch (e) {}
      await wait(500);
      if (location.href !== url0 || !findCloseBtn()) return;
    }
    // 2) SPA pushState back
    try { history.back(); } catch (e) {}
    await wait(600);
    if (location.href !== url0 || history.length < hist0) return;
    // 3) fall back to a visible home link
    const home = homeLink();
    if (home) { try { home.click(); } catch (e) {} return; }
    // 4) nothing on the page could take us back -> go to launcher
    closeToLauncher();
  } finally {
    backBusy = false;
  }
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Home" && !e.repeat && !typingInField()) {
    e.preventDefault(); e.stopPropagation();
    closeToLauncher();
    return;
  }
  if ((e.key === "Delete" || e.key === "Backspace" || e.key === "Escape") && !typingInField()) {
    // OSK owns Back/Esc while it is open (osk.js handles+flags the event at
    // window-capture before we see it in document-capture) — don't double-fire.
    if (e.__htlHandled || window.__htlOskOpen) return;
    e.preventDefault(); e.stopPropagation();
    if (!e.repeat) stepBack();
  }
}, true);

/* ---------- now-playing relay ----------
 * page-probe.js runs in the MAIN world (mediaSession is an empty default in
 * this isolated world) and bakes the payload into window.postMessage. We
 * listen here and forward to background.js, which POSTs it to the HTLauncher
 * loopback bridge. Throttle: forward only when title/artist/playing/pct
 * changed, or at most every ~5s while playing (keeps progress fresh without
 * spamming; the bridge itself is stateless).
 */
let npKey = null, npSentAt = 0;

window.addEventListener("message", (evt) => {
  // Only trust our own page script on this document.
  if (evt.source !== window || !evt.data || !evt.data.htlNP) return;
  const p = evt.data;
  const key = [p.playing, p.title, p.artist, p.pct == null ? "" : Math.round(p.pct)].join("|");
  const now = Date.now();
  if (npKey === key && !(p.playing && now - npSentAt > 5000)) return;
  npKey = key; npSentAt = now;
  try {
    chrome.runtime.sendMessage({
      np: {
        source: "spotify", playing: !!p.playing,
        title: p.title || "", artist: p.artist || "", album: p.album || "",
        artUrl: p.artworkUrl || null, pct: p.pct == null ? undefined : p.pct,
      },
    });
  } catch (e) { /* service worker asleep/extension reload — next tick retries */ }
});

// Navigating away/closing: best-effort "nothing playing" so the widget hides
// promptly. The renderer's 12s watchdog covers the case where this message
// never lands (browser crash / killed process).
window.addEventListener("pagehide", () => {
  try { chrome.runtime.sendMessage({ np: { source: "spotify", playing: false } }); }
  catch (e) {}
});
