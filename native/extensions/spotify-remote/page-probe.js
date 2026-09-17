/* MAIN-world probe for the Spotify now-playing widget.
 *
 * Why this file exists: MV3 content scripts run in the ISOLATED world,
 * where page globals like navigator.mediaSession are the world's own
 * (empty) defaults — MediaSession metadata (what powers Windows SMTC)
 * lives only in the page's MAIN world. manifest.json declares this file
 * as a second content_scripts entry with "world": "MAIN" (Chromium 111+,
 * Edge current). MAIN-world scripts have NO chrome.* access, so we hand
 * the data to content.js (isolated world) via window.postMessage —
 * message events cross worlds within the same document.
 *
 * Title/artist/album/art come from mediaSession metadata — far more
 * stable than Spotify's DOM selectors (which churn weekly). Playback
 * state has no mediaSession getter (playerState is not a real property),
 * so we use the play/pause button presence heuristic, and document.title
 * ("Song — Artist") only as a metadata==null fallback. */
(function () {
  const POLL_MS = 2000;

  function bestArtwork(m) {
    const aw = (m && m.artwork) || [];
    let best = null, bestSize = -1;
    for (const a of aw) {
      if (!a || typeof a.src !== "string" || !/^https:\/\//.test(a.src)) continue;
      // sizes like "300x300"; treat missing sizes as smallest
      const m2 = /(\d+)x(\d+)/.exec(a.sizes || "");
      const size = m2 ? parseInt(m2[1], 10) * parseInt(m2[2], 10) : 0;
      if (size > bestSize) { bestSize = size; best = a.src; }
    }
    return best;
  }

  function playingState() {
    // Spotify renders a "pause" button while playing, a "play" button while
    // paused. data-testid churns, but absence simply reads as "not playing",
    // which safely hides the widget rather than lying.
    if (document.querySelector('button[data-testid="pause"]')) return true;
    if (document.querySelector('button[data-testid="play"]')) return false;
    return false;
  }

  function progressPct() {
    // Spotify's playback progressbar exposes aria-valuenow 0-100. OPTIONAL:
    // if the attribute or element is gone, the renderer hides the bar.
    const el = document.querySelector('[data-testid="playback-progressbar"]');
    const v = el && el.getAttribute("aria-valuenow");
    const n = v == null ? NaN : parseFloat(v);
    return isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
  }

  function tick() {
    let title = null, artist = null, album = null, art = null;
    try {
      const m = navigator.mediaSession && navigator.mediaSession.metadata;
      if (m) { title = m.title || null; artist = m.artist || null;
               album = m.album || null; art = bestArtwork(m); }
    } catch (e) {}
    if (!title) {
      // Fallback: Spotify sets document.title to "Song — Artist — Album"
      // (em-dash). Do not hard-fail if the format differs: use whole title.
      const t = document.title || "";
      const parts = t.split(" \u2014 ");
      if (parts.length >= 2) { title = parts[0].trim(); artist = parts[1].trim(); }
      else if (t && !/^Spotify/i.test(t)) { title = t.trim(); }
    }
    let pct = null;
    try { pct = progressPct(); } catch (e) {}
    const playing = !!title && playingState();
    window.postMessage({
      htlNP: true, source: "spotify",
      playing, title: title || "", artist: artist || "",
      album: album || "", artworkUrl: art, pct,
    }, location.origin);
  }

  setInterval(tick, POLL_MS);
  setTimeout(tick, 1500); // first read shortly after load, before the interval
})();
