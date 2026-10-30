"""oracle.py — an independent reference renderer for animated vector drawables.

Evaluates an AVD's state at time t the way Android does (ValueAnimator / AnimatorSet /
KeyframeSet semantics, hwui's colour evaluator in linear light, PathParser node morphing,
VectorDrawable's trim, stroke scaling and layer alpha / tint) and writes a static SVG, which
rsvg-convert rasterises. It shares only input parsing with the converter (the vector tree,
the animator tree, path grammar); timing, interpolators, keyframes, trims and drawing are
written separately here so a converter bug does not reproduce itself in the reference.
"""

import math
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from avdrc import animators, pathdata  # noqa: E402
from avdrc.colors import Color  # noqa: E402
from avdrc.vector import Gradient  # noqa: E402

RSVG = '/opt/homebrew/bin/rsvg-convert'


# ------------------------------------------------------------------ interpolators (own code)

def _bezier(p0, p1, p2, p3, t):
    u = 1 - t
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3


class _PathLookup:
    """Android's PathInterpolator: the path approximated by points, y looked up by x with
    linear interpolation between neighbours."""

    def __init__(self, ops):
        xs, ys = [0.0], [0.0]
        cx, cy = 0.0, 0.0
        for op in ops[1:]:
            if op[0] == 'L':
                pts = [(op[1], op[2])]
            elif op[0] == 'Q':
                pts = []
                for i in range(1, 401):
                    t = i / 400
                    u = 1 - t
                    pts.append((u * u * cx + 2 * u * t * op[1] + t * t * op[3], u * u * cy + 2 * u * t * op[2] + t * t * op[4]))
            elif op[0] == 'C':
                pts = [(_bezier(cx, op[1], op[3], op[5], i / 400), _bezier(cy, op[2], op[4], op[6], i / 400)) for i in range(1, 401)]
            else:
                pts = []
            for x, y in pts:
                xs.append(max(x, xs[-1]))
                ys.append(y)
            if op[0] != 'Z':
                cx, cy = op[-2], op[-1]
        self.xs, self.ys = xs, ys

    def __call__(self, x):
        if x <= 0:
            return 0.0
        if x >= 1:
            return 1.0
        xs, ys = self.xs, self.ys
        lo, hi = 0, len(xs) - 1
        while hi - lo > 1:
            m = (lo + hi) // 2
            if xs[m] <= x:
                lo = m
            else:
                hi = m
        if xs[hi] == xs[lo]:
            return ys[hi]
        return ys[lo] + (ys[hi] - ys[lo]) * (x - xs[lo]) / (xs[hi] - xs[lo])


_LOOKUPS = {}


def interpolate(interp, x):
    if interp is None:
        return x
    k, p = interp.kind, interp.params
    if k == 'linear':
        return x
    if k == 'accelerate':
        return x * x if p[0] == 1.0 else math.pow(x, 2 * p[0]) if x > 0 else 0.0
    if k == 'decelerate':
        return 1.0 - (1.0 - x) * (1.0 - x) if p[0] == 1.0 else 1.0 - math.pow(max(0.0, 1.0 - x), 2 * p[0])
    if k == 'accel_decel':
        return math.cos((x + 1) * math.pi) / 2.0 + 0.5
    if k == 'anticipate':
        return x * x * ((p[0] + 1) * x - p[0])
    if k == 'overshoot':
        y = x - 1.0
        return y * y * ((p[0] + 1) * y + p[0]) + 1.0
    if k == 'anticipate_overshoot':
        T = p[0]
        if x < 0.5:
            y = x * 2
            return 0.5 * y * y * ((T + 1) * y - T)
        y = x * 2 - 2
        return 0.5 * (y * y * ((T + 1) * y + T) + 2.0)
    if k == 'bounce':
        t = x * 1.1226
        if t < 0.3535:
            return 8 * t * t
        if t < 0.7408:
            return 8 * (t - 0.54719) ** 2 + 0.7
        if t < 0.9644:
            return 8 * (t - 0.8526) ** 2 + 0.9
        return 8 * (t - 1.0435) ** 2 + 0.95
    if k == 'cycle':
        return math.sin(2 * p[0] * math.pi * x)
    if k == 'path':
        key = interp.params
        if key not in _LOOKUPS:
            _LOOKUPS[key] = _PathLookup(interp.params[0])
        return _LOOKUPS[key](x)
    raise ValueError(k)


# ------------------------------------------------------------------ timing (own code)

