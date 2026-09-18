/* HTLauncher in-page on-screen keyboard (TV overlay) for Edge app windows.
 *
 * Keep this file byte-identical with its copy in the OTHER extension dir
 * (netflix-remote / spotify-remote) — --load-extension cannot share files
 * between extensions, so each bundle carries its own copy. Edit both.
 *
 * Opens when spatial navigation lands on a text field (via
 * window.__htlOskAutoOpen, called by spatial.js) or when Enter is pressed on
 * a focused field with the OSK closed (submit suppressed; Done submits).
 * The overlay lives in an open shadow root on <html> so site CSS cannot
 * touch it. All remote keys while open: arrows = grid highlight, Enter =
 * press highlighted key, Backspace/Delete = delete from field, Escape = close,
 * printable chars = reach the field natively (we never intercept them).
 *
 * Pure helpers (layout, shouldOpenFor, setFieldValue, backspace, shift) are
 * exposed on window.__htlOsk / module.exports for test/osk.test.js. */
(() => {
  const W = typeof window !== "undefined" ? window : this;
  if (!W) return;
  const D = W.document;

  /* ---- pure layout (mirrors launcher web/js/osk.js spirit) --------------- */
  const ROWS_ALPHA = [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
    ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
    ["z", "x", "c", "v", "b", "n", "m"],
  ];
  const ROWS_SYM = [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
    ["!", "@", "#", "$", "%", "^", "&", "*", "(", ")"],
    ["_", "-", "+", "=", "[", "]", "{", "}", "|", ";"],
    ["'", '"', ",", ".", "<", ">", ":", "/", "?"],
  ];
  const TEXT_INPUT_TYPES = ["text", "search", "email", "password", "url", "tel", "number"];

  /* Open rule: (c) never for checkbox/radio/button-like; yes for textish
   * inputs, textarea, contenteditable. */
  function shouldOpenFor(tag, type, isContentEditable) {
    if (isContentEditable) return true;
    if (tag === "TEXTAREA") return true;
    if (tag !== "INPUT") return false;
    const t = (type || "text").toLowerCase();
    if (["checkbox", "radio", "button", "submit", "reset", "image", "file", "hidden"].includes(t)) return false;
    return TEXT_INPUT_TYPES.includes(t);
  }

  /* Grid rows including functional keys; shift/sym affect char labels. */
  function buildRows(letters, shift, sym) {
    const src = sym ? ROWS_SYM : ROWS_ALPHA;
    const rows = src.map((r) => r.map((ch) => ({ kind: "char", ch: shift && !sym ? ch.toUpperCase() : ch })));
    const bar = [
      { kind: "mode", label: sym ? "ABC" : "?#1" },
      { kind: "space", ch: " " },
      { kind: "shift", label: shift ? "SHIFT\u21e7" : "shift" },
      { kind: "bksp", label: "\u232b" },
      { kind: "done", label: "Done" },
    ];
    rows.push(bar);
    return rows;
  }

  /* Insert one char at the caret end using an injectable setter+dispatch so
   * this is testable headlessly. React/Netflix/Angular need the *native*
   * value setter, not el.value=, or their state never updates. */
  function setFieldValue(el, ch, opts) {
    opts = opts || {};
    const get = opts.getValue || (() => el.value || "");
    const apply = opts.apply || ((text) => {
      if (el.isContentEditable) {
        try { el.focus(); D.execCommand("insertText", false, ch); } catch (e) {}
        return;
      }
      const proto = el.tagName === "TEXTAREA" ? W.HTMLTextAreaElement : W.HTMLInputElement;
      const desc = Object.getOwnPropertyDescriptor(proto.prototype, "value");
      const text2 = get() + ch;
      if (desc && desc.set) desc.set.call(el, text2); else el.value = text2;
      el.dispatchEvent(new W.Event("input", { bubbles: true }));
      el.dispatchEvent(new W.Event("change", { bubbles: true }));
    });
    if (ch !== "" && ch != null) apply(ch);
  }
  /* Delete one char from the end (pure math when given get/set text hooks). */
  function backspaceField(el, opts) {
    opts = opts || {};
    if (el && el.isContentEditable) {
      // value= does nothing on contenteditable; delete via the editor command
      try { el.focus(); D.execCommand("delete"); } catch (e) {}
      try { el.dispatchEvent(new W.Event("input", { bubbles: true })); } catch (e) {}
      return;
    }
    const get = opts.getValue || (() => (el && el.value) || "");
    const set = opts.setValue || ((text) => { el.value = text; });
    const next = get().slice(0, -1);
    let desc = null;
    try {
      desc = Object.getOwnPropertyDescriptor(
        (el && el.tagName === "TEXTAREA" ? W.HTMLTextAreaElement : W.HTMLInputElement).prototype, "value");
    } catch (e) { /* headless stub without prototypes */ }
    if (el && desc && desc.set) desc.set.call(el, next); else set(next);
    try {
      el.dispatchEvent(new W.Event("input", { bubbles: true }));
      el.dispatchEvent(new W.Event("change", { bubbles: true }));
    } catch (e) {}
  }

  const API = { ROWS_ALPHA, ROWS_SYM, shouldOpenFor, buildRows,
                setFieldValue, backspaceField, TEXT_INPUT_TYPES };
  W.__htlOsk = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (!D || !D.addEventListener) return; // headless harness: pure helpers only

  /* ---- overlay state ------------------------------------------------------ */
  let host = null, shadow = null, open = false, target = null;
  let shift = false, sym = false, hi = { r: 1, c: 0 }; // highlighted cell
  let blurTimer = null;

  W.__htlOskOpen = false;
  W.__htlOskState = () => ({
    open,
    targetTag: target ? target.tagName : null,
    keyCount: shadow ? shadow.querySelectorAll("[data-key]").length : 0,
  });

  const CSS = `
:host { all: initial; }
.panel { position:fixed; right:32px; bottom:32px; z-index:2147483646;
  background:rgba(18,18,18,.92); border-radius:12px; padding:18px;
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  color:#fff; font-family:system-ui,sans-serif; box-shadow:0 8px 40px rgba(0,0,0,.6); }
.preview { font-size:22px; min-height:30px; margin-bottom:12px; padding:6px 10px;
  background:rgba(255,255,255,.08); border-radius:8px; white-space:pre-wrap; }
.row { display:flex; gap:8px; margin-bottom:8px; justify-content:center; }
.key { min-width:64px; height:64px; border-radius:10px; background:rgba(255,255,255,.12);
  color:#fff; font-size:24px; display:flex; align-items:center; justify-content:center;
  cursor:pointer; user-select:none; padding:0 10px; }
.key[data-hl="1"] { outline:4px solid #fff; outline-offset:-2px; background:rgba(255,255,255,.28); }
.key.space { flex:1; }
.key.done { background:#1DB954; font-weight:600; }
.key.mode.shift[data-on="1"] { background:rgba(29,185,84,.5); }
`;

  function el(tag, cls, ds) {
    const e = D.createElement(tag);
    if (cls) e.className = cls;
    if (ds) for (const k in ds) e.setAttribute(k, ds[k]);
    return e;
  }

  function render() {
    if (!shadow) return;
    const prev = shadow.querySelector(".preview");
    if (prev) prev.textContent = (target && (target.value != null ? target.value : target.textContent)) || "";
    const wrap = shadow.querySelector("#keys");
    if (!wrap) return;
    wrap.innerHTML = "";
    const rows = buildRows(null, shift, sym);
    rows.forEach((r, ri) => {
      const row = el("div", "row");
      r.forEach((k, ci) => {
        const cls = "key " + (k.kind === "done" ? "done" : k.kind === "space" ? "wide space" : "mode" + (k.kind === "shift" ? " shift" : ""));
        const cell = el("div", cls, {
          "data-key": "", "data-r": ri, "data-c": ci,
          "data-kind": k.kind, "data-ch": k.ch || "", "data-label": k.label || k.ch || "",
        });
        cell.textContent = k.label || k.ch || "";
        if (k.kind === "shift") cell.setAttribute("data-on", shift ? "1" : "0");
        if (hi.r === ri && hi.c === ci) cell.setAttribute("data-hl", "1");
        cell.addEventListener("pointerdown", (ev) => { ev.preventDefault(); press(k); });
        row.append(cell);
      });
      wrap.append(row);
    });
  }

  function moveHi(dr, dc) {
    const rows = buildRows(null, shift, sym);
    hi.r = Math.max(0, Math.min(rows.length - 1, hi.r + dr));
    const width = rows[hi.r].length;
    hi.c = Math.max(0, Math.min(width - 1, hi.c + dc));
    render();
  }

  function press(k) {
    if (!target) return;
    if (k.kind === "char") setFieldValue(target, k.ch);
    else if (k.kind === "space") setFieldValue(target, " ");
    else if (k.kind === "shift") shift = !shift;
    else if (k.kind === "mode") sym = !sym;
    else if (k.kind === "bksp") backspaceField(target);
    else if (k.kind === "done") { const f = target; close(); submitDone(f); return; }
    render();
    syncPreview();
  }
  function syncPreview() {
    const prev = shadow && shadow.querySelector(".preview");
    if (prev && target) prev.textContent = target.value != null ? target.value : target.textContent;
  }

  function submitDone(f) {
    // close() nulls `target`, so the field must come from the caller's capture.
    const form = f && f.form;
    try { if (form && form.requestSubmit) { form.requestSubmit(); return; } } catch (e) {}
    try {
      const ev = new W.KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true });
      (f || D).dispatchEvent(ev);
    } catch (e) {}
  }

  function openFor(field) {
    if (!field || !D.body) return;
    target = field;
    if (!host) {
      host = el("div"); host.id = "htl-osk";
      shadow = host.attachShadow({ mode: "open" });
      D.documentElement.append(host);
    }
    shadow.innerHTML = `<style>${CSS}</style><div class="panel"><div class="preview"></div><div id="keys"></div></div>`;
    open = true; W.__htlOskOpen = true;
    hi = { r: 1, c: 0 };
    render();
    try { target.focus({ preventScroll: true }); } catch (e) { try { target.focus(); } catch (e2) {} }
  }
  function close() {
    open = false; W.__htlOskOpen = false;
    if (host && host.parentNode) host.remove();
    shadow = null; host = null; target = null;
  }

  /* spatial.js calls this when focus lands on a text field */
  W.__htlOskAutoOpen = (field) => {
    if (shouldOpenFor(field.tagName, (field.type || "").toLowerCase(), field.isContentEditable)) openFor(field);
  };

  W.addEventListener("keydown", (e) => {
    /* (b) Enter on a focused field with OSK closed => open instead of submit */
    if (!open) {
      if (e.key === "Enter" && !e.__htlHandled && e.target &&
          shouldOpenFor(e.target.tagName, (e.target.type || "").toLowerCase(), e.target.isContentEditable)) {
        e.preventDefault(); e.stopPropagation(); e.__htlHandled = true;
        openFor(e.target);
      }
      return;
    }
    /* OSK is open: it owns these keys (spatial.js defers via __htlOskOpen) */
    if (e.__htlHandled) return;
    const rows = buildRows(null, shift, sym);
    const k = rows[hi.r] && rows[hi.r][hi.c];
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault(); e.stopPropagation(); e.__htlHandled = true;
      moveHi(e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0,
             e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0);
    } else if (e.key === "Enter") {
      e.preventDefault(); e.stopPropagation(); e.__htlHandled = true;
      if (k) press(k);
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault(); e.stopPropagation(); e.__htlHandled = true;
      if (target) backspaceField(target);
      syncPreview();
    } else if (e.key === "Escape") {
      e.preventDefault(); e.stopPropagation(); e.__htlHandled = true;
      close();
    }
    /* printable chars (length 1, no ctrl/meta): not intercepted — the focused
     * field receives them natively from the physical remote keyboard */
  }, true);

  /* close when focus has left the field for >300ms (focus is never inside the
   * shadow overlay — keys are non-focusable divs with pointerdown) */
  W.addEventListener("focusin", () => {
    if (!open) return;
    if (D.activeElement === target) { clearTimeout(blurTimer); return; }
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => { if (open && D.activeElement !== target) close(); }, 300);
  }, true);
  W.addEventListener("pagehide", () => { if (open) close(); });
})();
