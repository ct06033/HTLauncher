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