class Running:
    """One ObjectAnimator placed in time."""

    def __init__(self, anim, start, order):
        self.anim, self.start, self.order = anim, start, order

    def fraction(self, t):
        """(started, eased fraction) at time t — ValueAnimator.animateBasedOnTime."""
        a = self.anim
        if t < self.start:
            return False, 0.0
        play = t - self.start
        D = a.duration
        if D <= 0:
            return True, interpolate(a.interp, 1.0)
        if a.repeat >= 0 and play >= D * (a.repeat + 1):
            it, frac = a.repeat, 1.0
        else:
            it = int(math.floor(play / D))
            frac = play / D - it
        if a.mode == 'reverse' and it % 2 == 1:
            frac = 1.0 - frac
        return True, interpolate(a.interp, frac)


def place(node, t0, out):
    """Returns the end time; appends Running animators (document order)."""
    if isinstance(node, animators.ObjAnim):
        out.append(Running(node, t0 + node.offset, len(out)))
        total = float('inf') if node.repeat < 0 else node.duration * (node.repeat + 1)
        return t0 + node.offset + total
    if node.ordering == 'sequentially':
        t = t0
        for c in node.children:
            if t == float('inf'):
                break
            t = place(c, t, out)
        return t
    end = t0
    for c in node.children:
        end = max(end, place(c, t0, out))
    return end


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_to_srgb(c):
    return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def mix(a, b, f, vtype):
    if vtype == 'path':
        return pathdata.lerp_nodes(a, b, f)
    if vtype == 'color':
        return ('rgba', mix_color(a, b, f))
    v = a + (b - a) * f
    return float(int(v)) if vtype == 'int' else v


def resolve_rgba(c, dark=True):
    """Color or ('rgba', (r, g, b, a)) -> (r, g, b, a) floats 0..1."""
    if isinstance(c, tuple) and c[0] == 'rgba':
        return c[1]
    r, g, b = c.rgb(dark)
    return (r / 255.0, g / 255.0, b / 255.0, c.alpha)


def mix_color(a, b, f):
    ra, rb = resolve_rgba(a), resolve_rgba(b)
    out = []
    for i in range(3):
        x = srgb_to_linear(ra[i]) + (srgb_to_linear(rb[i]) - srgb_to_linear(ra[i])) * f
        out.append(linear_to_srgb(min(1.0, max(0.0, x))))
    out.append(ra[3] + (rb[3] - ra[3]) * f)
    return tuple(out)


def keyframe_value(h, f, start_value):
    kfs = h.keyframes
    vals = [k.value if k.value is not None else start_value for k in kfs]
    n = len(kfs)
    if n == 2:
        if kfs[1].interp is not None:
            f = interpolate(kfs[1].interp, f)
        return mix(vals[0], vals[1], f, h.vtype)
    if f <= 0:
        i = 1
    elif f >= 1:
        i = n - 1
    else:
        i = 1
        while i < n - 1 and f > kfs[i].fraction:
            i += 1
    a, b = kfs[i - 1], kfs[i]
    span = b.fraction - a.fraction
    g = (f - a.fraction) / span if span else 1.0
    if b.interp is not None:
        g = interpolate(b.interp, g)
    return mix(vals[i - 1], vals[i], g, h.vtype)


def motion_points(ops, precision):
    """The path sampled by arc length into Android's point list (precision 0.5 px)."""
    polys = []
    cur = []
    cx = cy = sx = sy = 0.0
    for op in ops:
        if op[0] == 'M':
            if len(cur) > 1:
                polys.append(cur)
            cur = [(op[1], op[2])]
            cx, cy, sx, sy = op[1], op[2], op[1], op[2]
        elif op[0] == 'L':
            cur.append((op[1], op[2])); cx, cy = op[1], op[2]
        elif op[0] == 'Q':
            for i in range(1, 65):
                t = i / 64; u = 1 - t
                cur.append((u * u * cx + 2 * u * t * op[1] + t * t * op[3], u * u * cy + 2 * u * t * op[2] + t * t * op[4]))
            cx, cy = op[3], op[4]
        elif op[0] == 'C':
            for i in range(1, 65):
                t = i / 64
                cur.append((_bezier(cx, op[1], op[3], op[5], t), _bezier(cy, op[2], op[4], op[6], t)))
            cx, cy = op[5], op[6]
        elif op[0] == 'Z':
            cur.append((sx, sy)); cx, cy = sx, sy
    if len(cur) > 1:
        polys.append(cur)
    segs = []
    for poly in polys:
        for a, b in zip(poly, poly[1:]):
            segs.append((a, b, math.hypot(b[0] - a[0], b[1] - a[1])))
    total = sum(s[2] for s in segs)
    if total == 0:
        p = (ops[0][1], ops[0][2])
        return [p, p]
    # Android: min(MAX_NUM_POINTS = 100, length / precision + 1) with precision half a pixel
    # of the viewport at the device density (~0.2 viewport units on a phone)
    n = min(100, int(total / precision) + 1)
    n = max(n, 2)
    out = []
    for i in range(n):
        d = total * i / (n - 1)
        acc = 0.0
        for a, b, l in segs:
            if acc + l >= d - 1e-12:
                u = 0.0 if l == 0 else max(0.0, min(1.0, (d - acc) / l))
                out.append((a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u))
                break
            acc += l
        else:
            out.append(segs[-1][1])
    return out


