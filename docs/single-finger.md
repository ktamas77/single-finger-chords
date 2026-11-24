# Single Finger chords: how it works

Yamaha's **Single Finger** (older models: Single Finger Chord) is one fingering mode of its
auto-accompaniment system. You play a root key in the left-hand zone, optionally with one or
two keys to its left, and the instrument plays a full chord. This repo implements it as a
Max for Live MIDI effect, `dist/Single Finger.amxd`.

## The rule

The **root is the highest key held** in the chord zone. The keys to its left pick the chord type
by their colour, not by their pitch:

| Keys held | Chord | Example, root C |
|---|---|---|
| root alone | major | C |
| root + a black key to its left | minor | Bb + C |
| root + a white key to its left | seventh | B + C |
| root + a black and a white key to its left | minor seventh | Bb + B + C |

From the PSR-K1 owner's manual, p. 48 (the YPT-230 manual, p. 19, has the same text):

> To play a major chord: Press the root note of the chord.
> To play a minor chord: Press the root note together with the nearest black key to the left of it.
> To play a seventh chord: Press the root note together with the nearest white key to the left of it.
> To play a minor seventh chord: Press the root note together with the nearest white and black
> keys to the left of it (three keys altogether).

### Which key to the left

The manuals disagree on wording, and this implementation accepts **any** key to the left, which
covers all of them:

| Manual | Wording |
|---|---|
| PSR-K1, YPT-230 | "the **nearest** black key to the left of it" |
| PSR-37, PSR-3500 | "the **first** black key to its left", "the **next** white key to its left" |
| PSS-140 | "**any** black key to the left of it", "**any** white key to its left" |

Extra keys of a colour already present change nothing: A + B + C is still C7.

### The chord zone

