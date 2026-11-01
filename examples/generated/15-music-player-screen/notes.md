# Music player screen — eval notes (prompt 15, run 1)

Request: "A music player screen: album art placeholder, title and artist, progress you can scrub,
play/pause, previous/next, shuffle and repeat."

Deliverables in this folder: `player.json` (source, final), `player.rc` (9,989 B), `player.html`
(published playground), `out/*.png` (renders), `*.txt` (every tool output I relied on),
`player.v3.json` (the version before the 480 dp width cap).

## 1. Tool calls in order (38, plus the initial `list`)

| # | tool | for | what I took / decided |
|---|---|---|---|
| 0 | `list` | tool catalog | Workflow says start with build_kit. Only `remotecompose` used. |
| 1 | build_kit (goal verbatim) | components + examples | Got Button, Skeleton, Slider, Icon; examples ANM-08, CMP-05, HST-07; icon suggestions for shuffle/repeat (`shuffle`, `shuffle_on`, `repeat`, `event_repeat`). "shuffle", "repeat" reported as unmatched terms. No IconButton, no media-player example with host variables. Decided to search for an icon button myself. |
| 2 | reference format | JSON essentials | Host strings = root `variable` command with vtype string + export; numbers = resources.variables with export; visibility needs a declared 0/1 variable; textMerge/textFromFloat flags; semantics modifier; `width`/`height` take expressions. |
| 3 | reference expressions | time maths | floor, %, step, ifElse(cond last). Enough for h:mm:ss. |
| 4 | reference components | authoring guide | Inline `components`, `$if theme.mono`, mono rules (outline ring instead of a fill), tree `variable` nodes allowed among children. Used later for ArtPlaceholder. |
| 5 | find components "icon button toggle" | icon buttons | Found **IconButton** (40 dp round, label, slot icon, onClick takes an array of actions). Decided: IconButton for all five controls. |
| 6 | find examples "host named action tap reaches the app" | hostNamedAction syntax | Dead end: no example carries the JSON of a host action (TIM-14, EXP-15, CMP-13 returned, none with it). Guessed `{"type":"hostNamedAction","name":...}` and let convert judge. |
| 7 | find icons "repeat shuffle album music note skip" | icon names | `shuffle`, `shuffle_on`, `repeat`, `repeat_on`, `skip_previous`, `skip_next`, `album` exist. |
| 8 | convert check:true | validate draft | ok, 9,902 B, 8 HostNamedAction ops accepted, host variables listed (artist, duration, playing, position, repeat, shuffle, skip, title). |
| 9 | render variants:true | all looks and sizes | 9 PNGs; only finding: zero-size repeat button at 180 dp "tiny". Mono: art tile invisible (surfaceHigh = black). |
| 10 | audit | problems | info only: 5 touch targets 40 dp (IconButton's fixed face), 22 ops never executed (the hidden states' actions, expected). |
| 11 | inspect accessibility | labels | All controls labelled with state ("Shuffle, off", "Pause"); slider "Track position"; texts readable. |
| 12 | inspect interactions | tap targets | 5 click targets (indices 0..4) + 1 touch target with `bounds: null`. |
| 13 | describe inspect | interact action syntax | `{target}`, `{tap:[x,y]}`, `{drag:[...]}`, `{variables}`; not in any reference text. |
| 14 | inspect interact targets 2,0,4 | play/shuffle/repeat taps | Wrong buttons were hit: target 2 tapped at the *previous* button (skip → -1), target 4 at play/pause. See §3. |
| 15 | inspect interact targets 1,3,3 | prev/next | Same index mismatch (1 hit shuffle, 3 hit play twice). Wasted. |
| 16 | inspect interact drag slider | scrub | Position text follows (1:23 → 3:22) but `changed_host_variables: []`; the slider writes a second variable also named `position` (id 104), not the exported id 70. |
| 17 | render paused/shuffle/repeat/0:00 (light) | states | Play icon, filled shuffle_on / repeat_on, 0:00 all correct. |
| 18 | render position 5025 / duration 7200 / long title | states | 1:23:45 and 2:00:00 correct; long title clipped (text_overflow warning). |
| 19 | inspect variables variable:position | why host not updated | Confirms: host `position` (70) is only read by the TouchExpression as its start value; no path back. |
| 20 | check_component ArtPlaceholder | mono ring tile | No errors; 262 B per extra instance; mono shows an outline ring. |
| 21 | convert check:true | v2 (component, ellipsis, exported `scrubbed` mirror) | ok 9,930 B; `scrubbed` not among host variables. |
| 22 | render variants:true | v2 looks | Mono tile now a ring; ellipsis works; same tiny warning. |
| 23 | inspect interact drag | does host see `scrubbed`? | No: `scrubbed` does not exist at all (alias folded away). |
| 24 | inspect interact taps by coordinates | play, shuffle, repeat, next | All reach the app: playing 1→0, shuffle 0→1, repeat 0→1, skip 0→1. |
| 25 | render long title v2 | ellipsis | "A Very Long Album Side Title…" — fixed. |
| 26 | convert check:true | `scrubbed = @position + 0` | Same byte count: folded again. Wasted. |
| 27 | inspect interact drag | same | still no host variable change. Wasted. |
| 28 | convert check:true | v3 (mirror removed) | ok 9,930 B. |
| 29 | audit | final | info only (touch targets, never-executed hidden-state ops). |
| 30 | inspect accessibility (playing 0, shuffle 1) | state labels | "Play", "Shuffle, on", "Repeat, off" announced as expected. |
| 31 | inspect summary | bytes/runtime | 9,930 B, 42% icon paths; 1 dead orphan variable. |
| 32 | render 800x1280 light | tablet | Fine but slider/controls span the full width. |
| 33 | convert check:true | v4: content column capped at widthIn [0,480] inside a centring box | ok 9,989 B. |
| 34 | render 800x1280 | tablet v4 | Centred 480 dp column. Good. |
| 35 | render variants:true | v4 all looks | Phone unchanged; only the 180 dp tiny warning remains. |
| 36 | inspect interact at 800x1280 (drag + tap) | slider still measures itself when centred | position 83 → 269 (finger near the end), playing toggled. |
| 37 | publish | first page | player.html 636 KB. |
| 38 | publish | final page | player.html regenerated from v4. |

