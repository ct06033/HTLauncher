// Headless test of the in-page OSK's pure helpers
// (native/extensions/*/osk.js -> window.__htlOsk). The script detects a
// document stub without addEventListener and stops after exporting helpers,
// so no DOM is required.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function load(dir) {
  const src = fs.readFileSync(path.join(__dirname, "..", "native", "extensions", dir, "osk.js"), "utf8");
  const sandbox = { window: { document: {} }, console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window.__htlOsk;
}

let failures = 0;
function ok(cond, msg) {
  if (cond) console.log("PASS: " + msg);
  else { failures++; console.log("FAIL: " + msg); }
}

for (const dirName of ["netflix-remote", "spotify-remote"]) {
  const O = load(dirName);
  ok(!!O && typeof O.shouldOpenFor === "function", dirName + ": __htlOsk exported");

  // ---- open rules ---------------------------------------------------------
  ok(O.shouldOpenFor("INPUT", "text") === true, dirName + ": opens for input[type=text]");
  ok(O.shouldOpenFor("INPUT", "search") === true, dirName + ": opens for input[type=search]");
  ok(O.shouldOpenFor("INPUT", "password") === true, dirName + ": opens for password");
  ok(O.shouldOpenFor("INPUT", undefined) === true, dirName + ": opens for typeless input (defaults text)");
  ok(O.shouldOpenFor("TEXTAREA", null) === true, dirName + ": opens for textarea");
  ok(O.shouldOpenFor("DIV", null, true) === true, dirName + ": opens for contenteditable");
  ok(O.shouldOpenFor("INPUT", "checkbox") === false, dirName + ": never for checkbox");
  ok(O.shouldOpenFor("INPUT", "radio") === false, dirName + ": never for radio");
  ok(O.shouldOpenFor("INPUT", "button") === false, dirName + ": never for button");
  ok(O.shouldOpenFor("BUTTON", null) === false, dirName + ": never for <button>");
  ok(O.shouldOpenFor("A", null) === false, dirName + ": never for links");

  // ---- layout -------------------------------------------------------------
  const alpha = O.ROWS_ALPHA.flat().join("");
  ok("qwertyuiop".split("").every((c) => alpha.includes(c)) &&
     "asdfghjkl".split("").every((c) => alpha.includes(c)) &&
     "zxcvbnm".split("").every((c) => alpha.includes(c)),
     dirName + ": all QWERTY letters present");
  ok("1234567890".split("").every((c) => O.ROWS_ALPHA[0].includes(c)), dirName + ": digit top row");
  const seen = new Set(); let dup = false;
  for (const r of O.ROWS_ALPHA) for (const c of r) { if (seen.has(c)) dup = true; seen.add(c); }
  ok(!dup, dirName + ": no duplicate keys within alpha layout");
  const symFlat = O.ROWS_SYM.flat();
  ok("!@#$%^&*()_+-=[]{}|;:'\",.<>/?".split("").every((c) => symFlat.includes(c)),
     dirName + ": sym row contents cover the spec charset");

  // buildRows: shift uppercases letters, not symbols; functional bar appended
  const rowsN = O.buildRows(null, false, false);
  ok(rowsN.length === 5 && rowsN[4].some((k) => k.kind === "done") &&
     rowsN[4].some((k) => k.kind === "bksp") && rowsN[4].some((k) => k.ch === " "),
     dirName + ": grid = 4 char rows + functional bar (space/bksp/done)");
  const rowsS = O.buildRows(null, true, false);
  ok(rowsS[1][0].ch === "Q" && rowsS[3][0].ch === "Z", dirName + ": shift uppercases letters");
  const rowsSym = O.buildRows(null, true, true);
  ok(rowsSym[1][0].ch === "!", dirName + ": shift does not alter sym layout");

  // shift-state toggling semantics (UI flips a bool; verify both states differ)
  ok(JSON.stringify(rowsN) !== JSON.stringify(rowsS), dirName + ": shift toggles visible labels");

  // ---- value routing (injectable, real-DOM path tested by dispatch below) --
  const events = [];
  const fake = { value: "abc" };
  const opts = { getValue: () => fake.value,
                 apply: (ch) => { fake.value += ch; events.push("input"); } };
  O.setFieldValue(fake, "d", opts);
  ok(fake.value === "abcd" && events.length === 1, dirName + ": setFieldValue appends + dispatches");
  O.setFieldValue(fake, "", opts);
  ok(fake.value === "abcd", dirName + ": empty char is a no-op");
  // backspace math with pure get/set hooks
  let v = "hello";
  O.backspaceField(null, { getValue: () => v, setValue: (t) => { v = t; } });
  ok(v === "hell", dirName + ": backspace deletes last char");
  v = "";
  O.backspaceField(null, { getValue: () => v, setValue: (t) => { v = t; } });
  ok(v === "", dirName + ": backspace on empty stays empty");
  // multi-codepoint: slice on UTF-16 unit — an emoji backspace halves the pair
  v = "a\ud83d\ude00"; // "a" + emoji (2 units)
  O.backspaceField(null, { getValue: () => v, setValue: (t) => { v = t; } });
  ok(v === "a\ud83d", dirName + ": backspace slices one UTF-16 unit (documented behavior)");

  // ---- native-setter path against a minimal InputElement stub -------------
  // Mirrors how React reads changes: the *prototype* descriptor setter must be
  // used, and input/change must bubble out of the element.
  let dispatched = [];
  function FakeEvent(type) { this.type = type; this.bubbles = true; }
  class FakeInput {
    constructor() { this.tagName = "INPUT"; this._v = ""; }
    get value() { return this._v; }
    set value(x) { this._v = "NATIVE:" + x; }   // marks that native setter ran
    dispatchEvent(e) { dispatched.push(e.type || e); }
  }
  const protoDesc = { set(v) { this._v = "NATIVE:" + v; }, get() { return this._v; },
                      configurable: true, enumerable: true };
  const src = fs.readFileSync(path.join(__dirname, "..", "native", "extensions", dirName, "osk.js"), "utf8");
  const el = new FakeInput();
  el.isContentEditable = false;
  const winStub = {
    document: {},
    HTMLInputElement: function () {}, HTMLTextAreaElement: function () {},
    Event: function (t) { this.type = t; this.bubbles = true; },
  };
  Object.defineProperty(winStub.HTMLInputElement.prototype, "value", protoDesc);
  const sb = { window: winStub, console };
  vm.createContext(sb);
  vm.runInContext(src, sb); // document stub w/o addEventListener -> pure exports only
  const O2 = sb.window.__htlOsk;
  // Exercise the PRODUCTION default path of setFieldValue (no injectable opts):
  // it must fetch the prototype value-setter from window.HTMLInputElement and
  // dispatch bubbling input+change events — exactly what React/Netflix need.
  O2.setFieldValue(el, "x");
  ok(el.value === "NATIVE:x" && dispatched.join(",") === "input,change",
     dirName + ": native-setter trick + input/change dispatch (React-compatible)");
}

console.log(failures ? failures + " FAILURES" : "ALL OSK TESTS PASS");
process.exit(failures ? 1 : 0);
