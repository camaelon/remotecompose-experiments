"""The RemoteCompose JSON document for one Doc.

Layout: a canvas filling its component; the viewport is scaled to the component size
(`componentWidth() / viewportWidth`), groups become save / translate / rotate / scale, paths
are `resources.paths` op lists drawn with `drawPath`, and every animated property is a
closed-form float expression of time.

Animated properties are chains: states Q0..Qn and a weight per transition, c_i(t) in [0, 1]
(0 before the transition starts, 1 once it is done). A scalar is Q0 + sum (Q_i - Q_i-1) c_i, a
path morph is a chain of `pathTween`s, a colour is drawn as two layers per transition whose
alphas compose to the interpolated colour. The weight of a keyframe interval is its
interpolator applied to the animator's eased fraction rescaled to the interval; the animator's
fraction comes from the clock, `clamp((t - start) / duration, 0, 1)` (repeats with `fract` /
`ping_pong`) pushed through its interpolator (closed forms, or a sampled table read with
`spline`).
"""

import math

from . import animators, interpolators, pathdata
from .colors import THEME, Color
from .expr import E, N, Pool, V, clamp, clamp01, fmt, fn, if_gt0, sysvar
from .vector import Gradient, VClip, VGroup, VPath
from .xmlutil import ConvertError

EPS_T = 1e-4
TABLE_SIZES = (9, 17, 33, 65, 129)
TABLE_TOL = 0.002
MOTION_SAMPLES = 100     # AnimatorInflater's MAX_NUM_POINTS
DENSITY = 2.625          # the device density assumed where Android's result depends on it (420 dpi)


def num(v, nd=4):
    """A JSON number, rounded."""
    r = round(float(v), nd)
    if r == int(r):
        return int(r)
    return r


class Options:
    def __init__(self, **kw):
        self.mode = 'auto'          # auto | once | loop
        self.trigger = None         # variable name holding the start time
        self.size = None            # (w, h) header size override
        self.max_tokens = 32
        self.theme = True           # theme colours as themed resources (else dark literals)
        self.description = None
        self.tint = None            # override the vector's tint (theme colour name or '#hex'): one colour for every paint
        self.strip_degenerate = False   # drop zero-area contours and repeated points of fill-only paths
        for k, v in kw.items():
            if not hasattr(self, k):
                raise TypeError(k)
            setattr(self, k, v)


class Chain:
    """An animated property: states and the weight of each transition."""

    def __init__(self, q0):
        self.states = [q0]
        self.weights = []           # E per transition
        self.deltas = []            # optional E replacing (Q_i - Q_i-1) * c_i for scalars (motion tables)

    def push(self, q, w, delta=None):
        self.states.append(q)
        self.weights.append(w)
        self.deltas.append(delta)

    @property
    def last(self):
        return self.states[-1]


