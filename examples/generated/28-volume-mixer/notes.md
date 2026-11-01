# Volume mixer: eval notes (run 28-1)

Final document: `mixer.json` (calls three inline components: MixerSlider, MuteButton, MixerRow). The last convert wrote `mixer.rc`, and later renders report about 10.3 KB. Renders are under `out/`, and the sheets are `final-sheet.png`, `states1-sheet.png`, `widget-sheet.png`, `variants2-sheet.png`, `tablet2.png`.

## 1. Tool calls, in order (23 total)
1. `list`: to learn the servers and tools. I took the 5-step workflow (build_kit, then components, convert/render/audit, then publish) and decided to follow it.
2. `build_kit` with the request verbatim, to get components and examples. It gave Slider, IconButton and Icon; the rules "Taps reach the app" and "Switch content by state"; and the key Slider doc: "the app does not receive the scrub — send it with a hostNamedAction on the control that confirms it". It also gave noise (see section 3). I decided to write my own slider so I could add the muted look and an onClick.
3. `get Slider definition:true`: to copy its structure (componentValue POS_ROOT_X, touchExpression mode 6, semantics overlay). I based MixerSlider on it, with a muted colour switched by `conditionalOperations` and `defaultValue` set to the exported level.
4. `find` "slider value sent to the app host on drag release": to look for a way to send a drag to the app. It found nothing new (CMP-03, TIM-13, HST-02, INT-04), so I accepted the limitation.
5. `reference format`: for the syntax of actions, visibility and host variables. Takeaways: hostNamedAction's value is a literal string only; visibility needs a declared 0/1 variable; `fillMaxWidth: "@fraction"` exists. I chose exported `*_level` and `*_muted`, plus `*_on = 1 - muted` for visibility.
6. `convert` (check): **failed** with "Unknown token in expression: @master_drag — declared as a tree variable after the expression that reads it". My onClick was a modifier on the canvas, and modifiers come before the canvas's touchExpression. I moved the onClick to the semantics overlay box that follows the canvas.
7. `convert` (check): ok, 10,181 B. 12 click targets, 8 host variables. It also reported info "content ends at 45% of the screen". I accepted that (a mixer is short) but made the rows a little taller.
8. `render variants:true`: light, dark, mono, mono-inverted, narrow, wide, short, small, tiny. All looked right. There was no 4x2 size among the variants.
9. `describe inspect`: to get the `actions` syntax for interact (`{tap:[x,y]}`, `{drag:[x0,y0,x1,y1],steps}`).
10. `inspect interact`, tap on the music mute button. Only music_muted went 0→1, host action `muteMusic`, and the two faces swapped visibility. Correct.
11. `inspect interact`, drag on the music slider. music_drag went 65→78.6. **No host variable changed and no host action was sent**, so a drag does not reach the app.
12. `inspect interact`, drag then tap on the slider. The tap fires the overlay's onClick: music_level became 78.6 and `setMusicLevel` was sent.
13. `inspect interact`, a single tap on the voice track. voice_level became 19 (the value under the finger) and `setVoiceLevel` was sent. So a tap on the track reaches the app; a drag does not.
14. `render samples` at 360×320: all on, effects muted, master muted, levels 0/100. All correct. The muted grey (`@colors.disabled`) was too faint, so I switched to `@colors.muted`.
15. `render` 320×160 (4x2) with samples. The rows compact to 34 dp and the header hides (it is shown only when windowHeight ≥ 240). Good.
16. `render variants` with effects muted. Fine in light, dark, mono and mono-inverted. At the tiny 180-wide size the slider collapses to a dot (accepted, noted below).
17. `render` 1024×768 tablet: the sliders stretched to about 830 dp, which looked poor. I capped the column with `fillMaxWidth: "@frac"`, where `frac = min(1, 600/(windowWidth()-24))`.
18. `render` tablet again: centred at 600 dp. Good.
19. `audit`: no warnings. Info: "Touch Target < 48dp ×4" (the 40 dp mute buttons), and never-executed actions (expected). I raised the button to `min(48, rowH-2)`.
20. `inspect accessibility`: the sliders read "Music volume", state "65 percent". The mute buttons read "Mute music, sound on" or "Unmute voice, muted". Good.
21. `inspect interact` sequence: master mute, then music mute and unmute, then an effects drag. Result: master_muted=1 (all three channels dim), music back to 0, host actions muteMaster/muteMusic/unmuteMusic, effects_drag 40→100 clamped, effects_level unchanged.
22. `render samples` at 360×640, dark: final check of the four states with the 48 dp buttons.
23. `render` 320×160 with componentTheme mono-inverted and master muted: the widget in e-ink. Fine.

## 2. Dead ends and wasted calls
- **Call 6 (failed convert).** I put onClick on the slider canvas, where it reads the touch variable before the touchExpression declares it. The Slider pitfall talks about *reading* the value after the slider in document order, but nothing says that a canvas's modifiers are "before" its own commands. One line in the format reference would have avoided it: "a canvas's modifiers are written before its commands".
- **Calls 11–13 (partial).** It took three interacts to learn that onClick fires on a tap but not at the end of a drag. The Slider doc never says this, and it is the key fact for "does a drag reach the app". The tools should state it.
- **Call 9** was needed only because the interact `actions` syntax is not in the `list` summary.
- Dead ends: 1 hard (call 6) plus 1 partial (calls 11–13).

