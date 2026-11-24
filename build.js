// node build.js  ->  dist/Single Finger.amxd  (Max for Live MIDI effect, needs Live 12 Suite / Max 9)
//
// A .amxd is a 32-byte header followed by the Max patcher as JSON; layout copied from Live's own
// "Max MIDI Effect.amxd". The chord logic is embedded in a v8.codebox, so the device is one file
// and never needs "freezing" in the Max editor.
const fs = require("node:fs");
const path = require("node:path");

// Max-side wrapper around src/core.js.
// ponytail: v8 code runs outside Max's real-time scheduler. Measured in Live 12.4.16: about 6 ms on
// pass-through notes and 11-21 ms on chords beyond the detect window (docs/single-finger.md). If
// that is felt while playing, port core.js to plain Max objects or a JUCE plugin.
const GLUE = `
inlets = 7; // 0: [pitch, velocity] from midiparse, or bang from the detect-window delay; 1-6: parameters
outlets = 3; // 0: [pitch, velocity] to midiformat, 1: ms to the delay, 2: chord name
var PARAMS = [null, "split", "low", "win", "voicing", "bass", "hold"];
var engine = createEngine();
var armed = false;
var shown = "-";

function send(events) {
  events.forEach(function (e) {
    outlet(0, e[0], e[1]);
  });
  var name = engine.name() || "-";
  if (name !== shown) outlet(2, "set", (shown = name));
}

function list(pitch, velocity) {
  if (inlet) return;
  send(engine.note(pitch, velocity));
  if (!engine.isDirty()) return;
  if (engine.opts.win <= 0) send(engine.flush());
  else if (!armed) {
    armed = true; // the window runs from the first key of a fingering, not the last
    outlet(1, engine.opts.win);
  }
}

function bang() {
  armed = false;
  send(engine.flush());
}

function msg_int(v) {
  if (PARAMS[inlet]) send(engine.set(PARAMS[inlet], v));
}

function msg_float(v) {
  msg_int(Math.round(v));
}
`;

const code = fs.readFileSync(path.join(__dirname, "src/core.js"), "utf8") + GLUE;

const boxes = [];
const lines = [];
const box = (props) => {
  const id = `obj-${boxes.length + 1}`;
  boxes.push({ box: { id, ...props } });
  return id;
};
const obj = (text, numinlets, outlettype, x, y) =>
  box({ maxclass: "newobj", text, numinlets, numoutlets: outlettype.length, outlettype, patching_rect: [x, y, 110, 22] });
const wire = (source, outlet, destination, inlet) =>
  lines.push({ patchline: { source: [source, outlet], destination: [destination, inlet] } });

// MIDI path: notes go through the engine, everything else passes straight across.
const midiin = obj("midiin", 1, ["int"], 40, 20);
const parse = obj("midiparse @hires 1", 1, ["", "", "", "int", "int", "", "int", ""], 40, 60);
const engine = box({
  maxclass: "v8.codebox",
  code,
  filename: "none",
  fontface: 0,
  fontname: "<Monospaced>",
  fontsize: 12,
  numinlets: 7,
  numoutlets: 3,
  outlettype: ["", "", ""],
  patching_rect: [40, 200, 620, 260],
  saved_object_attributes: { parameter_enable: 0 },
});
const delay = obj("delay 25", 2, ["bang"], 700, 300);
const format = obj("midiformat @hires 1", 7, ["int", ""], 40, 500);
const midiout = obj("midiout", 1, [], 40, 540);
wire(midiin, 0, parse, 0);
wire(parse, 0, engine, 0);
for (let i = 1; i <= 6; i++) wire(parse, i, format, i); // poly pressure, CC, program, aftertouch, bend, channel
wire(engine, 0, format, 0);
wire(format, 0, midiout, 0);
wire(engine, 1, delay, 0); // a number in delay's left inlet sets the time and starts it
wire(delay, 0, engine, 0);

// Device UI (presentation mode is what Live shows; 169 px is the height limit).
const label = (text, x, y, w) =>
  box({
    maxclass: "live.comment",
    text,
    textjustification: 0,
    numinlets: 1,
    numoutlets: 0,
    patching_rect: [300 + x * 2, 20 + y, w, 18],
    presentation: 1,
    presentation_rect: [x, y, w, 18],
  });