## 2. Dead ends and wasted calls (6)

- **#6 find examples for the host action syntax**: no example shows `hostNamedAction` JSON; the Button
  doc only names it. Avoided by: `reference format` listing the action types with their keys.
- **#14, #15 interact by target index**: the indices from `interactions` do not match what `interact`
  taps when hidden components exist (see §3). Two calls, then repeated by coordinates (#24). Avoided
  by: one consistent numbering, or `interact` printing which labelled component it hit.
- **#21/#23 and #26/#27 exported mirror of the scrub value**: four calls to discover that a
  `variable` whose value is a single `@ref` (or `@ref + 0`) folds to an alias and that `export`
  on it is silently dropped. Avoided by: convert warning "export ignored on an expression
  variable", and the Slider doc saying the host cannot read the dragged value through `value`.
- **#13 describe inspect**: needed only because the interact action syntax appears nowhere in
  `reference` or the tool description.

## 3. Wrong, misleading, noisy or missing in the tools' output

1. **build_kit misreads "placeholder"** as a loading state: `"term": "placeholder" → use_case:loading-state, component:Skeleton`
   and recommends Skeleton, which "repaints every frame while a skeleton is on screen". An album-art
   placeholder is a static tile; a Skeleton on a now-playing screen would burn battery. No
   placeholder/avatar/image-frame component was suggested.
2. **build_kit does not surface IconButton** although "play pause", "previous next" resolve to
   `component:Button`; the Button synonyms even list "play button", "skip button". A media-control
   row is icon buttons; I only found IconButton by `find kind components`.
3. **build_kit's examples are off-goal**: ANM-08 (a stateLayout morph), CMP-05 (a contacts list as
   "layout model"), HST-07 (font scale). None shows host string variables, a host action, or a
   state-switched icon, which is most of this request. `"shuffle"`, `"repeat"` are listed in
   `unmatched_terms` yet `icons.suggestions` resolves them — contradictory.
4. **`interact` target indices disagree with `interactions`.** `interactions` lists 5 visible click
   targets 0..4 ("Feed a target's index … to interact"); `interact {"target": 2}` reported
   `"at": [121.33, 593.52]` — the previous button, which `interactions` calls target 1 — and
   `{"target": 4}` hit play/pause (`interactions` target 2). `interact` evidently numbers hidden
   components too (`hidden_components: 11`). The step echo says `"handled": true` and nothing
   names the component, so the mismatch is only visible by diffing coordinates.
