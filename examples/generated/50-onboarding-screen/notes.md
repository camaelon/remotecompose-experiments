# Onboarding screen: eval notes (prompt 50, run 1)

Final document: `onboarding.json` (also copied to `onboarding-final.json`). `onboarding.rc` is a check build (8,982 B) from before the last edits; the final document converts to about 8,876 B.
Helpers: `gen.py` and `gendoc.py` generate the JSON. `sheet.py` builds contact sheets (sheet*.png).
Renders: v0-* (page 1), v1-* (page 2), v2-* (page 3), every variant. Also swipe1.png, swipeback.png and mid.png.

## 1. Tool calls (31)
1. list: tools overview. I chose remotecompose (build_kit, then convert, render, inspect).
2. build_kit(goal verbatim): it offered Button and PagerDots, INT-06 (a canvas swipe pager) and CMP-05 (the layout model), plus the design rules. I decided on a layout screen, an inline illustration component and PagerDots.
3. get INT-06 json: the touchExpression swipe technique, with page = round(...px...).
4. reference format: visibility needs a declared resources variable, the host-string syntax, actions, stateLayout on the window.
5. reference components: the inline component syntax, $if theme.mono and the unit-box scaling recipe.
6. find (swipe, enter/exit, visibility, host strings): LAY-12, LAY-15 and EXP-15 (visibility animates by about 300 ms).
7. find capabilities input.pager: only INT-06 came back.
8. get ANM-06: the animationSpec enterAnimation/exitAnimation syntax. I chose FADE_IN and FADE_OUT.
9. check_component Illustration with a sweep over plan/sync/secure: all four looks were fine on the first try (1,701 B, 626 B per extra call).
10. convert: error, `@px` was read from resources before the tree declared it. The message was clear.
11. convert (touchExpression and variables as root-level commands): the same error. Root-level commands are not "before" resources.
12. convert (everything in a canvas first in the tree): OK, but with the warning `tree_variable_visibility`.
13. render: the C++ render showed the pages fine despite the warning, and the result was headed "NOT DONE YET". I took the warning at face value and redesigned.
14. convert (onTouchDown/onTouchUp on the canvas reading @px): the same @px ordering error. Modifiers are written before the canvas's commands.
15. convert: "valueFloatExpressionChange: value ... not the number 2; to set a literal use valueFloatChange". A clear fix.
16. convert: OK, no warnings. The design is now: page is an exported resources float, onTouchDown on the content column stores touchX(), and onTouchUp moves page by ±1.
17. describe inspect: the action syntax for interact.
18. interact (tap Next ×3): page 0→2 and the getStarted host action fired. It also showed that step(a, b) means a > b, so my skipVis was inverted. Fixed.
19. interact (drags, while the canvas touchExpression still existed): no change. The covered canvas got no drag.
20. interact (drags with the touchX() handlers): still no page change, and pxStart was set. The inspector seems not to run onTouchUp for a drag.
21. describe render: the touch_events schema.
22. render with a scripted swipe left (C++): page 2 shown. The swipe works in the C++ player. The output said "click miss", which is expected.
23. render variants + 360×640, 834×1194, 844×390 (page 1): too much empty space in portrait, and a full-width 720 dp button in landscape. Fix: the illustration height is min(0.85·W, 0.4·H), the page centres vertically, and the buttons are capped at 440 dp.
24. render variants with page=2: good. Get started shows, Skip is hidden, both mono looks are right.
25. render variants with page=1: good.
26. inspect accessibility (page 2): only the current page is read; the dots say "Page 2 of 3"; Skip and Next are labelled.
27. interact (tap Skip ×2): the second tap fired `skip` again, because an invisible (visibility 2) box still takes taps. Changed it to gone (0).
28. interact: Skip → page 3, the second tap is not handled, Get started sends getStarted.
29. render a mid-transition (tap Next, capture at 0.3 s): page 1 is fading out, so the transition animates.
30. render a swipe right from page 3 (dark): page 2. Swiping back works.
31. audit: only info never_executed.

