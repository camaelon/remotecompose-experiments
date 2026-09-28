"""Lottie property evaluation: keyframes, easing, bezier motion paths, transforms and 2-D matrices."""

import math



# ─────────────────────────────────────────────────────────────────────────────
# Lottie property evaluation
# ─────────────────────────────────────────────────────────────────────────────

def _lst(v):
    if isinstance(v, (list, tuple)):
        return list(v)
    return [v]

def _pick(v, d):
    if isinstance(v, (list, tuple)):
        if not v:
            return 0.0
        return float(v[d] if d < len(v) else v[0])
    return float(v)


def cubic_bezier_y(x, x1, y1, x2, y2):
    """y of the CSS-style easing curve (0,0)-(x1,y1)-(x2,y2)-(1,1) at abscissa x."""
    x1 = min(1.0, max(0.0, x1))
    x2 = min(1.0, max(0.0, x2))
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    if abs(x1 - y1) < 1e-9 and abs(x2 - y2) < 1e-9:
        return x  # linear

    def bx(t):
        return 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t * t * x2 + t ** 3

    def by(t):
        return 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3

    t = x
    for _ in range(8):
        d = 3 * (1 - t) ** 2 * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2)
        if abs(d) < 1e-6:
            break
        nt = t - (bx(t) - x) / d
        if nt < 0 or nt > 1:
            break
        if abs(nt - t) < 1e-7:
            t = nt
            break
        t = nt
    if abs(bx(t) - x) > 1e-5:
        lo, hi = 0.0, 1.0
        for _ in range(40):
            t = (lo + hi) / 2
            if bx(t) < x:
                lo = t
            else:
                hi = t
    return by(t)


def ease_kf(k0, p, d=0):
    """Eased progress for the segment starting at keyframe k0; d picks the dimension."""
    o = k0.get('o')
    i = k0.get('i')
    if not o or not i:
        return p
    return cubic_bezier_y(p, _pick(o.get('x'), d), _pick(o.get('y'), d),
                          _pick(i.get('x'), d), _pick(i.get('y'), d))


def _is_keyframes(k):
    return isinstance(k, list) and k and isinstance(k[0], dict) and 't' in k[0]


class Prop:
    """An animatable Lottie property: `at(t)` yields a list of floats (or a shape dict)."""

    def __init__(self, data, default, is_shape=False):
        self.is_shape = is_shape
        self.k = None
        self.value = None
        self.animated = False
        if data is None:
            self.value = default if is_shape else _lst(default)
            return
        if isinstance(data, (int, float, list)):
            self.value = _lst(data)
            return
        k = data.get('k', default)
        if data.get('a', 0) == 1 or _is_keyframes(k):
            if _is_keyframes(k) and len(k) > 1:
                self.k = k
                self.animated = True
                return
            if _is_keyframes(k):
                k = k[0].get('s', default)
                if is_shape and isinstance(k, list):
                    k = k[0] if k else default
        if is_shape:
            self.value = k
        else:
            self.value = _lst(k)

    def keyframe_times(self):
        return [kf['t'] for kf in self.k] if self.animated else []

    def _seg_values(self, j):
        k0, k1 = self.k[j], self.k[j + 1]
        s = k0.get('s')
        e = k1.get('s', k0.get('e', s))
        if s is None:
            s = e
        return s, e

    def locate(self, t):
        """(segment index, linear progress) for time t."""
        kf = self.k
        if t <= kf[0]['t']:
            return 0, 0.0
        for j in range(len(kf) - 1):
            k0, k1 = kf[j], kf[j + 1]
            if t < k1['t']:
                if k0.get('h'):
                    return j, 0.0
                span = k1['t'] - k0['t']
                return j, (t - k0['t']) / span if span > 0 else 1.0
        return len(kf) - 2, 1.0

    def seg_u(self, t):
        """(segment index, eased tween) — used for path morphing."""
        j, p = self.locate(t)
        if p >= 1:
            return j, 1.0
        if self.k[j].get('h'):
            return j, 0.0
        return j, ease_kf(self.k[j], p, 0)

    def value_at_keyframe(self, j):
        if j < len(self.k) - 1:
            return self._seg_values(j)[0]
        return self._seg_values(len(self.k) - 2)[1]

    def at(self, t):
        if not self.animated:
            return self.value
        j, p = self.locate(t)
        k0 = self.k[j]
        s, e = self._seg_values(j)
        if self.is_shape:
            s0 = s[0] if isinstance(s, list) else s
            e0 = e[0] if isinstance(e, list) else e
            if p >= 1:
                return e0
            if k0.get('h') or p <= 0:
                return s0
            return lerp_shape(s0, e0, ease_kf(k0, p, 0))
        s = _lst(s)
        e = _lst(e)
        if p >= 1:
            return list(e)
        if k0.get('h') or p <= 0:
            return list(s)
        to, ti = k0.get('to'), k0.get('ti')
        if to and ti and len(s) >= 2 and (any(abs(x) > 1e-9 for x in to[:2]) or any(abs(x) > 1e-9 for x in ti[:2])):
            u = ease_kf(k0, p, 0)
            return bezier_arclen_point(s, e, to, ti, u)
        n = min(len(s), len(e))
        return [s[d] + (e[d] - s[d]) * ease_kf(k0, p, d) for d in range(n)]


