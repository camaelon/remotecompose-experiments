"""
lottie2rc.py — convert Lottie (bodymovin) JSON animations into RemoteCompose `.rc` documents.

    python3 lottie2rc.py examples/Science.json                 # -> examples/Science.rc
    python3 lottie2rc.py examples/*.json -d out/                # many files into a directory
    python3 lottie2rc.py in.json -o out.rc --no-fit --no-loop -v

No dependencies beyond the standard library; the binary is written directly (no node step).
See README.md for the mapping and CONVERT.md for how the output was validated.

How the conversion works
------------------------
RemoteCompose has no keyframe model, so every animated scalar becomes one FloatExpression
of the composition frame. One expression turns the player's animation clock into that frame,

    f = mod(animationTime * fps, frameCount)      (or min(...) with --no-loop)

and a keyframed property is written as its first value plus, per keyframe segment, the
segment's delta times its eased progress:

    v = v0 + Σ_j (v_{j+1} - v_j) · ease_j(clamp((f - t_j) / (t_{j+1} - t_j), 0, 1))

Every segment already passed contributes exactly its delta and every later one contributes
0, so no search for the current segment is needed. `ease_j` is Lottie's cubic-bezier easing,
stored once per distinct curve as a 17-entry table read through the A_SPLINE operator
(monotone Hermite); a linear segment needs no table and a hold is a STEP. Spatial position
keyframes (`to`/`ti`) use a 17-entry table of the arc-length-parametrised path per axis.
Values that have no closed form (trim windows, auto-orient angles) fall back to sampling one
float per frame into a FLOAT_LIST; `--sampled` forces that mechanism for everything. Android
evaluates at most 32 tokens per expression, so longer RPN is chained (`--max-tokens`).
`--bezier-op` replaces the tables with the experimental BEZIER_EASE_X operator of the
players in this repository, and `--keyframe-op` replaces the whole sum with one KEYFRAMES_X
expression per property (one key list per property, one curve table per document).

Geometry:
  * bezier shapes (`sh`), rectangles, ellipses and polystars become PATH_DATA (cubics only,
    so every keyframe of a morphing shape has the same structure); round-corners, pucker /
    bloat and zig-zag modifiers are applied to the vertices before encoding
  * a morphing shape keeps one PATH_DATA per keyframe; the frame's segment index and eased
    tween are sampled, and each segment is a DRAW_TWEEN_PATH inside a CONDITIONAL_OPERATIONS
  * trim paths become the start/stop fields of DRAW_TWEEN_PATH (path tweened with itself);
    "simultaneous" trims are split across the group's paths by arc length
  * layer / group transforms become MATRIX_TRANSLATE / ROTATE / SKEW / SCALE, parenting is
    flattened into the op stream, layer in/out points become a sampled visibility flag
  * precomps recurse with their time offset / stretch / time-remap applied to the sample times
  * animated colours become a ColorExpression (ARGB mode) fed by sampled channel tracks
  * alpha mattes and layer masks become CLIP_PATH with the path baked (statically) into the
    right space; inverted / subtracted shapes use an even-odd path with a huge rectangle
  * image layers embed the PNG as BITMAP_DATA + DRAW_BITMAP

What is not converted (a warning is printed): text, effects, repeaters, offset-path,
merge paths (the paths are simply drawn individually), mask expansion / feather / opacity,
radial-gradient highlight, animated mattes and masks (baked at the first visible frame),
luma mattes (treated as alpha).
"""

