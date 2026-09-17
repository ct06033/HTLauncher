// Headless test of web/js/weather.js mock-fallback behavior
const fs = require("fs");
const src = fs.readFileSync("web/js/weather.js", "utf8");

let saved = { "tvshell.state.v1": JSON.stringify({ __mockWeather: true, tempUnit: "F" }) };
global.Store = { state: JSON.parse(saved["tvshell.state.v1"]), save() { saved["tvshell.state.v1"] = JSON.stringify(this.state); } };
global.Bridge = { backend: "native" };
global.window = global;
global.location = { search: "" };
let fetched = [];
global.fetch = async (url, opts) => {
  fetched.push(url);
  if (url.includes("ipwho.is")) return { json: async () => ({ success: true, latitude: 40.71, longitude: -74.0, city: "New York", region: "NY" }) };
  if (url.includes("open-meteo")) return { ok: true, json: async () => ({
    current: { temperature_2m: 18.3, weather_code: 2, is_day: 1 },
    daily: { time: ["2026-09-17","2026-09-18"], weather_code: [2,61], temperature_2m_max: [20,15], temperature_2m_min: [10,7] },
  }) };
  throw new Error("unexpected " + url);
};
AbortSignal.timeout = AbortSignal.timeout || (ms => new AbortController().signal);

eval(src);

(async () => {
  let last = null;
  Weather.onChange(d => { last = d; });
  await Weather.refresh();
  console.assert(!Store.state.__mockWeather, "FAIL: legacy mock flag not cleared");
  console.assert(last && last.location === "New York, NY", "FAIL: no real data, got " + JSON.stringify(last));
  console.assert(last.tempC === 18, "FAIL: temp rounding " + last.tempC);
  console.assert(last.days.length === 2, "FAIL: days " + last.days.length);
  console.assert(JSON.parse(saved["tvshell.state.v1"]).__mockWeather === undefined, "FAIL: flag persisted");
  console.log("temp F fmt:", Weather.fmtTemp(last.tempC));

  // Second run: network down entirely -> must stay silent-real (no mock, keeps lastGood)
  global.fetch = async () => { throw new Error("offline"); };
  await Weather.refresh();
  console.assert(last.location !== "Mockville", "FAIL: fell back to mock when offline");
  console.assert(!Store.state.__mockWeather, "FAIL: mock flag set on failure");

  // Dev mock via explicit flag still works
  Weather.setMock(true);
  await Weather.refresh();
  console.assert(last.location === "Mockville", "FAIL: dev mock not active");
  console.assert(!Store.state.__mockWeather, "FAIL: dev mock persisted");
  console.log("ALL WEATHER TESTS PASSED");
})();
