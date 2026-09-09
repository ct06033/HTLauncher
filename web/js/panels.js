/* Shared UI helpers: slide-over panels, context menus, dialogs, pickers, icons. */
(() => {

/* ---------- icons (inline SVG) ---------- */
const ICONS = {
  bt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 7l10 10-5 4V3l5 4L7 17"/></svg>',
  wifi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 8.5a16 16 0 0120 0M5 12a11 11 0 0114 0M8.5 15.5a6 6 0 017 0"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/></svg>',
  lan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="14" width="8" height="6" rx="1"/><rect x="14" y="4" width="8" height="6" rx="1"/><path d="M6 14v-3h12"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10.6 2.6h2.8l.4 2.3a6.6 6.6 0 011.9.8l2-1.2 2 2-1.2 2a6.6 6.6 0 01.8 1.9l2.3.4v2.8l-2.3.4a6.6 6.6 0 01-.8 1.9l1.2 2-2 2-2-1.2a6.6 6.6 0 01-1.9.8l-.4 2.3h-2.8l-.4-2.3a6.6 6.6 0 01-1.9-.8l-2 1.2-2-2 1.2-2a6.6 6.6 0 01-.8-1.9l-2.3-.4v-2.8l2.3-.4a6.6 6.6 0 01.8-1.9l-1.2-2 2-2 2 1.2a6.6 6.6 0 011.9-.8z"/><circle cx="12" cy="12" r="3"/></svg>',
  power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v8"/><path d="M6.6 6.6a8 8 0 1010.8 0"/></svg>',
  app: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="2" opacity=".9"/><rect x="13" y="3" width="8" height="8" rx="2" opacity=".6"/><rect x="3" y="13" width="8" height="8" rx="2" opacity=".6"/><rect x="13" y="13" width="8" height="8" rx="2" opacity=".9"/></svg>',
  cmd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2.5" y="4" width="19" height="16" rx="2"/><path d="M6.5 9l4 3.5-4 3.5M12.5 16h5"/></svg>',
  web: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14 0 18M12 3c-3 3.5-3 14 0 18"/></svg>',
  audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="3" width="12" height="18" rx="3"/><circle cx="12" cy="14" r="3.2"/><circle cx="12" cy="7" r="1"/></svg>',
  hid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 8h10a4 4 0 014 4l-1 5a2.5 2.5 0 01-4.4 1L14 16h-4l-1.6 2A2.5 2.5 0 014 17l-1-5a4 4 0 014-4z"/><path d="M8 11v3M6.5 12.5h3"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 12.5l5 5L20 6.5"/></svg>',
};
const WX = {
  sun: c => `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="12" fill="#ffd166"/><g stroke="#ffd166" stroke-width="4" stroke-linecap="round">${[0,45,90,135,180,225,270,315].map(a=>`<line x1="${32+19*Math.cos(a*Math.PI/180)}" y1="${32+19*Math.sin(a*Math.PI/180)}" x2="${32+25*Math.cos(a*Math.PI/180)}" y2="${32+25*Math.sin(a*Math.PI/180)}"/>`).join("")}</g></svg>`,
  partly: c => `<svg viewBox="0 0 64 64"><circle cx="24" cy="22" r="9" fill="#ffd166"/><path d="M20 46a10 10 0 0110-10 12 12 0 0123 3 8 8 0 01-2 16H26a9 9 0 01-6-9z" fill="#cfd8ea"/></svg>`,
  cloud: c => `<svg viewBox="0 0 64 64"><path d="M14 44a11 11 0 0111-11 13 13 0 0125 4 9 9 0 01-2 18H21a10 10 0 01-7-11z" fill="#a8b4cc"/></svg>`,
  rain: c => `<svg viewBox="0 0 64 64"><path d="M14 36a11 11 0 0111-11 13 13 0 0125 4 9 9 0 01-2 18H21a10 10 0 01-7-11z" fill="#8fa0c0"/><g stroke="#6ea8fe" stroke-width="3.5" stroke-linecap="round"><line x1="22" y1="50" x2="19" y2="58"/><line x1="33" y1="50" x2="30" y2="58"/><line x1="44" y1="50" x2="41" y2="58"/></g></svg>`,
  storm: c => `<svg viewBox="0 0 64 64"><path d="M14 36a11 11 0 0111-11 13 13 0 0125 4 9 9 0 01-2 18H21a10 10 0 01-7-11z" fill="#6f7f9f"/><path d="M34 42l-8 10h6l-4 10 12-13h-7l5-7z" fill="#ffd166"/></svg>`,
  snow: c => `<svg viewBox="0 0 64 64"><path d="M14 36a11 11 0 0111-11 13 13 0 0125 4 9 9 0 01-2 18H21a10 10 0 01-7-11z" fill="#b9c6de"/><g fill="#eef4ff"><circle cx="22" cy="53" r="2.4"/><circle cx="33" cy="57" r="2.4"/><circle cx="44" cy="53" r="2.4"/></g></svg>`,
  fog: c => `<svg viewBox="0 0 64 64"><path d="M14 32a11 11 0 0111-11 13 13 0 0125 4 9 9 0 01-2 18H21a10 10 0 01-7-11z" fill="#9fadc8"/><g stroke="#cfd8ea" stroke-width="3.5" stroke-linecap="round"><line x1="14" y1="48" x2="50" y2="48"/><line x1="18" y1="55" x2="46" y2="55"/></g></svg>`,
  night: c => `<svg viewBox="0 0 64 64"><path d="M40 12a17 17 0 1010 28A19 19 0 0140 12z" fill="#e8ecf4"/><circle cx="20" cy="16" r="1.8" fill="#cfd8ea"/><circle cx="14" cy="28" r="1.4" fill="#cfd8ea"/></svg>`,
};
function wxIcon(code, isDay) {
  if (!isDay && [0,1,2,3].includes(code)) return WX.night();
  if (code === 0) return WX.sun();
  if (code <= 2) return WX.partly();
  if (code === 3 || code === 45 || code === 48) return WX.fog();
  if (code < 60) return WX.cloud();
  if (code < 70) return WX.rain();
  if (code < 75) return WX.snow();
  if (code < 80) return WX.rain();
  if (code < 82) return WX.storm();
  return WX.snow();
}
function wxLabel(code) {
  return ({0:"Clear",1:"Mainly clear",2:"Partly cloudy",3:"Overcast",45:"Fog",48:"Fog",
    51:"Drizzle",53:"Drizzle",55:"Drizzle",61:"Rain",63:"Rain",65:"Heavy rain",
    71:"Snow",73:"Snow",75:"Snow",77:"Snow",80:"Showers",81:"Showers",82:"Showers",
    85:"Snow",86:"Snow",95:"Thunder",96:"Thunder",99:"Thunder"})[code] || "--";
}

/* ---------- signal bars ---------- */
function bars(n) {
  let s = '<svg viewBox="0 0 24 24" fill="currentColor" style="width:100%;height:100%">';
  for (let i = 0; i < 4; i++) {
    s += `<rect x="${3+i*5}" y="${18-(i+1)*4}" width="3.5" height="${(i+1)*4}" rx="1" opacity="${i < n ? 1 : .25}"/>`;
  }
  return s + "</svg>";
}

/* ---------- slide-over panel ---------- */
function slideOver(title, buildBody) {
  const host = document.getElementById("panel-host");
  if (slideOver.active) slideOver.active.close();   // replace any open panel
  host.innerHTML = "";
  let opener = null;   // icon that opened this panel — snap focus back on close
  const panel = document.createElement("div"); panel.className = "panel";
  const h = document.createElement("h2"); h.textContent = title;
  const body = document.createElement("div");
  panel.append(h, body);
  host.append(panel);
  let entries = buildBody(body, panel);      // may be sync array or promise
  const closeBtn = document.createElement("div");
  closeBtn.className = "btn focusable"; closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", () => close());   // works via mouse AND layer.onActivate
  const row = document.createElement("div"); row.className = "btn-row"; row.append(closeBtn);
  panel.append(row);

  const layer = {
    id: "panel:" + title,
    list: [],
    get grid() { return null; },
    onActivate(el) { if (el === closeBtn) close(); else el.click(); },
    onBack() { close(); },
    onHome() { close(); App.goHome(); },
  };
  function rows() { return [...panel.querySelectorAll(".focusable")]; }
  Object.defineProperty(layer, "list", { get: rows, configurable: true });
  Object.defineProperty(layer, "grid", {
    get() { const r = rows(); return r.map(x => [x]); }, configurable: true });
  function close() {
    document.removeEventListener("keydown", escHandler, true);
    host.innerHTML = "";
    if (slideOver.active === api) slideOver.active = null;
    Nav.remove ? Nav.remove(layer) : Nav.pop();
    // snap focus back to the icon that opened this panel (keyboard or mouse)
    if (opener && document.contains(opener) && Nav.top() && Nav.top().id === "home")
      Nav.setFocus(opener);
  }
  function escHandler(e) { if (e.key === "Escape") { e.preventDefault(); close(); } }
  document.addEventListener("keydown", escHandler, true);
  const api = { close, panel };
  Promise.resolve(entries).then(() => {
    if (host.contains(panel)) { opener = Nav.current; Nav.push(layer); }
  });
  slideOver.active = api;
  return api;
}

/* ---------- modal menu / dialog ---------- */
function menu(items, anchorRect) {
  // items: [{label, danger?, onPick}]
  const host = document.getElementById("modal-host");
  host.innerHTML = "";
  const m = document.createElement("div"); m.className = "panel menu";
  const els = items.map(it => {
    const e = document.createElement("div");
    e.className = "menu-item focusable" + (it.danger ? " danger" : "");
    e.innerHTML = `<span>${it.label}</span>` + (it.hint ? `<span class="hint">${it.hint}</span>` : "");
    e.dataset.idx = items.indexOf(it);
    m.append(e); return e;
  });
  host.append(m);
  const layer = {
    id: "menu", grid: els.map(e => [e]),
    onActivate(el) {
      const it = items[+el?.dataset?.idx];
      if (!it) { close(); return; }
      close(); it.onPick && it.onPick();
    },
    onBack() { close(); },
    onHome() { close(); App.goHome(); },
    onExit() { host.innerHTML = ""; },   // Home key pops us without calling close()
    restore: () => App.refreshGrid(),
  };
  function close() { host.innerHTML = ""; Nav.pop(); }
  Nav.push(layer);
  return close;
}

function dialog(title, buildForm, onSubmit) {
  // buildForm(fieldsApi) returns array of fields; onSubmit(values)
  const host = document.getElementById("modal-host");
  host.innerHTML = "";
  const m = document.createElement("div"); m.className = "panel menu"; m.style.minWidth = "min(560px, 70vw)";
  const h = document.createElement("h2"); h.textContent = title;
  m.append(h);
  const fields = [];
  const api = {
    text(label, initial, placeholder) {
      const wrap = document.createElement("div"); wrap.className = "field";
      const l = document.createElement("label"); l.textContent = label;
      const v = document.createElement("div"); v.className = "f-value focusable";
      let value = initial || "";
      const render = () => v.innerHTML = value ? escapeHtml(value) : `<span class="ph">${placeholder || "tap to enter"}</span>`;
      v.addEventListener("click", () => OSK.open({
        title: label, initial: value,
        onSubmit(t) { value = t; render(); Nav.setFocus(v); },
        onCancel() { Nav.setFocus(v); },
      }));
      render();
      wrap.append(l, v); m.append(wrap);
      const f = { get value() { return value.trim(); }, label };
      fields.push(f); return f;
    },
    toggle(label, initial) {
      const wrap = document.createElement("div"); wrap.className = "field";
      const l = document.createElement("label"); l.textContent = label;
      const t = document.createElement("div"); t.className = "toggle focusable" + (initial ? " on" : "");
      let value = !!initial;
      t.addEventListener("click", () => { value = !value; t.classList.toggle("on", value); });
      wrap.append(l, t); m.append(wrap);
      fields.push({ get value() { return value; } });
    },
  };
  const result = buildForm(api) || [];
  const btnRow = document.createElement("div"); btnRow.className = "btn-row";
  const cancel = document.createElement("div"); cancel.className = "btn focusable"; cancel.textContent = "Cancel";
  const ok = document.createElement("div"); ok.className = "btn primary focusable"; ok.textContent = "Add";
  btnRow.append(cancel, ok); m.append(btnRow);
  host.append(m);
  const focusables = [...m.querySelectorAll(".focusable")];
  const layer = {
    id: "dialog",
    get grid() { return focusables.map(e => [e]); },
    onActivate(el) {
      if (el === cancel) close();
      else if (el === ok) {
        const vals = fields.map(f => f.value);
        if (vals.some(v => typeof v === "string" && !v)) { App.toast("A name is required to continue"); return; }
        close(); onSubmit(vals);
      } else el.click();
    },
    onBack() { close(); },
    onHome() { close(); App.goHome(); },
    onExit() { host.innerHTML = ""; },   // Home key pops us without calling close()
  };
  function close() { if (host.contains(m)) { host.innerHTML = ""; } if (Nav.top() === layer) Nav.pop(); }
  Nav.push(layer);
  function escapeHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
}

function picker(title, items, onPick, render) {
  const api = slideOver(title, (body) => {
    const list = document.createElement("div"); list.className = "picker";
    items.forEach((it, i) => {
      const row = document.createElement("div"); row.className = "row focusable";
      row.innerHTML = render ? render(it) : `<div class="r-label">${it.label || it}</div>`;
      row.addEventListener("click", () => { api.close(); onPick(it, i); });
      list.append(row);
    });
    body.append(list);
  });
  return api;
}

window.UI = { ICONS, WX, wxIcon, wxLabel, bars, slideOver, menu, dialog, picker, escapeHtml };
function escapeHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/</g, "&lt;"); }

})();
