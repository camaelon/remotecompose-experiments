# Video API — proposal

A small, intentionally bitmap-shaped extension to RemoteCompose for
embedded and streamed video. The design mirrors the existing image
ops: a `*_data` op declares the resource by id; one or two `draw_*`
ops paint its current frame into a destination rectangle. Same wire-
format conventions, same expression bindings as everything else.

## Design constraints (settled)

1. **As close to bitmaps as possible.** Authors who already use
   `bitmap_data` + `draw_bitmap` should pick this up immediately. A
   video is "a bitmap that advances over time".
2. **Two ingestion paths.** Inline (base64-embedded bytes) for short
   clips that should ship inside the document; URL for streams /
   long clips that the player fetches.
3. **Implementation-dependent decoder.** The format names a video by
   container and lets the player decode however it can. Conformant
   players support common interoperable subsets (`mp4` H.264 + AAC,
   `webm` VP9 + Opus); embedded players may decline anything else.
4. **Same state and expression model.** Playback parameters (current
   time, play/pause, loop) are expression-bound just like every other
   numeric / boolean field. No new control machinery; no callbacks,
   no event loop. The engine reads the expressions each frame and
   seeks the decoder accordingly.

The whole proposal is **three ops, one new uniform-source helper, and
a handful of system variables**.

---

## 1. The three ops

### `video_data` — declare a video resource

Mirrors `bitmap_data`. Required exactly one of `data_base64` or `url`.

| Field | Required | Type | Notes |
|---|---|---|---|
| `label` | yes | string | Id used by `draw_video` / `draw_video_scaled`. |
| `data_base64` | one-of | string | Inline bytes. Best for clips ≲ 1 MB; large clips bloat the document. |
| `url` | one-of | string | `https://`, `http://`, `file://`, or a relative path resolved against the document's loader. |
| `format` | optional | enum | `mp4` (default) / `webm` / `mov` / `gif` / `apng` / `webp`. Hint for the player; ignored if the bytes self-identify. |
| `width`, `height` | optional | int | Natural pixel dimensions, if known up front. Otherwise the player discovers them on first decoded frame. |
| `loop` | optional | bool | Default `true`. Restart at end of stream. |
| `mute` | optional | bool | Default `true`. Audio playback is opt-in to keep documents quiet by default. |
| `auto_play` | optional | bool | Default `true`. If `false`, the player holds frame 0 until `playing` becomes true (see below). |
| `time` | optional | float expression | If set, the engine seeks the decoder to this value (in seconds) every frame. If unset, the video plays at natural speed against `time.seconds`. |
| `playing` | optional | bool expression | If set, only advances frames while the expression is true. If unset, plays continuously. |

A `video_data` op is a *resource declaration*; it doesn't draw
anything by itself. The player begins fetching / preparing the video
as soon as the document is loaded.

### `draw_video` — paint current frame at a rect

Mirrors `draw_bitmap`. Stretches the current decoded frame into the
destination rectangle.

| Field | Required | Type | Notes |
|---|---|---|---|
| `video_id` | yes | id ref | The label declared in `video_data`. |
| `left`, `top`, `right`, `bottom` | yes | float | Destination rect in current canvas coords. |
| `content_desc_id` | optional | id ref | Accessibility description, parallels `draw_bitmap`. |

If the video has not yet decoded its first frame the player draws
nothing (the destination rect simply isn't painted; whatever is
underneath shows through). No flicker, no placeholder by default.

### `draw_video_scaled` — paint with src crop and scale-type

Mirrors `draw_bitmap_scaled`. Used when you want to crop the video,
fit/fill into a non-matching aspect, or pin to a corner.

| Field | Required | Type | Notes |
|---|---|---|---|
| `video_id` | yes | id ref | |
| `src_left`, `src_top`, `src_right`, `src_bottom` | yes | float | Crop rect in source pixels. |
| `dst_left`, `dst_top`, `dst_right`, `dst_bottom` | yes | float | Destination rect in current canvas coords. |
| `scale_type` | optional | enum | `fit` / `fill` / `crop` / `stretch` / `center`. Same semantics as `draw_bitmap_scaled`. Default `fit`. |
| `content_desc_id` | optional | id ref | |

That's it for drawing. Three ops, same shapes as the bitmap trio.

---

## 2. New shader / paint uniform source

A common request will be "use the video as a texture in a shader".
Mirroring how `bitmap_data` works as a sampler source for `paint`:

| Where | What |
|---|---|
| `paint.bitmap` (existing) | Fill texture from a bitmap id. |
| `paint.video` (new) | Fill texture from a video id; samples the current frame. |
| `shader_data.float_uniforms[].source` (existing) | Bind a uniform value to an expression. |
| `shader_data.sampler_uniforms[].source` (extended) | Bind a sampler uniform to a `bitmap` *or* `video` id. The shader sees a 2D RGBA sampler whose contents update each frame. |

