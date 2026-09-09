/* Built-in YouTube TV view. Integrates the HTPC-YT approach
 * (github.com/Liams-Electronics-Lab/HTPC-YT, GPL-3.0): frameless fullscreen
 * Electron window loading https://www.youtube.com/tv with the PS4 Leanback
 * user agent, input debounce, and Back->Escape remapping. Adapted for the
 * launcher: Back at the YouTube root (or Alt+F4) closes the view and returns
 * to HTLauncher — never the desktop. */
const { BrowserWindow, ipcMain } = require("electron");
const path = require("path");

const YT_UA = "Mozilla/5.0 (PS4; Leanback Shell) Cobalt/22.2.3-gold Firefox/65.0 LeanbackShell/01.00.01.75 Sony PS4/ (PS4, , no, CH)";
const DEBOUNCE_MS = 150;

let ytWin = null;
let allowNavOnce = false;

function openYouTube(getShellWin) {
  if (ytWin && !ytWin.isDestroyed()) { ytWin.show(); ytWin.focus(); return { ok: true }; }
  ytWin = new BrowserWindow({
    frame: false, fullscreen: true, show: false, backgroundColor: "#000",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      preload: path.join(__dirname, "yt-preload.js"),
    },
  });
  ytWin.setMenuBarVisibility(false);
  let lastKey = 0;

  ytWin.webContents.userAgent = YT_UA;
  ytWin.loadURL("https://www.youtube.com/tv");
  ytWin.once("ready-to-show", () => ytWin.show());

  ytWin.webContents.on("did-finish-load", () => {
    ytWin.webContents.insertCSS("body { cursor: none !important; }").catch(() => {});
  });

  // remote semantics ported from HTPC-YT: Back = Escape inside YT; debounce dupes
  ytWin.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const now = Date.now();
    if (now - lastKey < DEBOUNCE_MS) { event.preventDefault(); return; }
    lastKey = now;
    if (input.key === "BrowserBack" || input.key === "Backspace" ||
        input.key === "Delete" || input.key === "Escape") {
      const url = ytWin.webContents.getURL();
      const atRoot = /^https:\/\/www\.youtube\.com\/tv\/?(\?|#\/?)?$/.test(url);
      event.preventDefault();
      if (atRoot) { closeYouTube(getShellWin); return; }
      ytWin.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      ytWin.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    }
  });
  ytWin.on("app-command", (e, cmd) => {
    if (cmd === "browser-backward") {
      e.preventDefault();
      ytWin.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      ytWin.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    }
  });
  // Home key from the remote: jump straight back to the launcher
  ytWin.webContents.on("before-input-event", (ev, input) => {
    if (input.type === "keyDown" && input.key === "Home") { ev.preventDefault(); closeYouTube(getShellWin); }
  });

  ytWin.on("closed", () => { ytWin = null; const w = getShellWin(); if (w) { w.show(); w.focus(); } });
  return { ok: true };
}

function closeYouTube(getShellWin) {
  allowNavOnce = true;
  if (ytWin && !ytWin.isDestroyed()) ytWin.close();
  const w = getShellWin(); if (w) { w.show(); w.focus(); }
  return { ok: true };
}

module.exports = { openYouTube };