def lerp_shape(a, b, u):
    def lp(pa, pb):
        n = min(len(pa), len(pb))
        return [[pa[i][0] + (pb[i][0] - pa[i][0]) * u, pa[i][1] + (pb[i][1] - pa[i][1]) * u] for i in range(n)]
    return {'v': lp(a['v'], b['v']), 'i': lp(a['i'], b['i']), 'o': lp(a['o'], b['o']), 'c': a.get('c', False)}


def bezier_arclen_point(s, e, to, ti, u, samples=48):
    """Point at arc-length fraction u along the spatial bezier s -> e (After Effects style)."""
    p0 = (s[0], s[1])
    p1 = (s[0] + to[0], s[1] + to[1])
    p2 = (e[0] + ti[0], e[1] + ti[1])
    p3 = (e[0], e[1])

    def pt(t):
        mt = 1 - t
        a, b, c, d = mt ** 3, 3 * mt * mt * t, 3 * mt * t * t, t ** 3
        return (a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1])

    pts = [pt(k / samples) for k in range(samples + 1)]
    lens = [0.0]
    for k in range(1, len(pts)):
        lens.append(lens[-1] + math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]))
    total = lens[-1]
    if total <= 1e-9:
        return [s[0] + (e[0] - s[0]) * u, s[1] + (e[1] - s[1]) * u] + list(s[2:])
    target = u * total
    for k in range(1, len(lens)):
        if lens[k] >= target:
            seg = lens[k] - lens[k - 1]
            f = (target - lens[k - 1]) / seg if seg > 0 else 0.0
            t = (k - 1 + f) / samples
            x, y = pt(t)
            return [x, y] + list(s[2:])
    return list(e)


# affine matrices as (a, b, c, d, e, f): x' = a x + c y + e ; y' = b x + d y + f
def m_mul(m1, m2):
    """m1 · m2 (apply m2 first, then m1)."""
    a1, b1, c1, d1, e1, f1 = m1
    a2, b2, c2, d2, e2, f2 = m2
    return (a1 * a2 + c1 * b2, b1 * a2 + d1 * b2,
            a1 * c2 + c1 * d2, b1 * c2 + d1 * d2,
            a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1)

M_ID = (1, 0, 0, 1, 0, 0)
def m_translate(x, y): return (1, 0, 0, 1, x, y)
def m_scale(x, y): return (x, 0, 0, y, 0, 0)
def m_rotate(deg):
    r = math.radians(deg)
    c, s = math.cos(r), math.sin(r)
    return (c, s, -s, c, 0, 0)
