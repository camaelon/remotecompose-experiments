# C++ Layout Animation Subsystem — Design

Port of the androidx `AnimateMeasure` layout-animation system so the C++ player
animates component bounds/visibility over time (enabling `StateLayout` transitions
to actually animate, matching the TS/Android players).

## Reference (androidx) model

- `ComponentMeasure` = snapshot {x, y, w, h, visibility}.
- Each `Component` keeps its **live painted bounds** (mX/mY/mW/mH) across frames;
  those are the "from" when a new measure differs.
- `layout()`: if not first layout and bounds changed → create `AnimateMeasure(from=live
  bounds, to=new measure, startTime=now, spec)`. Otherwise apply measure directly.
- `AnimateMeasure.update(now)`: `p = motionEasing(elapsed/motionDuration)`,
  `vp = visEasing(elapsed/visDuration)`.
  - x/y/w/h = lerp(from, to, p).
  - visibility→alpha: unchanged→1; entering→vp; exiting→1-vp.
- `paint()`: draws the component at interpolated bounds, applying enter/exit effect
  (FADE, SLIDE_*, ROTATE) via saveLayer+alpha / translate / rotate+scale.
- Easing = cubic bezier control points per `GeneralEasing` type.
- `AnimationSpec` {motionDuration, motionEasingType, visibilityDuration,
  visibilityEasingType, enterAnimation, exitAnimation}. Default 300ms / CUBIC_STANDARD /
  FADE_IN / FADE_OUT.

## C++ pipeline (current)

`LayoutRoot::apply` → `measureComponent` → `layoutComponent`/`layoutManager` (fills
`MeasurePass` x/y) → `storeMeasuredDimensions` → `paintLayoutComponent` (matrixTranslate
m.x,m.y; background/border; padding; children). `MeasurePass` and `LayoutState` (getLS)
are rebuilt every frame. Time via `RemoteContext::getFloat(ID_ANIMATION_TIME)`.
`SkiaPaintContext` has matrix save/translate/scale/rotate but no alpha layer.

## Design

Because the C++ pipeline is functional (no persistent Component object bounds), add a
**persistent per-component animation store** that survives frame rebuilds:

```cpp
struct AnimState {
    bool  hasLive = false;                 // have we shown this component before?
    ComponentMeasure live;                 // bounds shown last frame (the "from")
    bool  animating = false;
    ComponentMeasure from, to;
    double startTime = 0;                  // ID_ANIMATION_TIME seconds at trigger
    ResolvedSpec spec;                     // durations/easings/enter/exit
    float p = 1, vp = 1;                   // last computed fractions
};
std::unordered_map<int /*componentId*/, AnimState>  // NOT cleared per frame
```

### 1. Primitives (new: `animation/Easing.{h,cpp}`, `animation/LayoutAnimation.{h,cpp}`)
- `CubicEasing` (bezier control points, binary-search evaluate) + `GeneralEasing` table.
- `ResolvedSpec` + easing lookup.

### 2. ComponentMeasure
- Add `float alpha = 1.0f;`.

### 3. Spec association
- Scan op tree once → map `animationId → AnimationSpec op`.
- `LayoutState` gains `int animationSpecId = -1` (set by the `animationSpec` modifier);
  resolve to a `ResolvedSpec` (fallback = DEFAULT) per component.

### 4. Animation update pass (new, after layout, before paint)
`updateAnimations(root, ctx, measure)`: walk components with a measure; for each `cid`:
- target = measure.get(cid) (bounds+visibility from layout).
- st = animStore[cid].
- if `!st.hasLive`: seed `st.live = target`, no animation (first appearance).
- else if `target != st.live` and animation enabled:
  - if not animating (or target changed): start/redirect anim `from=st.live, to=target,
    startTime=now`.
- if animating: compute p/vp from elapsed; `interp = lerp(from,to,p)`, alpha from vp;
  write interp bounds+alpha back into `measure.get(cid)`; set `st.live = interp`.
  When p>=1 && vp>=1 → animating=false, live=to. Request another frame (dirty).
- else: `st.live = target`, alpha=1.

GONE handling: a component present last frame but GONE this frame keeps a measure
(visibility=GONE) so it can exit-animate; drop from store once exit completes.

### 5. Paint
`paintLayoutComponent`: read `m.alpha`; if <1 wrap child paint in
`saveLayerAlpha`/restore. Apply enter/exit slide translate from spec+vp. Interpolated
x/y/w/h already in `m`.

### 6. SkiaPaintContext
- Add `saveLayerAlpha(alpha, l,t,r,b)` / matching restore (SkCanvas::saveLayerAlpha).

### 7. StateLayout
- In measure: measure the **current** state child; components in the previous state but
  not the current (by animationId) get a GONE measure (→ exit anim); shared animationIds
  reuse one component instance seeded at the previous position (→ move/resize anim); new
  ones enter. Reuse the general update pass for the actual tweening.
- Index change (0→1) is detected as today (`getInteger(indexId)`), which flips which
  state is measured → bounds change → general animation runs.

## Verification
`rcviewer --screenshot deck.rc out.png W H <delay_sec>` at delay 0.0 / 0.15 / 0.3 / 1.0
captures the transition start / middle / end. Also unit-render synthetic StateLayout docs.

## Implementation status
Done (builds clean, static rendering unchanged — regression verified):
- `ComponentMeasure.alpha`; `animation/LayoutAnimation.h` (persistent per-component
  store + `animUpdate` interpolation, reusing existing `CubicEasing`).
- `saveLayerAlpha`/`restoreLayer` on PaintContext (default) + SkiaPaintContext.
- Animation pass (`animateLayoutTree`) in `LayoutRoot::apply`, before paint.
- Alpha layer applied in `paintLayoutComponent`; GONE components skipped.
- Store reset on `CoreDocument::initFromBuffer`.
- StateLayout: current-index → visible, others → GONE (crossfade hook).

Verified:
- Regression: static slides render identically.
- StateLayout index selection now respected (index 0 vs 1 render the correct state;
  previously the last state always won). Deterministic rc2image test.

Verified end-to-end:
- Animated crossfade on a live StateLayout index flip. Using `refract.py --transitions`
  (each slide = a StateLayout `[prev, cur]` with the index driven by `animTime`), the
  `--pdf` render path (which pins the clock via `setFixedTimeMs`) shows: 0.05s = previous
  slide, 0.25s = both blended (crossfade), 0.70s = new slide. Works in the C++ player.
- NB: `rcviewer --screenshot` does NOT pin the wall clock (no `setFixedTimeMs`), so
  `CoreDocument::updateTimeVariables` overrides animationTime to ~0 every paint and the
  transition never advances there. Use `--pdf` (or the interactive viewer) to see it.
  That screenshot-path time bug is worth fixing separately.

Remaining:
- Shared-element morphing (match components across states by animationId so they
  move/resize instead of crossfading).
- Per-component AnimationSpec (map animationId → ANIMATION_SPEC op; enter/exit slide
  + rotate variants). Currently a single default spec (300ms, standard, fade).
- Container resize-with-reflow during animation (children currently hold target
  layout while the container tweens).
