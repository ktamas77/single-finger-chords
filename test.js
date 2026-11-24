// node test.js
const assert = require("node:assert/strict");
const { createEngine, detect, voice } = require("./src/core.js");

const C = 48, Bb = 46, B = 47, A = 45, Ab = 44;
const name = (keys) => { const c = detect(keys); return c.root + c.type; };

// The four manual fingerings, root C (PSR-K1 / YPT-230 "nearest" keys).
assert.equal(name([C]), "0");
assert.equal(name([Bb, C]), "0m");
assert.equal(name([B, C]), "07");
assert.equal(name([Bb, B, C]), "0m7");
// "Any" key to the left works too (PSS-140), and extra keys of one colour change nothing.
assert.equal(name([Ab, C]), "0m");
assert.equal(name([A, C]), "07");
assert.equal(name([A, B, C]), "07");
assert.equal(name([36, 37, C]), "0m7");
// Root is the highest key, whatever its colour.
assert.equal(name([45, 46]), "107"); // A + Bb = Bb7

// Voicing: compact keeps every tone in [low, low+11]; root position stacks up from the root.
const g7 = { root: 7, type: "7" };
assert.deepEqual(voice(g7, { low: 48, voicing: 0, bass: 0 }), [55, 59, 50, 53]);
assert.deepEqual(voice(g7, { low: 48, voicing: 1, bass: 1 }), [55, 59, 62, 65, 43]);
for (let pc = 0; pc < 12; pc++)
  for (const type of ["", "m", "7", "m7"])
    for (const p of voice({ root: pc, type }, { low: 48, voicing: 0, bass: 1 }))
      assert.ok(p >= 36 && p <= 59, `out of register: ${pc}${type} -> ${p}`);

const ons = (ev) => ev.filter((e) => e[1] > 0).map((e) => e[0]);
const offs = (ev) => ev.filter((e) => e[1] === 0).map((e) => e[0]);

// Keys landing inside the detect window make one chord, with no major blip first.
let e = createEngine();
assert.deepEqual(e.note(C, 90), []);
assert.deepEqual(e.note(Bb, 80), []);
assert.ok(e.isDirty());
let ev = e.flush();
assert.deepEqual(ons(ev), [48, 51, 55, 36]); // Cm + bass, at the root key's velocity
assert.ok(ev.every((x) => x[1] === 90));
assert.equal(e.name(), "Cm");
// Lifting the root first must not turn the leftover Bb into a Bb chord.
assert.deepEqual(e.note(C, 0), []);
assert.equal(e.name(), "Cm");
assert.deepEqual(offs(e.note(Bb, 0)).sort(), [36, 48, 51, 55]);
assert.equal(e.name(), "");

// Adding a key while the root is held changes the chord (PSS-140 note) and restrikes it.
e = createEngine();
e.note(C, 100); e.flush();
e.note(B, 100);
ev = e.flush();
assert.deepEqual(offs(ev), [48, 52, 55, 36]);
assert.deepEqual(ons(ev), [48, 52, 55, 58, 36]);
assert.equal(e.name(), "C7");

// A tap shorter than the window still sounds, then stops.
e = createEngine();
e.note(C, 100);
ev = e.note(C, 0);
assert.deepEqual(ons(ev), [48, 52, 55, 36]);
assert.deepEqual(offs(ev), [48, 52, 55, 36]);

// Above the split: straight through, untouched.
e = createEngine();
assert.deepEqual(e.note(60, 70), [[60, 70]]);
assert.deepEqual(e.note(60, 0), [[60, 0]]);
assert.equal(e.isDirty(), false);

// A played key that coincides with a chord tone is not cut off when the chord ends.
e = createEngine();
e.note(55, 70); // right hand G, above the split
e.note(C, 100); e.flush(); // C major also sounds 55
assert.deepEqual(offs(e.note(C, 0)).sort(), [36, 48, 52]); // 55 keeps ringing
assert.deepEqual(e.note(55, 0), [[55, 0]]);

