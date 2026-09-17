/* Weather: Open-Meteo (no API key). Native mode: IP-based geolocation via
 * ipwho.is (gives lat/lon AND a city label) with freeipapi as backup.
 * Browser preview mode: navigator.geolocation.
 * Mock data is DEV-ONLY (URL param ?mockwx or in-memory flag) and is NEVER
 * written to the persisted Store — a transient network failure must not
 * permanently pin the widget to Mockville. On failure we keep showing the
 * last good data (stale > fake) and retry on the next refresh cycle. */
window.Weather = (() => {
  let data = null;
  let mockMode = false;          // in-memory ONLY; resets on every boot
  let lastGood = null;           // last real fetch, survives transient failures
  const listeners = new Set();
  const MOCK_CYCLE = [
    { code: 0, tempC: 27 }, { code: 2, tempC: 22 }, { code: 61, tempC: 14 },
    { code: 71, tempC: -3 }, { code: 3, tempC: 10 }, { code: 95, tempC: 24 },
  ];

  async function locate() {
    // returns {lat, lon, label} or null
    try {
      const r = await fetch("https://ipwho.is/", { signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      if (j && j.success !== false && j.latitude && j.longitude) {
        const label = [j.city, j.region].filter(Boolean).join(", ") || "";
        return { lat: j.latitude, lon: j.longitude, label };
      }
      console.warn("ipwho.is bad payload:", JSON.stringify(j).slice(0, 120));
    } catch (e) { console.warn("ipwho.is failed:", e.message); }
    try {
      const r = await fetch("https://freeipapi.com/api/json", { signal: AbortSignal.timeout(6000) });
      const j = await r.json();
      if (j.latitude && j.longitude)
        return { lat: j.latitude, lon: j.longitude, label: [j.city, j.regionName].filter(Boolean).join(", ") };
    } catch (e) { console.warn("freeipapi failed:", e.message); }
    return null;
  }

  async function refresh() {
    // One-time migration: drop any legacy persisted mock flag, then clear it
    // from storage on the next save so old poisoned states self-heal.
    if (Store.state.__mockWeather) {
      delete Store.state.__mockWeather;
      Store.save();
    }
    if (mockMode) {
      const m = MOCK_CYCLE[(Date.now() / 60000 | 0) % MOCK_CYCLE.length];
      data = { tempC: m.tempC, code: m.code, isDay: true, location: "Mockville",
        days: MOCK_CYCLE.map((x, i) => ({ date: i, code: x.code, hi: x.tempC, lo: x.tempC - 8 })) };
      emit(); return;
    }
    try {
      let loc = null;
      if (Bridge.backend === "native") {
        // NEVER use navigator.geolocation in the packaged app — Windows pops a
        // consent dialog (breaks the no-interaction rule). IP-based instead.
        loc = await locate();
      } else {
        try {
          const g = await new Promise((res, rej) =>
            navigator.geolocation.getCurrentPosition(p => res(p.coords), rej, { timeout: 4000 }));
          loc = { lat: g.latitude, lon: g.longitude, label: "" };
        } catch (e) { /* browser denied/unavailable */ }
      }
      if (!loc) throw new Error("geolocation unavailable");
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
        `&current=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=6&timezone=auto`;
      const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error("wx " + r.status);
      const j = await r.json();
      if (!j.current || j.current.temperature_2m == null) throw new Error("bad open-meteo payload");
      data = lastGood = {
        tempC: Math.round(j.current.temperature_2m),
        code: j.current.weather_code, isDay: !!j.current.is_day,
        location: loc.label || "",
        days: j.daily.time.slice(0, 6).map((d, i) => ({
          date: d, code: j.daily.weather_code[i],
          hi: Math.round(j.daily.temperature_2m_max[i]), lo: Math.round(j.daily.temperature_2m_min[i]),
        })),
      };
      emit();
    } catch (e) {
      // Keep showing the last real reading; never fall back to mock in production.
      console.warn("weather refresh failed:", e.message);
      if (!data && lastGood) data = lastGood;
      if (data) emit();
    }
  }
  function setMock(on) { mockMode = !!on; data = null; }

  function emit() { listeners.forEach(f => f(data)); }
  function onChange(f) { listeners.add(f); }
  function fmtTemp(c) {
    return Store.state.tempUnit === "F" ? Math.round(c * 9 / 5 + 32) + "°" : Math.round(c) + "°";
  }
  return { refresh, onChange, setMock, get current() { return data; }, fmtTemp };
})();
