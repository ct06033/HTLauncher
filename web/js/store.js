/* TVShell persistence + settings store (localStorage; native parity later). */
window.Store = (() => {
  const KEY = "tvsh…e.v1";
  const DEFAULTS = {
    autostart: true,
    tempUnit: "F",           // F | C
    timeFormat: "12H",       // 12H | 24H
    wallpaper: { mode: "none", path: "", dir: "", intervalMin: 15 },
    pages: ["HOME", "", "", ""],
    tiles: {},                // pageIndex -> [tile]
    keymap: {                // PRD defaults
      left: ["ArrowLeft"], right: ["ArrowRight"], up: ["ArrowUp"], down: ["ArrowDown"],
      ok: ["Enter"], back: ["Delete"], home: ["Home"], menu: ["End"],
      pageUp: ["PageUp"], pageDown: ["PageDown"], sleep: ["Alt+s"],
    },
  };
  let state = load();
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return deepMerge(structuredClone(DEFAULTS), JSON.parse(raw));
    } catch (e) { console.warn("store load", e); }
    return structuredClone(DEFAULTS);
  }
  function deepMerge(base, over) {
    for (const k of Object.keys(over)) {
      if (over[k] && typeof over[k] === "object" && !Array.isArray(over[k]) &&
          base[k] && typeof base[k] === "object" && !Array.isArray(base[k]))
        deepMerge(base[k], over[k]);
      else base[k] = over[k];
    }
    return base;
  }
  function save() { localStorage.setItem(KEY, JSON.stringify(state)); }
  const listeners = new Set();
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function emit() { listeners.forEach(f => f(state)); }

  return {
    get state() { return state; },
    save, onChange, emit,
    tiles: (page) => state.tiles[page] || (state.tiles[page] = []),
    addTile(tile) {
      const p = App.currentPage ?? 0;
      Store.tiles(p).unshift(tile);          // new tiles at beginning of list
      save(); emit();
    },
    removeTile(page, idx) { Store.tiles(page).splice(idx, 1); save(); emit(); },
    moveTile(page, from, to) {
      const t = Store.tiles(page); const [it] = t.splice(from, 1); t.splice(to, 0, it); save(); emit();
    },
    updateTile(page, idx, patch) { Object.assign(Store.tiles(page)[idx], patch); save(); emit(); },
  };
})();
