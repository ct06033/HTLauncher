/* HTLauncher remote semantics for netflix.com (loaded as an Edge extension
 * inside the HTLauncher app window).
 * Netflix web already handles Arrows + Enter natively. We add:
 *  - Delete/Backspace/Esc = "Back": step out of the current overlay/page one
 *    level (real close-button click -> history.back() -> home link), and at
 *    browse root (or when nothing moves) close the tab => back to HTLauncher.
 *  - Home = always close (=> back to HTLauncher).
 * Typing in search still uses Backspace normally.
 *
 * Why not just dispatch a synthetic Escape like old v0.6.3: KeyboardEvent
 * from a content script is isTrusted=false. Netflix's SPA (and most React
 * apps) ignore untrusted Escapes, so Back appeared dead. Clicking the real
 * close button and calling history.back() are trusted-equivalent and work
 * regardless. */

/* Shared back-step engine (byte-identical block in spotify-remote/content.js
 * except for the ROOT_RE + siteSelectors). */
const ROOT_RE = /^https:\/\/www\.netflix\.com\/(browse\/?(#.*)?$|search\/?(#.*)?$|$)/;

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
/* Netflix-style: a real, visible "close/back" control inside an open overlay. */
function findCloseBtn() {
  const sel = [
    '[role="dialog"] button[aria-label*="close" i]',
    '[role="dialog"] button[aria-label*="back" i]',
    '[aria-modal="true"] button[aria-label*="close" i]',
    '[aria-modal="true"] button[aria-label*="back" i]',
    'button[aria-label="Close"]',
    'button[aria-label="close"]',
    '.modal button[aria-label*="close" i]',
  ].join(",");
  let nodes = [];
  try { nodes = document.querySelectorAll(sel); } catch (e) { return null; }
  for (const n of nodes) if (visible(n)) return n;
  return null;
}
function homeLink() {
  let a = null;
  try {
    a = document.querySelector('a[href="' + location.origin + '/browse"]') ||
        document.querySelector('a[href*="netflix.com/browse"]');
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
  if (e.key === "Home" && !e.repeat) {
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
