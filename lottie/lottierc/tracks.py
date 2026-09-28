"""Time and animation: clocks, Tracks (a value as a Python function and an RPN expression), the Sampler that turns them into bytes."""

import math

from .wire import EXPR_OFFSET, ID_ANIMATION_TIME, RcWriter, f2bits, id_from_nan, is_nan_bits, nan_id, op_
from .props import _lst, _pick, bezier_arclen_point, cubic_bezier_y


# expression operators (AnimatedFloatExpression)
X_ADD, X_SUB, X_MUL, X_DIV, X_MOD = op_(1), op_(2), op_(3), op_(4), op_(5)
X_MIN, X_MAX, X_FLOOR = op_(6), op_(7), op_(14)
X_A_DEREF, X_LERP = op_(32), op_(49)


# ─────────────────────────────────────────────────────────────────────────────
# Time, tracks and keyframe expressions
# ─────────────────────────────────────────────────────────────────────────────

X_STEP, X_CLAMP, X_HYPOT, X_A_SPLINE, X_TAN = op_(44), op_(27), op_(47), op_(38), op_(20)
X_FRACT = op_(53)
X_POW = op_(8)
X_ABS = op_(10)
X_SQRT = op_(9)
X_COS = op_(19)
X_SIN = op_(18)
X_ATAN2 = op_(24)
X_CEIL = op_(31)
X_BEZIER_EASE = op_(90)
X_KEYFRAMES = op_(91)     # EXPERIMENTAL rcX operator: [curves keys dim t] -> keyframe-interpolated value   # EXPERIMENTAL rcX operator: [x1 y1 x2 y2 p] -> eased p
EASE_TABLE_N = 17          # samples of an easing curve handed to A_SPLINE (monotone Hermite)


class Clock:
    """A time domain: the comp frame at every sample (for the sampling fallback) and the
    NaN-id bits of an expression yielding that comp frame (for keyframe expressions)."""
    def __init__(self, times, bits):
        self.times = times
        self.bits = bits


class Track:
    """A scalar function of comp time. `fn` always works (used to sample); `tokens` is the
    RPN form when the value can be written as an expression of the clock. `const` marks a
    time-independent value."""
    __slots__ = ('fn', 'tokens', 'const')

    def __init__(self, fn, tokens=None, const=None):
        self.fn = fn
        self.tokens = tokens
        self.const = const

    @staticmethod
    def constant(v):
        v = float(v)
        return Track(lambda t, v=v: v, [f2bits(v)], v)

    def is_const(self):
        return self.const is not None

    def _binary(self, other, opbits, pyop):
        if not isinstance(other, Track):
            other = Track.constant(other)
        if self.is_const() and other.is_const():
            return Track.constant(pyop(self.const, other.const))
        # identities: x + 0, x - 0, x * 1, x / 1, 0 + x, 1 * x, and x * 0
        if other.is_const():
            if opbits in (X_ADD, X_SUB) and other.const == 0:
                return self
            if opbits in (X_MUL, X_DIV) and other.const == 1:
                return self
            if opbits == X_MUL and other.const == 0:
                return Track.constant(0.0)
        if self.is_const():
            if (opbits == X_ADD and self.const == 0) or (opbits == X_MUL and self.const == 1):
                return other
            if opbits == X_MUL and self.const == 0:
                return Track.constant(0.0)
        fa, fb = self.fn, other.fn
        tokens = None
        if self.tokens is not None and other.tokens is not None:
            tokens = self.tokens + other.tokens + [opbits]
        return Track(lambda t: pyop(fa(t), fb(t)), tokens)

    def mul(self, o): return self._binary(o, X_MUL, lambda a, b: a * b)
    def div(self, o): return self._binary(o, X_DIV, lambda a, b: a / b if b else 0.0)
    def add(self, o): return self._binary(o, X_ADD, lambda a, b: a + b)
    def sub(self, o): return self._binary(o, X_SUB, lambda a, b: a - b)
    def min(self, o): return self._binary(o, X_MIN, lambda a, b: builtins_min(a, b))
    def scale(self, k): return self.mul(Track.constant(k))
    def neg(self): return self.mul(Track.constant(-1.0))

    def unary(self, opbits, pyfn):
        if self.is_const():
            return Track.constant(pyfn(self.const))
        f = self.fn
        return Track(lambda t: pyfn(f(t)), (self.tokens + [opbits]) if self.tokens is not None else None)

    def floor(self): return self.unary(X_FLOOR, math.floor)
    def ceil(self): return self.unary(X_CEIL, math.ceil)
    def abs(self): return self.unary(X_ABS, abs)
    def sqrt(self): return self.unary(X_SQRT, lambda v: math.sqrt(v) if v > 0 else 0.0)
    def cos(self): return self.unary(X_COS, math.cos)
    def sin(self): return self.unary(X_SIN, math.sin)
    def atan2(self, x): return self._binary(x, X_ATAN2, lambda y, x_: math.atan2(y, x_))
    def pow(self, o): return self._binary(o, X_POW, lambda a, b: math.pow(a, b) if (a >= 0 or float(b).is_integer()) else -math.pow(-a, b))
    def fract(self): return self.unary(X_FRACT, lambda v: v - math.floor(v))
    def max(self, o): return self._binary(o, X_MAX, lambda a, b: builtins_max(a, b))

    def clamp01(self):
        if self.is_const():
            return Track.constant(builtins_min(1.0, builtins_max(0.0, self.const)))
        f = self.fn
        return Track(lambda t: builtins_min(1.0, builtins_max(0.0, f(t))),
                     (self.tokens + [f2bits(1.0), f2bits(0.0), X_CLAMP]) if self.tokens is not None else None)

    @staticmethod
    def hypot(dx, dy):
        if dx.is_const() and dy.is_const():
            return Track.constant(math.hypot(dx.const, dy.const))
        fa, fb = dx.fn, dy.fn
        tokens = (dx.tokens + dy.tokens + [X_HYPOT]) if dx.tokens is not None and dy.tokens is not None else None
        return Track(lambda t: math.hypot(fa(t), fb(t)), tokens)


