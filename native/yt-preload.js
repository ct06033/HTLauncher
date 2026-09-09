/* preload for the built-in YouTube TV window (isolated from launcher preload) */
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("ytHost", {
  close: () => ipcRenderer.send("yt:close"),
});