class State:
    """Property values of one Doc at a time."""

    def __init__(self, doc):
        self.doc = doc
        self.tracks = {}            # (id(node), prop) -> [(Running, holder)]
        self.node_of = {}
        for name, tree in doc.targets:
            node = doc.vector.targets.get(name)
            if node is None:
                continue
            runs = []
            place(tree, 0.0, runs)
            for r in runs:
                for h in r.anim.holders:
                    self.tracks.setdefault((id(node), h.prop), []).append((r, h))
        for k in self.tracks:
            self.tracks[k].sort(key=lambda rh: (rh[0].start, rh[0].order))
        self._motion = {}

    def value(self, node, prop, t):
        lst = self.tracks.get((id(node), prop))
        static = getattr(node, prop)
        if static is None and lst and prop in ('fillColor', 'strokeColor'):
            static = Color(0)
        if not lst:
            return static
        current = None
        for r, h in lst:
            if r.start <= t:
                current = (r, h)
        if current is None:
            return static
        r, h = current
        _, f = r.fraction(t)
        if h.motion is not None:
            key = id(h)
            if key not in self._motion:
                v = self.doc.vector
                # AnimatedVectorDrawable passes the drawable's pixel size (viewport units per
                # device pixel) and setupPathMotion uses half of it; density 2.625 (420 dpi)
                pixel = min(v.vw / (v.width * 2.625), v.vh / (v.height * 2.625))
                self._motion[key] = motion_points(h.motion, 0.5 * pixel)
            pts = self._motion[key]
            vals = [p[h.axis] for p in pts]
            # ofFloat(values): evenly spaced keyframes, linear
            n = len(vals)
            pos = f * (n - 1)
            if pos <= 0:
                i = 0
            elif pos >= n - 1:
                i = n - 2
            else:
                i = int(pos)
            u = pos - i
            return vals[i] + (vals[i + 1] - vals[i]) * u
        start_value = None
        if any(k.value is None for k in h.keyframes):
            start_value = self.value(node, prop, r.start - 1e-7)
        return keyframe_value(h, f, start_value)


# ------------------------------------------------------------------ geometry (own code)

def mat_mul(a, b):
    return (a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
            a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
            a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5])


def mat_apply(m, x, y):
    return m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]


def group_matrix(sx, sy, rot, px, py, tx, ty):
    """VectorDrawable: postTranslate(-pivot), postScale, postRotate, postTranslate(t + pivot)."""
    m = (1, 0, 0, 1, -px, -py)
    m = mat_mul((sx, 0, 0, sy, 0, 0), m)
    r = math.radians(rot)
    c, s = math.cos(r), math.sin(r)
    m = mat_mul((c, s, -s, c, 0, 0), m)
    m = mat_mul((1, 0, 0, 1, tx + px, ty + py), m)
    return m


def matrix_scale(m):
    v0 = (m[2], m[3])      # map (0, 1)
    v1 = (m[0], m[1])      # map (1, 0)
    sx = math.hypot(*v0)
    sy = math.hypot(*v1)
    cross = v0[0] * v1[1] - v0[1] * v1[0]
    mx = max(sx, sy)
    return abs(cross) / mx if mx > 0 else 0.0


def flatten_first_contour(ops, steps=48):
    """The first contour of a path as a polyline (SkPathMeasure only measures that one)."""
    pts = []
    cx = cy = sx = sy = 0.0
    started = False
    for op in ops:
        if op[0] == 'M':
            if started and len(pts) > 1:
                break
            pts = [(op[1], op[2])]
            cx, cy, sx, sy = op[1], op[2], op[1], op[2]
            started = True
        elif op[0] == 'L':
            pts.append((op[1], op[2])); cx, cy = op[1], op[2]
        elif op[0] == 'Q':
            for i in range(1, steps + 1):
                t = i / steps; u = 1 - t
                pts.append((u * u * cx + 2 * u * t * op[1] + t * t * op[3], u * u * cy + 2 * u * t * op[2] + t * t * op[4]))
            cx, cy = op[3], op[4]
        elif op[0] == 'C':
            for i in range(1, steps + 1):
                t = i / steps
                pts.append((_bezier(cx, op[1], op[3], op[5], t), _bezier(cy, op[2], op[4], op[6], t)))
            cx, cy = op[5], op[6]
        elif op[0] == 'Z':
            pts.append((sx, sy))
            cx, cy = sx, sy
            break
    return pts


