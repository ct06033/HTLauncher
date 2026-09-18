/* HTLauncher in-page spatial navigator (D-pad/arrow focus movement).
 *
 * Keep this file byte-identical with its copy in the OTHER extension dir
 * (netflix-remote / spotify-remote) — --load-extension cannot share files
 * between extensions, so each bundle carries its own copy. Edit both.
 *
 * Why: Netflix/Spotify only move focus where the site itself implements arrow
 * keys. This adds a geometric "nearest neighbour in the pressed direction"
 * walker over every focusable element on the page. Runs in the isolated world
 * (DOM access is enough). Registered BEFORE content.js so remote-semantics
 * (Back/Home) still get first look at keys they own (we never touch
 * Delete/Backspace/Home/Escape/Enter).
 *
 * The pure scoring core htSpatialPick() is exposed on window.__htlSpatial for
 * the headless test (test/spatial.test.js). */
(() => {
  const W = typeof window !== "undefined" ? window : this;
  if (!W || !W.document) return;
  const D = W.document;

  const ARROWS = { ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1 };
  const SEL = 'a[href],button,input,textarea,select,' +
    '[role="button"],[role="link"],[role="menuitem"],[role="tab"],' +
    '[role="searchbox"],[tabindex]:not([tabindex="-1"])';
  const MIN_PX = 8;          // ignore tiny hit targets
  const MAX_CANDIDATES = 400; // Netflix ARIA grids expose thousands of nodes
  const CROSS_PENALTY = 1e5;  // zero/partial perpendicular-overlap penalty

  /* ---- pure geometry (unit-tested) -------------------------------------- */
  /* rects: [{x,y,w,h,...}], from: {x,y,w,h} (may be null), dir: Arrow* key.
   * Returns the chosen rect or null (nothing in that direction).
   * Score = primary-axis edge gap (0 when projections overlap) +
   * (1 - perpendicular overlap ratio) * CROSS_PENALTY. Ties break on the
   * smaller perpendicular center distance. */
  function htSpatialPick(rects, from, dir) {
    if (!from || !Array.isArray(rects) || !rects.length) return null;
    const horiz = dir === "ArrowLeft" || dir === "ArrowRight";
    const pos = dir === "ArrowRight" || dir === "ArrowDown"; // increasing axis
    const mDim = horiz ? "w" : "h";
    const cDim = horiz ? "h" : "w";
    let best = null, bestScore = Infinity, bestCross = Infinity;
    for (const c of rects) {
      if (!c || c === from) continue;
      const fc = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
      const cc = { x: c.x + c.w / 2, y: c.y + c.h / 2 };
      const along = (horiz ? cc.x - fc.x : cc.y - fc.y) * (pos ? 1 : -1);
      if (along <= 0) continue; // behind us (or same center line) — not this dir
      // primary-axis edge gap; 0 when the projections on that axis overlap
      let gap;
      if (pos) gap = c[horiz ? "x" : "y"] - (from[horiz ? "x" : "y"] + from[mDim]);
      else gap = from[horiz ? "x" : "y"] - (c[horiz ? "x" : "y"] + c[mDim]);
      if (gap < 0) gap = 0;
      // perpendicular overlap ratio between the two bands
      const a0 = from[horiz ? "y" : "x"], a1 = a0 + from[cDim];
      const b0 = c[horiz ? "y" : "x"], b1 = b0 + c[cDim];
      const ov = Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
      const ratio = Math.min(a1 - a0, b1 - b0) > 0 ? ov / Math.min(a1 - a0, b1 - b0) : 0;
      const score = gap + (1 - ratio) * CROSS_PENALTY;
      const crossDist = horiz ? Math.abs(cc.y - fc.y) : Math.abs(cc.x - fc.x);
      if (score < bestScore - 1e-9 ||
          (Math.abs(score - bestScore) <= 1e-9 && crossDist < bestCross)) {
        best = c; bestScore = score; bestCross = crossDist;
      }
    }
    return best;
  }

  /* Pure start-point rule for when nothing is focused: candidate whose center
   * is nearest the "center-left" of the viewport (TV browse entry column). */
  function htSpatialStart(rects, vw, vh) {
    if (!Array.isArray(rects) || !rects.length) return null;
    const tx = vw * 0.1, ty = vh / 2;
    let best = null, bd = Infinity;
    for (const c of rects) {
      const dx = c.x + c.w / 2 - tx, dy = c.y + c.h / 2 - ty;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  const API = { pick: htSpatialPick, htSpatialPick, start: htSpatialStart,
                SEL, MIN_PX, MAX_CANDIDATES };
  W.__htlSpatial = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (!D.addEventListener) return; // headless test harness: pure fns only

  /* ---- DOM wiring -------------------------------------------------------- */
  function rectOf(el) {
    if (!el || !el.getBoundingClientRect) return null;
    // cheap visibility: offsetParent (null for fixed/hidden) OR client rects
    const visible = el.offsetParent !== null ||
      (el.getClientRects && el.getClientRects().length > 0);
    if (!visible) return null;
    const cs = W.getComputedStyle ? W.getComputedStyle(el) : null;
    if (cs && (cs.visibility === "hidden" || cs.display === "none" ||
               parseFloat(cs.opacity || "1") < 0.05)) return null;
    const r = el.getBoundingClientRect();
    if (r.width < MIN_PX || r.height < MIN_PX) return null;
    return { x: r.x, y: r.y, w: r.width, h: r.height, el };
  }

  function collect(from) {
    const vw = W.innerWidth || 1280, vh = W.innerHeight || 720;
    const out = [];
    let nodes;
    try { nodes = D.querySelectorAll(SEL); } catch (e) { return out; }
    for (const el of nodes) {
      const r = rectOf(el);
      if (!r) continue;
      if (r.x > vw || r.y > vh || r.x + r.w < 0 || r.y + r.h < 0) continue; // off-viewport
      out.push(r);
    }
    if (out.length > MAX_CANDIDATES) {
      // cap before scoring: keep the MAX_CANDIDATES nearest the focus
      const fx = from ? from.x + from.w / 2 : vw * 0.1;
      const fy = from ? from.y + from.h / 2 : vh / 2;
      out.sort((a, b) =>
        ((a.x + a.w / 2 - fx) ** 2 + (a.y + a.h / 2 - fy) ** 2) -
        ((b.x + b.w / 2 - fx) ** 2 + (b.y + b.h / 2 - fy) ** 2));
      out.length = MAX_CANDIDATES;
    }
    return out;
  }

  function isTextish(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === "TEXTAREA") return true;
    if (tag !== "INPUT") return false;
    const t = (el.type || "text").toLowerCase();
    return ["text", "search", "email", "password", "url", "tel", "number"].includes(t);
  }

  function moveFocus(r) {
    const prev = D.querySelector("[data-htl-focus]");
    if (prev && prev !== r.el) prev.removeAttribute("data-htl-focus");
    try { r.el.focus({ preventScroll: true }); } catch (e) { try { r.el.focus(); } catch (e2) {} }
    try { r.el.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) {}
    r.el.setAttribute("data-htl-focus", "1");
    // auto-open the in-page OSK when spatial navigation lands on a text field
    if (isTextish(r.el) && typeof W.__htlOskAutoOpen === "function") {
      try { W.__htlOskAutoOpen(r.el); } catch (e) {}
    }
  }

  W.addEventListener("keydown", (e) => {
    if (!ARROWS[e.key]) return;                     // Enter/Back/Home/Esc: not ours
    if (e.__htlHandled) return;
    if (W.__htlOskOpen) return;                     // OSK owns the arrows while open
    const t = D.activeElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
      return;                                       // defer: caret movement inside fields
    }
    const from = (t && t !== D.body && t !== D.documentElement) ? rectOf(t) : null;
    const cands = collect(from);
    if (!cands.length) return;
    let target = null;
    if (from) {
      target = htSpatialPick(cands, from, e.key);
    } else {
      const seed = htSpatialStart(cands, W.innerWidth || 1280, W.innerHeight || 720);
      if (seed && seed.el !== t) target = seed;
    }
    if (!target || !target.el || target.el === t) return; // nothing in that direction: keep focus
    e.preventDefault(); e.stopPropagation();
    e.__htlHandled = true;
    moveFocus(target);
  }, true);
})();
