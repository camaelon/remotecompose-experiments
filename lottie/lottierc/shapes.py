"""Shape geometry: parametric shapes, modifiers (round corners, pucker, zig-zag), path encoding, gradient stops."""

import math

from .wire import P_CLOSE, P_CUBIC, P_LINE, P_MOVE, f2bits
from .props import m_apply


# ─────────────────────────────────────────────────────────────────────────────
# Geometry helpers — shapes are dicts {v, i, o, c} with RELATIVE tangents, as in Lottie
# ─────────────────────────────────────────────────────────────────────────────

KAPPA = 0.5519150244935105707435627
ROUND_CORNER = 0.5519   # lottie-web's constant for round corners

def shape_to_floats(sh):
    """A Lottie bezier shape {v,i,o,c} -> RemoteCompose path tokens (raw bits), cubics only."""
    v, i, o = sh.get('v') or [], sh.get('i') or [], sh.get('o') or []
    n = len(v)
    if n == 0:
        return []
    closed = bool(sh.get('c', False))
    out = [P_MOVE, f2bits(v[0][0]), f2bits(v[0][1])]
    segs = n - 1 + (1 if closed and n > 1 else 0)
    for j in range(segs):
        a, b = j, (j + 1) % n
        out += [P_CUBIC,
                f2bits(v[a][0]), f2bits(v[a][1]),
                f2bits(v[a][0] + o[a][0]), f2bits(v[a][1] + o[a][1]),
                f2bits(v[b][0] + i[b][0]), f2bits(v[b][1] + i[b][1]),
                f2bits(v[b][0]), f2bits(v[b][1])]
    if closed:
        out.append(P_CLOSE)
    return out


def shape_length(sh, samples=16):
    """Approximate arc length of a shape."""
    v, i, o = sh.get('v') or [], sh.get('i') or [], sh.get('o') or []
    n = len(v)
    if n < 2:
        return 0.0
    closed = bool(sh.get('c', False))
    total = 0.0
    segs = n - 1 + (1 if closed else 0)
    for j in range(segs):
        a, b = j, (j + 1) % n
        p0 = v[a]; p1 = (v[a][0] + o[a][0], v[a][1] + o[a][1])
        p2 = (v[b][0] + i[b][0], v[b][1] + i[b][1]); p3 = v[b]
        px, py = p0[0], p0[1]
        for k in range(1, samples + 1):
            t = k / samples; mt = 1 - t
            x = mt ** 3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t ** 3 * p3[0]
            y = mt ** 3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t ** 3 * p3[1]
            total += math.hypot(x - px, y - py)
            px, py = x, y
    return total


def reverse_shape(sh):
    v, i, o = sh.get('v') or [], sh.get('i') or [], sh.get('o') or []
    return {'v': list(reversed(v)), 'i': list(reversed(o)), 'o': list(reversed(i)), 'c': sh.get('c', False)}


def ellipse_shape(p, s, direction=1):
    sx, sy = s[0] / 2.0, s[1] / 2.0
    kx, ky = sx * KAPPA, sy * KAPPA
    px, py = p[0], p[1]
    sh = {
        'v': [[px, py - sy], [px + sx, py], [px, py + sy], [px - sx, py]],
        'i': [[-kx, 0], [0, -ky], [kx, 0], [0, ky]],
        'o': [[kx, 0], [0, ky], [-kx, 0], [0, -ky]],
        'c': True,
    }
    if direction == 3:
        # lottie-web keeps the top vertex first and walks the other way round
        sh = {'v': [sh['v'][0], sh['v'][3], sh['v'][2], sh['v'][1]],
              'i': [sh['o'][0], sh['o'][3], sh['o'][2], sh['o'][1]],
              'o': [sh['i'][0], sh['i'][3], sh['i'][2], sh['i'][1]], 'c': True}
    return sh


def rect_shape(p, s, r, direction=1):
    w, h = s[0], s[1]
    r = max(0.0, min(float(r), w / 2.0, h / 2.0))
    L, T, R, B = p[0] - w / 2.0, p[1] - h / 2.0, p[0] + w / 2.0, p[1] + h / 2.0
    if r <= 1e-9:
        sh = {'v': [[R, T], [R, B], [L, B], [L, T]],
              'i': [[0, 0]] * 4, 'o': [[0, 0]] * 4, 'c': True}
    else:
        k = r * KAPPA
        sh = {
            'v': [[R, T + r], [R, B - r], [R - r, B], [L + r, B], [L, B - r], [L, T + r], [L + r, T], [R - r, T]],
            'i': [[0, -k], [0, 0], [k, 0], [0, 0], [0, k], [0, 0], [-k, 0], [0, 0]],
            'o': [[0, 0], [0, k], [0, 0], [-k, 0], [0, 0], [0, -k], [0, 0], [k, 0]],
            'c': True,
        }
    if direction == 3:
        rv = reverse_shape(sh)
        # keep the same starting vertex
        rv = {'v': rv['v'][-1:] + rv['v'][:-1], 'i': rv['i'][-1:] + rv['i'][:-1], 'o': rv['o'][-1:] + rv['o'][:-1], 'c': True}
        return rv
    return sh


