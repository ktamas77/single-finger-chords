// Yamaha-style Single Finger chord engine. Pure logic: no Max, no timers, so it
// runs unchanged in Node (test.js) and inside the device's v8.codebox (build.js).
// Methods return the MIDI to send as [[pitch, velocity], ...]; velocity 0 = note off.

var BLACK = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0]; // pitch class -> black key?
var NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
var TYPES = { "": [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10] };

// Root = highest held key. Among the keys to its left: any black = minor,
// any white = 7th, both = minor 7th. ("Any", not "nearest": see docs/single-finger.md.)
function detect(pitches) {
  var root = Math.max.apply(null, pitches);
  var black = false;
  var white = false;
  pitches.forEach(function (p) {
    if (p < root) BLACK[p % 12] ? (black = true) : (white = true);
  });
  return { root: root % 12, type: black ? (white ? "m7" : "m") : white ? "7" : "" };
}

// First pitch at or above `from` with pitch class `pc`.
function place(pc, from) {
  return from + ((((pc - from) % 12) + 12) % 12);
}

// voicing 0 = compact: every chord tone inside [low, low+11], so chords stay in one register.
// voicing 1 = root position: root inside [low, low+11], other tones stacked above it.
function voice(chord, opts) {
  var root = place(chord.root, opts.low);
  var notes = TYPES[chord.type].map(function (i) {
    return opts.voicing ? root + i : place(chord.root + i, opts.low);
  });
  if (opts.bass) notes.push(root - 12);
  return notes;
}

function createEngine() {
  var opts = { split: 54, low: 48, win: 25, voicing: 0, bass: 1, hold: 0 };
  var held = new Map(); // chord-zone keys down now: pitch -> velocity
  var thru = new Set(); // keys passed straight through when pressed; their release must follow
  var counts = new Map(); // output pitch -> active note-ons (a chord tone and a played key can coincide)
  var sounding = []; // chord notes currently on
  var chord = null;
  var dirty = false; // a zone key was pressed since the last flush

  function on(out, pitch, velocity) {
    counts.set(pitch, (counts.get(pitch) || 0) + 1);
    out.push([pitch, velocity]);
  }

  function off(out, pitch) {
    var n = (counts.get(pitch) || 0) - 1;
    if (n > 0) return counts.set(pitch, n);
    counts.delete(pitch);
    out.push([pitch, 0]);
  }

  function stop(out) {
    sounding.forEach(function (p) {
      off(out, p);
    });
    sounding = [];
  }

  // Detect from the keys held right now and restrike the chord. The host calls this when
  // its detect-window timer fires, so keys landing a few ms apart count as one fingering.
  function flush() {
    var out = [];
    if (!dirty) return out;
    dirty = false;
    var keys = Array.from(held.keys());
    if (!keys.length) return out;
    chord = detect(keys);
    stop(out);
    sounding = voice(chord, opts);
    var velocity = held.get(Math.max.apply(null, keys));
    sounding.forEach(function (p) {
      on(out, p, velocity);
    });
    return out;
  }

  function note(pitch, velocity) {
    var out = [];
    if (velocity > 0) {
      // A key is routed where its press went, even if the split point moved since.
      if (thru.has(pitch)) out.push([pitch, velocity]);
      else if (pitch > opts.split && !held.has(pitch)) {
        thru.add(pitch);
        on(out, pitch, velocity);
      } else {
        held.set(pitch, velocity);
        dirty = true;
      }
    } else if (thru.delete(pitch)) off(out, pitch);
    else if (held.has(pitch)) {
      out = flush(); // a tap shorter than the detect window still sounds
      held.delete(pitch);
      // Releasing one key of a fingering never re-detects; only the last release ends the chord.
      if (!held.size && !opts.hold) stop(out);
    }
    return out;
  }

  function set(name, value) {
    var out = [];
    opts[name] = value;
    if (name === "hold" && !value && !held.size) stop(out);
    return out;
  }

  return {
    opts: opts,
    note: note,
    flush: flush,
    set: set,
    isDirty: function () {
      return dirty;
    },
    name: function () {
      return sounding.length ? NAMES[chord.root] + chord.type : "";
    },
  };
}

if (typeof module !== "undefined") module.exports = { createEngine: createEngine, detect: detect, voice: voice };