## 3. Wrong, misleading, noisy or missing output
- **build_kit noise.** "effect" resolved to `capability:draw.shader`, so the kit included **DRW-14 "AGSL plasma shader"** with a full AGSL program. That is irrelevant to an audio "effects" channel.
- **build_kit.** "master", "music" and "mixer" were listed as `unmatched_terms`. A11Y-01 was offered because "voice" matched: `"about": "the goal's subject: voice, button"`.
- **Slider `value` doc.** It reads "omitted, the slider keeps its own The drag writes…" (a broken sentence). It says to "send it with a hostNamedAction on the control that confirms it, or let the app read the value it needs another way", but there is no "other way" for a drag: the touch variable is not exported, and hostNamedAction's value is literal only. The plain fact should be stated: **a drag cannot reach the app; only a tap (onClick) can.** The doc names no "confirm" pattern.
- **Slider pitfalls.** They mention player bug-fix dates and ticket ids ("T31-T33 / C49-C50 fixes (2026-10-30)"). That is noise for a new user.
- **Rule "Taps reach the app".** It says to use exported state plus hostNamedAction. This is right for taps, but it is silent on sliders, which are the main control here.
- **render variants.** The workflow says to check a 4x2 widget at 320×160, but the variants have no 4x2 size: "short" is 360×384. I had to render it separately.
- **convert check.** "content ends at 45%… add what the screen is for (history, details, actions)" pushes padding content onto a screen that is short by nature.
- **audit `never_executed`.** It lists 36 click-action ops as "never executed in 30 frames". That is expected for click handlers and is noisy.
- **inspect interact output.** `changed_variables` includes unnamed, unclamped intermediate touch expressions (e.g. -52.38→142.86) for *every* slider on any tap. It looks like every slider changed, though only the named `*_drag` values matter.
- **IconButton.** It is a fixed 40 dp face with no size parameter, so it cannot fit a 4x2 widget with 4 rows (160 dp). I wrote my own MuteButton instead. No tool warned that four 40 dp rows overflow a 4x2 widget.

## 4. What I would have liked
- A Slider param such as `onRelease` / `onChange` (actions run when the finger lifts), or an `exportTo` variable, so a drag reaches the app. Failing that, a clear "not possible" statement.
- A library MuteButton/ToggleIconButton with two icons and a state, or IconButton with `size` and a runtime `selected`.
- A Slider `enabled`/`muted` runtime param for a dimmed look.
- `render variants` including the widget sizes (4x2, 4x1, 2x2) and a tablet size.
- The interact `actions` syntax shown in the tool summary.
- stateDescription that can switch text by state (e.g. "65 percent, muted"); I could not find how to do it.

## 5. Assessment of the final screen
- **Correctness.** There are four rows: Master (on a surface card, bold), Music, Voice and Effects. Each row has a label, a 0–100 slider, the live number and a round mute button. Sample values: master 80, music 65, voice 90, effects 40, none muted.
- **Master.** It is *clearly the overall control*, not a visual scaler of the other sliders. It sits in its own card at the top with an explanatory line. Muting master greys every channel slider (`dim = max(own, master)`), while each channel keeps its own mute state and level.
- **Mute.** Unmuted shows a speaker icon on a surfaceHigh disc; muted shows a crossed speaker on an error-red disc, and the slider's active part and thumb turn grey. Levels are untouched, so unmute restores them.
- **Interactions, verified with interact.** A mute tap flips only its channel, sets the exported `*_muted` and sends `mute<Ch>` / `unmute<Ch>`. A drag moves only its slider, clamped at 0–100.
- **What reaches the app:**
  - Mute taps: yes (exported variable plus host action).
  - A *tap* on a slider track: yes. It copies the value into the exported `*_level` and sends `set<Ch>Level`.
  - A *drag*: **no**. The value lives in the slider's own touch variable; onClick does not fire after a drag, and hostNamedAction cannot carry a value. A drag reaches the app only if the user then taps the track (which moves the value to the tap point).
  - If the app sets `*_level` after load, the slider does not follow: the touch variable copied it only at start. I did not verify this.
- **Host variables.** `master_level`, `music_level`, `voice_level`, `effects_level`, and `master_muted`, `music_muted`, `voice_muted`, `effects_muted`, all exported.
- **Sizes.**
  - Phone 360×640: fine, but the bottom half is empty.
  - 4x2 widget at 320×160: the header hides and the rows compact to 34 dp with 32 dp buttons, below 48 dp.
  - Tablet: the column is capped at 600 dp and centred.
  - At 180 dp wide the slider collapses to a dot.
- **Themes and mono.** Light, dark, mono and mono-inverted all render correctly. In mono the master card background disappears and the unmuted buttons show only their icon.
- **Accessibility.** Each slider reads "<Channel> volume", state "<n> percent" (live). Each mute button reads "Mute <ch>, sound on" or "Unmute <ch>, muted".
  - A slider does not announce its muted state.
  - A channel silenced by master still announces "sound on".
  - Sliders have no adjust actions, so a screen reader cannot step them.
  - The slider overlay is now marked clickable, a side effect of the onClick.
- **Bytes.** About 10.3 KB. Material icon paths are stored once.
- **Weak spots.** The drag does not reach the app (the format allows only the tap). The muted slider greys are subtle in mono-inverted. The empty space on the phone. No tablet-specific layout beyond the width cap.