def star_shape(kind, pt, p, rot, outer_r, outer_round, inner_r, inner_round, direction):
    num = max(1, int(math.floor(pt)))
    d = -1.0 if direction == 3 else 1.0
    v, i, o = [], [], []
    if kind == 1:
        n = num * 2
        angle = 2 * math.pi / n
        long_perim = 2 * math.pi * outer_r / (n * 2)
        short_perim = 2 * math.pi * inner_r / (n * 2)
    else:
        n = num
        angle = 2 * math.pi / n
        long_perim = short_perim = 2 * math.pi * outer_r / (n * 4)
    long_flag = True
    cur = -math.pi / 2 + math.radians(rot)
    for _ in range(n):
        if kind == 1:
            rad = outer_r if long_flag else inner_r
            rnd = (outer_round if long_flag else inner_round) / 100.0
            perim = long_perim if long_flag else short_perim
        else:
            rad = outer_r
            rnd = outer_round / 100.0
            perim = long_perim
        x, y = rad * math.cos(cur), rad * math.sin(cur)
        if abs(x) < 1e-12 and abs(y) < 1e-12:
            ox = oy = 0.0
        else:
            L = math.hypot(x, y)
            ox, oy = y / L, -x / L
        v.append([x + p[0], y + p[1]])
        o.append([-ox * perim * rnd * d, -oy * perim * rnd * d])
        i.append([ox * perim * rnd * d, oy * perim * rnd * d])
        long_flag = not long_flag
        cur += angle * d
    return {'v': v, 'i': i, 'o': o, 'c': True}


# ── shape modifiers (ports of lottie-web's implementations) ──────────────────

def _abs_pts(sh):
    v, i, o = sh.get('v') or [], sh.get('i') or [], sh.get('o') or []
    ia = [[v[k][0] + i[k][0], v[k][1] + i[k][1]] for k in range(len(v))]
    oa = [[v[k][0] + o[k][0], v[k][1] + o[k][1]] for k in range(len(v))]
    return [list(x) for x in v], ia, oa


def _from_abs(v, ia, oa, closed):
    return {'v': v, 'i': [[ia[k][0] - v[k][0], ia[k][1] - v[k][1]] for k in range(len(v))],
            'o': [[oa[k][0] - v[k][0], oa[k][1] - v[k][1]] for k in range(len(v))], 'c': closed}


def pucker_bloat_shape(sh, amount):
    v, ia, oa = _abs_pts(sh)
    n = len(v)
    if n == 0 or abs(amount) < 1e-9:
        return sh
    pc = amount / 100.0
    cx = sum(p[0] for p in v) / n
    cy = sum(p[1] for p in v) / n
    nv, ni, no = [], [], []
    for k in range(n):
        nv.append([v[k][0] + (cx - v[k][0]) * pc, v[k][1] + (cy - v[k][1]) * pc])
        no.append([oa[k][0] + (cx - oa[k][0]) * -pc, oa[k][1] + (cy - oa[k][1]) * -pc])
        ni.append([ia[k][0] + (cx - ia[k][0]) * -pc, ia[k][1] + (cy - ia[k][1]) * -pc])
    return _from_abs(nv, ni, no, sh.get('c', False))


