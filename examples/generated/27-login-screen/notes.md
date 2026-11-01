# Login screen — eval 27, run 1

Final document: `login.json` (source, with an inline `FieldDisplay` component) → `login.rc` (8,083 B).
Renders in `out/`: `states-sample1..4.png` (empty, filled, error, remember on — light), `v-*.png` (dark, light,
mono, mono-inverted, narrow, wide, short, small, tiny; filled + error + remember), `tablet-dark.png` (800×1280),
`empty-light.png` (first look, before vertical centring). Tool outputs saved as `*.txt` next to them.

## What the format can and cannot do for text entry (from the tools)
- **The tools never say it directly.** No tool output mentions keyboards, text input, text fields or an IME.
  `build_kit` lists "field", "password", "email", "login" as `unmatched_terms`; `find kind components "text field"`
  returns Avatar, KeyValueRow and DigitalClock. `reference expressions`: "a text cannot be read as a number".
  So I concluded: **RemoteCompose cannot take keyboard input itself.** No text-field component, no way to
  read a string's length or emptiness in an expression, no string ops on layout text except textMerge/textFromFloat.
- What I did, which is the pattern the task suggested (the tools don't recommend one):
  - Fields are **read-only displays the app fills**: host strings `email` and `passwordMasked`, exported
    (`root` `variable` with `vtype: string`, from `reference format` / HST-01).
  - **Tapping a field sends `hostNamedAction` `editEmail` / `editPassword`** so the app opens its own input.
  - **The password is masked by the app**: it sends `passwordMasked` (bullets) and never the plain text. The
    document can't mask a string itself (no string-replace / repeat op is documented).
  - **Emptiness comes from host floats** `emailLength` / `passwordLength`, because a string can't be read as a
    number. `emailFilled = min(1, @emailLength)` etc. drive the placeholder vs value and the sign-in button.
    Weak spot: the app has to keep a string and its length in step.
  - **Error**: host string `errorMessage` (default "Wrong password") shown when the host float `showError` = 1.

## 1. Tool calls, in order (27 MCP calls; plain `list`/`describe` counted)
1. `list` — the servers and tools. Took the 5-step workflow; decided to use only `remotecompose`.
2. `build_kit` (goal verbatim) — Button, Checkbox and Icon components, CMP-12 as the layout model, EXP-02 (a math reference, irrelevant: "sign" in "sign-in" matched `expr.math`). Design rules: hostNamedAction per control, theme colours, switching state by visibility. Nothing on text entry. I decided to look for that.
3. `find examples "text field input keyboard host string password"` — EXP-15, HST-07, HST-05, TIM-14, LAY-07. None is about input. The TIM-14 pitfall about visibility-switched buttons and stale tap bounds was useful.
4. `find kind terms` (text field, keyboard, password, …) — field/keyboard/password/email/login/masked all unmatched. That confirmed there is no input vocabulary.
5. `reference format` — the host-strings syntax (root `variable` vtype string, export), visibility rules (a declared 0/1 variable), semantics, textMerge, verticalScroll. This was the key document.
6. `reference expressions` — "a text cannot be read as a number", so I chose to get the lengths from host floats.
7. `find kind components "text field input"` — Avatar/KeyValueRow/DigitalClock. A dead end (see 2).
8. `get HST-01` — a complete example with exported strings and maxLines + ellipsis for host strings. I copied that pattern.
9. `reference components` — the authoring guide (params, locals, `$if`, mono rules, ring = background + padding + clip). I wrote the `FieldDisplay` inline component from it.
10. `convert` (check) — error: "Button: unknown parameter 'modifiers' … wrap the call in a box". A clear message. I wrapped it.
11. `convert` (check) — OK, 7,953 B. Two design warnings: `shared_action_name` (editEmail) and `shared_string_value` (email and passwordMasked both ""). I fixed the second with distinct defaults and suspected pattern mode for the first.
12. `convert` (check) with `componentMode: expand` — the shared_action_name warning was still there. A dead end (see 2).
13. `inspect interactions` — the two fields have distinct action text ids, so the warning looked like a false positive.
14. `render` light — looks right. The warning still prints "NOT DONE YET".
15. `describe inspect` — the `actions` syntax for interact (`target`, `tap`, `variables`, `wait`).
16. `inspect interact` — a tap on the disabled button was unhandled. editEmail, editPassword and rememberMe reached the app and `remember` went 0→1. After the host set the four values, the sign-in tap sent `signIn`.
17. `inspect interact` — fill, then clear the email, then tap the button: no signIn, so the stale-bounds trap from TIM-14 did not bite (in the TS inspector). Two checkbox taps took remember 0→1→0, with rememberMe sent each time.
18. `describe render` — the `samples` and `variants` options.
19. `render samples` ×4 — empty, filled, error, remember on. All four are right.
20. `render variants` — dark, mono and mono-inverted are right. Short and tiny cut off below the fold; the page scrolls, and no findings were reported.
21. `render` 800×1280 dark — tablet: the form is capped at 420 dp and centred.
22. `audit` — 0 errors and 0 warnings. Info: the Checkbox row is 40 dp tall (< 48 dp), and some ops are never executed (the click actions).
23. `inspect accessibility` (filled) — fields worked. I found a bug of my own: when empty, the description would read the placeholder host default ("Email, name@example.com").
24. `inspect accessibility` (empty, after the rework) — the field row is "Email"/"Password", clickable. The inner text says "Empty, you@example.com" or the value / "9 characters, hidden". The checkbox reports "Not checked". Sign in: clickable false, enabled false.
25. `inspect interact` — the same taps re-run after vertical centring. All four actions arrive, and the disabled tap is unhandled.
26. `render variants` — rechecked after centring. All fine.
27. `convert` (check) — final: 8,083 B and no design warnings. The shared_action_name warning disappeared once I removed `onClick` from the inline component's `call` example, so the lint was reading the example.

## 2. Dead ends and wasted calls
- **#7 find components "text field"**: I hoped for a TextField. It returned unrelated components ranked by the word "input". The results list doesn't say "nothing matched; no text input component exists".
- **#12 componentMode expand**: I guessed that the `shared_action_name` warning came from pattern mode. It actually came from my component definition's `call` example (`"onClick": {"name": "editEmail"}`), which the lint counts as a second control. Telling me *where* the second use was would have saved this call and #13.
- **#13 inspect interactions**: a diagnostic, needed only because of that false positive.
- (Small) **#4 find terms**: it only confirmed what build_kit's `unmatched_terms` already said.

## 3. What was wrong, misleading, noisy or missing
- **Text entry isn't covered anywhere.** Not in `build_kit`'s `design`, not in `reference format`, and nowhere in the vocabulary. A login form is a common request, but the kit answers with Button/Checkbox plus **EXP-02 "Math function reference"** because "sign" matched `expr.math` ("term": "sign", "ids": ["capability:expr.math"]). That is noise, and it hides the real gap. `not_covered` is `[]`, which suggests the kit covers everything.
- **False positive `shared_action_name`**: "1 hostNamedAction name(s) used by several controls (editEmail)". There was only one control with that name; the second was the inline component's `call` example. `render` then prefixes its output with "NOT DONE YET: this document has design problems to fix before it is shown or published."
- **`shared_string_value`** is right but awkward for input fields: empty is the natural default for both fields, and the tool forces fake sample defaults (`name@example.com`, `••••••••`). It also says `"42", "42 " is not enough` without explaining why. Those defaults then leak into accessibility unless the lengths gate them.
- **Button `enabled` is static**, and the kit doesn't say how to make a button that enables from a variable. I had to infer two stacked Buttons switched by visibility. TIM-14 warns *against* exactly that (stale bounds in the TS player). It worked here, but the guidance conflicts and offers no supported pattern for "enabled when X".
- **Button can't fill the width** (it wraps its label), so a full-width primary CTA, the usual one on a login screen, isn't possible with the library Button.
- **`unused_space` info** ("Let the main element grow … add what the screen is for (history, details, actions)") is chart/dashboard advice. On a login form it is noise. Vertical centring silenced it.
- **The `variants` "wide" size is 576×570**, which is not a tablet. I had to render the tablet separately.
- **`variants` short/tiny reported "findings: none"** while the Sign in button was cut off at the bottom. The page scrolls, so this is acceptable, but a "content continues below the fold (scrolls)" note would help.
- The Checkbox's 40 dp row is flagged by the audit as < 48 dp, yet it is the library's own component.
- Accessibility roles show as `255` (none). The Checkbox pitfall admits "No role: the JSON semantics has no role key". The fields and the button have no role either.

## 4. What I would have liked
- An explicit **"text input" entry** in `reference format` / `build_kit` design rules: "the format has no text input; a field is a host string the app fills, the tap is a hostNamedAction, mask in the app, pass emptiness as a float". Ideally a library **TextField display component** (label, placeholder, value, filled flag, onClick) and a catalog example of a login form.
- A way to test a host string for emptiness inside the document (a `textLength()` or similar), so the app doesn't have to send lengths.
- A Button whose `enabled` can be a variable, plus a `fillMaxWidth` / `fill` param.
- Lint warnings that name the location (JSON pointer) of each occurrence.
- A `tablet` size in render `variants`.

## 5. Honest assessment of the final screen
- **Content**: a login icon, the title "Sign in", a subtitle, Email and Password fields (label above an outlined field with a mail/lock icon, a muted placeholder while empty, the app's text when filled; the password shows the bullets the app sends), an error row (error icon + `errorMessage` in the error colour) under the fields, a Remember me Checkbox, and a Sign in button.
- **Interactions** (verified with inspect interact):
  - A tap on a field → `editEmail` / `editPassword`.
  - The checkbox flips `remember` (exported) 0↔1 and sends `rememberMe`.
  - Sign in is disabled-looking and unclickable until `emailLength` and `passwordLength` are both > 0, then sends `signIn`.
  - Clearing a field after filling it disables the button again.
- **Host variables**: strings `email`, `passwordMasked`, `errorMessage`; floats `emailLength`, `passwordLength`, `showError`, `remember`.
- **Sizes**:
  - Phone 360×760: centred vertically.
  - Narrow (259) and tiny (180): fine, with the email ellipsized.
  - Short heights: scrolls (`verticalScroll`).
  - Tablet 800×1280: form capped at 420 dp and centred.
- **Themes**: light and dark follow the system theme. Mono and mono-inverted look right: fields become rings, the checked box is a tick, the error relies on the icon plus text (no colour in mono).
- **Accessibility**: header description set. Each field row is labelled "Email"/"Password" and clickable, and its inner text reads "Empty, <placeholder>" or the email / "N characters, hidden". The checkbox is labelled with a Checked/Not checked state. Sign in is reported as not clickable and not enabled when disabled.
- **Byte size**: 8,083 B.
- **Known weak spots**:
  - Typing is all host-side.
  - The lengths can disagree with the strings.
  - The error is not announced (no live region).
  - The button is not full-width.
  - Two Sign in buttons are stacked by visibility (TS stale-bounds risk per TIM-14, not seen in tests).
  - No accessibility roles.
  - The checkbox touch target is 40 dp.
  - The field border doesn't turn red on error.
  - Placeholder defaults (`name@example.com`) are needed only to dodge `shared_string_value`.
  - Verified only in the TS inspector and the renderer, not on Android.