builtins_min = min
builtins_max = max


class Sampler:
    """Owns the frame clock and turns tracks into value bits.

    Keyframed properties become one FloatExpression each (see `prop_track`): the value at
    the first keyframe plus, per segment, the segment's delta times its eased progress,
    where progress is `clamp((frame - t0) / (t1 - t0), 0, 1)` and the easing is a 17-entry
    table of the cubic-bezier curve read through A_SPLINE. Because every segment before the
    current one contributes exactly its delta and every later one contributes 0, no search
    for the current segment is needed. Anything not expressible (auto-orient, trims) is
    sampled once per frame into a FLOAT_LIST, the original mechanism, and `--sampled`
    forces that for everything."""

    def __init__(self, writer, n_frames, fps, fr, ip, profile):
        self.w = writer
        loop, interp, keyframes = profile.loop, profile.interp, profile.keyframes
        self.max_tokens = profile.max_tokens
        self.bezier_op = profile.bezier_op
        self.keyframe_op = profile.keyframe_op
        self.quantize = profile.quantize     # key lists and tables as quantised int16 (see list_bits)
        self.curves = []             # KEYFRAMES_X curve table: 4 floats per distinct easing
        self.curve_ids = {}
        self.curves_bits = None      # allocated on first use, written by finish()
        self.keys_cache = {}
        self.keys_dims = {}          # key list bits -> component count, for KEYFRAMED_FLOATS_X
        self.n = n_frames            # number of frame intervals; sampled arrays hold n+1 samples
        self.fps = fps
        self.interp = interp
        self.keyframes = keyframes
        self.cache = {}
        self.expr_cache = {}
        self.ease_cache = {}
        w = writer
        # +0.001 frame: float32 `time * fps` can land a hair under an integer frame, and a hold
        # track read at floor(f) would then show the previous frame at the exact boundary.
        if loop:
            f = w.expression([nan_id(ID_ANIMATION_TIME), f2bits(fps), X_MUL, f2bits(1e-3), X_ADD,
                              f2bits(n_frames), X_MOD])
        else:
            f = w.expression([nan_id(ID_ANIMATION_TIME), f2bits(fps), X_MUL, f2bits(1e-3), X_ADD,
                              f2bits(n_frames - 1e-3), X_MIN])
        self.f_bits = f
        self.fi_bits = w.expression([f, X_FLOOR])
        self.frac_bits = w.expression([f, self.fi_bits, X_SUB])
        step = fr / fps
        # the composition frame, from the sample index
        if abs(step - 1.0) < 1e-9 and abs(ip) < 1e-9:
            frame_bits = f
        else:
            frame_bits = w.expression([f, f2bits(step), X_MUL, f2bits(ip), X_ADD])
        self.root_clock = Clock([ip + k * step for k in range(n_frames + 1)], frame_bits)
        self.clock_cache = {}

    # ── clocks ────────────────────────────────────────────────────────────
    def child_clock(self, clock, st, sr):
        """A precomp's children run at (frame - st) / sr."""
        if abs(st) < 1e-9 and abs(sr - 1) < 1e-9:
            return clock
        key = (clock.bits, round(st, 6), round(sr, 6))
        hit = self.clock_cache.get(key)
        if hit is None:
            tokens = [clock.bits]
            if abs(st) > 1e-9:
                tokens += [f2bits(st), X_SUB]
            if abs(sr - 1) > 1e-9:
                tokens += [f2bits(sr), X_DIV]
            hit = Clock([(t - st) / sr for t in clock.times], self.w.expression(tokens))
            self.clock_cache[key] = hit
        return hit

    def track_clock(self, clock, track):
        """A clock whose frame is another track's value (time remap)."""
        return Clock([track.fn(t) for t in clock.times], self.track_bits(track, clock))

    # ── value bits ────────────────────────────────────────────────────────
    @staticmethod
    def is_const(track, eps=1e-6):
        v0 = track[0]
        return all(abs(v - v0) <= eps for v in track)

    def bits(self, track, hold=False):
        """Value bits for a per-sample list: a float literal when constant, else a NaN id."""
        if self.is_const(track):
            return f2bits(track[0])
        hold = hold or not self.interp
        key = (hold, tuple(round(float(v), 5) for v in track))
        hit = self.cache.get(key)
        if hit is not None:
            return hit
        arr = self.list_bits(track)
        if hold:
            tokens = [arr, self.fi_bits, X_A_DEREF]
        else:
            tokens = [arr, self.fi_bits, X_A_DEREF,
                      arr, self.fi_bits, f2bits(1.0), X_ADD, X_A_DEREF,
                      self.frac_bits, X_LERP]
        bits = self.w.expression(tokens)
        self.cache[key] = bits
        return bits

    # stack effect of every operator the converter emits (+1 for a literal / variable / array)
    STACK_EFFECT = {X_ADD: -1, X_SUB: -1, X_MUL: -1, X_DIV: -1, X_MOD: -1, X_MIN: -1, X_MAX: -1,
                    X_STEP: -1, X_HYPOT: -1, X_A_DEREF: -1, X_A_SPLINE: -1, X_CLAMP: -2, X_LERP: -2,
                    X_FLOOR: 0, X_TAN: 0, X_FRACT: 0, X_CEIL: 0, X_ABS: 0, X_SQRT: 0, X_COS: 0, X_SIN: 0, X_ATAN2: -1, X_POW: -1, X_BEZIER_EASE: -4, X_KEYFRAMES: -3}

    def _effect(self, tok):
        if is_nan_bits(tok) and id_from_nan(tok) > EXPR_OFFSET:
            return self.STACK_EFFECT.get(tok, 1)
        return 1

    def expr_bits(self, tokens):
        """Emit an expression for an RPN token list (cached), splitting it into a chain of
        expressions when it is longer than `max_tokens` (Android's evaluator takes at most 32).
        A span of tokens can be hoisted into its own expression when it is a complete
        sub-expression: it leaves exactly one value on the stack and never consumes a value
        pushed before it. The longest such span within the limit is hoisted, repeatedly."""
        tokens = list(tokens)
        if len(tokens) == 1:
            return tokens[0]          # a literal or an existing id
        if self.keyframe_op and len(tokens) == 5 and tokens[4] == X_KEYFRAMES and tokens[0] == self.curves_bits \
                and tokens[1] in self.keys_dims and not is_nan_bits(tokens[2]):
            # a plain "component d of this key list at this clock": KEYFRAMED_FLOATS_X defines every
            # component of the list at once (14 + 4·D bytes instead of 29 each). Only the bare form:
            # replacing the span inside longer expressions by an id shrank the raw bytes but grew the
            # deflated ones, since deflate already folds the repeated token pattern and an id does
            # not repeat (measured: +2 % deflated over the 22-file set)
            return self.keyframed_float(tokens)
        limit = self.max_tokens
        while limit and len(tokens) > limit:
            after = []                # stack depth after each token
            d = 0
            for tok in tokens:
                d += self._effect(tok)
                after.append(d)
            best = None
            for j in range(len(tokens)):
                for i in range(max(0, j - limit + 1), j):
                    base = after[i - 1] if i > 0 else 0
                    if after[j] != base + 1:
                        continue
                    if min(after[i:j + 1]) < base + 1:
                        continue
                    if best is None or (j - i) > (best[1] - best[0]):
                        best = (i, j)
                    break             # for this j the earliest i is the longest span
            if best is None:
                raise ValueError('expression term longer than --max-tokens (%d)' % limit)
            i, j = best
            tokens = tokens[:i] + [self.expr_bits(tokens[i:j + 1])] + tokens[j + 1:]
        key = tuple(tokens)
        hit = self.expr_cache.get(key)
        if hit is None:
            hit = self.w.expression(tokens)
            self.expr_cache[key] = hit
        return hit

    def keyframed_float(self, span):
        """The float id for a [curves, keys, d, clock, KEYFRAMES_X] span, emitting the list's
        KEYFRAMED_FLOATS_X op on first use."""
        key = tuple(span)
        hit = self.expr_cache.get(key)
        if hit is None:
            D = self.keys_dims[span[1]]
            ids = [self.w.alloc_id() for _ in range(D)]
            self.w.keyframed_floats(id_from_nan(span[1]), id_from_nan(span[0]), span[3], ids)
            for k in range(D):
                self.expr_cache[(span[0], span[1], f2bits(float(k)), span[3], X_KEYFRAMES)] = nan_id(ids[k])
            hit = self.expr_cache[key]
        return hit

    def share(self, track, clock):
        """A track that is used several times: emitted once, referenced by id afterwards."""
        if track.is_const() or track.tokens is None or len(track.tokens) == 1 or not self.keyframes:
            return track
        return Track(track.fn, [self.track_bits(track, clock)])

    def track_bits(self, track, clock, hold=False):
        if track.is_const():
            return f2bits(track.const)
        if self.keyframes and track.tokens is not None:
            return self.expr_bits(track.tokens)
        return self.bits([track.fn(t) for t in clock.times], hold=hold)

    # ── keyframes → tokens ────────────────────────────────────────────────
    def ease_table_bits(self, x1, y1, x2, y2):
        key = tuple(round(v, 4) for v in (x1, y1, x2, y2))
        hit = self.ease_cache.get(key)
        if hit is None:
            n = EASE_TABLE_N
            hit = self.list_bits([cubic_bezier_y(k / (n - 1), x1, y1, x2, y2) for k in range(n)])
            self.ease_cache[key] = hit
        return hit

    # ── KEYFRAMES_X ───────────────────────────────────────────────────────
    def curve_index(self, easing):
        key = tuple(round(v, 4) for v in easing)
        if key not in self.curve_ids:
            self.curve_ids[key] = len(self.curves) // 4
            self.curves += list(easing)
        return float(self.curve_ids[key])

    def curves_ref(self):
        if self.curves_bits is None:
            self.curves_bits = nan_id(self.w.alloc_array_id())
        return self.curves_bits

    def finish(self):
        """Write the shared curve table (call once, after everything else)."""
        if self.curves_bits is not None:
            self.w.float_list_at(id_from_nan(self.curves_bits), self.curves)

    def keys_list_bits(self, times, values, easings, tangents=None):
        """A KEYFRAMES_X key list: n, D (+256 when spatial), rows of (t, v0..vD-1[, out0.., in0..]),
        then (n-1)*D easing codes. `values[i]` is the D-vector at key i; `easings[j][d]` is
        'hold', None or a 4-tuple; `tangents[i]` = (out, in) D-vectors for a spatial property."""
        n, D = len(times), len(values[0])
        floats = [float(n), float(D + (256 if tangents else 0))]
        for i, (t, v) in enumerate(zip(times, values)):
            floats.append(float(t)); floats += [float(x) for x in v[:D]]
            if tangents:
                o, ii = tangents[i]
                floats += [float(x) for x in (list(o) + [0.0] * D)[:D]] + [float(x) for x in (list(ii) + [0.0] * D)[:D]]
        for j in range(n - 1):
            for d in range(D):
                e = easings[j][d]
                floats.append(-2.0 if e == 'hold' else (-1.0 if e is None else self.curve_index(e)))
        compact = self.compact_key_list(floats, n, D, bool(tangents)) if self.quantize else None
        if compact is not None:
            floats = compact[0]
        key = tuple(round(x, 5) for x in floats)
        hit = self.keys_cache.get(key)
        if hit is None:
            if compact is not None:
                hit = nan_id(self.w.float_list_compact(*compact[1:]))
            else:
                hit = nan_id(self.w.float_list(floats))
            self.keys_cache[key] = hit
        self.keys_dims[hit] = D
        return hit

    def quantum_for(self, maxabs):
        """The grid for values of a list whose largest magnitude is `maxabs`: the requested Q,
        256 times finer for normalised quantities (colours, unit values), and never coarser
        than what int16 needs to hold the range."""
        q = self.quantize if maxabs > 2.0 else self.quantize / 256.0
        return max(q, maxabs / 32767.0) if maxabs > 0 else q

    def compact_key_list(self, floats, n, D, spatial):
        """A key list as FLOAT_LIST_COMPACT_X: the two header words raw, rows as int16 with one
        quantum for the time column (1/16 frame, exact for whole frames) and one for the value
        columns, easing codes as int8. -> (quantised floats, raw, quanta, body, tail) or None
        when it would not fit or not be smaller."""
        stride = 1 + D * (3 if spatial else 1)
        rows = floats[2:2 + n * stride]
        tail = floats[2 + n * stride:]
        if any(abs(v - round(v)) > 1e-6 or not -128 <= v <= 127 for v in tail):
            return None
        q_t = 1.0 / 16.0
        maxabs = max([abs(v) for i, v in enumerate(rows) if i % stride != 0] or [0.0])
        q_v = self.quantum_for(maxabs)
        body, out = [], list(floats[:2])
        for i, v in enumerate(rows):
            q = q_t if i % stride == 0 else q_v
            k = int(round(v / q))
            if not -32768 <= k <= 32767:
                return None
            body.append(k)
            out.append(k * q)
        out += tail
        raw, quanta, tail_i = list(floats[:2]), [q_t] + [q_v] * (stride - 1), [int(round(v)) for v in tail]
        if RcWriter.compact_size(raw, quanta, body, tail_i) >= 9 + 4 * len(floats):
            return None
        return out, raw, quanta, body, tail_i

    def list_bits(self, values):
        """nan-id bits of a plain float list, quantised to int16 under --quantize when smaller."""
        values = [float(v) for v in values]
        if self.quantize and len(values) >= 8:
            maxabs = max(abs(v) for v in values)
            q = self.quantum_for(maxabs)
            body = [int(round(v / q)) for v in values]
            if all(-32768 <= k <= 32767 for k in body) and RcWriter.compact_size([], [q], body, []) < 9 + 4 * len(values):
                return nan_id(self.w.float_list_compact([], [q], body, []))
        return nan_id(self.w.float_list(values))

    def keyframes_tokens(self, keys_bits, dim, clock):
        return [self.curves_ref(), keys_bits, f2bits(float(dim)), clock.bits, X_KEYFRAMES]

    def curve_bits(self, x1, y1, x2, y2):
        key = ('curve',) + tuple(round(v, 4) for v in (x1, y1, x2, y2))
        hit = self.ease_cache.get(key)
        if hit is None:
            hit = nan_id(self.w.float_list([x1, y1, x2, y2]))
            self.ease_cache[key] = hit
        return hit

    @staticmethod
    def _easing(k0, d):
        o, i = k0.get('o'), k0.get('i')
        if not o or not i:
            return None
        e = (_pick(o.get('x'), d), _pick(o.get('y'), d), _pick(i.get('x'), d), _pick(i.get('y'), d))
        if abs(e[0] - e[1]) < 1e-9 and abs(e[2] - e[3]) < 1e-9:
            return None   # linear
        return e

    def progress_tokens(self, clock, t0, t1, easing):
        """Eased progress of one segment in [0, 1]. The raw progress
        `clamp((frame - t0) / (t1 - t0), 0, 1)` is its own (shared) expression: every property
        keyed on the same pair of frames reuses it, which is what makes a flapping wing with 49
        keyframes on rotation *and* scale cheap."""
        raw = self.expr_bits([clock.bits, f2bits(t0), X_SUB, f2bits(t1 - t0), X_DIV, f2bits(1.0), f2bits(0.0), X_CLAMP])
        if easing is None:
            return [raw]
        # The eased progress is its own shared expression too: the x, y (and z) of a position,
        # the two axes of a scale, the channels of a colour all key on the same segment.
        if self.bezier_op:
            eased = [self.curve_bits(*easing), raw, X_BEZIER_EASE]   # array form: one 4-float list per curve
        else:
            eased = [self.ease_table_bits(*easing), raw, X_A_SPLINE]
        return [self.expr_bits(eased)]

    def prop_track(self, prop, d, clock):
        """Track of dimension `d` of a keyframed property."""
        if not prop.animated:
            v = prop.value
            return Track.constant(_lst(v)[d] if d < len(_lst(v)) else 0.0)
        fn = lambda t: _lst(prop.at(t))[d]
        if not self.keyframes:
            return Track(fn)           # --sampled: no tables, no expressions
        kf = prop.k
        if self.keyframe_op:
            spatial = any(k.get('to') and k.get('ti') and (any(abs(x) > 1e-9 for x in k['to'][:2]) or any(abs(x) > 1e-9 for x in k['ti'][:2]))
                          for k in kf[:-1] if len(_lst(k.get('s', [0]))) >= 2)
            try:
                D = min(len(_lst(prop.value_at_keyframe(j))) for j in range(len(kf)))
                if d < D:
                    values = [_lst(prop.value_at_keyframe(j))[:D] for j in range(len(kf))]
                    times = [float(k['t']) for k in kf]
                    easings = []
                    for j in range(len(kf) - 1):
                        k0 = kf[j]
                        easings.append(['hold' if (k0.get('h') or times[j + 1] <= times[j]) else self._easing(k0, dd) for dd in range(D)])
                    tangents = None
                    if spatial:
                        # row i carries segment i's out-tangent (Lottie `to`) and in-tangent (`ti`)
                        tangents = [(k.get('to') or [0.0] * D, k.get('ti') or [0.0] * D) for k in kf]
                    return Track(fn, self.keyframes_tokens(self.keys_list_bits(times, values, easings, tangents), d, clock))
            except (KeyError, IndexError, TypeError):
                pass
        tokens = None
        try:
            tokens = [f2bits(_lst(prop.value_at_keyframe(0))[d])]
            for j in range(len(kf) - 1):
                k0, k1 = kf[j], kf[j + 1]
                s, e = prop._seg_values(j)
                s, e = _lst(s), _lst(e)
                t0, t1 = float(k0['t']), float(k1['t'])
                sv, ev = s[d], e[d]
                to, ti = k0.get('to'), k0.get('ti')
                spatial = bool(to and ti and len(s) >= 2 and d < 2 and
                               (any(abs(x) > 1e-9 for x in to[:2]) or any(abs(x) > 1e-9 for x in ti[:2])))
                if t1 <= t0 + 1e-9 or k0.get('h'):
                    # a hold (or a zero-length segment): the delta lands at t1
                    if abs(ev - sv) > 1e-12:
                        tokens += [clock.bits, f2bits(t1 - 1e-3), X_STEP, f2bits(ev - sv), X_MUL, X_ADD]
                    continue
                u = self.progress_tokens(clock, t0, t1, self._easing(k0, d))
                if spatial:
                    n = EASE_TABLE_N
                    table = [bezier_arclen_point(s, e, to, ti, k / (n - 1))[d] for k in range(n)]
                    tokens += [self.list_bits(table)] + u + [X_A_SPLINE, f2bits(sv), X_SUB, X_ADD]
                elif abs(ev - sv) > 1e-12:
                    tokens += u + [f2bits(ev - sv), X_MUL, X_ADD]
        except (KeyError, IndexError, TypeError):
            tokens = None
        return Track(fn, tokens)

    def keyframe_progress_track(self, kf_times, easings, clock):
        """U = sum of eased segment progress: the number of keyframes passed plus the tween
        inside the current segment. Used for path morphs and parametric shapes."""
        if len(kf_times) < 2:
            return Track.constant(0.0)
        segs = list(zip(kf_times[:-1], kf_times[1:], easings))

        def fn(t):
            u = 0.0
            for (t0, t1, ez) in segs:
                if t1 <= t0:
                    u += 1.0 if t >= t1 else 0.0
                    continue
                p = builtins_min(1.0, max(0.0, (t - t0) / (t1 - t0)))
                if ez == 'hold':
                    u += 1.0 if p >= 1 else 0.0
                elif ez is None:
                    u += p
                else:
                    u += cubic_bezier_y(p, *ez)
            return u
        if self.keyframe_op:
            values = [[float(i)] for i in range(len(kf_times))]
            eas = [['hold' if (t1 <= t0 or ez == 'hold') else ez] for (t0, t1, ez) in segs]
            return Track(fn, self.keyframes_tokens(self.keys_list_bits([float(t) for t in kf_times], values, eas), 0, clock))
        tokens = [f2bits(0.0)]
        for (t0, t1, ez) in segs:
            if t1 <= t0 or ez == 'hold':
                tokens += [clock.bits, f2bits(t1 - 1e-3), X_STEP, X_ADD]
            else:
                tokens += self.progress_tokens(clock, t0, t1, ez) + [X_ADD]
        return Track(fn, tokens)


