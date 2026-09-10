/* TVShell bridge — one API, two backends.
 * In a browser: MOCK (fake data, console logs) so the whole UI is testable.
 * In Electron: window.tvnative (preload -> IPC -> PowerShell/netsh/edge). Phase 5. */
(() => {
    const isNative = typeof window.tvnative !== "undefined";

  /* ---------------- mock data ---------------- */
  const MOCK = {
    volume: { level: 78, muted: false },
    network: {
      connected: { type: "wifi", ssid: "LivingRoom-5G", signal: 4, ip: "192.168.1.42" },
      scan: [
        { ssid: "LivingRoom-5G", signal: 4, secured: true },
        { ssid: "LivingRoom-2.4G", signal: 3, secured: true },
        { ssid: "xfinitywifi", signal: 2, secured: false },
        { ssid: "NeoCave", signal: 3, secured: true },
        { ssid: "printer_9C2A", signal: 1, secured: true },
      ],
    },
    bluetooth: {
      adapterOn: true,
      connected: [
        { name: "Living Room Speaker", kind: "audio" },
        { name: "Magic Remote", kind: "hid" },
      ],
      known: [{ name: "JBL Flip 6", kind: "audio" }, { name: "XB1 Controller", kind: "hid" }],
    },
    startMenu: [
      "Netflix","Disney+","Prime Video","YouTube","Spotify","VLC media player","Plex",
      "Xbox Console Companion","Steam","Epic Games Launcher","Chrome","Firefox","Discord",
      "PhotoScape X","Canva","TIDAL","Crunchyroll","Max","Paramount+","Peacock","BBC iPlayer",
      "Kodi","MPC-HC","foobar2000","Calibre","LibreOffice Writer","Obsidian","Notepad++",
      "7-Zip File Manager","CPUID HWMonitor","EarTrumpet","PowerToys Settings"
    ].map(n => ({ name: n, path: "startmenu:" + n })),
  };

  const delay = (ms) => new Promise(r => setTimeout(r, ms + Math.random() * 120));

  const Mock = {
    backend: "mock",
    async getVolume() { return { ...MOCK.volume }; },
    async ensureMaxVolume() { MOCK.volume.level = 100; MOCK.volume.muted = false;
      console.log("[mock] volume set 100%, unmuted"); return { ok: true }; },
    async networkStatus() { return { ...MOCK.network.connected }; },
    async networkScan() { await delay(500); return MOCK.network.scan.map(s => ({ ...s })); },
    async networkConnect(ssid) {
      await delay(1200);
      if (/NeoCave|printer/.test(ssid)) return { ok: false, error: "Incorrect password" };
      MOCK.network.connected = { type: "wifi", ssid, signal: 3, ip: "192.168.1.42" };
      return { ok: true };
    },
    async btStatus() { return { adapterOn: MOCK.bluetooth.adapterOn,
      connected: MOCK.bluetooth.connected.map(d => ({ ...d })) }; },
    async btKnown() { await delay(300);
      return MOCK.bluetooth.known.map(d => ({ ...d })); },
    async btToggle(on) { MOCK.bluetooth.adapterOn = on; return { ok: true }; },
    async btConnect(name) { await delay(1400);
      if (name === "XB1 Controller") return { ok: false, error: "Device unavailable" };
      if (!MOCK.bluetooth.connected.some(d => d.name === name)) {
        const k = MOCK.bluetooth.known.find(d => d.name === name);
        MOCK.bluetooth.connected.push({ name, kind: k ? k.kind : "hid" }); }
      return { ok: true }; },
    async btDisconnect(name) { MOCK.bluetooth.connected =
      MOCK.bluetooth.connected.filter(d => d.name !== name); return { ok: true }; },
    async listStartMenu() { await delay(700); return MOCK.startMenu.map(a => ({ ...a })); },
    async launchApp(app) { console.log("[mock] launch app:", app.name); return { ok: true }; },
    async runCommand(cmd) { console.log("[mock] run.exe ->", cmd);
      return cmd.includes("invalid") ? { ok: false, error: "not recognized" } : { ok: true }; },
    async openWebApp(url) { console.log("[mock] msedge --kiosk", url); return { ok: true }; },
    async faviconFor(url) { try { return { iconUrl: new URL(url).origin + "/favicon.ico" }; }
      catch { return { iconUrl: null }; } },
    async power(kind) { console.log("[mock] power:", kind); return { ok: true }; },
    async pickWallpaper() { console.log("[mock] file picker"); return { path: null }; },
    async setAutostart(on) { console.log("[mock] autostart =", on); return { ok: true }; },
    async checkForUpdates() { await delay(800);
      return { available: false, version: "1.0.0" }; },
    async scanGames() { await delay(700);
      return [
        { name: "Baldur's Gate 3", appid: "1086940", src: "steam", launch: "steam://rungameid/1086940" },
        { name: "NieR:Automata", appid: "524220", src: "steam", launch: "steam://rungameid/524220" },
        { name: "Forza Horizon 6", appid: "2483190", src: "steam", launch: "steam://rungameid/2483190" },
        { name: "Divinity: Original Sin 2", appid: "435150", src: "steam", launch: "steam://rungameid/435150" },
        { name: "Rocket League", appid: "RocketLeague", src: "epic", launch: "com.epicgames.launcher://apps/RocketLeague?action=launch&silent=true" },
      ]; },
    async gameIcon(appid) { return { iconUrl: appid && /^\d+$/.test(appid)
      ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg` : null }; },
    wallpaperUrl(ref) { return ref && ref.startsWith("mock:") ? "assets/" + ref.slice(5) : (ref || null); },
    mockWallpapers: ["wallpapers/space.svg", "wallpapers/dunes.svg", "wallpapers/forest.svg"],
  };

  // Native-side additions the mock doesn't need: real wallpaper dirs + app icons
  const nativeExtras = {
    appIconFor: (lnk) => window.tvnative.appIconFor ? window.tvnative.appIconFor(lnk) : { iconPath: null },
    mockWallpapers: [],
  };
  window.Bridge = isNative
    ? Object.assign({}, Mock, window.tvnative, nativeExtras, { backend: "native" })
    : Mock;
  if (isNative) {
    window.Bridge.wallpaperUrl = (ref) => (ref && ref.startsWith("mock:")) ? "assets/" + ref.slice(5)
      : (ref && (ref.startsWith("file") || ref.startsWith("assets/") || ref.startsWith("data:"))) ? ref
      : ref ? "file:///" + String(ref).replace(/^\//, "").replace(/\\/g, "/") : null;
    window.Bridge.listWallpaperDir = async (dir) =>
      window.tvnative.listWallpaperDir ? window.tvnative.listWallpaperDir(dir) : [];
  }
})();