This is one extension to existing ops, not a new op type. Authoring a
video-textured shader becomes the same pattern as a bitmap-textured
shader.

---

## 3. System variables

Each declared video exposes a small bag of read-only state that
expressions can reference. Names are scoped by the video's label, so
documents with multiple videos don't collide.

| Variable | Type | Meaning |
|---|---|---|
| `video.<label>.duration` | float | Total length in seconds. `0` until known. |
| `video.<label>.time` | float | Current playback position in seconds. |
| `video.<label>.ready` | bool | `true` once the player has buffered enough to render. |
| `video.<label>.width` | int | Natural pixel width. `0` until known. |
| `video.<label>.height` | int | Natural pixel height. `0` until known. |
| `video.<label>.frame` | int | Current frame index (best-effort; may be approximated by `time × fps`). |

These cover the common cases: progress bars (`time / duration`),
"video loaded" gates (`ready`), aspect-aware layout (`width / height`).

If the runtime variable namespace prefers integer ids, the same data
can be exposed via tokens like `VIDEO_TIME(id)`, `VIDEO_DURATION(id)`,
etc. — same content, different surface.

---

## 4. Worked examples

### Looping inline clip filling a 400×225 box

```
video_data(label="loop", data_base64="…", loop=true, mute=true)
draw_video(video_id="$loop", left=0, top=0, right=400, bottom=225)
```

### Streamed video with a custom progress bar

```
video_data(label="intro", url="https://cdn.example.com/intro.mp4")

# Progress bar driven by the live time variable
draw_video(video_id="$intro", left=0, top=0, right=400, bottom=225)
draw_rect(left=0, top=225, right=$intro_progress, bottom=230,
          paint={color="#FFE7C887"})

float_expression(label="intro_progress",
                 expr="400 * video.intro.time / video.intro.duration")
```

### Scrubbing — bind playback to a touch-driven expression

```
video_data(label="scrub", url="…", auto_play=false,
           time="$scrub_time")

float_expression(label="scrub_time",
                 expr="touch.x / window.width * video.scrub.duration")
```

The video doesn't auto-advance; it follows the touch position.

### Video as a shader texture

```
video_data(label="vid", url="…")
shader_data(label="effect",
            shader="…",
            sampler_uniforms=[{ "name": "uTex", "source": "video", "id": "$vid" }],
            float_uniforms=[{ "name": "iTime", "values": ["CONTINUOUS_SEC"] }])
paint(shader="$effect")
draw_rect(left=0, top=0, right=400, bottom=400)
```

The fragment shader samples `uTex` and the sampler refreshes each frame.

---

## 5. What stays coherent with bitmaps

- `video_data` reads exactly like `bitmap_data` — declarative resource
  with one of inline / URL / (could later add `empty: true` for
  render-target videos but not in v1).
- `draw_video` and `draw_video_scaled` have field-for-field parity
  with `draw_bitmap` and `draw_bitmap_scaled`.
- `paint.video = $id` slots into the same place `paint.bitmap = $id`
  does today.
- All numeric / boolean fields (`time`, `playing`, etc.) are RPN
  expression ids exactly like everywhere else.

## 6. What's intentionally out of scope (v1)

- **Audio mixing across multiple videos** — first version mutes by
  default, lets the document opt-in per-video, and stops there.
- **Frame-accurate seeking guarantees** — the format describes intent
  via `time`; the player decodes to the nearest keyframe + delta as
  it can. Documents needing frame-accurate output should pre-process.
- **Recording / encoding** — read-only consumption only.
- **Subtitles / captions** — separate proposal if needed; no
  free-text overlays in this round.
- **Picture-in-picture, fullscreen handoff** — host-side concerns,
  not document-format concerns.

## 7. Open questions for review

1. **Codec floor.** What MUST every conformant player support?
   Strawman: `mp4` H.264 baseline + AAC; `gif`. Anything else
   (`webm` VP9, `mov` HEVC, `webp` animated, `apng`) is a "may".
2. **Inline size cap.** Should the wire format reject `data_base64`
   above some threshold, or just rely on author judgement? A 50 MB
   document is technically valid but bad for everyone.
3. **URL fetch policy.** Whose responsibility is CORS / auth / TLS
   trust? Probably the host's, but worth specifying that documents
   don't carry credentials.
4. **`paint.video` blend semantics.** Is the texture sampled in
   gamma or linear space? Affects PBR-style content and the
   eventual surface API.
5. **Resource lifecycle.** When does a player release a decoded
   video? On document close is obvious; per-frame eviction policies
   when many videos exist need a hint (`priority` field?).
