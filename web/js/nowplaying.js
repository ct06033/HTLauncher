/* NowPlaying: display-only top-bar widget fed by native/nowplaying.js via
 * Bridge.onEvent({type:"nowplaying", data}). Data shape:
 *   {source, title, artist, album, artUrl, pos, dur, pct} or null (hidden).
 *
 * Hidden entirely when nothing is playing — never focusable, never part of
 * the D-pad grid (no .focusable / tabindex). A watchdog hides the widget if
 * events stop for 12s: covers an Edge crash or force-close where the
 * extension never gets to send playing:false. Cheap diffing avoids
 * re-setting text/background-image every 5s progress refresh (no flicker).
 */
window.NowPlaying = (() => {
  let last = null;
  let lastSeen = 0;
  let subbed = false;

  function render(data) {
    const zone = document.getElementById("np-zone");
    if (!zone) return;
    if (!data || !data.title) {
      zone.classList.add("hidden");
      return;
    }
    last = data;
    const title = document.getElementById("np-title");
    const artist = document.getElementById("np-artist");
    const art = document.getElementById("np-art");
    const bar = document.getElementById("np-bar");
    const fill = document.getElementById("np-bar-fill");
    if (title.textContent !== data.title) title.textContent = data.title;
    const artistText = data.artist || "";
    if (artist.textContent !== artistText) artist.textContent = artistText;
    if (art.__npUrl !== (data.artUrl || "")) {
      art.__npUrl = data.artUrl || "";
      art.style.backgroundImage = data.artUrl ? `url("${data.artUrl}")` : "none";
    }
    // Progress bar is OPTIONAL (v1: pct from the playback bar's aria-valuenow).
    if (typeof data.pct === "number") {
      bar.style.display = "";
      fill.style.width = Math.max(0, Math.min(100, data.pct)) + "%";
    } else {
      bar.style.display = "none";
    }
    zone.classList.remove("hidden");
  }

  function hide() {
    last = null;
    const zone = document.getElementById("np-zone");
    if (zone) zone.classList.add("hidden");
  }

  function init() {
    if (subbed || typeof Bridge === "undefined" || !Bridge.onEvent) return;
    subbed = true;
    Bridge.onEvent((ev) => {
      if (!ev || ev.type !== "nowplaying") return;
      lastSeen = Date.now();
      render(ev.data);
    });
    setInterval(() => {
      if (last && Date.now() - lastSeen > 12000) hide();
    }, 3000);
  }

  return { init, hide, render, get current() { return last; } };
})();
