/* TVShell main app — home screen, panels, add flows, pages, power. */
window.App = (() => {
  let currentPage = 0;
  let gridRows = [];           // DOM grid for current page
  let wallpaperTimer = null, wallpaperIdx = 0, wallpaperPool = [], wallpaperOn = "a";
  let pageUnsub = null;        // Store.onChange for grid

  /* =============== boot =============== */
  async function boot() {
    startClock();
    wireTopBar();
    buildPages();
    showPage(0);
    Weather.onChange(renderWeather);
    Weather.refresh(); setInterval(Weather.refresh, 10 * 60 * 1000);
    setupWallpaper();
    Store.onChange(() => { setupWallpaper(); });
    checkVolume();
    pushHomeLayer();
    autoSetupGames();          // one-time: detect installed games -> GAMES page
    toast(`HTLauncher ready. Arrow keys + Enter, Del=Back, End=Menu, Home, PgUp/PgDn.`);
  }

  /* =============== games auto-setup =============== */
  async function autoSetupGames(force) {
    if (Store.state.gamesSetup && !force) return "already";
    let games = [];
    try { games = await Bridge.scanGames(); } catch (e) { return "error"; }
    if (!games.length) {
      Store.state.gamesSetup = "none"; Store.save();
      if (force) toast("No installed games found (Steam/Epic/GOG)");
      return "none";
    }
    let slot = Store.state.pages.findIndex((n, i) => i > 0 && /^games$/i.test(n || ""));
    if (slot === -1) slot = Store.state.pages.findIndex((n, i) => i > 0 && !n);
    if (slot === -1) { if (force) toast("All pages are full — free one first"); return "nopage"; }
    if (!Store.state.pages[slot]) { Store.state.pages[slot] = "GAMES"; buildPages(); }
    const existing = Store.tiles(slot);
    const newTiles = games
      .filter(g => !existing.some(t => t.type === "game" && (t.appid === g.appid || t.name === g.name)))
      .map(g => ({ type: "game", name: g.name, src: g.src, appid: g.appid,
        launch: g.launch, icon: null }));
    if (newTiles.length) { Store.tiles(slot).push(...newTiles); Store.save(); }
    Store.state.gamesSetup = String(games.length); Store.save();
    if (currentPage === slot) renderGrid();
    fillGameIcons(slot).then((any) => { if (any && currentPage === slot) renderGrid(); });
    toast(`Added ${newTiles.length || games.length} game${(newTiles.length || games.length) > 1 ? "s" : ""} to GAMES — press Page Down`);
    return "ok";
  }
  async function fillGameIcons(slot) {
    let changed = false;
    const tiles = Store.tiles(slot);
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      if (t.type === "game" && !t.icon && t.appid && /^\d+$/.test(t.appid) && Bridge.gameIcon) {
        try {
          const ic = await Bridge.gameIcon(t.appid);
          if (ic.iconUrl) { Store.updateTile(slot, i, { icon: ic.iconUrl }); changed = true; }
        } catch (e) {}
      }
    }
    return changed;
  }

  async function checkVolume() {
    const v = await Bridge.getVolume();
    if (v.level < 100 || v.muted) {
      await Bridge.ensureMaxVolume();
      toast(v.muted ? "Volume was muted — set to 100%" : "Volume set to 100%");
    }
  }

  /* =============== home layer =============== */
  function pushHomeLayer() {
    if (Nav.top() && Nav.top().id === "home") return;
    Nav.push({
      id: "home",
      get grid() { return homeGrid(); },
      lockRows: false,
      onActivate: activateGridEl,
      onMenu(el) {
        const t = gridTileOf(el);
        if (t) tileMenu(t.tile, t.page, t.idx);
        else if (el && el.classList.contains("add-tile")) openAddMenu();
        else if (el) el.click();
      },
      onBack() { /* already home; PRD: back at top level does nothing visible */ },
      onHome() { goHome(); },
    });
  }
  function firstGridEl() { return homeGrid().flat()[0]; }
  function goHome() {
    while (Nav.depth() > 1) {
      const before = Nav.depth();
      const l = Nav.top();
      // let layers with their own teardown run it (it pops or removes itself)
      if (l && l.onBack) l.onBack();
      if (Nav.depth() === before) Nav.pop();   // onBack was a no-op → force pop
    }
    renderGrid();
    Nav.setFocus(firstGridEl());
  }

  function homeGrid() {
    const g = [];
    g.push([...document.querySelectorAll("#topbar .focusable")]);
    g.push([...document.querySelectorAll("#page-tabs .page-tab")]);
    const rows = [...document.querySelectorAll("#tile-grid .grid-row")];
    for (const r of rows) g.push([...r.children]);
    return g;
  }
  function gridTileOf(el) {
    if (!el || !el.classList.contains("tile") || el.classList.contains("add-tile")) return null;
    const idx = +el.dataset.idx;
    return { tile: Store.tiles(currentPage)[idx], page: currentPage, idx };
  }
  function activateGridEl(el) {
    const t = gridTileOf(el);
    if (t) return launch(t.tile);
    if (el && el.classList.contains("add-tile")) return openAddMenu();
    if (el) el.click();
  }

  /* =============== top bar =============== */
  function wireTopBar() {
    const $ = id => document.getElementById(id);
    $("btn-bluetooth").innerHTML = UI.ICONS.bt;
    $("btn-network").innerHTML = UI.ICONS.wifi;
    $("btn-settings").innerHTML = UI.ICONS.gear;
    $("btn-power").innerHTML = UI.ICONS.power;
    $("weather-zone").addEventListener("click", openForecast);
    $("btn-bluetooth").addEventListener("click", btPanel);
    $("btn-network").addEventListener("click", netPanel);
    $("btn-settings").addEventListener("click", settingsPanel);
    $("btn-power").addEventListener("click", powerMenu);
    refreshNetIcon();
  }
  async function refreshNetIcon() {
    const s = await Bridge.networkStatus();
    document.getElementById("btn-network").innerHTML =
      s && s.type === "lan" ? UI.ICONS.lan : UI.ICONS.wifi;
    document.getElementById("btn-network").classList.toggle("on", !!(s && s.ssid));
  }

  /* =============== clock =============== */
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  function startClock() {
    const tEl = document.getElementById("clock-time"), dEl = document.getElementById("clock-date");
    const tick = () => {
      const d = new Date();
      let h = d.getHours(), ampm = h >= 12 ? "PM" : "AM";
      if (Store.state.timeFormat === "12H") { h = h % 12 || 12;
        tEl.innerHTML = `${h}:${String(d.getMinutes()).padStart(2,"0")}<span class="ampm">${ampm}</span>`;
      } else tEl.textContent = `${String(h).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
      dEl.textContent = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
    };
    tick(); setInterval(tick, 5000);
  }

  /* =============== weather =============== */
  function renderWeather(w) {
    if (!w) return;
    document.getElementById("weather-icon").innerHTML = UI.wxIcon(w.code, w.isDay);
    document.getElementById("weather-temp").textContent = Weather.fmtTemp(w.tempC) + " " + UI.wxLabel(w.code);
    const loc = document.getElementById("weather-loc");
    if (loc) loc.textContent = w.location || "";
  }
  function openForecast() {
    const w = Weather.current; if (!w) return;
    const host = document.getElementById("forecast-popup");
    host.innerHTML = "";
    const grid = document.createElement("div"); grid.id = "forecast-grid";
    const days = (w.days || []).slice(0, 6);
    days.forEach((d, i) => {
      const c = document.createElement("div"); c.className = "fc-day focusable";
      const date = d.date === i ? new Date() : new Date(d.date);
      const name = i === 0 ? "Today" : ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][date.getDay()];
      c.innerHTML = `<div class="fc-name">${name}</div>
        <div class="fc-date">${MONTHS[date.getMonth()]} ${date.getDate()}</div>
        ${UI.wxIcon(d.code, true)}
        <div class="fc-hl">${Weather.fmtTemp(d.hi)} <span class="lo">${Weather.fmtTemp(d.lo)}</span></div>`;
      c.addEventListener("click", closeForecast);
      grid.append(c);
    });
    host.append(grid);
    host.classList.remove("hidden");
    const layer = {
      id: "forecast", grid: [ [...grid.children] ],
      onActivate: closeForecast, onBack: closeForecast,
      onHome() { closeForecast(); goHome(); },
      onExit() { host.classList.add("hidden"); },
    };
    Nav.push(layer);
    Nav.setFocus(grid.children[0]);
  }
  function closeForecast() {
    document.getElementById("forecast-popup").classList.add("hidden");
    if (Nav.top() && Nav.top().id === "forecast") Nav.pop();
    Nav.setFocus(document.getElementById("weather-zone"));
  }

  /* =============== pages =============== */
  function buildPages() {
    const tabs = document.getElementById("page-tabs");
    tabs.innerHTML = "";
    Store.state.pages.forEach((name, i) => {
      if (i > 0 && !name) return;
      const t = document.createElement("div");
      t.className = "page-tab focusable" + (i === currentPage ? " active" : "");
      t.textContent = name || "PAGE";
      t.addEventListener("click", () => showPage(i));
      tabs.append(t);
    });
    const used = Store.state.pages.filter((n, i) => i > 0 && n).length;
    if (used < 3) {
      const add = document.createElement("div");
      add.className = "page-tab add-page focusable"; add.textContent = "+";
      add.title = "Add page";
      add.addEventListener("click", () => {
        const slot = Store.state.pages.findIndex((n, i) => i > 0 && !n);
        OSK.open({ title: "Name new page",
          onSubmit(name) {
            Store.state.pages[slot] = name; Store.save(); buildPages(); showPage(slot);
          }, onCancel: () => Nav.setFocus(add) });
      });
      tabs.append(add);
    }
  }
  function showPage(i) {
    currentPage = i; buildPages(); renderGrid();
    const home = stack();
    function stack() { return Nav.top() && Nav.top().id === "home"; }
    if (!home) pushHomeLayer();
  }
  function flipPage(dir) {
    if (Nav.depth() > 1 && Nav.top().id !== "home") return; // only flip at home level
    const names = Store.state.pages;
    let next = currentPage;
    for (let step = dir; ; step += dir) {
      const cand = currentPage + step;
      if (cand < 0) break;
      if (cand >= names.length) break;
      if (cand === 0 || names[cand]) { next = cand; break; }
    }
    if (next !== currentPage) { showPage(next); toast(names[next] || "HOME"); }
  }

  /* =============== tile grid =============== */
  function renderGrid() {
    const wrap = document.getElementById("tile-grid");
    wrap.innerHTML = "";
    const tiles = Store.tiles(currentPage);
    const cells = tiles.map(t => tileEl(t, tiles.indexOf(t)));
    cells.push(addTileEl());
    for (let i = 0; i < cells.length; i += 7) {
      const row = document.createElement("div"); row.className = "grid-row";
      cells.slice(i, i + 7).forEach(c => row.append(c));
      wrap.append(row);
    }
    // NOTE: never move focus here — renderGrid runs mid-flow (add/delete/
    // reorder) and stealing focus caused phantom highlights on layer pop.
    if (!document.querySelector(".focused")) {
      const first = wrap.querySelector(".tile") || wrap.querySelector(".add-tile");
      if (first && Nav.top() && Nav.top().id === "home") Nav.setFocus(first);
    }
  }
  function tileEl(t, idx) {
    const e = document.createElement("div");
    e.className = "tile focusable" + (t.type === "game" && t.icon ? " tile-banner" : "");
    e.dataset.idx = idx;
    const iconHtml = t.type === "command" ? UI.ICONS.cmd : initialsIcon(t);
    e.innerHTML = `<div class="t-icon">${iconHtml}</div><div class="t-name">${UI.escapeHtml(t.name)}</div>`;
    if (t.type === "game" && t.icon)
      e.style.backgroundImage = `linear-gradient(180deg, rgba(8,10,16,.25), rgba(8,10,16,.82)), url("${t.icon}")`;
    e.addEventListener("click", () => launch(t));
    return e;
  }
  function initialsIcon(t) {
    if (t.icon) return `<img src="${t.icon}" onerror="this.replaceWith(fallbackIcon(this))">`;
    const palette = [["#b91c1c","#fecaca"],["#1d4ed8","#dbeafe"],["#047857","#a7f3d0"],
      ["#7c3aed","#ddd6fe"],["#b45309","#fde68a"],["#0e7490","#a5f3fc"],["#be185d","#fbcfe8"]];
    let h = 0; for (const c of t.name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const [bg, fg] = palette[h % palette.length];
    const init = escapeAttr(t.name.trim().charAt(0).toUpperCase() || "?");
    return `<span style="width:100%;height:100%;display:grid;place-items:center;background:${bg};color:${fg};border-radius:calc(10*var(--u));font-weight:700;font-size:calc(26*var(--u))">${init}</span>`;
  }
  function escapeAttr(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  window.fallbackIcon = (img) => { const s = document.createElement("span");
    s.innerHTML = UI.ICONS.web; return s.firstChild; };
  function addTileEl() {
    const e = document.createElement("div");
    e.className = "tile add-tile focusable";
    e.innerHTML = '<div class="plus">+</div>';
    e.title = "Add item";
    e.addEventListener("click", openAddMenu);
    return e;
  }

  /* =============== add flows =============== */
  function openAddMenu() {
    UI.menu([
      { label: "Add app", hint: "from Start menu", onPick: addAppFlow },
      { label: "Add command", hint: "run dialog", onPick: addCommandFlow },
      { label: "Add webapp", hint: "Edge kiosk", onPick: addWebappFlow },
    ]);
  }
  const BUILTINS = [
    { name: "Netflix TV", path: "builtin:netflix", builtin: true, icon: "assets/icons/netflix.png" },
    { name: "YouTube TV", path: "builtin:youtube", builtin: true, icon: "assets/icons/youtube.jpg" },
  ];
  async function addAppFlow() {
    const apps = await Bridge.listStartMenu();
    // built-ins participate in the picker (dedupe: real apps win over builtin)
    for (const bi of BUILTINS) {
      if (!apps.some(a => a.name.toLowerCase() === bi.name.toLowerCase() && !a.builtin)) apps.push(bi);
    }
    apps.sort((a, b) => a.name.localeCompare(b.name));
    UI.picker("Choose an app", apps,
      async (app) => {
        const tile = { type: "app", name: app.name, path: app.path, aumid: app.aumid || null,
          icon: app.builtin ? app.icon : null };
        Store.addTile(tile); renderGrid(); toast(`Added ${app.name}`);
        if (app.builtin) return;
        const ic = (app.aumid || app.lnk) && Bridge.appIconFor
          ? await Bridge.appIconFor(app.lnk || "", app.aumid || null) : { iconPath: null };
        if (ic.iconPath) {
          const page = App.currentPage ?? 0;
          const idx = Store.tiles(page).findIndex(t => t.type === 'app' && t.name === app.name);
          if (idx >= 0) { Store.updateTile(page, idx, { icon: ic.iconPath }); renderGrid(); }
        }
      },
      (a) => `<div class="r-icon">${UI.ICONS.app}</div><div class="r-label">${UI.escapeHtml(a.name)}</div>`);
  }
  function addCommandFlow() {
    UI.dialog("Add command", (f) => {
      f.text("Name"); f.text("Command (as typed in Run)", "e.g. notepad.exe");
    }, ([name, cmd]) => {
      Store.addTile({ type: "command", name, cmd }); renderGrid(); toast(`Added ${name}`);
    });
  }
  function addWebappFlow() {
    UI.dialog("Add webapp", (f) => {
      f.text("Name"); f.text("URL", "https://…", "https://youtube.com/tv");
    }, async ([name, url]) => {
      if (!/^https?:\/\//i.test(url)) url = "https://" + url;
      const t = { type: "webapp", name, url, icon: null };
      Store.addTile(t); renderGrid(); toast(`Added ${name}`);
      const fav = await Bridge.faviconFor(url);
      if (fav.iconUrl) {
        const idx = Store.tiles(currentPage).indexOf(t);
        if (idx >= 0) { Store.updateTile(currentPage, idx, { icon: fav.iconUrl }); renderGrid(); }
      }
    });
  }

  /* =============== tile menu =============== */
  function tileMenu(tile, page, idx) {
    if (!tile) return;
    const items = [
      { label: "Open", onPick: () => launch(tile) },
      { label: "Rename", onPick: () => OSK.open({ title: "New name", initial: tile.name,
          onSubmit(n) { Store.updateTile(page, idx, { name: n }); renderGrid(); },
          onCancel: () => Nav.setFocus(Nav.current) }) },
      { label: "Reorder", hint: "◀ ▶ move", onPick: () => reorderMode(page, idx) },
    ];
    if (tile.type !== "app" && tile.type !== "game") items.push({ label: "Edit", hint: tile.type, onPick: () => editTile(tile, page, idx) });
    items.push({ label: "Delete", danger: true, onPick: () => {
      Store.removeTile(page, idx); renderGrid(); toast("Removed"); } });
    UI.menu(items);
  }
  function editTile(tile, page, idx) {
    if (tile.type === "command") UI.dialog("Edit command", (f) => {
      f.text("Name", tile.name); f.text("Command", tile.cmd);
    }, ([name, cmd]) => { Store.updateTile(page, idx, { name, cmd }); renderGrid(); });
    else UI.dialog("Edit webapp", (f) => {
      f.text("Name", tile.name); f.text("URL", tile.url);
    }, ([name, url]) => {
      if (!/^https?:\/\//i.test(url)) url = "https://" + url;
      Store.updateTile(page, idx, { name, url }); renderGrid();
    });
  }
  function reorderMode(page, idx) {
    toast("◀ ▶ to move, OK to drop, Back to cancel");
    let cur = idx;
    const t = Store.tiles(page);
    const layer = {
      id: "reorder",
      get grid() { return [[document.querySelector(`.tile[data-idx="${cur}"]`) || Nav.current]]; },
      onActivate() { Store.save(); Nav.pop(); renderGrid(); },
      onBack() { renderGrid(); Nav.pop(); },
      onHome() { Nav.pop(); goHome(); },
    };
    document.addEventListener("keydown", keyHandler, true);
    function keyHandler(e) {
      const m = navKeys(e); if (!m) return;
      e.preventDefault();
      if (m.left && cur > 0) { Store.moveTile(page, cur, cur - 1); cur--; renderLive(); }
      else if (m.right && cur < t.length - 1) { Store.moveTile(page, cur, cur + 1); cur++; renderLive(); }
      else if (m.ok || m.back || m.home) {} // handled by nav layer
    }
    function navKeys(e) {
      const km = Store.state.keymap;
      const test = (combo, key) => {
        const parts = combo.toLowerCase().split("+");
        const k = parts[parts.length - 1];
        const alias = { arrowleft:"left", arrowright:"right" };
        return (e.key.toLowerCase() === k || alias[e.key.toLowerCase()] === k) && !e.altKey === !parts.includes("alt");
      };
      return { left: (km.left||[]).some(c=>test(c)), right: (km.right||[]).some(c=>test(c)),
        ok: e.key === "Enter", back: e.key === "Delete" || e.key === "Backspace", home: e.key === "Home" };
    }
    function renderLive() { renderGrid(); const el = document.querySelector(`.tile[data-idx="${cur}"]`); if (el) Nav.setFocus(el); }
    Nav.push(layer);
  }

  /* =============== launch =============== */
  async function launch(tile) {
    let r;
    if (tile.path === "builtin:youtube" || tile.path === "builtin:netflix") {
      const fn = tile.path === "builtin:youtube" ? Bridge.openYouTube : Bridge.openNetflix;
      if (fn) r = await fn();
      else { toast("Opens fullscreen on the Windows build (web preview can't host it)"); return; }
    }
    else if (tile.type === "app") r = await Bridge.launchApp(tile);
    else if (tile.type === "game") r = await Bridge.runCommand(tile.launch);
    else if (tile.type === "command") r = await Bridge.runCommand(tile.cmd);
    else r = await Bridge.openWebApp(tile.url);
    if (r && !r.ok) toast("Failed: " + (r.error || "unknown"));
    else toast(tile.type === "webapp" ? "Opening kiosk browser…" : "Launching " + tile.name + "…");
    // Native: the app/webapp opens fullscreen; Alt+F4/close returns focus to shell (phase 5).
  }

  /* =============== network panel =============== */
  function netPanel() {
    UI.slideOver("Network", async (body) => {
      const status = await Bridge.networkStatus();
      const head = document.createElement("div"); head.className = "row current";
      head.innerHTML = `<div class="r-icon">${status.type === "lan" ? UI.ICONS.lan : UI.ICONS.wifi}</div>
        <div class="r-label"><div>${UI.escapeHtml(status.ssid || status.type || "Disconnected")}</div>
        <div class="sub">${status.type === "wifi" ? "Wi-Fi" : "Ethernet"} · ${status.ip || ""}</div></div>
        <div class="r-icon" style="width:calc(28*var(--u))">${UI.bars(status.signal || 0)}</div>`;
      body.append(head);
      const loading = document.createElement("div"); loading.className = "spinner"; body.append(loading);
      const nets = await Bridge.networkScan();
      loading.remove();
      nets.forEach(n => {
        const row = document.createElement("div"); row.className = "row focusable";
        row.innerHTML = `<div class="r-icon" style="width:calc(28*var(--u))">${UI.bars(n.signal)}</div>
          <div class="r-label">${UI.escapeHtml(n.ssid)}</div>
          ${n.secured ? `<div class="r-icon" style="width:calc(24*var(--u));color:var(--text-dim)">${UI.ICONS.lock}</div>` : ""}`;
        row.addEventListener("click", async () => {
          try {
          if (n.ssid === status.ssid) return;
          let pass = "";
          if (n.secured) {
            row.querySelector(".r-label").innerHTML += ' <span class="badge">connecting…</span>';
            pass = await new Promise(res => OSK.open({ title: `Password for ${n.ssid}`,
              onSubmit: res, onCancel: () => res(null) }));
            console.log("[wifi] after osk await, pass=", JSON.stringify(pass));
            if (pass === null) return;
          }
          const r = await Bridge.networkConnect(n.ssid, pass);
          console.log("[wifi] connect result", JSON.stringify(r));
          if (r.ok) { toast(`Connected to ${n.ssid}`); netPanel(); refreshNetIcon(); }
          else toast("Couldn't connect: " + r.error);
          } catch (e) { console.error("[wifi] handler error", e); }
        });
        body.append(row);
      });
    });
  }

  /* =============== bluetooth panel =============== */
  function btPanel() {
    UI.slideOver("Bluetooth", async (body) => {
      const s = await Bridge.btStatus();
      const togRow = document.createElement("div"); togRow.className = "row focusable";
      togRow.innerHTML = `<div class="r-label">Bluetooth</div>`;
      const tog = document.createElement("div"); tog.className = "toggle focusable" + (s.adapterOn ? " on" : "");
      tog.addEventListener("click", async () => {
        const on = !tog.classList.contains("on");
        tog.classList.toggle("on", on); await Bridge.btToggle(on);
      });
      togRow.append(tog); body.append(togRow);
      const sec = (t) => { const h = document.createElement("h2"); h.textContent = t; h.style.cssText = "margin-top:calc(18*var(--u))"; body.append(h); };
      sec("Connected");
      if (!s.connected.length) { const d = document.createElement("div"); d.className = "dim"; d.textContent = "Nothing connected"; body.append(d); }
      s.connected.forEach(d => {
        const row = document.createElement("div"); row.className = "row focusable";
        row.innerHTML = `<div class="r-icon">${UI.ICONS[d.kind] || UI.ICONS.hid}</div>
          <div class="r-label">${UI.escapeHtml(d.name)}</div><div class="badge">connected</div>`;
        row.addEventListener("click", async () => { await Bridge.btDisconnect(d.name); btPanel(); });
        body.append(row);
      });
      sec("Other devices");
      const known = await Bridge.btKnown();
      if (!known.length) { const d = document.createElement("div"); d.className = "dim"; d.textContent = "None found. On Windows, pair via Settings first."; body.append(d); }
      known.forEach(d => {
        const row = document.createElement("div"); row.className = "row focusable";
        row.innerHTML = `<div class="r-icon">${UI.ICONS[d.kind] || UI.ICONS.hid}</div>
          <div class="r-label">${UI.escapeHtml(d.name)}</div><div class="sub">select to connect</div>`;
        row.addEventListener("click", async () => {
          toast("Connecting…");
          const r = await Bridge.btConnect(d.name);
          if (r.ok) btPanel(); else toast("Couldn't connect: " + r.error);
        });
        body.append(row);
      });
    });
  }

  /* =============== settings =============== */
  function settingsPanel() {
    UI.slideOver("Settings", (body) => {
      const s = Store.state;
      const setRow = (label, rightEl, sub) => {
        const row = document.createElement("div"); row.className = "row focusable";
        const lab = document.createElement("div"); lab.className = "r-label";
        lab.innerHTML = `<div>${label}</div>` + (sub ? `<div class="sub">${sub}</div>` : "");
        row.append(lab, rightEl); body.append(row); return row;
      };
      const toggle = (v, fn) => { const t = document.createElement("div");
        t.className = "toggle focusable" + (v ? " on" : "");
        t.addEventListener("click", () => { const on = !t.classList.contains("on");
          t.classList.toggle("on", on); fn(on); }); return t; };
      const seg = (opts, v, fn) => { const w = document.createElement("div");
        w.style.cssText = "display:flex;gap:calc(8*var(--u))";
        opts.forEach(o => { const b = document.createElement("div");
          b.className = "btn focusable" + (o === v ? " primary" : ""); b.textContent = o;
          b.addEventListener("click", () => { [...w.children].forEach(c => c.classList.remove("primary"));
            b.classList.add("primary"); fn(o); }); w.append(b); }); return w; };

      setRow("Auto-start", toggle(s.autostart, (on) => { s.autostart = on; Store.save(); Bridge.setAutostart(on); }));
      setRow("Temperature", seg(["F", "C"], s.tempUnit, (v) => { s.tempUnit = v; Store.save(); renderWeather(Weather.current); }));
      setRow("Time format", seg(["12H", "24H"], s.timeFormat, (v) => { s.timeFormat = v; Store.save(); startClock(); }));
      setRow("Keyboard mapping", (() => { const b = document.createElement("div");
        b.className = "btn focusable"; b.textContent = "Configure";
        b.addEventListener("click", keymapPanel); return b; })());
      const wp = s.wallpaper;
      setRow("Wallpaper", (() => { const b = document.createElement("div");
        b.className = "btn focusable"; b.textContent = wp.mode === "none" ? "Choose" : wp.mode;
        b.addEventListener("click", wallpaperPanel); return b; })(),
        wp.mode === "dir" ? `random rotation · every ${wp.intervalMin}m` : wp.mode === "image" ? wp.path : "");
      setRow("Pages", (() => { const w = document.createElement("div"); w.className = "dim";
        w.textContent = s.pages.filter(Boolean).join(" · "); return w; })());
      const verRow = setRow("Check for updates", (() => { const b = document.createElement("div");
        b.className = "btn focusable"; b.textContent = "Check";
        b.addEventListener("click", () => checkForUpdatesUI(b)); return b; })(),
        "installed version …");
      if (Bridge.appVersion) Bridge.appVersion().then(v => {
        const sub = verRow.querySelector(".sub"); if (sub && v) sub.textContent = "installed version " + v;
      });
      setRow("Games", (() => { const b = document.createElement("div");
        b.className = "btn focusable"; b.textContent = "Rescan";
        b.addEventListener("click", () => { Store.state.gamesSetup = null; Store.save(); autoSetupGames(true); });
        return b; })(),
        "auto-detect Steam/Epic/GOG games into a GAMES page");
      setRow("Reset HTLauncher", (() => { const b = document.createElement("div");
        b.className = "btn danger focusable"; b.textContent = "Clear all data";
        b.addEventListener("click", () => UI.menu([{ label: "Confirm — wipe settings & tiles", danger: true,
          onPick() { localStorage.clear(); location.reload(); } }])); return b; })());
    });
  }

  function keymapPanel() {
    const NAMES = { left:"Left", right:"Right", up:"Up", down:"Down", ok:"OK / Select",
      back:"Back", home:"Home", menu:"Menu", pageUp:"Page Up (prev page)",
      pageDown:"Page Down (next page)", sleep:"Sleep PC" };
    UI.slideOver("Keyboard mapping", (body) => {
      Object.entries(NAMES).forEach(([action, label]) => {
        const row = document.createElement("div"); row.className = "row focusable";
        row.innerHTML = `<div class="r-label">${label}<div class="sub">${Store.state.keymap[action].join(", ")}</div></div>
          <div class="sub">press key to remap</div>`;
        const startCapture = () => {
          row.querySelector(".sub:last-child").textContent = "listening…";
          const h = (e) => {
            e.preventDefault(); e.stopPropagation();
            const parts = [];
            if (e.ctrlKey) parts.push("ctrl"); if (e.altKey) parts.push("alt"); if (e.shiftKey) parts.push("shift");
            parts.push(e.key.toLowerCase());
            const combo = parts.join("+");
            Store.state.keymap[action] = [combo]; Store.save();
            document.removeEventListener("keydown", h, true);
            keymapPanel();
          };
          document.addEventListener("keydown", h, true);
        };
        row.addEventListener("click", startCapture);
        body.append(row);
      });
    });
  }

  function wallpaperPanel() {
    const wp = Store.state.wallpaper;
    UI.slideOver("Wallpaper", (body) => {
      const opt = (label, sub, fn) => { const r = document.createElement("div");
        r.className = "row focusable"; r.innerHTML = `<div class="r-label">${label}<div class="sub">${sub}</div></div>`;
        r.addEventListener("click", fn); body.append(r); };
      opt("Single image", wp.mode === "image" ? wp.path : "pick an image file", async () => {
        const p = await Bridge.pickWallpaper();
        if (p.path) { wp.mode = "image"; wp.path = p.path; Store.save(); UI.slideOver("Wallpaper", () => {}); }
        else if (Bridge.backend === "mock") { wp.mode = "image"; wp.path = "mock:" + Bridge.mockWallpapers[0]; Store.save(); setupWallpaper(); toast("Mock: single image set"); }
      });
      opt("Folder rotation", wp.mode === "dir" ? `${wp.dir} · random every ${wp.intervalMin}m` : "random images on an interval", () => {
        UI.dialog("Folder rotation", (f) => {
          f.text("Directory"); f.text("Interval (minutes)", String(wp.intervalMin || 15));
        }, ([dir, mins]) => {
          wp.mode = "dir"; wp.dir = dir; wp.intervalMin = Math.max(1, +mins || 15);
          Store.save(); setupWallpaper(); toast("Rotation set (mock in web preview)");
        });
      });
      opt("None", "solid dark background", () => { wp.mode = "none"; Store.save(); setupWallpaper(); });
    });
  }

  /* =============== wallpaper rotation =============== */
  async function setupWallpaper() {
    clearTimeout(wallpaperTimer);
    const el = document.getElementById("wallpaper");
    const wp = Store.state.wallpaper;
    const urlFor = (ref) => Bridge.wallpaperUrl(ref) || "linear-gradient(160deg,#0b0e14,#131a2a)";
    if (wp.mode === "image" && wp.path) {
      el.style.backgroundImage = `url("${urlFor(wp.path)}")`;
    } else if (wp.mode === "dir") {
      try {
        wallpaperPool = (Bridge.backend === "native" && Bridge.listWallpaperDir)
          ? await Bridge.listWallpaperDir(wp.dir)
          : Bridge.mockWallpapers.map(m => "mock:" + m);
      } catch (e) { wallpaperPool = []; }
      if (!wallpaperPool.length) { el.style.backgroundImage = "none"; return; }
      const rotate = () => {
        wallpaperIdx = Math.floor(Math.random() * wallpaperPool.length);
        el.style.backgroundImage = `url("${urlFor(wallpaperPool[wallpaperIdx])}")`;
      };
      rotate();
      const ms = Math.max(1, wp.intervalMin) * 60 * 1000;
      wallpaperTimer = setTimeout(function loop() { rotate(); wallpaperTimer = setTimeout(loop, ms); }, ms);
    } else {
      el.style.backgroundImage = "linear-gradient(160deg,#0b0e14,#131a2a 60%,#0d1522)";
    }
  }

  /* =============== updates =============== */
  async function checkForUpdatesUI(btn) {
    if (btn.dataset.busy) return;
    btn.dataset.busy = "1";
    const orig = btn.textContent;
    btn.textContent = "Checking…";
    try {
      const r = await Bridge.checkForUpdates();
      if (r.available) {
        toast("Update " + r.version + " found — installing, app will restart…");
        btn.textContent = "Installing…";
        const inst = await Bridge.installUpdate();
        if (!inst.ok) { toast("Install failed: " + (inst.error || "unknown")); btn.textContent = orig; delete btn.dataset.busy; }
        // success => electron quits & runs installer
      } else {
        toast("You're up to date (" + (r.version || "?") + ")");
        btn.textContent = orig; delete btn.dataset.busy;
      }
    } catch (e) {
      toast("Update check failed: " + (e.message || e));
      btn.textContent = orig; delete btn.dataset.busy;
    }
  }

  /* =============== power =============== */
  function powerMenu() {
    UI.menu([
      { label: "Sleep", hint: "PC to sleep", onPick: () => Bridge.power("sleep") },
      { label: "Shutdown", hint: "PC off", onPick: () => confirmThen("Shut down the PC?", () => Bridge.power("shutdown")) },
      { label: "Exit program", onPick: () => confirmThen("Exit TVShell?", () => Bridge.power("exit")) },
    ]);
  }
  function confirmThen(msg, fn) {
    UI.menu([{ label: msg, danger: true, onPick: fn },
             { label: "Cancel" }]);
  }
  function onSleepCombo() {
    document.getElementById("sleep-overlay").classList.remove("hidden");
    Bridge.power("sleep");
    const wake = () => { document.getElementById("sleep-overlay").classList.add("hidden");
      document.removeEventListener("keydown", wake, true); };
    document.addEventListener("keydown", wake, true);
  }

  /* =============== toast =============== */
  let toastTimer = null;
  function toast(msg) {
    console.log("[toast]", msg);
    const t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  function refreshGrid() { renderGrid(); }

  document.addEventListener("DOMContentLoaded", boot);
  return { boot, goHome, flipPage, toast, onSleepCombo, get currentPage() { return currentPage; },
    refreshGrid };
})();