## 2. Dead ends and wasted calls
- Calls 10–14 and 19 (6 calls): I tried to drive a layout's visibility from a touchExpression. INT-06, the only pager example, is a canvas-only pager whose page lives in the canvas. Nothing said a touchExpression variable cannot feed resources expressions, modifiers or visibility. What would have avoided it: a layout pager example, or a pitfall saying "for a layout pager, use onTouchDown/onTouchUp with touchX() into a resources variable".
- Call 15: I used a literal in valueFloatExpressionChange. The error fixed it at once.
- Call 20: I trusted interact for drags. It does not appear to fire onTouchUp actions (the C++ render did).
- Call 27 was not wasted, but it found a real bug that no tool warned about: an invisible (2) component still takes clicks.
- Calls 17 and 21 (describe): build_kit never shows the inspect or render action schemas. They were needed.

## 3. Wrong, misleading or noisy output
- `tree_variable_visibility` says the component "gets a fresh 0 and the component hides". The C++ render (call 13) showed it visible. It may be true on Android, but the claim does not match the render tool. It should say which player is affected.
- A "NOT DONE YET" header on render when the only issue is a warning: it is alarming, and the render was fine.
- INT-06 is presented as the pager technique for "onboarding", but its approach cannot drive layout visibility. The structure_note says "take the technique", and the technique is exactly what does not transfer.
- The step() argument order is never stated. The reference uses "step(@days, 0.5)" as "shown when days > 0.5", while a GLSL reader expects step(edge, x) = x ≥ edge. I wrote it inverted. The interact formula `(1.5 > var)` showed the truth.
- The visibility docs (LAY-12) say "2 invisible keeps its space", but not that it STILL RECEIVES CLICKS. That is a real trap for "hide Skip on the last page".
- inspect interact `drag` does not trigger onTouchDown/onTouchUp handlers (pxStart changed only once, and page never moved), while render touch_events does. Silent disagreement between engines.
- render variants always include "as a 4x2 widget 320×160" and "tiny 195×506" with zero_size and text_overflow warnings. That is noise for a phone screen; I ignored them.
- build_kit's "Adapt to the size" rule is widget-centric ("A widget is resized by the host"). There is nothing on tablet and landscape for a phone screen.

## 4. What I would have liked
- A library Pager or SwipeArea component (or an example) for layout content: swipe → page index in a resources variable, buttons that set the same index, and enter/exit transitions with direction.
- interact supporting onTouchUp for drags, or saying it doesn't.
- A direction-aware slide (enter from the right on Next, from the left on Back). I used a fade because the slide direction can't follow the change.
- A theme number or text style for scaling type on tablets (a "text_xl on wide windows" rule).
- The render and inspect action schemas in build_kit's next_steps.

## 5. Assessment of the final screen
- **Correctness:**
  - Three pages, each with a distinct drawn illustration (calendar, cloud sync, padlock) from one inline `Illustration` component, plus a title and a body.
  - PagerDots (a library component) shows the page, and its dot slides.
  - Next advances. On page 3 it is replaced by "Get started" (hostNamedAction `getStarted`).
  - Skip jumps to page 3 and sends `skip`. It is gone on page 3.
  - A swipe left or right changes the page by one, clamped 0..2 (a quarter-width swipe is enough). Verified in the C++ render, not in inspect interact.
  - The page change cross-fades through animationSpec (FADE_OUT before, FADE_IN after, 300 ms).
- **Host variables:** title1..3 and body1..3 are exported strings with sample texts. `page` is an exported float, so the app can read it or start on any page.
- **Sizes:**
  - Phone 390×844, small 360×640 and 281×506, landscape 844×390, and tablet 858×1182 were all checked.
  - Landscape and wide windows switch to a side-by-side row through a stateLayout on the window aspect.
  - The content is capped at 640 dp and the buttons at 440 dp.
  - Weak spot: on a tablet the text stays at phone size (26/16), so it looks a little small. The tiny 195 dp variant clips the body (not a supported size).
- **Themes and mono:** all colours are theme colours. Light, dark, mono-dark and mono-light are right. In mono, big fills become outlines, except the sync cloud, which is a grey fill.
- **Accessibility:** only the visible page is read. The dots announce "Page N of 3" (a live textMerge). Skip, Next and Get started are labelled 48 dp buttons. The document has a description. The illustrations have no description; they are decorative.
- **Bytes:** about 8.9 KB. Each page is written twice (portrait and landscape) through the stateLayout, which costs bytes.
- **Known weak spots:**
  - The swipe is a release-only gesture: no finger-following drag.
  - The transition is a fade, not a directional slide.
  - The swipe handlers sit on the whole content column, so a tap on a button also runs onTouchUp. That is harmless (a zero delta).
  - The tree-variable-visibility issue was avoided entirely.
  - The swipe is not checked on Android or Java.
