# Settings screen: notes

Deliverable: `settings.json` (RemoteCompose JSON, inline components), `settings.rc` (21,706 bytes, from the last convert/render).
Renders are in `out/`: `light-tall.png`, `variants-*.png` (dark, light, mono, mono-inverted, narrow, wide, short, small, tiny), `after-taps.png` (light, after scripted taps and a drag), `tablet-dark.png` (900x700). `sheet1.png` and `sheet2.png` are contact sheets I put together myself with PIL.
Raw tool outputs are saved as `*.txt` beside this file. `c.sh` is a two-line wrapper around `mcp-cli.mjs call remotecompose`. I wrote it because zsh would not word-split `$C`, so my first attempt never reached the tool.

## 1. Tool calls in order (30 in total)

1. `list`: what tools exist. It says to start with build_kit. → Followed the 5-step workflow it gives.
2. `build_kit` (the request verbatim): returned Slider, Switch and Icon, examples INT-02, INT-04 and CMP-12, design rules ("Taps reach the app": exported variable + hostNamedAction, own name per control), `unmatched_terms: ["account"]`, `not_covered: ["theme.mode"]`. → Use Switch and Slider. I would have to find a theme choice and the account rows myself.
3. `find kind components`: wanted the whole library. It returned only 10 components, with no sign the list was cut. → Dead end (see §2).
4. `find kind components limit 60`: the full list of 35. Spotted Tabs, ListItem, KeyValueRow, TextChoice, Divider and Avatar.
5. `get Tabs`: considered it for the theme choice. Its params say nothing about a selected state for screen readers, and a tab bar is the wrong pattern for a setting. → Not used. I wrote radio rows instead.
6. `get ListItem`: title/subtitle are strings, it has leading/trailing slots, chevron, onClick. → Use it for the account rows.
7. `reference format`: syntax for host strings (a root-level `variable` command with vtype string), verticalScroll, semantics, textMerge/textFromFloat, visibility rules. Very useful.
8. `reference components`: inline component syntax (params, locals, `$slot`, `$if`). The guide says nothing about semantics roles or state.
9. `get Switch definition`: its semantics are `contentDescription @label, clickable` only, with **no on/off state**. → I added a visible "On"/"Off" TextChoice under each title so the state is read out.
10. `get Slider definition`: semantics are the label only, with **no value**. The drag writes the slider's own variable, so the exported resource variable is **not** updated. → I planned a live "%" text after the slider plus a commit action.
11. `convert check:true`: converted OK (21.6 KB), lists the host variables. Raised a `shared_action_name` warning on "@action" (a false positive, see §3).
12. `inspect interactions`: 10 click targets, each hostNamedAction with its own text id, so the action names are distinct.
13. `render light 360x1000`: looked good. "On"/"Off" was too loud. → Made it muted at 13 sp (TextChoice params from call 15).
14. `describe inspect`: the shape of `interact` actions (`target`, `tap`, `drag`, `wait`, `variables`).
15. `get TextChoice`: it takes fontSize and color.
16. `interact` tap target 0 (Push): push 1→0, host action `pushChanged`, no other host variable changed. ✔
17. `interact` tap target 6 (Dark): theme 2→1, `themeDark` sent, System's selected canvas hidden, Dark's shown. ✔
18. `interact` drag the slider: the slider's own `brightness` went 70→7.1, but **no host variable changed and no action was sent**. My wrapping box's onClick did not fire, and it would have read the stale variable anyway because it comes before the slider in document order. → Dead end.
19. `interact` drag after moving the click into an overlay box placed *after* the slider: the drag still sends nothing (a drag is not a click in the TS inspector).
20. `interact` tap on the slider: the value jumps to 92, `brightnessOut` (exported) = 92, `brightnessChanged` is sent. ✔ (for taps)
21. `find examples` "slider release / touch up / send value to host": nothing relevant, so there is no on-release action. → Accepted the gap and documented it.
22. `inspect accessibility`: all labels present. Revealed that my overlay box (`fillMaxSize` inside a weighted box) was laid out **999,999,572 dp tall**, which pushed everything below it to y≈1e9 in the inspector. The C++ render had not shown this.
23. `audit`: the same issue, reported as "Zero Dimensions ×40" (it did not name the real cause, the infinite height). It also flagged an unlabeled clickable (the overlay) and the touch-target info.
24. `audit` after the fix (overlay set to fillMaxWidth, height 40, with semantics "Brightness N percent", clickable): 0 errors. One warning left, the false-positive shared_action_name. Info: switches are 52x32 (< 48 dp).
25. `render variants:true`: dark, light, mono, mono-inverted, narrow, wide, short, small and tiny all came back with "findings: none" except tiny (180 wide: titles squeezed, "On"/"Off" clipped). Also saw that in dark the unselected radio ring (`@colors.outline`) was nearly invisible. → Switched it to `@colors.muted`.
26. `describe render`: touch_events schema (t, type down/move/up/tap, x, y).
27. `render` light with touch_events (tap Sounds, tap Dark, drag the slider 200→110). Result: Sounds On, Dark selected, the others cleared, slider at 29%. The C++ log says "up … click hit" for the drag release, so on this player the overlay *does* commit on release. That disagrees with the TS inspector in call 19.
28. `render dark 900x700` (tablet): content is centred and capped at 600 dp. ✔
29. `interact`: tapped Email, Sounds and Weekly, scrolled with a drag, tapped Change password and Sign out. Result: 3 host variables flipped, actions `emailChanged`, `soundsChanged`, `weeklyChanged`, `changePassword`, `signOut`; scroll 0→150.6 and the scrolled targets still hit. ✔
30. `inspect bytes`: 21.7 KB total. 48.7% is the 11 icon paths (10.5 KB).