def segment(pts, d0, d1):
    """Part of a polyline between distances d0 and d1."""
    out = []
    acc = 0.0
    for a, b in zip(pts, pts[1:]):
        l = math.hypot(b[0] - a[0], b[1] - a[1])
        s0, s1 = acc, acc + l
        if s1 >= d0 and s0 <= d1 and l > 0:
            u0 = max(0.0, (d0 - s0) / l)
            u1 = min(1.0, (d1 - s0) / l)
            p0 = (a[0] + (b[0] - a[0]) * u0, a[1] + (b[1] - a[1]) * u0)
            p1 = (a[0] + (b[0] - a[0]) * u1, a[1] + (b[1] - a[1]) * u1)
            if not out:
                out.append(p0)
            out.append(p1)
        acc = s1
    return out


def trim_polylines(ops, ts, te, to):
    """VectorDrawable trim (start / end shifted by the offset, modulo 1, wrapping)."""
    pts = flatten_first_contour(ops)
    length = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))
    start = math.fmod(ts + to, 1.0) * length
    end = math.fmod(te + to, 1.0) * length
    if start < 0:
        start = 0.0      # Java's % keeps the sign; getSegment clamps negatives to 0
    if start > end:
        return [p for p in (segment(pts, start, length), segment(pts, 0, end) if end > 0 else []) if len(p) > 1]
    s = segment(pts, start, end)
    return [s] if len(s) > 1 else []


def ops_to_d(ops, m):
    parts = []
    for op in ops:
        if op[0] == 'Z':
            parts.append('Z')
            continue
        pts = [mat_apply(m, x, y) for x, y in zip(op[1::2], op[2::2])]
        parts.append(op[0] + ' '.join('%.3f %.3f' % p for p in pts))
    return ' '.join(parts)


def polys_to_d(polys, m):
    out = []
    for poly in polys:
        pts = [mat_apply(m, x, y) for x, y in poly]
        out.append('M' + ' L'.join('%.3f %.3f' % p for p in pts))
    return ' '.join(out)


# ------------------------------------------------------------------ SVG

def color_attr(c, alpha_mul):
    r, g, b, a = resolve_rgba(c)
    return 'rgb(%d,%d,%d)' % (round(r * 255), round(g * 255), round(b * 255)), max(0.0, min(1.0, a * alpha_mul))