def orient_track(tr, sampler, clock, h=0.01):
    """Auto-orient as an expression: the direction of motion is atan2 of the position a
    hundredth of a frame later minus a hundredth of a frame earlier (both clamped to the
    keyframe range, lottie-web's window), in degrees — the position's own keyframe expression evaluated on two
    shifted clocks, so no per-frame table is needed."""
    times = (tr.px.keyframe_times() + tr.py.keyframe_times()) if tr.split else tr.p.keyframe_times()
    if not times:
        return Track.constant(0.0)
    lo, hi = float(min(times)), float(max(times))

    def shifted(sign):
        f = lambda t: min(max(t + sign * h, lo), hi)
        c = sampler.track_clock(clock, Track(f, [clock.bits, f2bits(sign * h), X_ADD, f2bits(hi), f2bits(lo), X_CLAMP]))
        return c, f

    def pos_at(c, f, d):
        base = sampler.prop_track(tr.px if d == 0 else tr.py, 0, c) if tr.split else sampler.prop_track(tr.p, d, c)
        if base.is_const():
            return base
        return Track(lambda t: tr.pos(f(t))[d], base.tokens)

    (cp, fp), (cm, fm) = shifted(1.0), shifted(-1.0)
    dx = pos_at(cp, fp, 0).sub(pos_at(cm, fm, 0))
    dy = pos_at(cp, fp, 1).sub(pos_at(cm, fm, 1))
    return dy.atan2(dx).scale(180.0 / math.pi)


