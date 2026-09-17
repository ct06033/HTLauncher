chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.close && sender.tab && sender.tab.id != null) {
    chrome.tabs.remove(sender.tab.id);   // closing the app window's only tab exits
  }
});
