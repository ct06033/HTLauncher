// Headless test of the in-page spatial navigator's pure geometry
// (native/extensions/*/spatial.js -> window.__htlSpatial.pick). Loads the real
// file in a sandbox with a document stub lacking addEventListener, so only the
// pure functions attach. Grid: 3x3 of 100x100 cells, 10px gutters.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// vm.runInNewContext: the IIFE sees `window` as a global. Capture via sandbox.
function load(dir) {
  const src = fs.readFileSync(path.join(__dirname, "..", "native", "extensions", dir, "spatial.js"), "utf8");
  const sandbox = { window: { document: {} }, console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window.__htlSpatial;
}

let failures = 0;
function ok(cond, msg) {
  if (cond) console.log("PASS: " + msg);
  else { failures++; console.log("FAIL: " + msg); }
}

function grid() {
  // cell(r,c): x = c*110, y = r*110, 100x100
  const cells = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      cells.push({ id: r + "," + c, x: c * 110, y: r * 110, w: 100, h: 100 });
  return cells;
}
const at = (rects, id) => rects.find((x) => x.id === id);
const pick = (S, rects, fromId, dir) => {
  const g = rects; const from = at(g, fromId);
  const r = S.pick(g.filter((x) => x !== from), from, dir);
  return r && r.id;
}

for (const dirName of ["netflix-remote", "spotify-remote"]) {
  const S = load(dirName);
  ok(!!S && typeof S.pick === "function", dirName + ": __htlSpatial.pick exported");
  ok(S.MIN_PX === 8 && S.MAX_CANDIDATES === 400, dirName + ": constants (8px min, 400 cap)");

  const g = grid();
  ok(pick(S, g, "1,1", "ArrowRight") === "1,2", dirName + ": Right from center picks right-middle (not diagonal)");
  ok(pick(S, g, "1,1", "ArrowDown") === "2,1", dirName + ": Down from center picks bottom-middle");
  ok(pick(S, g, "1,1", "ArrowLeft") === "1,0", dirName + ": Left from center picks left-middle");
  ok(pick(S, g, "1,1", "ArrowUp") === "0,1", dirName + ": Up from center picks top-middle");
  ok(pick(S, g, "0,0", "ArrowUp") === undefined || pick(S, g, "0,0", "ArrowUp") === null ||
     S.pick(g.filter(x => x !== at(g,"0,0")), at(g,"0,0"), "ArrowUp") === null,
     dirName + ": no candidate above top row -> null (keep focus)");
  ok(S.pick(g.filter(x => x !== at(g,"2,2")), at(g,"2,2"), "ArrowDown") === null,
     dirName + ": no candidate below bottom row -> null");
  ok(S.pick([], at(g, "1,1"), "ArrowRight") === null, dirName + ": empty candidate list -> null");
  ok(S.pick(g, null, "ArrowRight") === null, dirName + ": null from -> null");

  // tie-break: two candidates same primary-axis gap; full perpendicular
  // overlap must beat partial overlap
  const tie = [
    { id: "partial", x: 210, y: 105, w: 100, h: 100 }, // same gap, 95% overlap
    { id: "inline",  x: 210, y: 110, w: 100, h: 100 }, // same gap, 100% overlap
  ];
  ok(S.pick(tie, at(g, "1,1"), "ArrowRight").id === "inline",
     dirName + ": equal-gap tie prefers full perpendicular overlap");

  // zero perpendicular overlap is penalised even with a smaller gap
  const penalty = [
    { id: "row-bad",   x: 260, y: 500, w: 100, h: 100 }, // gap 50, no vertical overlap
    { id: "row-good",  x: 400, y: 110, w: 100, h: 100 }, // gap 190, full overlap
  ];
  ok(S.pick(penalty, at(g, "1,1"), "ArrowRight").id === "row-good",
     dirName + ": zero-overlap candidate loses to an in-line farther one");

  // diagonal-only target still reachable (partial overlap beats nothing)
  ok(pick(S, g, "0,0", "ArrowDown") === "1,0", dirName + ": Down from top-left picks middle-left");
  ok(pick(S, g, "2,0", "ArrowRight") === "2,1", dirName + ": Right from bottom-left picks bottom-middle");

  // start rule: nothing focused -> nearest to center-left (x=0.1*vw, y=vh/2)
  const s = S.start(g, 330, 330);
  ok(s && s.id === "1,0", dirName + ": htSpatialStart seeds center-left cell");
}

// manifests must be valid JSON with the right script order
for (const dirName of ["netflix-remote", "spotify-remote"]) {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "native", "extensions", dirName, "manifest.json"), "utf8"));
  const iso = m.content_scripts.find((cs) => !cs.world || cs.world === "ISOLATED");
  ok(JSON.stringify(iso.js) === '["spatial.js","osk.js","content.js"]',
     dirName + ": isolated js order spatial,osk,content");
  ok(iso.css.includes("nav.css") && iso.css.includes("cursor.css"),
     dirName + ": css includes cursor.css + nav.css");
  if (dirName === "spotify-remote") {
    const main = m.content_scripts.find((cs) => cs.world === "MAIN");
    ok(main && main.js[0] === "page-probe.js", "spotify-remote: MAIN-world page-probe.js entry untouched");
  }
}

console.log(failures ? failures + " FAILURES" : "ALL SPATIAL TESTS PASS");
process.exit(failures ? 1 : 0);