class Emitter:
    def __init__(self, doc, res, opts=None):
        self.doc = doc
        self.vec = doc.vector
        self.res = res
        self.opts = opts or Options()
        self.pool = Pool(self.opts.max_tokens)
        self.paths = {}             # name -> op list (JSON)
        self.path_keys = {}         # key -> name
        self.theme_used = set()
        self.warnings = res.warnings
        self.gaps = []
        self.paint = {}             # current paint state, to emit deltas only
        self.n_tween = 0
        self.stats = {'draws': 0}

    def warn(self, msg):
        if msg not in self.warnings:
            self.warnings.append(msg)

    # ------------------------------------------------------------------ timeline
    def build_timeline(self):
        """props: (id(node), prop) -> [(Placed, Holder)], sorted by start."""
        self.props = {}
        self.nodes = {}
        ends = []
        for name, tree in self.doc.targets:
            node = self.vec.targets.get(name)
            if node is None:
                self.warn('target %s not found in the vector (ignored)' % name)
                continue
            placed, end = animators.schedule(tree)
            ends.append(end)
            for p in placed:
                for h in p.anim.holders:
                    prop = h.prop
                    if not self.prop_ok(node, prop):
                        self.warn('property %s on <%s> %s (not animatable, ignored)' % (prop, node.kind, name))
                        continue
                    self.props.setdefault((id(node), prop), []).append((p, h))
                    self.nodes[id(node)] = node
        for k in self.props:
            self.props[k].sort(key=lambda ph: (ph[0].start, ph[0].order))
        self.end = max(ends) if ends else 0.0
        finite = [p.end for lst in self.props.values() for p, _ in lst if p.end != animators.INF]
        self.finite_end = max(finite) if finite else 0.0
        self.infinite = self.end == animators.INF
        periods = [p.start + p.anim.duration * (2 if p.anim.mode == 'reverse' else 1)
                   for lst in self.props.values() for p, _ in lst if p.end == animators.INF]
        #: a time span worth sampling: the finite part plus one period of the repeating ones
        self.span = max([self.finite_end] + periods)

    def prop_ok(self, node, prop):
        if node.kind == 'group':
            return prop in VGroup.PROPS
        if node.kind == 'path':
            return prop in VPath.PROPS
        if node.kind == 'clip':
            return prop == 'pathData'
        if node.kind == 'vector':
            return prop == 'alpha'
        return False

    # ------------------------------------------------------------------ time and clocks
    def setup_time(self):
        opts = self.opts
        at = sysvar('animationTime()')
        mode = opts.mode
        if mode == 'auto':
            mode = 'once'
        self.play_mode = mode
        if opts.trigger:
            base = E('op', '-', (at, V(opts.trigger)))
        else:
            base = at
        if mode == 'loop' and not self.infinite and self.end > 0:
            self.t = self.pool.ref(E('op', '%', (N(base), N(self.end))), name='t')
        elif opts.trigger:
            self.t = self.pool.ref(base, name='t')
        else:
            self.t = at

    def clock(self, placed):
        """The animator's interpolated fraction e(t) as a variable."""
        a = placed.anim
        S, D, R = placed.start, a.duration, a.repeat
        t = self.t
        if D <= 0:
            f = fn('step', t - S + EPS_T, 0)
        else:
            base = (t - S) / D if S else t / D
            if R == 0:
                f = clamp01(base)
            elif R > 0 and a.mode == 'restart':
                p = self.pool.ref(clamp(base, 0, R + 1))
                f = (p - fn('ceil', p) + 1) * fn('step', p, 0)
            elif R > 0:
                f = fn('ping_pong', clamp(base, 0, R + 1), 1)
            elif a.mode == 'restart':
                f = fn('fract', fn('max', base, 0))
            else:
                f = fn('ping_pong', fn('max', base, 0), 1)
        fv = self.pool.ref(f)
        return self.pool.ref(self.ease(a.interp, fv))

    def ease(self, interp, f):
        """interp(f) as an expression (f is a variable or number)."""
        if interp is None or f.is_num and interp.kind == 'linear':
            return f
        k, p = interp.kind, interp.params
        if k == 'linear':
            return f
        if k == 'accelerate':
            return f * f if p[0] == 1 else fn('pow', f, 2 * p[0])
        if k == 'decelerate':
            return f * (2 - f) if p[0] == 1 else 1 - fn('pow', 1 - f, 2 * p[0])
        if k == 'accel_decel':
            return 0.5 - fn('cos', f * math.pi) * 0.5
        if k == 'anticipate':
            T = p[0]
            return f * f * ((T + 1) * f - T)
        if k == 'overshoot':
            T = p[0]
            g = self.pool.ref(f - 1)
            return g * g * ((T + 1) * g + T) + 1
        if k == 'cycle':
            return fn('sin', f * (2 * math.pi * p[0]))
        cub = interp.is_cubic()
        if cub and cub == (0.0, 0.0, 1.0, 1.0):
            pass
        return fn('spline', self.table(interp), f)

    def table(self, interp):
        for n in TABLE_SIZES:
            ys = [interp.value(i / (n - 1)) for i in range(n)]
            err = 0.0
            for j in range(201):
                x = j / 200.0
                err = max(err, abs(_spline(ys, x) - interp.value(x)))
            if err < TABLE_TOL:
                break
        return self.pool.array(ys)

    # ------------------------------------------------------------------ chains
    def chain(self, node, prop, static):
        """The Chain of an animated property, or None when it does not animate."""
        lst = self.props.get((id(node), prop))
        if not lst:
            return None
        ch = Chain(static)
        first = True
        for k, (placed, h) in enumerate(lst):
            # the most recently started animator drives the property: an earlier one that is
            # still running when a later one starts counts as finished from then on
            nxt = lst[k + 1][0].start if k + 1 < len(lst) else None
            cut = nxt is not None and placed.end > nxt + 1e-9
            if cut:
                self.warn('overlapping animators on %s (the later one takes over)' % prop)
            n0 = len(ch.weights)
            e = self.clock(placed)
            if h.motion is not None:
                self.motion(ch, placed, h, e, first)
            else:
                self.keyframes(ch, placed, h, e, first)
            first = False
            if cut:
                for i in range(n0, len(ch.weights)):
                    if ch.deltas[i] is not None:
                        ch.deltas[i] = if_gt0(self.t - nxt + EPS_T, ch.states[i + 1] - ch.states[i], ch.deltas[i])
                    else:
                        ch.weights[i] = if_gt0(self.t - nxt + EPS_T, 1, ch.weights[i])
        if len(ch.states) == 1:
            return None
        return ch

    def keyframes(self, ch, placed, h, e, first):
        kfs = h.keyframes
        vals = [k.value if k.value is not None else ch.last for k in kfs]
        start_val = vals[0]
        if not same(start_val, ch.last):
            if first and placed.start <= 0:
                ch.states[0] = start_val        # the static value is never seen
            else:
                ch.push(start_val, fn('step', self.t - placed.start + EPS_T, 0))
        m = len(kfs) - 1
        for j in range(1, m + 1):
            fa, fb = kfs[j - 1].fraction, kfs[j].fraction
            if fb <= fa:
                w = fn('step', e - fa, 0)
            else:
                raw = (e - fa) / (fb - fa) if fa else e / (fb - fa)
                if m > 1:
                    if j == 1:
                        raw = fn('min', raw, 1)
                    elif j == m:
                        raw = fn('max', raw, 0)
                    else:
                        raw = clamp01(raw)
                    raw = self.pool.ref(raw) if kfs[j].interp is not None and kfs[j].interp.kind != 'linear' else raw
                w = self.ease(kfs[j].interp, raw) if kfs[j].interp is not None else raw
            ch.push(vals[j], w)

    def motion(self, ch, placed, h, e, first):
        """propertyXName / propertyYName along a path: Android samples the path into evenly
        spaced points (by arc length, at most 100) and interpolates linearly between them; the
        same table here, read with arrayGet + lerp."""
        ops = h.motion
        v = self.vec
        precision = 0.5 * min(v.vw / (v.width * DENSITY), v.vh / (v.height * DENSITY))
        pts = _motion_samples(ops, None, precision)
        ax = h.axis
        vals = [p[ax] for p in pts]
        if first and placed.start <= 0:
            ch.states[0] = vals[0]
        elif not same(vals[0], ch.last):
            ch.push(vals[0], fn('step', self.t - placed.start + EPS_T, 0))
        lo, hi = min(vals), max(vals)
        if hi - lo < 1e-9:
            return
        linear = all(abs(v - (vals[0] + (vals[-1] - vals[0]) * i / (len(vals) - 1))) < 1e-3 * max(1.0, hi - lo) for i, v in enumerate(vals))
        if linear:
            ch.push(vals[-1], e)
            return
        n = len(vals)
        arr = self.pool.array(vals)
        pos = self.pool.ref(e * (n - 1))
        i0 = self.pool.ref(clamp(fn('floor', pos), 0, n - 2))
        v = fn('lerp', fn('arrayGet', arr, i0), fn('arrayGet', arr, i0 + 1), pos - i0)
        ch.push(vals[-1], None, delta=v - vals[0])

    def scalar(self, node, prop):
        """A property's value: a number, or an expression when it animates."""
        static = getattr(node, prop)
        ch = self.chain(node, prop, static)
        if ch is None:
            return N(static)
        v = N(ch.states[0])
        for i in range(1, len(ch.states)):
            d = ch.deltas[i - 1]
            if d is not None:
                v = v + d
            else:
                v = v + (ch.states[i] - ch.states[i - 1]) * ch.weights[i - 1]
        lst = self.props[(id(node), prop)]
        if any(h.vtype == 'int' for _, h in lst):
            v = fn('floor', v)
        return v

    # ------------------------------------------------------------------ paths
    def path_name(self, ops, hint='p'):
        js = ops_json(ops)
        key = repr(js)
        if key in self.path_keys:
            return self.path_keys[key]
        name = '%s%d' % (hint, len(self.paths))
        self.paths[name] = js
        self.path_keys[key] = name
        return name

    def path_value(self, node, evenodd=False, cmds=None, strip=False):
        """'$paths.x' or a pathTween id for the node's (possibly morphing) pathData."""
        ch = self.chain(node, 'pathData', node.pathData)
        states = ch.states if ch else [node.pathData]
        ops_list = pathdata.morph_ops(states) if len(states) > 1 else [pathdata.to_ops(states[0])]
        if strip and len(ops_list) == 1:
            ops_list = [pathdata.strip_degenerate(ops_list[0])]
        if ops_list is None:
            self.warn('path morph between incompatible paths (first keyframe drawn)')
            ops_list = [pathdata.to_ops(states[0])]
            ch = None
        if evenodd:
            flips = pathdata.evenodd_flips(ops_list[0])
            if any(flips):
                ops_list = [pathdata.reverse_contours(o, flips) for o in ops_list]
        names = ['$paths.' + self.path_name(o) for o in ops_list]
        if ch is None or len(names) == 1:
            return names[0], None
        return names, ch.weights

    def resolve_path(self, pv, cmds, single_use=False):
        """A drawable path reference from path_value's result, emitting pathTweens; with
        `single_use` and one transition, returns ('tween', p1, p2, w) for drawTweenPath."""
        names, weights = pv
        if weights is None:
            return names
        if single_use and len(weights) == 1:
            return ('tween', names[0], names[1], weights[0])
        cur = names[0]
        for nm, w in zip(names[1:], weights):
            self.n_tween += 1
            pid = 'tw%d' % self.n_tween
            cmds.append({'pathTween': {'id': pid, 'path1': cur, 'path2': nm, 'tween': self.fval(w)}})
            cur = pid
        return cur

    # ------------------------------------------------------------------ values in JSON
    def fval(self, e):
        e = N(e)
        if e.is_num:
            return num(e.v)
        return self.pool.value(e).infix()

    # ------------------------------------------------------------------ colours and paint
    def color_json(self, c):
        """A colour field value: '#AARRGGBB' or '@colors.name' (theme colours are opaque)."""
        if c.theme:
            if self.opts.theme:
                self.theme_used.add(c.theme)
                return '@colors.' + c.theme
            r, g, b = c.rgb(dark=True)
            return '#FF%02X%02X%02X' % (r, g, b)
        return '#FF%06X' % (c.argb & 0xFFFFFF)

    def tint_color(self):
        t = self.opts.tint
        if t is None:
            return self.vec.tint
        if t.startswith('#'):
            from .colors import parse_hex
            return Color(parse_hex(t))
        if t not in THEME:
            raise ConvertError('unknown theme colour %r for the tint (one of %s)' % (t, ', '.join(THEME)))
        return Color.themed(t)

    def tinted(self, c):
        v = self.vec
        tint = self.tint_color()
        if tint is None or c is None:
            return c
        if isinstance(c, Gradient):
            g = Gradient()
            for k in Gradient.__slots__:
                setattr(g, k, getattr(c, k))
            g.stops = [(o, self.tinted(sc)) for o, sc in c.stops]
            return g
        mode = (v.tint_mode if self.opts.tint is None else "src_in")
        if mode not in ('src_in', 'src_atop', 'multiply'):
            self.warn('tintMode %s (treated as src_in)' % mode)
        if mode == 'multiply' and not tint.theme and not c.theme:
            r1, g1, b1 = c.rgb()
            r2, g2, b2 = tint.rgb()
            argb = (int(round(c.alpha * tint.alpha * 255)) << 24) | ((r1 * r2 // 255) << 16) | ((g1 * g2 // 255) << 8) | (b1 * b2 // 255)
            return Color(argb)
        return Color((tint.argb & 0xFFFFFF) | (int(round(c.alpha * tint.alpha * 255)) << 24), tint.theme)

    def set_paint(self, cmds, **want):
        """Emit the paint keys that differ from the current state. Keys: shader ('grad' with a
        gradient spec in `gradient`, or None), color, alpha, style, strokeWidth, strokeCap,
        strokeJoin. `alpha` is absolute (a colour resets the alpha to its own)."""
        cur = self.paint
        grad = want.pop('gradient', None)
        out = {}
        if grad is not None:
            ops = [{grad[0]: grad[1]}]
            cur['shader'] = 'grad'
            cur.pop('color', None)
            cur['alpha'] = None
            for k in ('alpha', 'style', 'strokeWidth', 'strokeCap', 'strokeJoin'):
                if k in want and cur.get(k) != want[k]:
                    ops.append({'width' if k == 'strokeWidth' else k: want[k]})
                    cur[k] = want[k]
            cmds.append({'paint': {'ops': ops}})
            return
        if cur.get('shader') == 'grad':
            out['shader'] = 0
            cur['shader'] = None
        if 'color' in want and cur.get('color') != want['color']:
            out['color'] = want['color']
            cur['color'] = want['color']
            cur['alpha'] = want.pop('_color_alpha', 1)
        want.pop('_color_alpha', None)
        for k in ('alpha', 'strokeJoin', 'strokeCap', 'style', 'strokeWidth'):
            if k in want and cur.get(k) != want[k]:
                out[k] = want[k]
                cur[k] = want[k]
        if out:
            cmds.append({'paint': out})

    def gradient_spec(self, g, alpha_mul):
        cols = []
        for off, c in g.stops:
            c2 = c
            if c.theme:
                if not self.opts.theme:
                    r, gg, b = c.rgb()
                    c2 = Color((int(round(c.alpha * 255)) << 24) | (r << 16) | (gg << 8) | b)
            cols.append(c2)
        stops = [num(o) for o, _ in g.stops]
        colors = []
        for c in cols:
            if c.theme:
                self.theme_used.add(c.theme)
                if c.alpha < 1:
                    self.warn('translucent theme colour in a gradient (drawn opaque)')
                colors.append('@colors.' + c.theme)
            else:
                colors.append('#%08X' % c.argb)
        tile = {'clamp': 0, 'repeat': 1, 'mirror': 2}.get(g.tile, 0)
        if g.type == 'linear':
            spec = {'x1': num(g.x1), 'y1': num(g.y1), 'x2': num(g.x2), 'y2': num(g.y2), 'colors': colors, 'stops': stops}
            if tile:
                spec['tileMode'] = tile
            return ('linearGradient', spec)
        if g.type == 'radial':
            spec = {'centerX': num(g.cx), 'centerY': num(g.cy), 'radius': num(g.r), 'colors': colors, 'stops': stops}
            if tile:
                spec['tileMode'] = tile
            return ('radialGradient', spec)
        return ('sweepGradient', {'centerX': num(g.cx), 'centerY': num(g.cy), 'colors': colors, 'stops': stops})

    # ------------------------------------------------------------------ drawing
    def emit_root(self):
        cmds = []
        self.root_alpha = self.scalar(self.vec, 'alpha')
        self.emit_children(self.vec.root, cmds)
        return cmds

    def emit_children(self, group, cmds):
        for c in group.children:
            if c.kind == 'group':
                self.emit_group(c, cmds)
            elif c.kind == 'path':
                self.emit_path(c, cmds)
            elif c.kind == 'clip':
                pv = self.path_value(c)
                ref = self.resolve_path(pv, cmds)
                cmds.append({'clipPath': {'path': ref}})

    def emit_group(self, g, cmds):
        body = []
        tx, ty = self.scalar(g, 'translateX'), self.scalar(g, 'translateY')
        rot = self.scalar(g, 'rotation')
        sx, sy = self.scalar(g, 'scaleX'), self.scalar(g, 'scaleY')
        px, py = self.scalar(g, 'pivotX'), self.scalar(g, 'pivotY')
        pivot = not (px.is_num and px.v == 0 and py.is_num and py.v == 0)
        if not (tx.is_num and tx.v == 0 and ty.is_num and ty.v == 0):
            body.append({'translate': {'dx': self.fval(tx), 'dy': self.fval(ty)}})
        if not (rot.is_num and rot.v % 360 == 0):
            r = {'angle': self.fval(rot)}
            if pivot:
                r['pivotX'] = self.fval(px)
                r['pivotY'] = self.fval(py)
            body.append({'rotate': r})
        if not (sx.is_num and sx.v == 1 and sy.is_num and sy.v == 1):
            s = {'sx': self.fval(sx), 'sy': self.fval(sy)}
            if pivot:
                s['pivotX'] = self.fval(px)
                s['pivotY'] = self.fval(py)
            body.append({'scale': s})
        needs_save = bool(body) or any(c.kind == 'clip' for c in g.children)
        inner = body
        self.emit_children(g, inner)
        if needs_save:
            cmds.append({'save': inner})
        else:
            cmds.extend(inner)

    def emit_path(self, p, cmds):
        # an unset colour is transparent black, which an animator may still animate
        fill = self.tinted(p.fillColor if p.fillColor is not None or (id(p), 'fillColor') not in self.props else Color(0))
        stroke = self.tinted(p.strokeColor if p.strokeColor is not None or (id(p), 'strokeColor') not in self.props else Color(0))
        sw = self.scalar(p, 'strokeWidth')
        ts, te, to = self.scalar(p, 'trimPathStart'), self.scalar(p, 'trimPathEnd'), self.scalar(p, 'trimPathOffset')
        trim = None if (ts.is_num and ts.v == 0 and te.is_num and te.v == 1) else (ts, te, to)
        jobs = []       # (path value, paint keys, layers)
        if fill is not None:
            layers = self.layers(p, 'fillColor', fill, self.scalar(p, 'fillAlpha') * self.root_alpha)
            if layers:
                strip = self.opts.strip_degenerate and (stroke is None or (sw.is_num and sw.v <= 0))
                jobs.append((self.path_value(p, evenodd=p.fillType == 'evenOdd', strip=strip), {'style': 'fill'}, layers))
        if stroke is not None and not (sw.is_num and sw.v <= 0):
            layers = self.layers(p, 'strokeColor', stroke, self.scalar(p, 'strokeAlpha') * self.root_alpha)
            if layers:
                if p.strokeMiterLimit != 4 and p.strokeLineJoin == 'miter':
                    self.warn('stroke miter limit %g (player default used)' % p.strokeMiterLimit)
                extra = {'style': 'stroke', 'strokeWidth': self.fval(sw),
                         'strokeCap': p.strokeLineCap if p.strokeLineCap in ('butt', 'round', 'square') else 'butt',
                         'strokeJoin': p.strokeLineJoin if p.strokeLineJoin in ('miter', 'round', 'bevel') else 'miter'}
                jobs.append((self.path_value(p), extra, layers))
        if not jobs:
            return
        single = trim is None and sum(len(l) for _, _, l in jobs) == 1
        refs = {}
        for pv, extra, layers in jobs:
            key = repr(pv)
            if key not in refs:
                refs[key] = self.resolve_path(pv, cmds, single_use=single)
            for paint in layers:
                want = dict(extra)
                want.update(paint)
                self.set_paint(cmds, **want)
                self.draw(refs[key], cmds, trim)

    def layers(self, p, prop, color, alpha_mul):
        """The paints one fill or stroke needs: [paint keys] (one per draw)."""
        ch = self.chain(p, prop, getattr(p, prop) or Color(0)) if (id(p), prop) in self.props else None
        if isinstance(color, Gradient):
            if ch is not None:
                self.warn('animated colour over a gradient (gradient kept)')
            return [{'alpha': self.fval(alpha_mul), 'gradient': self.gradient_spec(color, alpha_mul)}]
        if ch is None:
            a = N(alpha_mul) * color.alpha
            if a.is_num and a.v <= 0:
                return []
            return [self.color_paint(color, a)]
        states = [self.tinted(c) for c in ch.states]
        if any(isinstance(c, Gradient) for c in states):
            self.warn('animated gradient (first state drawn)')
            return [self.color_paint(states[0], N(alpha_mul) * states[0].alpha)] if not isinstance(states[0], Gradient) else []
        ws = [self.pool.ref(w) for w in ch.weights]
        n = len(ws)
        out = []
        for i in range(1, n + 1):
            ca, cb = states[i - 1], states[i]
            w = ws[i - 1]
            gate = N(1)
            if i > 1:
                gate = gate * fn('step', w, 0)
            if i < n:
                gate = gate * (1 - fn('step', ws[i], 0))
            alpha = self.pool.ref((ca.alpha + (cb.alpha - ca.alpha) * w) * alpha_mul)
            if same_rgb(ca, cb):
                out.append(self.color_paint(cb, alpha * gate))
                continue
            w = self.linear_light(ca, cb, w)
            y = self.pool.ref(alpha * w)
            x = alpha * (1 - w) / fn('max', 1 - y, 0.0001)
            out.append(self.color_paint(ca, x * gate))
            out.append(self.color_paint(cb, y * gate))
        return out

    def linear_light(self, ca, cb, w):
        """Android interpolates colours in linear light; two layers mix in sRGB. Warp the
        weight (a table read with spline) so the sRGB mix lands on the linear-light colour."""
        a = [v / 255.0 for v in ca.rgb()]
        b = [v / 255.0 for v in cb.rgb()]
        den = sum((y - x) ** 2 for x, y in zip(a, b))
        if den < 1e-6:
            return w
        lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
        enc = lambda c: c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
        n = 17
        ys = []
        for i in range(n):
            f = i / (n - 1)
            target = [enc(lin(x) + (lin(y) - lin(x)) * f) for x, y in zip(a, b)]
            ys.append(sum((tg - x) * (y - x) for tg, x, y in zip(target, a, b)) / den)
        if max(abs(y - i / (n - 1)) for i, y in enumerate(ys)) < 0.01:
            return w
        return self.pool.ref(fn('spline', self.pool.array(ys), w))

    def color_paint(self, color, alpha):
        """Paint keys for a solid colour at an absolute alpha (expression or number)."""
        alpha = N(alpha)
        if not color.theme and alpha.is_num:
            a = max(0.0, min(1.0, alpha.v))
            ab = int(round(a * 255))
            return {'color': '#%02X%06X' % (ab, color.argb & 0xFFFFFF), '_color_alpha': num(ab / 255.0, 6), 'alpha': num(ab / 255.0, 6)}
        return {'color': self.color_json(color), '_color_alpha': 1, 'alpha': self.fval(alpha)}

    def draw(self, ref, cmds, trim):
        self.stats['draws'] += 1
        if trim is None:
            if isinstance(ref, tuple):
                cmds.append({'drawTweenPath': {'path1': ref[1], 'path2': ref[2], 'tween': self.fval(ref[3])}})
            else:
                cmds.append({'drawPath': {'path': ref}})
            return
        ts, te, to = trim
        for s, e in self.trim_windows(ts, te, to):
            if s.is_num and e.is_num and e.v <= s.v:
                continue
            cmds.append({'drawTweenPath': {'path1': ref, 'path2': ref, 'tween': 0, 'start': self.fval(s), 'stop': self.fval(e)}})

    def trim_windows(self, ts, te, to):
        """[(start, stop)] windows of the path to draw for a trim (VectorDrawable: start and end
        shifted by the offset modulo 1; a window that wraps draws [s, 1] and [0, e])."""
        if to.is_num and to.v == 0:
            if ts.is_num and te.is_num:
                if te.v >= ts.v:
                    return [(ts, te)]
                return [(ts, N(1)), (N(0), te)]
            # animated start / end without offset: draw [start, end]; ends may cross
            return [(ts, te)]
        s = self.pool.ref(fn('fract', ts + to + 1))
        e = self.pool.ref(fn('fract', te + to + 1))
        full = fn('step', 1e-4, fn('abs', ts) + fn('abs', 1 - te))      # 1 when untrimmed
        s1 = if_gt0(full, 0, s)
        e1 = if_gt0(full, 1, if_gt0(s - e, 1, e))
        e2 = if_gt0(s - e, e, 0) * (1 - full)
        return [(s1, e1), (N(0), e2)]

    # ------------------------------------------------------------------ document
    def build(self):
        self.build_timeline()
        self.setup_time()
        v = self.vec
        content = self.emit_root()
        scale = {'scale': {'sx': 'componentWidth() / %s' % fmt(v.vw), 'sy': 'componentHeight() / %s' % fmt(v.vh)}}
        commands = list(self.pool.commands)
        commands.append({'save': [scale] + content})
        w, h = self.opts.size or (v.width, v.height)
        header = {'apiLevel': 7, 'width': num(w, 2), 'height': num(h, 2)}
        if self.opts.description:
            header['contentDescription'] = self.opts.description
        doc = {'header': header}
        resources = {}
        if self.theme_used:
            resources['colors'] = {k: {'light': THEME[k][0], 'dark': THEME[k][1]} for k in sorted(self.theme_used)}
        if self.paths:
            resources['paths'] = self.paths
        if self.pool.float_arrays:
            resources['floatArrays'] = self.pool.float_arrays
        if resources:
            doc['resources'] = resources
        canvas = {'type': 'canvas', 'modifiers': ['fillMaxSize'], 'commands': commands}
        if self.opts.trigger:
            canvas['modifiers'].append({'onClick': {'type': 'valueFloatExpressionChange', 'target': '@' + self.opts.trigger, 'value': 'animationTime()'}})
            # a named (exported) variable, so a host can set it too; -1000: already played
            doc.setdefault('resources', {})['variables'] = {self.opts.trigger: {'value': -1000, 'export': True}}
        doc['root'] = canvas
        return doc


def same(a, b):
    if isinstance(a, list) or isinstance(b, list):
        return a == b
    if isinstance(a, Color) or isinstance(b, Color):
        return a == b
    if isinstance(a, Gradient) or isinstance(b, Gradient):
        return a is b
    return abs(a - b) < 1e-9


def same_rgb(a, b):
    return a.theme == b.theme and (a.theme is not None or (a.argb & 0xFFFFFF) == (b.argb & 0xFFFFFF))


def ops_json(ops):
    out = []
    for op in ops:
        t = op[0]
        if t == 'M':
            out.append({'type': 'moveTo', 'x': num(op[1]), 'y': num(op[2])})
        elif t == 'L':
            out.append({'type': 'lineTo', 'x': num(op[1]), 'y': num(op[2])})
        elif t == 'Q':
            out.append({'type': 'quadTo', 'x1': num(op[1]), 'y1': num(op[2]), 'x2': num(op[3]), 'y2': num(op[4])})
        elif t == 'C':
            out.append({'type': 'cubicTo', 'x1': num(op[1]), 'y1': num(op[2]), 'x2': num(op[3]), 'y2': num(op[4]), 'x3': num(op[5]), 'y3': num(op[6])})
        elif t == 'Z':
            out.append({'type': 'close'})
    return out


def _spline(ys, x):
    from .expr import monotone_spline
    return monotone_spline(ys, x)


def _motion_samples(ops, n, precision=None):
    """Points evenly spaced by arc length along a motion path (all contours): n of them, or
    as AnimatorInflater.setupPathMotion picks, min(100, length / precision + 1)."""
    poly = []
    for c in pathdata.contours(ops) or [ops]:
        pts = pathdata.flatten_contour(c, steps=64)
        poly.append(pts)
    total = 0.0
    flat = []
    for pts in poly:
        for a, b in zip(pts, pts[1:]):
            l = math.hypot(b[0] - a[0], b[1] - a[1])
            flat.append((a, b, l))
            total += l
    if n is None:
        n = max(2, min(MOTION_SAMPLES, int(total / precision) + 1))
    if total == 0 or not flat:
        p = (ops[0][1], ops[0][2]) if ops else (0.0, 0.0)
        return [p] * n
    out = []
    for i in range(n):
        d = total * i / (n - 1)
        acc = 0.0
        for a, b, l in flat:
            if acc + l >= d or (a, b, l) is flat[-1]:
                u = 0 if l == 0 else min(1.0, (d - acc) / l)
                out.append((a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u))
                break
            acc += l
    return out