def m_skew(kx, ky): return (1, ky, kx, 1, 0, 0)
def m_apply(m, x, y):
    a, b, c, d, e, f = m
    return (a * x + c * y + e, b * x + d * y + f)


# ─────────────────────────────────────────────────────────────────────────────
# Transform (layer `ks` or shape group `tr`)
# ─────────────────────────────────────────────────────────────────────────────

class Transform:
    def __init__(self, tr, auto_orient=False):
        tr = tr or {}
        self.a = Prop(tr.get('a'), [0, 0, 0])
        p = tr.get('p')
        self.split = bool(isinstance(p, dict) and p.get('s'))
        if self.split:
            self.px = Prop(p.get('x'), [0])
            self.py = Prop(p.get('y'), [0])
        else:
            self.p = Prop(p, [0, 0, 0])
        self.s = Prop(tr.get('s'), [100, 100, 100])
        self.r = Prop(tr.get('r'), [0])
        self.o = Prop(tr.get('o'), [100])
        self.sk = Prop(tr.get('sk'), [0])
        self.sa = Prop(tr.get('sa'), [0])
        self.auto_orient = auto_orient and self.pos_animated()

    def pos_animated(self):
        return (self.px.animated or self.py.animated) if self.split else self.p.animated

    def pos(self, t):
        if self.split:
            return [self.px.at(t)[0], self.py.at(t)[0]]
        v = self.p.at(t)
        return [v[0], v[1] if len(v) > 1 else 0.0]

    def anchor(self, t):
        v = self.a.at(t)
        return [v[0], v[1] if len(v) > 1 else 0.0]

    def scale(self, t):
        v = self.s.at(t)
        return [v[0] / 100.0, (v[1] if len(v) > 1 else v[0]) / 100.0]

    def orient(self, t):
        """Auto-orient: the direction of motion, in degrees (lottie-web samples the position
        a hundredth of a frame apart, clamped to the keyframe range)."""
        times = (self.px.keyframe_times() + self.py.keyframe_times()) if self.split else self.p.keyframe_times()
        if not times:
            return 0.0
        lo, hi = min(times), max(times)
        for h in (0.01, 0.1, 0.5, 2.0):
            t0 = min(max(t - h, lo), hi)
            t1 = min(max(t + h, lo), hi)
            if t1 <= t0:
                t0, t1 = lo, min(hi, lo + h)
            p0, p1 = self.pos(t0), self.pos(t1)
            dx, dy = p1[0] - p0[0], p1[1] - p0[1]
            if abs(dx) > 1e-7 or abs(dy) > 1e-7:
                return math.degrees(math.atan2(dy, dx))
        return 0.0

    def rot(self, t):
        r = self.r.at(t)[0]
        if self.auto_orient:
            r += self.orient(t)
        return r

    def opacity(self, t): return self.o.at(t)[0] / 100.0
    def skew(self, t): return self.sk.at(t)[0]
    def skew_axis(self, t): return self.sa.at(t)[0]

    def is_animated(self):
        props = [self.a, self.s, self.r, self.o, self.sk, self.sa] + ([self.px, self.py] if self.split else [self.p])
        return any(p.animated for p in props)

    def matrix(self, t):
        """Point transform at time t: T(p) · R(r) · Skew · S(s) · T(-a)."""
        px, py = self.pos(t)
        ax, ay = self.anchor(t)
        sx, sy = self.scale(t)
        r = self.rot(t)
        sk, sa = self.skew(t), self.skew_axis(t)
        m = m_translate(px, py)
        if r:
            m = m_mul(m, m_rotate(r))
        if sk:
            m = m_mul(m, m_rotate(-sa))
            m = m_mul(m, m_skew(math.tan(math.radians(-sk)), 0))
            m = m_mul(m, m_rotate(sa))
        m = m_mul(m, m_scale(sx, sy))
        m = m_mul(m, m_translate(-ax, -ay))
        return m
