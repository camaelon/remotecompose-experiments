# Sound: proposed additions to SoundExpression and PlaySound

androidx has one sound type today (`SoundExpression.TYPE_TONE`, "add initial sound api",
5a97aa4c08f): a waveform, a frequency, a duration, and a fixed 100-sample fade at each end.
This adds what UI sounds need. The format stays as it is: same opcodes, same layout, new
type tags in the reserved range 10..40. The TypeScript player implements all of it
(`players/typescript/src/core/operations/SoundOperations.ts`,
`utilities/ToneSynthesizer.ts`), and json2rc writes it (`resources.sounds`, see the MCP guide,
reference topic "format").

Compatibility: today's players ignore an unknown type. `SoundExpression.apply` synthesises
only `TYPE_TONE`, so playing a synth or a sequence on an older player loads nothing and plays
nothing. It does not crash, and the document still renders. Each sound stays within
`MAX_PARAMS` (64).

## 1. PlaySound as a tap action

**Problem.** `RcScope.playSound` is documented as "usable anywhere performHaptic is usable
(action handlers, onClick, etc.)". `ClickModifierOperation.onClick` runs only
`ActionOperation`s, and `PlaySound` is not one, so a `playSound` in an onClick is parsed and
then ignored. `HapticFeedback` has the same gap. The only working trigger today is a canvas
condition, which replays the sound on every frame while it holds.

**Change.** `PlaySound implements ActionOperation`, with
`runAction(context, document, component, x, y) { context.playSound(mSoundExpressionId); }`.
There is no wire change: the operation is written inside the click container as it is
today. `HapticFeedback` could get the same change.

**Also.** `CoreDocument.applyOperations` (the data pass) recurses into containers and applies
every operation, so a `PlaySound` inside a `ConditionalOperations` plays once at load whether
or not its condition holds. The TypeScript player skips `PlaySound` in `ContextMode.DATA`.

## 2. TYPE_SYNTH (11): one enveloped note

`params = [asNan(11), p1 .. pN]`. A param left out (N < 16) takes its default. Any param may
be a NaN-encoded variable, as for the tone.

| # | name | default | meaning |
|---|------|---------|---------|
| 1 | frequency | 440 | Hz |
| 2 | duration | 0.2 | seconds held, before the release |
| 3 | waveform | 0 | 0 sine, 1 square/pulse, 2 sawtooth, 3 triangle, 4 noise |
| 4 | attack | 0.005 | s, linear 0 → 1 |
| 5 | decay | 0 | s, linear 1 → sustain |
| 6 | sustain | 1 | level 0..1 |
| 7 | release | 0.05 | s, linear from the level at note-off to 0 |
| 8 | frequencyEnd | 0 | Hz: exponential glide over the duration; 0 = none |
| 9 | vibratoRate | 0 | Hz |
| 10 | vibratoDepth | 0 | semitones (frequency × 2^(depth/12 · sin 2π·rate·t)) |
| 11 | pulseWidth | 0.5 | square only, 0.01..0.99 |
| 12 | cutoff | 0 | one-pole low-pass, Hz; 0 = off (`y += a(x − y)`, `a = 1 − e^(−2π·fc/sr)`) |
| 13 | fmRatio | 0 | modulator frequency / frequency; 0 = no FM |
| 14 | fmIndex | 0 | phase deviation in radians, × the envelope (bells decay brighter → purer) |
| 15 | echoDelay | 0 | s; 0 = no echo |
| 16 | echoFeedback | 0.4 | 0..0.95; the tail runs until a repeat is under 1% |

Rules:
- **Sustain 0 is percussive.** The note is held for `max(duration, attack + decay)`, so a bell
  or a pluck rings out whatever duration it is given.
- **Phase accumulates** (`phase += f/sr`), so glides and vibrato stay continuous. FM adds
  `fmIndex · env · sin(2π·modPhase) / 2π` to the phase before the waveform. This works for
  every waveform, not only sine.
- **Noise** takes a new value each time the phase completes a cycle, so it is white at
  22050 Hz and pitched below that. The generator is a fixed LCG, so every player writes the
  same samples: `seed = 22222`, then `seed = seed · 1103515245 + 12345 (mod 2^32)`, and the
  value is `(seed >>> 8) / 2^23 − 1`.
- **Volumes and rate.** Unlike the tone, the synth uses them. `leftVolume` and `rightVolume`
  are a gain per channel, and the WAV is stereo when they differ. `rate` is speed: frequencies
  are multiplied by it and times divided by it.
- **Output** is a 16-bit WAV at 22050 Hz, like the tone, at most 30 s long. If the peak goes
  over full scale, the whole sound is scaled down rather than clipped.

## 3. TYPE_SEQUENCE (12): notes of a voice, mixed

`params = [asNan(12), voiceId, then (start s, frequency Hz, duration s, gain) per note]`.

- `voiceId` is a plain float, not NaN-encoded: it is the id of a `TYPE_SYNTH`
  SoundExpression written earlier. Each note is that voice at the note's frequency and
  duration. The voice's glide is applied as a ratio (`frequencyEnd / frequency`), so every note
  glides by the same interval.
- Notes may overlap, which gives chords. They are summed into one buffer, then the voice's
  echo is applied to the mix, then the same scale-down-on-overflow as the synth.
- A frequency ≤ 0 or a gain of 0 is a rest.
- The format allows (64 − 2) / 4 = 15 notes per sound. A longer tune is two sounds.
- When the voice is synthesised again (a variable changed), the sequences using it are
  marked dirty and rebuilt. The TypeScript player finds the voice with `putObject(id)` /
  `getObject(id)`.

## Not done yet

- **Loop and stop**, for alarms, timers and ringing. This needs a loop flag (say, a
  NaN-encoded flag param) and a `STOP_SOUND` operation.
- **Recorded sounds**: `SoundData` (169) already carries SC-format PCM. json2rc could take
  `{"file": "click.wav"}` the way bitmaps do.
- **Volume and rate at play time** (AudioTrack `setVolume` / playback rate) instead of being
  built into the samples. Today a volume slider makes the sound again, which is fine for
  short sounds.
