/* TVShell Electron main process — window shell + IPC to services. */
const { app, BrowserWindow, ipcMain, screen } = require("electron");
const path = require("path");
const svc = require("./services");

let win = null;

function createWindow() {
  const d = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
    frame: false, fullscreen: true, kiosk: false,   // kiosk off: we manage keys
    autoHideMenuBar: true, backgroundColor: "#0b0e14",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "..", "web", "index.html"));
  win.once("ready-to-show", () => win.show());
  // Never let the shell be hidden behind desktop: relaunch if minimized
  win.on("minimize", () => win.restore());
  win.on("closed", () => { win = null; app.quit(); });
}

// Single instance: reopening focuses the shell instead of stacking
const got = app.requestSingleInstanceLock();
if (!got) app.quit();
app.on("second-instance", () => { if (win) { win.show(); win.focus(); } });

app.whenReady().then(() => {
  createWindow();
  svc.registerIpc(ipcMain, () => win);
});
app.on("window-all-closed", () => app.quit());
