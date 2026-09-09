/* TVShell on-screen keyboard. One Nav layer; minimize collapses to a pill. */
(() => {
  const LOWER = ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm"];
  const UPPER = ["!@#$%^&*()", "QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
  const SPECIAL = ["~`|\\/[]{}", "\"'<>=+-_", "^&*()#$;", ".:;,@?%"];
  let active = null;

  function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;"); }

  function open(opts) {
    // opts: { title, initial, submitLabel, onSubmit(text), onCancel? }
    if (active) active.close(true);
    const host = document.getElementById("osk-host");
    host.innerHTML = "";
    const st = { text: opts.initial || "", shift: false, layout: "alpha", minimized: false };

    const pill = el("div", "focusable"); pill.id = "osk-min-pill"; pill.textContent = "⌨ Keyboard — reopen";
    const preview = el("div"); preview.id = "osk-preview";
    const keysWrap = el("div"); keysWrap.id = "osk-keys";
    const btnMin = el("div", "btn focusable"); btnMin.textContent = "Minimize";
    const btnSubmit = el("div", "btn primary focusable"); btnSubmit.textContent = opts.submitLabel || "Submit";
    const actions = el("div"); actions.id = "osk-actions"; actions.append(btnMin, btnSubmit);
    const h = el("h2"); h.textContent = opts.title || "Type";
    const panel = el("div", "panel"); panel.append(h, preview, keysWrap, actions);
    host.append(panel, pill);

    function renderPreview() {
      preview.innerHTML = (st.text ? esc(st.text) : '<span class="dim">tap keys…</span>') + '<span class="dim">▏</span>';
    }
    function keyCell(label, ds, cls) {
      const k = el("div", "key focusable" + (cls || "")); k.textContent = label; Object.assign(k.dataset, ds); return k;
    }
    function renderKeys() {
      keysWrap.innerHTML = "";
      const rows = st.layout === "special" ? SPECIAL : (st.shift ? UPPER : LOWER);
      for (const r of rows) {
        const row = el("div", "osk-row");
        for (const c of r) row.append(keyCell(c, { ch: c }));
        keysWrap.append(row);
      }
      const bottom = el("div", "osk-row");
      bottom.append(keyCell(st.layout === "special" ? "abc" : "?#1", { special: "sym" }, " wide"));
      bottom.append(keyCell("Space", { special: "space" }, " wide"));
      bottom.append(keyCell(st.shift ? "⇧ Shift" : "shift", { special: "shift" }, " wide" + (st.shift ? " active-mod" : "")));
      bottom.append(keyCell("⌫", { special: "bksp" }, " wide"));
      bottom.append(keyCell("Enter", { special: "enter" }, " wide"));
      keysWrap.append(bottom);
    }
    function insert(ch) { st.text += ch; renderPreview(); }
    function backspace() {
      if (!st.text) { close(); return; }
      st.text = st.text.slice(0, -1); renderPreview();
    }
    function submit() {
      const t = st.text.trim();
      if (!t) { App.toast("A name is required to continue"); return; }
      close(true); opts.onSubmit(t);
    }
    function pressKey(k) {
      if (k === btnMin) return setMinimized(true);
      if (k === btnSubmit) return submit();
      if (k === pill) return setMinimized(false);
      if (k.dataset.ch) return insert(k.dataset.ch);
      const id = k.dataset.special;
      if (id === "sym") { st.layout = st.layout === "special" ? "alpha" : "special"; renderKeys(); return focus("sym"); }
      if (id === "shift") { st.shift = !st.shift; renderKeys(); return focus("shift"); }
      if (id === "space") return insert(" ");
      if (id === "bksp") return backspace();
      if (id === "enter") return submit();
    }
    function focus(specialId) {
      const k = keysWrap.querySelector(`[data-special="${specialId}"]`) || keysWrap.querySelector(".key");
      if (k) Nav.setFocus(k);
    }
    function setMinimized(m) {
      st.minimized = m;
      panel.style.display = m ? "none" : "";
      pill.style.display = m ? "block" : "none";
      if (m) Nav.setFocus(pill); else focus("enter");
    }
    function close(silent) {
      document.removeEventListener("keydown", phys, true);
      host.innerHTML = "";
      active = null;
      if (Nav.top() === layer) Nav.pop();
      if (!silent && opts.onCancel) opts.onCancel();
    }

    // physical keyboard passthrough
    function phys(e) {
      if (e.key === "Backspace") { e.preventDefault(); backspace(); }
      else if (e.key === "Enter") { e.preventDefault(); submit(); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === " " && e.target === document.body) { e.preventDefault(); insert(" "); }
      else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey &&
               !["Home","End","PageUp","PageDown"].includes(e.key)) {
        e.preventDefault(); insert(e.key);
      }
    }

    panel.addEventListener("click", (e) => {
      const k = e.target.closest(".key,.btn"); if (k) pressKey(k);
    });
    pill.addEventListener("click", () => setMinimized(false));

    renderKeys(); renderPreview(); pill.style.display = "none";

    const layer = {
      id: "osk",
      get grid() {
        if (st.minimized) return [[pill]];
        const rows = [...keysWrap.querySelectorAll(".osk-row")].map(r => [...r.children]);
        return [[btnSubmit], [btnMin], ...rows];
      },
      hasText: () => st.text.length > 0,
      initial: () => st.minimized ? pill : (keysWrap.querySelector('[data-special="enter"]')),
      onActivate: pressKey,
      onBack() { close(); },           // back = dismiss keyboard, keep text? PRD: submit closes; back closes
      onHome() { close(); App.goHome(); },
      restore: (setF) => setF(btnSubmit),
    };
    active = layer;
    Nav.push(layer);
    document.addEventListener("keydown", phys, true);
    setTimeout(() => focus("enter"), 0);
    return layer;
  }

  window.OSK = { open, get active() { return active; } };
})();
