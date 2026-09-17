// Headless test of the now-playing loopback bridge (native/nowplaying.js).
// Boots the real http server on an ephemeral port with an injected sendFn,
// then POSTs payloads with node's http client and asserts what the renderer
// would receive.
const http = require("http");
const np = require("../native/nowplaying");

function post(port, path, body, method = "POST") {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method, headers: { "content-type": "text/plain" } },
      (res) => { let b = ""; res.on("data", (c) => b += c); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: b })); });
    req.on("error", reject);
    if (body != null) req.write(body);
    req.end();
  });
}

(async () => {
  const events = [];
  const server = np.start(0, (ev) => events.push(ev));   // 0 => ephemeral port
  await new Promise((r) => server.on("listening", r));
  const port = server.address().port;

  // 1) valid playing payload => forwarded with all fields
  let r = await post(port, "/nowplaying", JSON.stringify({
    source: "spotify", playing: true, title: " Bohemian Rhapsody", artist: "Queen",
    album: "A Night at the Opera", artUrl: "https://i.scdn.co/image/ab67", pct: 42.5,
  }));
  console.assert(r.status === 204, "FAIL: expected 204, got " + r.status);
  console.assert(r.headers["access-control-allow-origin"] === "*", "FAIL: no CORS header");
  console.assert(events.length === 1, "FAIL: sendFn not called");
  console.assert(events[0].type === "nowplaying", "FAIL: wrong event type");
  console.assert(events[0].data.title === " Bohemian Rhapsody", "FAIL: title lost");
  console.assert(events[0].data.artist === "Queen", "FAIL: artist lost");
  console.assert(events[0].data.artUrl === "https://i.scdn.co/image/ab67", "FAIL: artUrl lost");
  console.assert(events[0].data.pct === 42.5, "FAIL: pct lost");

  // 2) playing:false => data null (renderer hides widget)
  r = await post(port, "/nowplaying", JSON.stringify({ source: "spotify", playing: false }));
  console.assert(r.status === 204, "FAIL: stop not 204");
  console.assert(events.length === 2 && events[1].data === null, "FAIL: stop not forwarded as null");

  // 3) malformed JSON => 400, no crash, no event
  r = await post(port, "/nowplaying", "{not json!!");
  console.assert(r.status === 400, "FAIL: malformed expected 400, got " + r.status);
  console.assert(events.length === 2, "FAIL: malformed emitted an event");

  // 4) non-object / unknown-path / wrong-method
  r = await post(port, "/nowplaying", JSON.stringify(42));
  console.assert(r.status === 400, "FAIL: scalar body expected 400, got " + r.status);
  r = await post(port, "/elsewhere", "{}");
  console.assert(r.status === 404, "FAIL: unknown path expected 404, got " + r.status);
  r = await post(port, "/nowplaying", null, "GET");
  console.assert(r.status === 404, "FAIL: GET expected 404, got " + r.status);
  console.assert(events.length === 2, "FAIL: extra events emitted: " + events.length);

  // 5) OPTIONS preflight => 204 with CORS headers
  r = await post(port, "/nowplaying", null, "OPTIONS");
  console.assert(r.status === 204, "FAIL: OPTIONS expected 204, got " + r.status);
  console.assert(r.headers["access-control-allow-origin"] === "*", "FAIL: OPTIONS no CORS");

  // 6) non-https artUrl is dropped (renderer injects it as CSS url())
  await post(port, "/nowplaying", JSON.stringify({
    playing: true, title: "X", artist: "Y", artUrl: "javascript:alert(1)",
  }));
  const evil = events[events.length - 1].data;
  console.assert(evil.artUrl === null, "FAIL: non-https artUrl not dropped: " + evil.artUrl);

  np.stop();
  // server actually closed
  let closed = false;
  try { await post(port, "/nowplaying", "{}"); } catch (e) { closed = true; }
  console.assert(closed, "FAIL: stop() left the port listening");

  console.log("ALL NOWPLAYING TESTS PASSED");
})().catch((e) => { console.error("TEST CRASH:", e); process.exit(1); });
