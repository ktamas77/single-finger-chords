# AGENTS.md

Notes for coding agents. Read [README.md](README.md) for what the device does and
[docs/single-finger.md](docs/single-finger.md) for the rules it implements and why.

## What this repo is

One Max for Live MIDI effect, `dist/Single Finger.amxd`, generated entirely from code. Nobody opens
the Max editor. There are no dependencies and no `package.json`; keep it that way.

## Commands

```
node test.js       # run before every commit; also rebuilds dist/
node build.js      # writes dist/Single Finger.amxd
node live-test.js  # end-to-end inside a running Live
```

`live-test.js` needs Live running with the [AbletonOSC](https://github.com/ideoforms/AbletonOSC)
control surface enabled. It adds two temporary MIDI tracks, starts and stops the transport, and
deletes the tracks again. Tell the user before running it against a set they are working in.

## Rules

- **Never hand-edit the `.amxd`.** Change `src/core.js` or `build.js` and rebuild. Commit `dist/`:
  it is the deliverable people download.
- **`src/core.js` stays a plain script.** `build.js` pastes its text into a `v8.codebox`, so no
  `import`, `require` or `export`. The guarded `module.exports` on the last line is the only Node
  hook. No Max globals in it either; everything Max-facing lives in `GLUE` in `build.js`.
- **The engine returns MIDI events, it does not send them, and it owns no timers.** The detect
  window is a Max `delay` object in the patcher that bangs the engine's `flush()`. This is what
  lets `test.js` run the real logic in Node.
- **Every note-on must get a note-off.** The random key-mash at the end of the engine section of
  `test.js` enforces it. A stuck note is the worst bug this device can have.
- **Behaviour changes need doc changes:** the tables in `README.md` and `docs/single-finger.md`.
- Deliberate shortcuts are marked with a `ponytail:` comment naming the ceiling and the way out.

## How the device is built

File layout, copied from Live's own stock `Max MIDI Effect.amxd` (the unfrozen format):

```
"ampf" u32le(4) "mmmm" "meta" u32le(4) 00000000 "ptch" u32le(length) <patcher JSON> "\n\0"
```

`mmmm` marks a MIDI effect (`aaaa` audio effect, `iiii` instrument). Frozen devices use a different
container inside `ptch` (`mx@c` header plus a `dlst` file list). It is not needed here because the
`v8.codebox` carries the code inside the patcher JSON.

The patch:

```
midiin -> midiparse -+- notes ------------> v8.codebox -> midiformat -> midiout
                     +- everything else ----------------> midiformat
v8.codebox outlet 1 -> delay -> v8.codebox inlet 0    (detect window)
v8.codebox outlet 2 -> comment                        (chord name)
six live.* controls -> v8.codebox inlets 1-6          (order = PARAMS in GLUE)
```

To add a parameter: add its name to `PARAMS` in `GLUE`, raise `inlets` and the codebox's
`numinlets`, add a `number()` or `choice()` call, give it a default in `createEngine`'s `opts`,
and add it to both doc tables.

## Looking things up instead of guessing

Max ships inside Live, with machine-readable documentation for every object:

```
/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Max/Max.app/Contents/Resources/C74/
  help/**/<object>.maxhelp               JSON patchers: the exact box JSON for each object
  docs/refpages/**/<object>.maxref.xml   reference text: inlets, outlets, messages
/Applications/Ableton Live 12 Suite.app/Contents/App-Resources/Misc/Max Devices/*.amxd   stock templates
```

Facts in `build.js` that were checked there, not assumed:

- `delay`: a number in the left inlet sets the time and starts it.
- `comment`: `set <text>` changes the displayed text; a `themecolor.live_control_fg` expression on
  `textcolor` follows Live's theme.
- `midiparse` outlets, left to right: notes, poly pressure, controllers, program, aftertouch, pitch
  bend, channel, raw event. `midiformat` inlets 0-6 match the first seven.
- `v8.codebox`: code lives in the box's `code` field with `filename: "none"`; message handlers are
  global functions (`list`, `bang`, `msg_int`, `msg_float`); `inlet` says which inlet fired.
- `live.numbox` / `live.toggle` / `live.menu`: parameter settings sit in
  `saved_attribute_attributes.valueof`. `parameter_type` 1 = int, 2 = enum. `parameter_unitstyle`
  2 shows ms and 8 shows note names (confirmed by the screenshot: F#2, C2, 25.0 ms).

## Things Live does that will trip you up

- `open -a <Live> file.amxd` loads the device onto the **selected track**, but only when Live is
  already running. As a launch argument it is ignored and Live flashes an error.
- New MIDI tracks can arrive with the user's default devices on them. Find the device by name, not
  by index.
- Track names are not unique. `live-test.js` renames its tracks before routing by name.
- Session recording can start with a count-in. Follow the song position, not the clock.
- `screencapture` only sees the current desktop. If Live is on another one, switch to it first.

## Why not a Live Extension or a VST

Extensions (Ableton's Extensions SDK) run once from a right-click menu and have no MIDI input or
event API, so they cannot process notes as they are played. Live loads a MIDI-only VST3 as an audio
effect behind the instrument, which forces a two-track routing workaround. Evidence and links are in
`docs/single-finger.md`.

## Publishing

- The code lives in a private GitHub repo. Do not make it public or publish releases without being asked.
- max4.live lists Max for Live devices. Its submit form needs a sign-in by emailed link, a
  screenshot of the device in Live (`docs/screenshot.png`), a 120 to 4,000 character description
  and a license, and a person reviews every submission. Submit only when the owner asks.