# The package is the split of the original single-file converter; lottie2rc.py stays as the entry point.
from .wire import (  # noqa: F401
    BARE_FILL, BLEND_SRC_ATOP, BLEND_SRC_IN, BLEND_SRC_OVER, CANVAS_CONTENT_ID, CE_ARGB, CE_IDARGB, COND_EQ,
    COND_GT, COND_GTE, COND_LT, COND_LTE, COND_NEQ, CV_HEIGHT, CV_WIDTH, DATA_TYPE_INT,
    DATA_TYPE_STRING, DIM_FILL, EXPR_OFFSET, GRAD_FOCAL_RADIAL_X, GRAD_LINEAR, GRAD_RADIAL, ID_ANIMATION_TIME, ID_WINDOW_HEIGHT,
    ID_WINDOW_WIDTH, LOTTIE_BLEND, MAGIC_NUMBER, NO_PIVOT, OP_ANIMATED_FLOAT, OP_BITMAP_DATA, OP_CLIP_PATH, OP_CLIP_RECT,
    OP_COLOR_EXPRESSION, OP_COMPONENT_VALUE, OP_CONDITIONAL, OP_CONTAINER_END, OP_DATA_FLOAT, OP_DRAW_BITMAP, OP_DRAW_PATH, OP_DRAW_RECT,
    OP_DRAW_TWEEN_PATH, OP_FLOAT_LIST, OP_FLOAT_LIST_COMPACT_X, OP_HEADER, OP_KEYFRAMED_FLOATS_X, OP_LAYOUT_CANVAS, OP_LAYOUT_CONTENT, OP_LAYOUT_ROOT,
    OP_LOOP, OP_MATRIX_RESTORE, OP_MATRIX_ROTATE, OP_MATRIX_SAVE, OP_MATRIX_SCALE, OP_MATRIX_SKEW, OP_MATRIX_TRANSLATE, OP_MODIFIER_HEIGHT,
    OP_MODIFIER_WIDTH, OP_PAINT_VALUES, OP_PATH_COMBINE, OP_PATH_DATA, OP_PATH_DATA_COMPACT_X, OP_PATH_TWEEN, PB_ALPHA, PB_BLEND_MODE,
    PB_BLUR_X, PB_CLEAR_COLOR_FILTER, PB_COLOR, PB_COLOR_FILTER, PB_COLOR_FILTER_ID, PB_COLOR_ID, PB_GRADIENT, PB_PATH_EFFECT,
    PB_SHADER, PB_STROKE_CAP, PB_STROKE_JOIN, PB_STROKE_MITER, PB_STROKE_WIDTH, PB_STYLE, PPE_DASH, P_CLOSE,
    P_CUBIC, P_DONE, P_LINE, P_MOVE, RcWriter, STYLE_FILL, STYLE_FILL_AND_STROKE, STYLE_STROKE,
    TAG_DESC, TAG_FPS, TAG_HEIGHT, TAG_WIDTH, Wire, bits2f, f2bits, id_from_nan,
    is_nan_bits, nan_id, op_, parse_hex_color, rgb_to_argb)
from .props import (  # noqa: F401
    M_ID, Prop, Transform, bezier_arclen_point, cubic_bezier_y, ease_kf, lerp_shape, m_apply,
    m_mul, m_rotate, m_scale, m_skew, m_translate)
from .shapes import (  # noqa: F401
    BIG, INVERT_RECT, KAPPA, MERGE_OPS, MOD_TYPES, ROUND_CORNER, SHAPE_TYPES, STYLE_TYPES,
    ellipse_shape, expand_midpoints, interp_stops, pucker_bloat_shape, rect_shape, reverse_shape, round_corners_shape, shape_length,
    shape_to_floats, star_shape, transform_shape_floats, zigzag_shape)
from .tracks import (  # noqa: F401
    Clock, EASE_TABLE_N, Sampler, Track, X_ABS, X_ADD, X_ATAN2, X_A_DEREF,
    X_A_SPLINE, X_BEZIER_EASE, X_CEIL, X_CLAMP, X_COS, X_DIV, X_FLOOR, X_FRACT,
    X_HYPOT, X_KEYFRAMES, X_LERP, X_MAX, X_MIN, X_MOD, X_MUL, X_POW,
    X_SIN, X_SQRT, X_STEP, X_SUB, X_TAN, builtins_max, builtins_min, orient_track,
    transform_tracks)
from .profile import (  # noqa: F401
    Profile)
from .paints import (  # noqa: F401
    BlurEffect, DropShadow, FillEffect, PaintMixin, PaintState, ShadowPass, TintEffect)
from .paths import (  # noqa: F401
    PathMixin)
from .mattes import (  # noqa: F401
    MaskMatteMixin)
from .text import (  # noqa: F401
    CharsGlyphs, FontGlyphs, Glyph, TextMixin)
from .groups import (  # noqa: F401
    GroupMixin, REPEATER)
from .gaps import (  # noqa: F401
    GAPS, gaps_markdown, gaps_text)
from .convert import (  # noqa: F401
    Converter, convert_document, convert_file, main)
