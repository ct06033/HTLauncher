// Unit test: openEdgeApp sanitizes a "Crashed" Edge profile before spawn
// (see native/edgeapps.js header comment — Edge safe mode silently disables
// --load-extension content scripts after any unclean exit).
// Run: node test/sanitize-profile.test.js
const path = require("path");
const fs = require("fs");
const os = require("os");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "htl-sanitize-"));
process.env.LOCALAPPDATA = tmp;
const profDir = path.join(tmp, "HTLauncher", "SpotifyProfile", "Default");
fs.mkdirSync(profDir, { recursive: true });
const pref = path.join(profDir, "Preferences");
fs.writeFileSync(pref, JSON.stringify({
  profile: { exit_type: "Crashed" },
  extensions: { safemode: { foo: 1 }, settings: { bar: 1 } },
}));

// stub spawn so no browser actually launches
const cp = require("child_process");
cp.spawn = () => ({ unref() {} });

const mod = require(path.join(__dirname, "..", "native", "edgeapps.js"));
mod.openSpotify();

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("PASS:", name); }
  else { fail++; console.log("FAIL:", name); }
}
const out = JSON.parse(fs.readFileSync(pref, "utf8"));
check("exit_type rewritten Crashed -> Normal", out.profile.exit_type === "Normal");
check("safemode state cleared", !out.extensions.safemode);
check("extension settings preserved (no collateral damage)", !!out.extensions.settings);

// missing-profile case: must not throw
process.env.LOCALAPPDATA = path.join(tmp, "nope");
try { mod.openNetflix(); check("missing Preferences is a silent no-op", true); }
catch (e) { check("missing Preferences is a silent no-op", false); }

console.log(fail ? "SANITIZE TESTS FAILED" : "ALL SANITIZE TESTS PASS");
process.exit(fail ? 1 : 0);
