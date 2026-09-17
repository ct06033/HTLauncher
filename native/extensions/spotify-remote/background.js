chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.close && sender.tab && sender.tab.id != null) {
    chrome.tabs.remove(sender.tab.id);   // closing the app window's only tab exits
  }
  if (msg && msg.np) {
    // Relay the now-playing payload to the HTLauncher loopback bridge.
    // content-type text/plain deliberately avoids a CORS preflight.
    // MV3 service workers sleep between events; the content script's
    // sendMessage wakes us, so a 2s cadence keeps this worker warm enough.
    fetch("http://127.0.0.1:47633/nowplaying", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(msg.np),
    }).catch(() => {});   // launcher not running / port busy — ignore
  }
});