def round_corners_shape(sh, rnd):
    v, ia, oa = _abs_pts(sh)
    n = len(v)
    closed = bool(sh.get('c', False))
    if n == 0 or rnd <= 0:
        return sh
    nv, ni, no = [], [], []

    def add(vx, vy, ox, oy, ix, iy):
        nv.append([vx, vy]); no.append([ox, oy]); ni.append([ix, iy])

    for k in range(n):
        cv, co, ci = v[k], oa[k], ia[k]
        sharp = abs(cv[0] - co[0]) < 1e-9 and abs(cv[1] - co[1]) < 1e-9 and abs(cv[0] - ci[0]) < 1e-9 and abs(cv[1] - ci[1]) < 1e-9
        if not sharp or ((k == 0 or k == n - 1) and not closed):
            add(cv[0], cv[1], co[0], co[1], ci[0], ci[1])
            continue
        closer = v[n - 1] if k == 0 else v[k - 1]
        dist = math.hypot(cv[0] - closer[0], cv[1] - closer[1])
        perc = min(dist / 2, rnd) / dist if dist else 0.0
        ix = vx = cv[0] + (closer[0] - cv[0]) * perc
        iy = vy = cv[1] - (cv[1] - closer[1]) * perc
        ox = vx - (vx - cv[0]) * ROUND_CORNER
        oy = vy - (vy - cv[1]) * ROUND_CORNER
        add(vx, vy, ox, oy, ix, iy)
        closer = v[0] if k == n - 1 else v[k + 1]
        dist = math.hypot(cv[0] - closer[0], cv[1] - closer[1])
        perc = min(dist / 2, rnd) / dist if dist else 0.0
        ox = vx = cv[0] + (closer[0] - cv[0]) * perc
        oy = vy = cv[1] + (closer[1] - cv[1]) * perc
        ix = vx - (vx - cv[0]) * ROUND_CORNER
        iy = vy - (vy - cv[1]) * ROUND_CORNER
        add(vx, vy, ox, oy, ix, iy)
    return _from_abs(nv, ni, no, closed)


class _Cubic:
    def __init__(self, p0, p1, p2, p3):
        self.pts = [p0, p1, p2, p3]
        self.a = [-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0], -p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]]
        self.b = [3 * p0[0] - 6 * p1[0] + 3 * p2[0], 3 * p0[1] - 6 * p1[1] + 3 * p2[1]]
        self.c = [-3 * p0[0] + 3 * p1[0], -3 * p0[1] + 3 * p1[1]]
        self.d = [p0[0], p0[1]]

    def point(self, t):
        return [((self.a[0] * t + self.b[0]) * t + self.c[0]) * t + self.d[0],
                ((self.a[1] * t + self.b[1]) * t + self.c[1]) * t + self.d[1]]

    def derivative(self, t):
        return [(3 * t * self.a[0] + 2 * self.b[0]) * t + self.c[0],
                (3 * t * self.a[1] + 2 * self.b[1]) * t + self.c[1]]

    def normal_angle(self, t):
        d = self.derivative(t)
        return math.atan2(d[0], d[1])

    def t_at(self, u, samples=32):
        """Curve parameter at arc-length fraction u (After Effects spaces zig-zag points by length)."""
        pts = [self.point(k / samples) for k in range(samples + 1)]
        lens = [0.0]
        for k in range(1, len(pts)):
            lens.append(lens[-1] + math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]))
        total = lens[-1]
        if total <= 1e-12:
            return u
        target = u * total
        for k in range(1, len(lens)):
            if lens[k] >= target:
                seg = lens[k] - lens[k - 1]
                return (k - 1 + ((target - lens[k - 1]) / seg if seg > 0 else 0.0)) / samples
        return 1.0


def zigzag_shape(sh, amplitude, frequency, point_type):
    v, ia, oa = _abs_pts(sh)
    n = len(v)
    closed = bool(sh.get('c', False))
    count = n if closed else n - 1
    if count <= 0:
        return sh
    nv, ni, no = [], [], []

    def set_point(point, angle, direction, amp, out_amp, in_amp):
        ang_o = angle - math.pi / 2
        ang_i = angle + math.pi / 2
        px = point[0] + math.cos(angle) * direction * amp
        py = point[1] - math.sin(angle) * direction * amp
        nv.append([px, py])
        no.append([px + math.cos(ang_o) * out_amp, py - math.sin(ang_o) * out_amp])
        ni.append([px + math.cos(ang_i) * in_amp, py - math.sin(ang_i) * in_amp])

    def projecting_angle(cur):
        prev = v[n - 1 if cur == 0 else cur - 1]
        nxt = v[(cur + 1) % n]
        vx, vy = nxt[0] - prev[0], nxt[1] - prev[1]
        rx, ry = vy, -vx
        return math.atan2(0, 1) - math.atan2(ry, rx)

    def corner(cur, direction):
        angle = projecting_angle(cur % n)
        point = v[cur % n]
        prev = v[n - 1 if cur % n == 0 else (cur % n) - 1]
        nxt = v[(cur + 1) % n]
        prev_d = math.hypot(point[0] - prev[0], point[1] - prev[1]) if point_type == 2 else 0.0
        next_d = math.hypot(point[0] - nxt[0], point[1] - nxt[1]) if point_type == 2 else 0.0
        set_point(point, angle, direction, amplitude, next_d / ((frequency + 1) * 2), prev_d / ((frequency + 1) * 2))

    def segment(idx):
        nxt = (idx + 1) % n
        return _Cubic(v[idx], oa[idx], ia[nxt], v[nxt])

    def zz_segment(seg, direction):
        k = 0
        while k < frequency:
            t = seg.t_at((k + 1) / (frequency + 1))
            dist = math.hypot(seg.pts[3][0] - seg.pts[0][0], seg.pts[3][1] - seg.pts[0][1]) if point_type == 2 else 0.0
            angle = seg.normal_angle(t)
            point = seg.point(t)
            set_point(point, angle, direction, amplitude, dist / ((frequency + 1) * 2), dist / ((frequency + 1) * 2))
            direction = -direction
            k += 1
        return direction

    direction = -1
    seg = segment(0)
    corner(0, direction)
    for k in range(count):
        direction = zz_segment(seg, -direction)
        if k == count - 1 and not closed:
            seg = None
        else:
            seg = segment((k + 1) % count)
        corner(k + 1, direction)
    return _from_abs(nv, ni, no, closed)