def transform_tracks(tr, sampler, clock):
    """Position, anchor, scale, rotation, skew and opacity of a Transform as Tracks."""
    pt = lambda prop, d: sampler.prop_track(prop, d, clock)
    if tr.split:
        px, py = pt(tr.px, 0), pt(tr.py, 0)
    else:
        px, py = pt(tr.p, 0), pt(tr.p, 1)
    ax, ay = pt(tr.a, 0), pt(tr.a, 1)
    sx = pt(tr.s, 0).scale(0.01)
    sy = (pt(tr.s, 1) if len(_lst(tr.s.value if not tr.s.animated else [0, 0])) > 1 or tr.s.animated else pt(tr.s, 0)).scale(0.01)
    r = pt(tr.r, 0)
    if tr.auto_orient:
        if sampler.keyframes and sampler.keyframe_op:
            r = r.add(orient_track(tr, sampler, clock))          # a finite difference of the exact position
        else:
            r = r.add(Track(lambda t: tr.orient(t)))   # sampled: the default mode's position is a 17-point spline fit,
                                                       # too coarse to differentiate
    o = pt(tr.o, 0).scale(0.01)
    sk = pt(tr.sk, 0)
    sa = pt(tr.sa, 0)
    return {'px': px, 'py': py, 'ax': ax, 'ay': ay, 'sx': sx, 'sy': sy, 'r': r, 'o': o, 'sk': sk, 'sa': sa}
