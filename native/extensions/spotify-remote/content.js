/* HTLauncher remote semantics for open.spotify.com (Edge extension inside
 * the HTLauncher app window).
 *
 * The Spotify web player is already fully keyboard-navigable (arrows + Tab +
 * Enter on its own focus model), so we don't re-implement focus movement —
 * we add launcher integration:
 *  - Delete/Backspace = "Back": walk the SPA history (Netflix-style); at the
 *    library root, close the tab => back to HTLauncher.
 *  - Home = always close (=> back to HTLauncher).
 *  - Space: the web player uses Space to play/pause but standard controls
 *    (buttons/links) activate on Enter — normalize so the remote OK plays
 *    whatever is under focus.
 * Typing in search: Backspace behaves normally. */
const ROOT_RE = /^https:\/\/open\.spotify\.com\/(?:intl-[a-z-]+)?\/?(?:#.*)?$/;

function closeToLauncher() {
  try { chrome.runtime.sendMessage({ close: true }); } catch (e) {}
}
function typingInField() {
  const t = document.activeElement;
  return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Home" && !e.repeat && !typingInField()) {
    e.preventDefault(); e.stopPropagation();
    closeToLauncher();
    return;
  }
  if ((e.key === "Delete" || e.key === "Backspace") && !typingInField() && !e.repeat) {
    e.preventDefault(); e.stopPropagation();
    if (ROOT_RE.test(location.href)) { closeToLauncher(); return; }
    history.back();
    // if history.back() can't move (deep SPA state), second press within 1.5s exits
    const at = location.href;
    setTimeout(() => { if (location.href === at) closeToLauncher(); }, 1500);
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