class SvgWriter:
    def __init__(self, doc, W, H, t):
        self.doc = doc
        self.vec = doc.vector
        self.W, self.H = W, H
        self.t = t
        self.state = State(doc)
        self.defs = []
        self.body = []
        self.n = 0
        self.notes = []

    def val(self, node, prop):
        return self.state.value(node, prop, self.t)

    def uid(self, p):
        self.n += 1
        return '%s%d' % (p, self.n)

    def render(self):
        v = self.vec
        base = (self.W / v.vw, 0, 0, self.H / v.vh, 0, 0)
        self.min_scale = min(self.W / v.vw, self.H / v.vh)
        out = []
        self.group(v.root, base, (1, 0, 0, 1, 0, 0), out)
        alpha = self.val(v, 'alpha')
        attrs = ''
        if alpha < 1:
            attrs += ' opacity="%.4f"' % max(0.0, alpha)
        if v.tint is not None:
            fid = self.uid('tint')
            r, g, b, a = resolve_rgba(v.tint)
            mode = v.tint_mode
            op = 'in' if mode in ('src_in', 'multiply', 'src_atop') else 'over'
            self.defs.append('<filter id="%s" filterUnits="userSpaceOnUse" x="0" y="0" width="%d" height="%d" color-interpolation-filters="sRGB">'
                             '<feFlood flood-color="rgb(%d,%d,%d)" flood-opacity="%.4f"/>'
                             '<feComposite in2="SourceGraphic" operator="%s"/></filter>' % (fid, self.W, self.H, round(r * 255), round(g * 255), round(b * 255), a, op))
            attrs += ' filter="url(#%s)"' % fid
        svg = ['<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">' % (self.W, self.H, self.W, self.H),
               '<defs>%s</defs>' % ''.join(self.defs), '<g%s>' % attrs] + out + ['</g></svg>']
        return '\n'.join(svg)

    def group(self, g, base, stack, out):
        """Children of a group; `stack` is the group-stacked matrix (without the viewport)."""
        open_clips = 0
        for c in g.children:
            if c.kind == 'group':
                m = group_matrix(self.val(c, 'scaleX'), self.val(c, 'scaleY'), self.val(c, 'rotation'),
                                 self.val(c, 'pivotX'), self.val(c, 'pivotY'), self.val(c, 'translateX'), self.val(c, 'translateY'))
                self.group(c, base, mat_mul(stack, m), out)
            elif c.kind == 'clip':
                ops = pathdata.to_ops(self.val(c, 'pathData'))
                cid = self.uid('clip')
                self.defs.append('<clipPath id="%s" clipPathUnits="userSpaceOnUse"><path d="%s"/></clipPath>' % (cid, ops_to_d(ops, mat_mul(base, stack))))
                out.append('<g clip-path="url(#%s)">' % cid)
                open_clips += 1
            elif c.kind == 'path':
                self.path(c, base, stack, out)
        out.extend(['</g>'] * open_clips)

    def paint(self, node, prop, alpha_prop, m_local):
        c = self.val(node, prop)
        if c is None:
            return None      # (an animated unset colour starts from transparent black: see State.value)
        a = self.val(node, alpha_prop)
        if isinstance(c, Gradient):
            gid = self.uid('grad')
            stops = ''.join('<stop offset="%.4f" stop-color="%s" stop-opacity="%.4f"/>' % ((o,) + color_attr(sc, 1.0)) for o, sc in c.stops)
            tf = 'matrix(%s)' % ' '.join('%.6f' % x for x in m_local)
            spread = {'clamp': 'pad', 'repeat': 'repeat', 'mirror': 'reflect'}.get(c.tile, 'pad')
            if c.type == 'linear':
                self.defs.append('<linearGradient id="%s" gradientUnits="userSpaceOnUse" x1="%g" y1="%g" x2="%g" y2="%g" gradientTransform="%s" spreadMethod="%s">%s</linearGradient>' % (gid, c.x1, c.y1, c.x2, c.y2, tf, spread, stops))
            elif c.type == 'radial':
                self.defs.append('<radialGradient id="%s" gradientUnits="userSpaceOnUse" cx="%g" cy="%g" r="%g" gradientTransform="%s" spreadMethod="%s">%s</radialGradient>' % (gid, c.cx, c.cy, c.r, tf, spread, stops))
            else:
                self.notes.append('sweep gradient drawn as its first colour')
                return color_attr(c.stops[0][1], a)
            return ('url(#%s)' % gid, max(0.0, min(1.0, a)))
        return color_attr(c, a)

    def path(self, p, base, stack, out):
        m = mat_mul(base, stack)
        ops = pathdata.to_ops(self.val(p, 'pathData'))
        ts, te, to = self.val(p, 'trimPathStart'), self.val(p, 'trimPathEnd'), self.val(p, 'trimPathOffset')
        if ts != 0.0 or te != 1.0:
            d = polys_to_d(trim_polylines(ops, ts, te, to), m)
        else:
            d = ops_to_d(ops, m)
        if not d:
            return
        fill = self.paint(p, 'fillColor', 'fillAlpha', m)
        if fill is not None and fill[1] > 0:
            out.append('<path d="%s" fill="%s" fill-opacity="%.4f" fill-rule="%s" stroke="none"/>' % (
                d, fill[0], fill[1], 'evenodd' if p.fillType == 'evenOdd' else 'nonzero'))
        stroke = self.paint(p, 'strokeColor', 'strokeAlpha', m)
        sw = self.val(p, 'strokeWidth')
        if stroke is not None and stroke[1] > 0 and sw > 0:
            ms = matrix_scale(stack)
            width = sw * self.min_scale * ms
            if width > 0:
                out.append('<path d="%s" fill="none" stroke="%s" stroke-opacity="%.4f" stroke-width="%.4f" stroke-linecap="%s" stroke-linejoin="%s" stroke-miterlimit="%g"/>' % (
                    d, stroke[0], stroke[1], width, p.strokeLineCap, p.strokeLineJoin, p.strokeMiterLimit))


def render_svg(doc, W, H, t):
    w = SvgWriter(doc, W, H, t)
    return w.render(), w.notes


def rasterize(svg_text, svg_path, png_path, W, H):
    with open(svg_path, 'w') as fh:
        fh.write(svg_text)
    r = subprocess.run([RSVG, '-w', str(W), '-h', str(H), '-b', 'none', svg_path, '-o', png_path], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError('rsvg-convert: ' + r.stderr[-300:])