## 2. Dead ends and wasted calls (5)

- **Call 3**: `find kind components` with no limit silently returned 10 of 35. Nothing said "10 of 35" or "more available". The rc-examples description says "With no arguments, lists every component", and I took that at face value. A `total` field would have avoided this.
- **Call 5** (get Tabs): I went to Tabs only because no segmented control or radio group exists, and none was suggested. If build_kit had mapped "theme choice" (one of N) to a recipe, the call would not have been needed.
- **Calls 18–19**: trying to make a slider *drag* reach the app. The Slider param doc does warn that the exported variable is not updated ("send it with a hostNamedAction on the control that confirms it"). It does not say that a click modifier placed before the slider reads the stale value, or that no release/drag-end action exists.
- **Call 21**: a search for an on-release action. Nothing exists. A plain "there is no drag-end event" line in the Slider pitfalls would have saved it.
- **The `fillMaxSize` overlay** (found in call 22): it cost me a re-audit. The convert check and the render said nothing about a 1e9-dp component. Only the accessibility bounds and the audit's "Zero Dimensions" (a misleading title) showed it.

## 3. Wrong, misleading, noisy or missing in tool output

- **False positive that blocks**: `[shared_action_name] 1 hostNamedAction name(s) used by several controls (@action)`. It fires when an inline component passes a string param into `hostNamedAction.name`. The expanded document has distinct names (pushChanged, themeDark, …), as interact confirms. Every render is still headed "NOT DONE YET: this document has design problems to fix before it is shown or published", and publish would presumably refuse it. The lint checks the unexpanded JSON.
- **Switch has no state semantics**: its definition carries only `contentDescription @label`. A screen reader hears "Push notifications", never on/off. Nothing in the Switch pitfalls or the build_kit design rules mentions this. `inspect accessibility` shows `state: null` for every node, with no warning that a toggle has no state.
- **Slider has no value semantics**, and the drag never reaches the exported variable (documented, but only inside the param doc for `value`, which also has a typo: "omitted, the slider keeps its own The drag writes…"). build_kit's rule "Taps reach the app … check every tap with inspect interact" has no slider-specific recipe.
- **Players disagree on drag release**: the C++ render reports "up … click hit" after a drag on the overlay, so the commit fires. The TS `interact` drag fires no click. A user cannot know which behaviour a device will have.
- **Audit "Zero Dimensions ×40"** when the real problem is a 999,999,572-dp-tall box. The bounds show it, but the finding names the wrong symptom. `convert check` and `render` reported "findings: none" for the same document.
- **`find` truncation** (see §2) is silent.
- **build_kit** said `not_covered: ["theme.mode"]`, which reads as "theme" meaning light/dark *rendering*, not a user-facing theme picker. It gave no guidance for a single-choice control (radio / segmented). `unmatched_terms: ["account"]` was honest but gave no pointer (ListItem + Avatar would have been the answer).
- **render variants**: "tiny 180×456" produced warnings for a phone settings screen. That is fine, but a phone-screen goal probably does not need widget sizes such as "short 360×456 (a widget resized down)".
- Noise: every render result repeats the full shared_action_name paragraph.

