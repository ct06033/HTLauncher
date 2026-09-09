/* TVShell spatial navigation engine.
 * Views push a "layer" onto a stack; only the top layer receives keys.
 * Layer = { grid?: el[][], lockRows?: bool, onActivate(el), onBack(), onMenu(el), onHome(), id }
 * Focus follows keymap (Settings-remappable). */
window.Nav = (() => {
  const stack = [];
  let current = null; // element with focus

  function keymapMatches(e) {
    const km = Store.state.keymap;
    const test = (combo) => {
      const parts = combo.toLowerCase().split("+");
      const needAlt = parts.includes("alt"), needCtrl = parts.includes("ctrl"),
            needShift = parts.includes("shift");
      const key = parts[parts.length - 1];
      const norm = e.key.toLowerCase();
      const alias = { arrowleft:"left", arrowright:"right", arrowup:"up", arrowdown:"down",
        delete:"back", " ":"space", enter:"ok", pageup:"pgup", pagedown:"pgdn", end:"menu", home:"home" };
      const logical = norm === alias[norm] ? norm : (alias[norm] || norm);
      const match = norm === key || logical === key ||
        (key === "delete" && e.key === "Backspace") ||
        (key === "back" && (e.key === "Backspace" || e.key === "Delete")) ||
        (key === "end" && e.key === "ContextMenu");
      return match && !!e.altKey === needAlt && !!e.ctrlKey === needCtrl && !!e.shiftKey === needShift;
    };
    const find = (action) => (km[action] || []).some(test);
    return { left: find("left"), right: find("right"), up: find("up"), down: find("down"),
      ok: find("ok"), back: find("back"), home: find("home"), menu: find("menu"),
      pageUp: find("pageUp"), pageDown: find("pageDown"), sleep: find("sleep") };
  }

  function els(layer) {
    if (layer.grid) return layer.grid.flat().filter(Boolean);
    return (layer.list || []).filter(Boolean);
  }

  function setFocus(el) {
    if (!el) return;
    if (current) current.classList.remove("focused");
    // safety net: drop any leftover highlight from push/pop paths that reset
    // `current` without clearing the class (only one element may be focused)
    [...document.querySelectorAll(".focused")].forEach(e => { if (e !== el) e.classList.remove("focused"); });
    current = el;
    el.classList.add("focused");
    const l = top();
    if (l) {                       // remember per-layer focus for restore
      l._last = el;
      l._lastKey = el.id ? "#" + el.id
        : el.classList.contains("tile") ? `.tile[data-idx="${el.dataset.idx}"]` : null;
    }
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  }

  function rect(el) { return el.getBoundingClientRect(); }
  function center(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

  function move(dir) {
    const layer = top();
    const pool = els(layer);
    if (!pool.length) return;
    if (!pool.includes(current)) { setFocus(pool[0]); return; }
    const from = rect(current), fc = center(from);
    let best = null, bestScore = Infinity;
    for (const el of pool) {
      if (el === current || el.offsetParent === null) continue;
      const r = rect(el), c = center(r);
      const dx = c.x - fc.x, dy = c.y - fc.y;
      let primary, secondary, forward;
      if (dir === "right") { primary = dx; secondary = Math.abs(dy); forward = dx > r.width * .3; }
      else if (dir === "left") { primary = -dx; secondary = Math.abs(dy); forward = dx < -r.width * .3; }
      else if (dir === "down") { primary = dy; secondary = Math.abs(dx); forward = dy > r.height * .3; }
      else { primary = -dy; secondary = Math.abs(dx); forward = dy < -r.height * .3; }
      if (!forward) continue;
      if (layer.lockRows && (dir === "up" || dir === "down") &&
          Math.abs(c.y - fc.y) > Math.max(r.height, from.height) * .7) continue;
      const score = primary + secondary * 4;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) setFocus(best);
    // at an edge with nothing beyond: page tabs let PgUp/PgDn handle pages; grid scroll handled by scrollIntoView
  }

  const top = () => stack[stack.length - 1];

  function activate() { const l = top(); if (l && l.onActivate) l.onActivate(current); }
  function menu() { const l = top(); if (l && l.onMenu) l.onMenu(current); else if (l && l.onActivate && !l.grid) l.onActivate(current); }
  function back() { const l = top(); if (l && l.onBack) l.onBack(); }
  function home() {
    // topmost layer with an onHome gets first refusal (overlays clean up,
    // then their onHome typically calls App.goHome() which unwinds the rest)
    for (let i = stack.length - 1; i >= 0; i--)
      if (stack[i].onHome) return stack[i].onHome();
  }

  function push(layer) {
    stack.push(layer);
    current = null;
    const pool = els(layer);
    if (pool.length && layer.autofocus !== false) setFocus(layer.initial ? layer.initial() : pool[0]);
    if (layer.onEnter) layer.onEnter();
  }
  function pop() {
    const gone = stack.pop();
    if (gone && gone.onExit) gone.onExit();
    current = null;
    const l = top();
    if (!l) return;
    if (l.restore) return l.restore(setFocus);
    // default restore: return to the element this layer had focused before,
    // re-resolving tile references (renderGrid may have replaced the DOM node)
    let el = l._last && document.contains(l._last) ? l._last
           : l._lastKey ? document.querySelector(l._lastKey) : null;
    const pool = els(l);
    if (!el || !pool.includes(el)) el = l.initial ? l.initial() : pool[0];
    setFocus(el);
  }
  function remove(layer) {
    // close a layer even if newer layers were stacked over it
    const i = stack.lastIndexOf(layer);
    if (i === -1) return;
    if (i === stack.length - 1) return pop();
    stack.splice(i, 1);
    if (layer.onExit) layer.onExit();
  }
  function depth() { return stack.length; }
  function inOsk() { return stack.some(l => l.id === "osk"); }

  document.addEventListener("keydown", (e) => {
    const m = keymapMatches(e);
    const l = top();
    if (!l) return;
    // OSK layer text handling happens inside its own listener; here only navigation keys when OSK not typing
    if (m.sleep) { e.preventDefault(); App.onSleepCombo(); return; }
    if (m.home) { e.preventDefault(); home(); return; }
    const backPressed = m.back || (e.key === "Escape" && l.id !== "osk");
    if (backPressed && l.id !== "osk") { e.preventDefault(); back(); return; }
    if (m.back && l.id === "osk" && !l.hasText()) { e.preventDefault(); l.onBack(); return; }
    if (m.pageUp) { e.preventDefault(); App.flipPage(-1); return; }
    if (m.pageDown) { e.preventDefault(); App.flipPage(1); return; }
    const handled = ["left","right","up","down","ok","menu"];
    for (const d of handled) {
      if (m[d]) {
        e.preventDefault();
        if (d === "ok") activate();
        else if (d === "menu") menu();
        else if (l.id === "osk" && !l.navOk && (d === "ok")) activate();
        else move(d);
        return;
      }
    }
  }, true);

  // Mouse/touch convenience. Remote semantics for clicks: highlight FIRST
  // (capture phase — before the element's own click listener runs), then the
  // element's listener acts. Elements with their own listeners (rows, tiles,
  // toggles, buttons…) would fire TWICE if we also activated here, so we only
  // activate modal menu/dialog items, which have no listener of their own.
  document.addEventListener("click", (e) => {
    if (!e.isTrusted) return;
    const el = e.target.closest(".focusable, .tile, .row, .menu-item, .key, .btn, .fc-day, .page-tab, .f-value, .toggle");
    const t = top();
    if (!el || !t || !els(t).includes(el)) return;
    setFocus(el);
    if (el.closest("#modal-host")) queueMicrotask(() => { if (top() === t) activate(); });
  }, true);

  return { push, pop, setFocus, activate, depth, inOsk, top,
    get current() { return current; }, move };
})();