5. **The Slider's exported value is not what the host sees.** The Slider doc: `Bind a document
   variable ("@volume") to preset it and read it after the slider`. True inside the document, but
   the drag writes a *second* variable named `position` (id 104); the exported one (id 70) stays at
   83 and `changed_host_variables` is `[]`. The doc should say the host cannot read a scrub through
   the bound variable, and how a tap/drag can reach the host otherwise (an action on release?).
   `convert`'s "Host-settable variables" list also hides that two variables share the name.
6. **`export: true` silently ignored** on a `variable` command whose value is an expression; the
   expression `@position + 0` is folded to an alias too (no bytes added, no variable, no warning).
7. **The interact action syntax** (`{target}`, `{tap}`, `{drag}`, `{variables}`) is only in the JSON
   schema (`describe`), not in `reference` or the tool description ("run actions: taps, variable
   changes").
8. **`hostNamedAction` JSON is undocumented**: listed as an allowed onClick in the Button/IconButton
   params, but no reference or example shows its keys. `{"type":"hostNamedAction","name":"next"}`
   converted; the disassembly shows `type=-1, valueId=-1`, so I do not know whether a value can be
   attached or what the host receives.
9. **touch target of the slider** in `interactions`: `"bounds": null`, so there is nothing to feed to
   `interact` for a drag; I guessed the thumb's pixel position from the render.
10. **`render variants` "tiny 180×432"** warns zero_size for a phone screen: a 180 dp phone does not
    exist; the warning is noise for a `form_factor: phone` goal. (The "wide" variant at 576 is not a
    tablet either; I had to render 800×1280 myself.)
11. **Audit "never_executed" lists the hidden state's actions** (play when paused, shuffle_on …) as
    "Unreached branches … or dead code" every run; expected for a state switch, so it is noise.
12. **The audit also reports `dead_orphans: 1`** in `summary` without naming it.
13. `reference format` says a `variable` command goes "before the layout"; the components guide
    says a tree variable may sit "among the top container's children". Putting the position
    formatters after the Slider as column children worked — the format reference should say so,
    because the Slider pitfall requires reading the value *after* the slider.
14. Minor: `describe` output and `reference tools` overlap; no text says `IconButton` is fixed at
    40 dp while the audit then flags every one as < 48 dp — the component should offer a `size`.

## 4. What I would have liked

- build_kit to return IconButton + a now-playing example (host strings, play/pause swap, host
  actions) for "music player"; an "ImagePlaceholder"/"ArtTile" component; and to not call a static
  placeholder a Skeleton.
- A one-paragraph "how a tap/drag reaches the host" in `reference format`: the action types with
  their JSON, what the host receives, and that a slider drag is not a host variable write.
- `interact` to name the component it hit (its contentDescription) and to use the same indices as
  `interactions`.
- A `size` param on IconButton (48 dp targets, a 64 dp play button).
- A way to export a derived value (`export` on an expression) or a warning when it is ignored.
- Variants sized for the goal's form factor (phone: 360, 412, tablet 800), not 180 dp.

## 5. Honest assessment of the final screen

- **Correctness**: album-art tile with an album icon, title and artist (host strings, ellipsised),
  a scrubbable Slider, position/duration as m:ss or h:mm:ss (0:00, 1:23, 1:23:45, 2:00:00 verified),
  shuffle / previous / play-pause (filled) / next / repeat as IconButtons.
- **Interactions**: every button verified by tap: playing, shuffle, repeat toggle (icon and label
  swap), previous/next change the exported `skip` counter (-1/+1) and each tap also sends a
  hostNamedAction (`playPause`, `previous`, `next`, `shuffle`, `repeat`). The slider scrubs and the
  position text follows (verified at 360 and 800 wide).
- **Host variables**: title, artist (strings), position, duration, playing, shuffle, repeat, skip
  (floats), all exported. **Weak spot**: the scrubbed value does not reach the exported `position`
  (the slider writes its own variable of the same name); the tools offer no way around it. The app
  will see the taps but not the scrub unless the player resolves the name to the newest variable.
- **Themes**: light and dark from @colors only; no literal colours.
- **Mono / mono-inverted**: verified; the art tile is an outline ring in mono (inline component
  with `$if theme.mono`); shuffle/repeat state shows by icon shape (the `_on` variants), play/pause
  by icon.
- **Accessibility**: document description; "Album art"; "Track position"; "Shuffle, on/off",
  "Repeat, on/off", "Play"/"Pause", "Previous track", "Next track"; title/artist/times are text
  nodes. Weak spots: the slider announces no value (Slider label is a plain string), and the 40 dp
  faces are below the 48 dp recommendation (IconButton has no size param).
- **Size**: 9,989 B (.rc); 42% is the 9 icon paths. HTML playground 636 KB.
- **Sizes**: phone 360×720, narrow 259, short 432, tablet 800×1280 (content capped at 480 dp,
  centred). Below ~220 dp the five buttons no longer fit (repeat gets 0 width) — not a phone size.
- Other weak spots: `repeat` is a 0/1 toggle (no repeat-one mode); `skip` is a counter rather than an
  event; the audit's "never executed" and touch-target infos remain.
