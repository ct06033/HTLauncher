/* Now-playing loopback bridge.
 *
 * The Spotify web player runs in a *separate* Edge app window (see
 * edgeapps.js) — Electron cannot see its playback state. So the bundled
 * MV3 extension POSTs the current track to this tiny HTTP server, which
 * relays it to the launcher renderer over the existing "svc:event"
 * channel (preload onEvent).
 *
 * Deliberately dumb and defensive: loopback-only, no auth (any local
 * process could spoof a track title — acceptable display-only risk),
 * never allowed to break boot (port collisions log and continue).
 *
 * start(port, sendFn) is injectable for headless tests: sendFn receives
 * {type:"nowplaying", data:{...}|null} for each valid payload.
 */
const http = require("http");

const MAX_BODY = 8 * 1024; // tiny JSON; cap to avoid unbounded buffering

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
  };
}

function cleanStr(v, max) {
  return typeof v === "string" ? v.slice(0, max) : null;
}
function cleanNum(v) {
  return typeof v === "number" && isFinite(v) ? v : null;
}

function normalize(p) {
  if (!p || typeof p !== "object") return null;
  // Only https art: the renderer paints it as a CSS background-image, and
  // CSP aside, never let a remote payload inject javascript:/file: URLs.
  const art = cleanStr(p.artUrl, 2000);
  return {
    source: cleanStr(p.source, 32) || "spotify",
    playing: p.playing === true,
    title: cleanStr(p.title, 200) || "",
    artist: cleanStr(p.artist, 200) || "",
    album: cleanStr(p.album, 200) || "",
    artUrl: art && art.startsWith("https://") ? art : null,
    // pos/dur are OPTIONAL (mediaSession doesn't expose them v1); the probe
    // may instead report pct = 0-100 from the playback bar's aria-valuenow.
    pos: cleanNum(p.pos),
    dur: cleanNum(p.dur),
    pct: cleanNum(p.pct),
  };
}

let server = null;

function start(port = 47633, sendFn) {
  const emit = typeof sendFn === "function" ? sendFn : () => {};
  server = http.createServer((req, res) => {
    // Preflight-tolerant OPTIONS (the extension uses text/plain to avoid
    // preflights entirely, but a UA that still asks must not stall).
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }
    const path = (req.url || "").split("?")[0];
    if (req.method !== "POST" || path !== "/nowplaying") {
      res.writeHead(404, corsHeaders());
      res.end();
      return;
    }
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > MAX_BODY) req.destroy();
    });
    req.on("end", () => {
      let parsed;
      try { parsed = JSON.parse(body); }
      catch (e) { res.writeHead(400, corsHeaders()); res.end(); return; }
      const data = normalize(parsed);
      if (!data) { res.writeHead(400, corsHeaders()); res.end(); return; }
      // playing:false => the widget hides (data null per renderer contract)
      emit({ type: "nowplaying", data: data.playing ? data : null });
      res.writeHead(204, corsHeaders());
      res.end();
    });
  });
  // EADDRINUSE etc. must never crash the launcher — log and continue.
  server.on("error", (e) => console.warn("[nowplaying] bridge error:", e.code || e.message));
  server.listen(port, "127.0.0.1");
  return server;
}

function stop() {
  if (server) { try { server.close(); } catch (e) {} server = null; }
}

module.exports = { start, stop };
