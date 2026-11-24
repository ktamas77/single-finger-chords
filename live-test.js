// node live-test.js  -  end-to-end check inside a running Ableton Live.
//
// Needs the AbletonOSC control surface enabled in Live (https://github.com/ideoforms/AbletonOSC).
// It adds two temporary MIDI tracks, loads dist/Single Finger.amxd on one, plays fingerings through
// it from a clip, records the device's MIDI output on the other, compares, then deletes both tracks.
// It starts and stops Live's transport, so run it on a set where that does no harm.
const dgram = require("node:dgram");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const LIVE = process.env.LIVE_APP || "/Applications/Ableton Live 12 Suite.app";
const AMXD = path.join(__dirname, "dist", "Single Finger.amxd");

// [start beat, keys played, pitches the device must output]
const CASES = [
  [0, [48], [36, 48, 52, 55]], // C
  [1, [46, 48], [36, 48, 51, 55]], // Cm
  [2, [47, 48], [36, 48, 52, 55, 58]], // C7
  [3, [46, 47, 48], [36, 48, 51, 55, 58]], // Cm7
  [4, [72], [72]], // above the split: passes through
  [5, [41, 43], [43, 50, 53, 55, 59]], // G7, compact voicing
];

// --- minimal OSC over UDP: AbletonOSC listens on 11000 and replies on 11001 ---
const pad = (b) => Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]);
const str = (s) => pad(Buffer.from(s));

function encode(address, args) {
  let tags = ",";
  const parts = [];
  for (const a of args) {
    if (typeof a === "boolean") tags += a ? "T" : "F";
    else if (typeof a === "string") { tags += "s"; parts.push(str(a)); }
    else if (Number.isInteger(a)) { tags += "i"; const b = Buffer.alloc(4); b.writeInt32BE(a); parts.push(b); }
    else { tags += "f"; const b = Buffer.alloc(4); b.writeFloatBE(a); parts.push(b); }
  }
  return Buffer.concat([str(address), str(tags), ...parts]);
}

function decode(buf) {
  let o = 0;
  const readStr = () => { const e = buf.indexOf(0, o); const s = buf.toString("utf8", o, e); o = (e + 4) & ~3; return s; };
  const address = readStr();
  const args = [];
  for (const t of readStr().slice(1)) {
    if (t === "i") { args.push(buf.readInt32BE(o)); o += 4; }
    else if (t === "f") { args.push(buf.readFloatBE(o)); o += 4; }
    else if (t === "d") { args.push(buf.readDoubleBE(o)); o += 8; }
    else if (t === "s") args.push(readStr());
    else if (t === "T" || t === "F") args.push(t === "T");
  }
  return { address, args };
}

async function connect() {
  const sock = dgram.createSocket("udp4");
  await new Promise((res, rej) => { sock.once("error", rej); sock.bind(11001, "127.0.0.1", res); });
  const waiters = [];
  sock.on("message", (m) => {
    const msg = decode(m);
    const i = waiters.findIndex((w) => w.address === msg.address);
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg.args);
  });
  const send = (address, ...args) => sock.send(encode(address, args), 11000, "127.0.0.1");
  const query = (address, ...args) =>
    new Promise((resolve, reject) => {
      const w = { address, resolve };
      waiters.push(w);
      setTimeout(() => {
        const i = waiters.indexOf(w);
        if (i >= 0) { waiters.splice(i, 1); reject(new Error(`no reply to ${address}: is Live running with AbletonOSC enabled?`)); }
      }, 3000);
      send(address, ...args);
    });
  return { send, query, close: () => sock.close(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };
}

(async () => {
  const o = await connect();
  const [before] = await o.query("/live/song/get/num_tracks");
  const [tempo] = await o.query("/live/song/get/tempo");
  const [wasSelected] = await o.query("/live/view/get/selected_track");
  const dev = before;
  const rec = before + 1;
  let failed = 0;
  try {
    o.send("/live/song/stop_playing"); await o.sleep(400);
    o.send("/live/song/create_midi_track", -1); await o.sleep(500);
    o.send("/live/song/create_midi_track", -1); await o.sleep(500);
    // Unique names: the recorder picks its input by track name.
    o.send("/live/track/set/name", dev, "SFtestDev");
    o.send("/live/track/set/name", rec, "SFtestRec"); await o.sleep(400);

    // Opening an .amxd in a running Live loads it onto the selected track.
    o.send("/live/view/set/selected_track", dev); await o.sleep(500);
    execFileSync("open", ["-g", "-a", LIVE, AMXD]);
    await o.sleep(3000);
    const devices = (await o.query("/live/track/get/devices/name", dev)).slice(1);
    const di = devices.indexOf("Single Finger");
    if (di < 0) throw new Error(`device did not load; track has [${devices.join(", ")}]`);
    const names = (await o.query("/live/device/get/parameters/name", dev, di)).slice(2);
    const values = (await o.query("/live/device/get/parameters/value", dev, di)).slice(2);
    console.log("parameters:", names.map((n, i) => `${n}=${values[i]}`).join(", "));

    o.send("/live/track/set/input_routing_type", rec, "SFtestDev"); await o.sleep(500);
    const channels = (await o.query("/live/track/get/available_input_routing_channels", rec)).slice(1);
    o.send("/live/track/set/input_routing_channel", rec, channels.find((c) => /^post fx$/i.test(c))); await o.sleep(300);
    o.send("/live/track/set/arm", rec, 1); await o.sleep(300);

    o.send("/live/clip_slot/create_clip", dev, 0, 8.0); await o.sleep(400);
    for (const [beat, keys] of CASES) for (const pitch of keys) o.send("/live/clip/add/notes", dev, 0, pitch, beat, 0.75, 100, false);
    await o.sleep(400);

    o.send("/live/clip_slot/fire", rec, 0);
    o.send("/live/clip_slot/fire", dev, 0);
    // Follow the song position, not the clock: a count-in can delay the start.
    for (;;) {
      const [t] = await o.query("/live/song/get/current_song_time");
      if (t >= 7.6) break;
      await o.sleep(25);
    }
    o.send("/live/song/stop_playing"); await o.sleep(600);

    const raw = (await o.query("/live/clip/get/notes", rec, 0)).slice(2); // pitch, start, duration, velocity, mute, ...
    const notes = [];
    for (let i = 0; i + 4 < raw.length; i += 5) notes.push({ pitch: raw[i], start: raw[i + 1] });
    const beatMs = 60000 / tempo;
    for (const [beat, keys, want] of CASES) {
      const got = notes.filter((n) => n.start >= beat - 0.05 && n.start < beat + 0.9);
      const pitches = got.map((n) => n.pitch).sort((a, b) => a - b);
      const ok = pitches.join(" ") === want.join(" ");
      if (!ok) failed++;
      const late = got.map((n) => (n.start - beat) * beatMs);
      console.log(`${ok ? "ok  " : "FAIL"} keys [${keys.join(" ")}] -> [${pitches.join(" ")}]${ok ? "" : ` want [${want.join(" ")}]`}` + (late.length ? `  ${Math.min(...late).toFixed(0)}-${Math.max(...late).toFixed(0)} ms after the key` : ""));
    }
  } finally {
    const [now] = await o.query("/live/song/get/num_tracks");
    for (let t = now - 1; t >= before; t--) { o.send("/live/song/delete_track", t); await o.sleep(400); }
    o.send("/live/view/set/selected_track", wasSelected); await o.sleep(300);
    o.close();
  }
  if (failed) throw new Error(`${failed} of ${CASES.length} cases failed`);
  console.log("ok");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
