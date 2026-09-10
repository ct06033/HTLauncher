/* HTLauncher remote semantics for netflix.com (loaded as an Edge extension
 * inside the HTLauncher app window).
 * Netflix web already handles Arrows + Enter natively. We add:
 *  - Delete/Backspace/Esc = "Back": at browse root or on a Title page with no
 *    in-page back, close the tab (=> back to HTLauncher). Otherwise forward a
 *    synthetic Escape so Netflix steps back one level.
 *  - Home = always close (=> back to HTLauncher).
 * Typing in search still uses Backspace normally. */
const ROOT_RE = /^https:\/\/www\.netflix\.com\/(browse\/?(#.*)?$|search\/?(#.*)?$|$)/;

function closeToLauncher() {
  try { chrome.runtime.sendMessage({ close: true }); } catch (e) {}
}
function pressEsc() {
  for (const type of ["keydown", "keyup"])
    document.dispatchEvent(new KeyboardEvent(type, { key: "Escape", code: "Escape", bubbles: true }));
}
function typingInField() {
  const t = document.activeElement;
  return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Home" && !e.repeat) {
    e.preventDefault(); e.stopPropagation();
    closeToLauncher();
    return;
  }
  if ((e.key === "Delete" || e.key === "Backspace" || e.key === "Escape") && !typingInField()) {
    e.preventDefault(); e.stopPropagation();
    if (ROOT_RE.test(location.href)) { closeToLauncher(); return; }
    const prev = location.href;
    pressEsc();
    // if a Title page's Esc does nothing (SPA doesn't navigate), give the
    // user a second-stage exit: same key within 1.5s returns to launcher
    if (/\/(title|Title)\//.test(prev)) {
      setTimeout(() => { if (location.href === prev) closeToLauncher(); }, 1500);
    }
  }
}, true);