## 4. What I would have liked

- A library **RadioGroup / SegmentedButton** (one of N, with selected state semantics), and a ListItem with a `destructive` / colour option for "Sign out".
- **State semantics** (on/off, selected, value) on Switch, Slider, Tabs and Chip, plus an audit rule "toggle without state description".
- A Slider `onChange` / `onRelease` action param that also writes an exported variable, or at least one documented pattern for "a slider whose value reaches the app".
- Lints that run on the expanded document (no false shared_action_name).
- `find` results with `total` / `truncated`.
- An audit finding that names "unbounded height (fillMaxSize in a weighted / scroll parent)" directly.

## 5. Honest assessment

- **Structure**: a scrolling column (verticalScroll) capped at 600 dp and centred, with a Settings title and three Section cards on `@colors.surface`. It looks right at 360 (phone), 576, 900 (tablet: centred column) and 259 (titles ellipsize). At 180 the toggle titles collapse to nothing, which is acceptable because that is not a phone width.
- **Notifications**: 4 rows (Push, Email updates, Sounds, Weekly summary). Each has an icon, a title, a muted "On"/"Off" line and a library Switch bound to an exported variable (push=1, emailNotif=1, sounds=0, weekly=1), sending its own hostNamedAction. Verified: each tap flips only its own variable and sends its own action.
- **Display**: a Brightness slider (0–100, exported `brightness`=70 as the app's input) with a live "70%" text. Three radio rows, Light / Dark / System, set exported `theme` (0/1/2, sample 2 = System) and send themeLight / themeDark / themeSystem. Verified: selecting Dark deselects System; visuals update in renders.
- **Account**: a ListItem with an account_circle icon and host strings `userName` / `userEmail` (exported string variables, root-level). "Change password" has a chevron and sends `changePassword`. "Sign out" is drawn in `@colors.error` with a logout icon and sends `signOut`. Verified after scrolling.
- **Weak spot 1, the slider and the app**: a drag changes the on-screen value but does not update `brightness`. On a tap, and on drag release in the C++ player only, an overlay after the slider copies the value into exported `brightnessOut` and sends `brightnessChanged`. In the TS inspector a drag sends nothing. So the app reads `brightnessOut`, not `brightness`: two variables for one value. This is awkward, but it follows the tool's own advice.
- **Accessibility**: every control is labelled. Switch state is announced only through the adjacent "On"/"Off" text, not on the switch node itself. The theme state is a separate "selected" / "not selected" node next to "Dark theme" (the hidden alternative is not exposed). The slider value is on the overlay node ("Brightness 70 percent", live), while the slider canvas itself only says "Brightness". Section headers carry "… section". The switches are 52x32 dp (below 48 dp; library component).
- **Themes / mono**: theme colours only. Light, dark, mono and mono-inverted all render cleanly. In mono the cards lose their surface fill (by design), and the dividers and section structure carry the grouping.
- **Size**: 21.7 KB, about half of it the 11 Material icon paths. Repeated rows are inline components (SettingToggle, ThemeOption, Section).
- **Not resolved**: the false shared_action_name warning (I did not work around it). I did not run publish, so I do not know whether that warning blocks a public page.