// Moving the split while keys are down strands nothing.
e = createEngine();
e.note(C, 100); e.flush();
e.set("split", 40); // C is now "above" the split
assert.deepEqual(offs(e.note(C, 0)).sort(), [36, 48, 52, 55]);
e.note(60, 70);
e.set("split", 100);
assert.deepEqual(e.note(60, 0), [[60, 0]]);

// Hold: the chord outlives the keys until the next chord, or until Hold is switched off.
e = createEngine();
e.set("hold", 1);
e.note(C, 100); e.flush();
assert.deepEqual(e.note(C, 0), []);
assert.equal(e.name(), "C");
e.note(50, 100);
ev = e.flush();
assert.deepEqual(offs(ev), [48, 52, 55, 36]);
assert.equal(e.name(), "D");
e.note(50, 0);
assert.deepEqual(offs(e.set("hold", 0)).sort(), [38, 50, 54, 57]);

// Every note-on is eventually matched by a note-off, under a random key mash.
e = createEngine();
const live = new Map();
const track = (events) => events.forEach(([p, v]) => live.set(p, v > 0));
let seed = 7;
const rnd = (n) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
const down = new Set();
for (let i = 0; i < 5000; i++) {
  const p = 36 + rnd(40);
  if (down.has(p)) { down.delete(p); track(e.note(p, 0)); }
  else { down.add(p); track(e.note(p, 1 + rnd(127))); }
  if (rnd(3) === 0) track(e.flush());
  if (rnd(50) === 0) track(e.set("split", 40 + rnd(30)));
}
down.forEach((p) => track(e.note(p, 0)));
assert.deepEqual([...live].filter(([, isOn]) => isOn), [], "stuck notes");

// The device itself: build it, pull the embedded code back out of the .amxd, and run it against
// stand-ins for the globals Max gives a v8 object (inlet, outlet).
require("./build.js");
const amxd = require("node:fs").readFileSync(`${__dirname}/dist/Single Finger.amxd`);
assert.equal(amxd.subarray(0, 12).toString("latin1"), "ampf\x04\0\0\0mmmm");
assert.equal(amxd.readUInt32LE(28), amxd.length - 32);
const patcher = JSON.parse(amxd.subarray(32, amxd.length - 1).toString()).patcher;
const ports = new Map(patcher.boxes.map(({ box }) => [box.id, box]));
for (const { patchline: { source: [s, o], destination: [d, i] } } of patcher.lines)
  assert.ok(o < ports.get(s).numoutlets && i < ports.get(d).numinlets, `bad patch cord ${s}:${o} -> ${d}:${i}`);

const sent = [];
const max = { inlet: 0, outlet: (...a) => sent.push(a) };
require("node:vm").runInNewContext([...ports.values()].find((b) => b.maxclass === "v8.codebox").code, max);
const call = (inlet, fn, ...args) => { max.inlet = inlet; sent.length = 0; max[fn](...args); return sent.slice(); };
assert.deepEqual(call(0, "list", C, 100), [[1, 25]]); // first key arms the detect window, no sound yet
assert.deepEqual(call(0, "list", Bb, 90), []); // second key: no second timer
assert.deepEqual(call(0, "bang"), [[0, 48, 100], [0, 51, 100], [0, 55, 100], [0, 36, 100], [2, "set", "Cm"]]);
call(0, "list", C, 0);
assert.deepEqual(call(0, "list", Bb, 0), [[0, 48, 0], [0, 51, 0], [0, 55, 0], [0, 36, 0], [2, "set", "-"]]);
assert.deepEqual(call(0, "list", 72, 64), [[0, 72, 64]]); // right hand
call(0, "list", 72, 0);
call(3, "msg_float", 0); // Detect 0 ms: chords sound immediately (live.numbox sends floats)
call(5, "msg_int", 0); // Bass off
call(4, "msg_int", 1); // Voicing: Root
assert.deepEqual(call(0, "list", 43, 80), [[0, 55, 80], [0, 59, 80], [0, 62, 80], [2, "set", "G"]]);

console.log("ok");