def transform_shape_floats(sh, m):
    v, i, o = sh.get('v') or [], sh.get('i') or [], sh.get('o') or []
    tv, ti, to = [], [], []
    for k in range(len(v)):
        x, y = m_apply(m, v[k][0], v[k][1])
        ix, iy = m_apply(m, v[k][0] + i[k][0], v[k][1] + i[k][1])
        ox, oy = m_apply(m, v[k][0] + o[k][0], v[k][1] + o[k][1])
        tv.append([x, y]); ti.append([ix - x, iy - y]); to.append([ox - x, oy - y])
    return shape_to_floats({'v': tv, 'i': ti, 'o': to, 'c': sh.get('c', False)})


BIG = 1e5
INVERT_RECT = [P_MOVE, f2bits(-BIG), f2bits(-BIG),
               P_LINE, f2bits(-BIG), f2bits(-BIG), f2bits(BIG), f2bits(-BIG),
               P_LINE, f2bits(BIG), f2bits(-BIG), f2bits(BIG), f2bits(BIG),
               P_LINE, f2bits(BIG), f2bits(BIG), f2bits(-BIG), f2bits(BIG),
               P_CLOSE]


def expand_midpoints(stops, steps=6):
    """After Effects exports a gradient *midpoint* as an ordinary stop holding the 50% mix of
    its neighbours, but renders the segment as a power curve through it (mix = t^(ln .5/ln m))
    rather than two linear pieces. Detect such stops and lay extra stops along that curve so a
    linear gradient shader draws the same thing. Evenly placed midpoints stay linear."""
    out = []
    n = len(stops)
    skip = False
    for j in range(n):
        if skip:
            skip = False
            continue
        a = stops[j]
        if 0 < j < n - 1:
            pass
        if j + 2 < n or (j + 2 == n and False):
            pass
        out.append(a)
        if j + 2 <= n - 1:
            mid, b = stops[j + 1], stops[j + 2]
            span = b[0] - a[0]
            if span <= 1e-6:
                continue
            m = (mid[0] - a[0]) / span
            is_mid = all(abs(mid[c] - 0.5 * (a[c] + b[c])) < 0.02 for c in range(1, 5))
            if is_mid and 0.02 < m < 0.98 and abs(m - 0.5) > 0.02:
                expo = math.log(0.5) / math.log(m)
                for k in range(1, steps):
                    t = k / steps
                    mix = t ** expo
                    out.append((a[0] + span * t,) + tuple(a[c] + (b[c] - a[c]) * mix for c in range(1, 5)))
                skip = True   # the midpoint stop itself is replaced by the curve
    return out


def interp_stops(stops, off):
    if not stops:
        return 1.0
    stops = sorted(stops)
    if off <= stops[0][0]:
        return stops[0][1]
    for j in range(len(stops) - 1):
        a, b = stops[j], stops[j + 1]
        if off <= b[0]:
            span = b[0] - a[0]
            f = (off - a[0]) / span if span > 0 else 0.0
            return a[1] + (b[1] - a[1]) * f
    return stops[-1][1]


# Lottie shape-list vocabulary
SHAPE_TYPES = ('sh', 'rc', 'el', 'sr')
STYLE_TYPES = ('fl', 'st', 'gf', 'gs')
MOD_TYPES = ('rd', 'pb', 'zz', 'op')   # 'op' is applied by the paint, not the geometry (see draw_with)
MERGE_OPS = {2: 3, 3: 0, 4: 1, 5: 4}   # Lottie merge mode -> PATH_COMBINE op: add=union, subtract=difference, intersect, exclude=xor
