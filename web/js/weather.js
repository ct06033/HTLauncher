/* Weather: Open-Meteo (no API key). Falls back to a mock cycle when offline
 * (web-dev mode). Native mode geolocates via IP in phase 5; here browser geolocation. */
window.Weather = (() => {
  let data = null;
  const listeners = new Set();
  const MOCK_CYCLE = [
    { code: 0, tempC: 27 }, { code: 2, tempC: 22 }, { code: 61, tempC: 14 },
    { code: 71, tempC: -3 }, { code: 3, tempC: 10 }, { code: 95, tempC: 24 },
  ];

  async function refresh() {
    const mock = Store.state.__mockWeather;
    if (mock) {
      const m = MOCK_CYCLE[(Date.now() / 60000 | 0) % MOCK_CYCLE.length];
      data = { tempC: m.tempC, code: m.code, isDay: true,
        days: MOCK_CYCLE.map((x, i) => ({ date: i, code: x.code, hi: x.tempC, lo: x.tempC - 8 })) };
      emit(); return;
    }
    try {
      let lat = 40.71, lon = -74.0;
      try {
        const g = await new Promise((res, rej) =>
          navigator.geolocation.getCurrentPosition(p => res(p.coords), rej, { timeout: 4000 }));
        lat = g.latitude; lon = g.longitude;
      } catch (e) { /* default NYC */ }
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
        `&current=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=6&timezone=auto`;
      const r = await fetch(u); if (!r.ok) throw new Error("wx " + r.status);
      const j = await r.json();
      data = {
        tempC: Math.round(j.current.temperature_2m),
        code: j.current.weather_code, isDay: !!j.current.is_day,
        days: j.daily.time.slice(0, 6).map((d, i) => ({
          date: d, code: j.daily.weather_code[i],
          hi: Math.round(j.daily.temperature_2m_max[i]), lo: Math.round(j.daily.temperature_2m_min[i]),
        })),
      };
      emit();
    } catch (e) {
      console.warn("weather fetch failed, mock mode:", e.message);
      Store.state.__mockWeather = true;
      return refresh();
    }
  }
  function emit() { listeners.forEach(f => f(data)); }
  function onChange(f) { listeners.add(f); }
  function fmtTemp(c) {
    return Store.state.tempUnit === "F" ? Math.round(c * 9 / 5 + 32) + "°" : Math.round(c) + "°";
  }
  return { refresh, onChange, get current() { return data; }, fmtTemp };
})();