The zone is every key **up to and including the split point**. The default split point is MIDI
note 54 (F#2). PSR-K1: "The key range left of the Split Point (default setting: 54 or F#2) is
referred to as the auto accompaniment section." PSR-350: the accompaniment is played with keys
"up to and including the Accompaniment Split Point key", settable from 0 to 127. Keys above the
split pass through untouched, so the right hand plays normally.

Yamaha and Ableton both call MIDI note 60 "C3", so note names in the device match the manuals.

## Behaviour the manuals leave open

These are decisions made for this device. The first two follow from how the instruments behave;
the rest are choices.

- **Chords are detected on key presses only.** Lifting one key of a fingering never changes the
  chord. Without this, releasing Bb + C root-first would leave Bb alone and flash a Bb major.
- **Adding a key while the root is held changes the chord.** PSS-140: "you can for example change
  from a major to a minor chord while pressing the basic note by additionally playing any black
  key to the left."
- **Detect window (default 25 ms).** Fingers never land together. The device waits this long after
  the first key of a fingering before deciding, so Bb + C sounds as one C minor rather than a
  major chord followed by a minor one. It costs that much latency on chords only; set it to 0 for
  none. A tap shorter than the window still sounds.
- **A chord change restrikes every note**, so a piano-like sound gets a full new attack.
- **The chord ends when the last zone key is released**, unless Hold is on. With Hold, the chord
  rings until the next chord, as an arranger's accompaniment does.
- **Velocity** of the chord is the velocity of the root key.

## Output

- **Compact voicing (default):** every chord tone is placed inside one octave starting at `Low`,
  so chords stay in the same register wherever you play them and move smoothly from one to the
  next. With `Low` = C2 (48), G7 comes out as D, F, G, B.
- **Root voicing:** root position, with the root inside the octave starting at `Low`.
- **Bass (default on):** the root, one octave below the chord's register.

## Device parameters

| Parameter | Range | Default | Meaning |
|---|---|---|---|
| Split | C-2 to G8 | F#2 (54) | Highest key of the chord zone |
| Low | C-1 to C6 | C2 (48) | Bottom of the chord's register |
| Detect | 0 to 100 ms | 25 ms | Wait for the other keys of a fingering |
| Voicing | Compact, Root | Compact | See Output |
| Bass | off, on | on | Add the root an octave down |
| Hold | off, on | off | Chord rings until the next one |

The device also shows the current chord name. Pitch bend, controllers, aftertouch and program
changes pass through unchanged.

## Why a Max for Live device

- **Live Extensions cannot do this in real time.** They run once from a right-click menu, read or
  rewrite the Set, and stop. liveextensions.dev: "Need real-time audio, MIDI routing, a native
  device or a control surface? That's still Max for Live." The SDK (1.0.0-beta.1) has no MIDI input
  or event API; the closest it could offer is rewriting a recorded clip.
- **VST3/AU works, but badly in Live.** Developer forum reports agree that Live loads a MIDI-only
  VST3 as an audio effect, after the instrument, so it needs a second track and MIDI routing.
  A plugin is the right choice only for use outside Live.
- **Max for Live** sits in the device chain in front of any instrument and needs no routing.

## Build and test

```
node test.js       # chord rules, voicing, stuck-note checks, then builds and checks the device
node build.js      # writes dist/Single Finger.amxd
node live-test.js  # end-to-end in a running Live (needs AbletonOSC); see AGENTS.md
```

`src/core.js` holds the chord logic and has no Max dependencies. `build.js` embeds it in a
`v8.codebox` inside the patcher, so the device is a single file and needs Max 9 (Live 12 Suite).

## Verified in Live

Checked on 2026-11-24 in Live 12.4.16 Suite (Max 9.1.5, macOS) with `live-test.js`, which plays
fingerings through the device from a clip and records its MIDI output on a second track:

- The device loads, shows its six controls with the right defaults and units, and Live sees them
  as automatable parameters (Split, Low, Detect, Voicing, Bass, Hold).
- C, Bb + C, B + C, Bb + B + C and F + G produce C, Cm, C7, Cm7 and G7 with the bass note; a key
  above the split passes through. All notes of a chord start together.
- The chord display shows the chord name while it sounds.

### Measured timing

At 128 BPM, three runs, measured from the key's position in the clip to the recorded output:

| | Delay |
|---|---|
| Key above the split (pass-through) | about 6 ms |
| Chord, Detect at 25 ms | 36 to 46 ms, so 11 to 21 ms on top of the detect window |
| First chord after loading the device | 46, 58 and 279 ms in the three runs |

The extra delay is the cost of running the logic in Max's JavaScript engine, which is not on the
real-time scheduler. Lowering Detect lowers chord delay by the same amount. The slow first chord
looks like a one-off warm-up; it was not investigated further.

## Not verified

- Feel under a real keyboard. The test drives the device from a clip, not from live playing.
- Chord velocity inside Live. The test set forced every note to velocity 100 before the device,
  so only `test.js` covers velocity.
- Windows. Built and tested on macOS only.
- Electones reportedly sound the chord in the same octave wherever it is played. That came from
  earlier research and the source page blocks fetching; Compact voicing behaves that way anyway.

## Out of scope

Fingered and Multi Finger modes, Casio Chord and other brands' rules, drums or bass patterns.

## Sources

- Yamaha PSR-K1 owner's manual, p. 48: https://manualsonline.com/manuals/mfg/yamaha/psrk1.html?p=48
- Yamaha YPT-230 owner's manual, p. 19: https://www.manualsdir.com/manuals/227506/yamaha-ypt-230.html?page=19
- Yamaha PSS-140 owner's manual, pp. 17-18: https://www.manualsdir.com/manuals/653023/yamaha-pss-140.html?page=17
- Yamaha PSR-37 owner's manual, p. 26: https://www.manualsdir.com/manuals/653351/yamaha-psr-37.html?page=26
- Yamaha PSR-3500 owner's manual, p. 33: https://www.manualsdir.com/manuals/652890/yamaha-psr-3500.html?page=33
- Yamaha PSR-350 owner's manual, p. 45: https://caraudio.manualsonline.com/manuals/mfg/yamaha/psr350.html?p=45
- What Extensions are: https://liveextensions.dev/about/ and https://www.ableton.com/en/blog/introducing-extensions-sdk
- VST3 MIDI plugins in Live: https://forum.juce.com/t/vst3-midi-plugins-wont-load-in-ableton-live/36323