const param = (inlet, maxclass, outlettype, name, rect, valueof) => {
  const id = box({
    maxclass,
    numinlets: 1,
    numoutlets: outlettype.length,
    outlettype,
    parameter_enable: 1,
    varname: name,
    patching_rect: [300 + rect[0] * 2, 20 + rect[1], rect[2], rect[3]],
    presentation: 1,
    presentation_rect: rect,
    saved_attribute_attributes: {
      valueof: {
        parameter_longname: name,
        parameter_shortname: name,
        parameter_modmode: 0,
        parameter_initial_enable: 1,
        ...valueof,
      },
    },
  });
  wire(id, 0, engine, inlet);
};
// parameter_type: 1 = int, 2 = enum. parameter_unitstyle: 2 = ms, 8 = MIDI note name.
const number = (inlet, name, x, min, max, initial, unitstyle) => {
  label(name, x, 44, 50);
  param(inlet, "live.numbox", ["", "float"], name, [x, 60, 46, 15], {
    parameter_type: 1,
    parameter_mmin: min,
    parameter_mmax: max,
    parameter_initial: [initial],
    parameter_unitstyle: unitstyle,
  });
};
const choice = (inlet, maxclass, outlettype, name, rect, options, initial) => {
  label(name, rect[0], 86, 50);
  param(inlet, maxclass, outlettype, name, rect, {
    parameter_type: 2,
    parameter_enum: options,
    parameter_mmax: options.length - 1,
    parameter_initial: [initial],
  });
};

const display = box({
  maxclass: "comment",
  text: "-",
  fontsize: 24,
  numinlets: 1,
  numoutlets: 0,
  patching_rect: [700, 400, 150, 34],
  presentation: 1,
  presentation_rect: [6, 4, 156, 34],
  textcolor: [0, 0, 0, 1],
  saved_attribute_attributes: { textcolor: { expression: "themecolor.live_control_fg" } },
});
wire(engine, 2, display, 0);

number(1, "Split", 8, 0, 127, 54, 8); // highest key of the chord zone; Yamaha default F#2
number(2, "Low", 62, 12, 96, 48, 8); // bottom of the chord's register
number(3, "Detect", 116, 0, 100, 25, 2); // ms to wait for the other keys of a fingering
choice(4, "live.menu", ["", "", "float"], "Voicing", [8, 102, 74, 15], ["Compact", "Root"], 0);
choice(5, "live.toggle", [""], "Bass", [94, 102, 15, 15], ["off", "on"], 1);
choice(6, "live.toggle", [""], "Hold", [130, 102, 15, 15], ["off", "on"], 0);

const patcher = {
  fileversion: 1,
  appversion: { major: 9, minor: 0, revision: 0, architecture: "x64", modernui: 1 },
  classnamespace: "box",
  rect: [100, 100, 900, 640],
  openrect: [0, 0, 0, 169],
  openinpresentation: 1,
  default_fontsize: 10,
  default_fontface: 0,
  default_fontname: "Arial Bold",
  gridsize: [8, 8],
  devicewidth: 0,
  description: "Yamaha-style Single Finger chords: root alone = major, + black key to the left = minor, + white key = 7th, + both = m7.",
  title: "Single Finger",
  boxes,
  lines,
  dependency_cache: [],
  latency: 0,
  project: {
    version: 1,
    creationdate: 3590052786,
    modificationdate: 3590052786,
    viewrect: [0, 0, 300, 500],
    autoorganize: 1,
    hideprojectwindow: 1,
    showdependencies: 1,
    autolocalize: 0,
    contents: { patchers: {} },
    layout: {},
    searchpath: {},
    detailsvisible: 0,
    amxdtype: 0x6d6d6d6d, // "mmmm" = MIDI effect
    readonly: 0,
    devpathtype: 0,
    devpath: ".",
    sortmode: 0,
    viewmode: 0,
  },
  autosave: 0,
};

const json = Buffer.from(JSON.stringify({ patcher }, null, "\t") + "\n\0");
const head = Buffer.alloc(32); // "ampf" 4 "mmmm" "meta" 4 <4 zero bytes> "ptch" <json length>
head.write("ampf", 0);
head.writeUInt32LE(4, 4);
head.write("mmmm", 8);
head.write("meta", 12);
head.writeUInt32LE(4, 16);
head.write("ptch", 24);
head.writeUInt32LE(json.length, 28);

const out = path.join(__dirname, "dist", "Single Finger.amxd");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([head, json]));
console.log(`${out} (${head.length + json.length} bytes, ${boxes.length} objects)`);
