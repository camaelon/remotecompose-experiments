"""Path data: parsing (Android's PathParser grammar), absolute normalisation, morph checks.

`parse(s)` gives Android's node list: (command letter, [params]) exactly as
`PathParser.createNodesFromPathData` splits it, which is what `pathType` morphing interpolates
(node by node, parameter by parameter). `to_ops(nodes)` turns nodes into absolute
moveTo / lineTo / quadTo / cubicTo / close ops (H/V become lines, S/T reflected controls,
arcs cubics), the form RemoteCompose path data and the JSON op list take.
"""

import math
import re

from .xmlutil import ConvertError

ARGS = {'z': 0, 'm': 2, 'l': 2, 't': 2, 'h': 1, 'v': 1, 'c': 6, 's': 4, 'q': 4, 'a': 7}
_NUM_RE = re.compile(r'[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?')


def parse(s):
    """Android PathParser: a list of (cmd, params). Raises ConvertError on garbage."""
    if s is None:
        return []
    s = s.strip()
    nodes = []
    i, n = 0, len(s)
    cmd = None
    while i < n:
        c = s[i]
        if c.isalpha() and c not in 'eE':
            if c.lower() not in ARGS:
                raise ConvertError('bad path command %r' % c)
            if cmd is not None:
                nodes.append(cmd)
            cmd = (c, [])
            i += 1
            continue
        if c in ' ,\t\r\n':
            i += 1
            continue
        m = _NUM_RE.match(s, i)
        if not m or cmd is None:
            raise ConvertError('bad path data near %r' % s[i:i + 12])
        cmd[1].append(float(m.group(0)))
        i = m.end()
    if cmd is not None:
        nodes.append(cmd)
    for c, p in nodes:
        k = ARGS[c.lower()]
        if k == 0:
            if p:
                raise ConvertError('Z takes no parameters')
        elif len(p) % k != 0:          # an empty command is a no-op (PathParser tolerates it)
            raise ConvertError('path command %s has %d parameters' % (c, len(p)))
    return nodes


def can_morph(a, b):
    """Android's PathParser.canMorph: same commands, same parameter counts."""
    if len(a) != len(b):
        return False
    for (ca, pa), (cb, pb) in zip(a, b):
        if ca != cb or len(pa) != len(pb):
            return False
    return True


def lerp_nodes(a, b, f):
    return [(ca, [x + (y - x) * f for x, y in zip(pa, pb)]) for (ca, pa), (_, pb) in zip(a, b)]


def arc_count(nodes):
    return sum(len(p) // 7 for c, p in nodes if c in 'aA')


def to_ops(nodes, arc_segments=None, used_segments=None):
    """Absolute ops: ('M', x, y) ('L', x, y) ('Q', x1, y1, x, y) ('C', x1, y1, x2, y2, x, y) ('Z',).

    `arc_segments`, when given, forces the number of cubics each arc (in order) becomes, so the
    keyframes of a morph produce compatible lists; `used_segments` (a list) receives the
    counts actually used."""
    ops = []
    cx = cy = 0.0          # current point
    sx = sy = 0.0          # subpath start
    ctrlx = ctrly = 0.0    # last control point (for S / T)
    prev = 'm'
    arc_i = 0
    for cmd, params in nodes:
        lc = cmd.lower()
        rel = cmd.islower()
        k = ARGS[lc]
        if lc == 'z':
            ops.append(('Z',))
            cx, cy = sx, sy
            ctrlx, ctrly = cx, cy
            prev = cmd
            continue
        for j in range(0, len(params), k):
            p = params[j:j + k]
            ox, oy = (cx, cy) if rel else (0.0, 0.0)
            if lc == 'm':
                x, y = p[0] + ox, p[1] + oy
                if j > 0:          # implicit lineTo after the first pair
                    ops.append(('L', x, y))
                else:
                    ops.append(('M', x, y))
                    sx, sy = x, y
                cx, cy = x, y
                ctrlx, ctrly = cx, cy
            elif lc == 'l':
                x, y = p[0] + ox, p[1] + oy
                ops.append(('L', x, y)); cx, cy = x, y; ctrlx, ctrly = cx, cy
            elif lc == 'h':
                x = p[0] + (cx if rel else 0.0)
                ops.append(('L', x, cy)); cx = x; ctrlx, ctrly = cx, cy
            elif lc == 'v':
                y = p[0] + (cy if rel else 0.0)
                ops.append(('L', cx, y)); cy = y; ctrlx, ctrly = cx, cy
            elif lc == 'c':
                x1, y1, x2, y2, x, y = p[0] + ox, p[1] + oy, p[2] + ox, p[3] + oy, p[4] + ox, p[5] + oy
                ops.append(('C', x1, y1, x2, y2, x, y)); ctrlx, ctrly = x2, y2; cx, cy = x, y
            elif lc == 's':
                if prev.lower() in 'cs':
                    x1, y1 = 2 * cx - ctrlx, 2 * cy - ctrly
                else:
                    x1, y1 = cx, cy
                x2, y2, x, y = p[0] + ox, p[1] + oy, p[2] + ox, p[3] + oy
                ops.append(('C', x1, y1, x2, y2, x, y)); ctrlx, ctrly = x2, y2; cx, cy = x, y
            elif lc == 'q':
                x1, y1, x, y = p[0] + ox, p[1] + oy, p[2] + ox, p[3] + oy
                ops.append(('Q', x1, y1, x, y)); ctrlx, ctrly = x1, y1; cx, cy = x, y
            elif lc == 't':
                if prev.lower() in 'qt':
                    x1, y1 = 2 * cx - ctrlx, 2 * cy - ctrly
                else:
                    x1, y1 = cx, cy
                x, y = p[0] + ox, p[1] + oy
                ops.append(('Q', x1, y1, x, y)); ctrlx, ctrly = x1, y1; cx, cy = x, y
            elif lc == 'a':
                x, y = p[5] + ox, p[6] + oy
                force = arc_segments[arc_i] if arc_segments is not None else None
                segs = arc_to_cubics(cx, cy, x, y, p[0], p[1], p[2], p[3] != 0, p[4] != 0, force)
                if used_segments is not None:
                    used_segments.append(len(segs))
                arc_i += 1
                ops.extend(segs)
                cx, cy = x, y
                ctrlx, ctrly = cx, cy
            prev = cmd
    if ops and ops[0][0] != 'M':
        ops.insert(0, ('M', 0.0, 0.0))      # a path starts at the origin
    return ops


def arc_to_cubics(x0, y0, x1, y1, rx, ry, angle, large, sweep, force=None):
    """SVG elliptical arc -> cubic ops (Android's PathParser.arcToBezier subdivision: one
    cubic per quarter turn). With `force`, exactly that many cubics (a degenerate arc becomes
    straight cubics) so morph keyframes line up."""
    def line_cubics(n):
        out = []
        for i in range(n):
            ax, ay = x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n
            bx, by = x0 + (x1 - x0) * (i + 1) / n, y0 + (y1 - y0) * (i + 1) / n
            out.append(('C', ax + (bx - ax) / 3, ay + (by - ay) / 3, ax + 2 * (bx - ax) / 3, ay + 2 * (by - ay) / 3, bx, by))
        return out
    if (x0 == x1 and y0 == y1) or rx == 0 or ry == 0:
        if force:
            return line_cubics(force)
        if x0 == x1 and y0 == y1:
            return [] if not force else line_cubics(force)
        return [('L', x1, y1)]
    rx, ry = abs(rx), abs(ry)
    phi = math.radians(angle)
    cphi, sphi = math.cos(phi), math.sin(phi)
    dx2, dy2 = (x0 - x1) / 2.0, (y0 - y1) / 2.0
    x1p = cphi * dx2 + sphi * dy2
    y1p = -sphi * dx2 + cphi * dy2
    lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
    if lam > 1:
        s = math.sqrt(lam)
        rx *= s
        ry *= s
    num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
    den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
    coef = math.sqrt(max(0.0, num / den)) if den else 0.0
    if large == sweep:
        coef = -coef
    cxp = coef * rx * y1p / ry
    cyp = -coef * ry * x1p / rx
    ccx = cphi * cxp - sphi * cyp + (x0 + x1) / 2.0
    ccy = sphi * cxp + cphi * cyp + (y0 + y1) / 2.0

    def ang(ux, uy, vx, vy):
        d = math.hypot(ux, uy) * math.hypot(vx, vy)
        if d == 0:
            return 0.0
        c = max(-1.0, min(1.0, (ux * vx + uy * vy) / d))
        a = math.acos(c)
        return -a if ux * vy - uy * vx < 0 else a
    th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
    dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
    if not sweep and dth > 0:
        dth -= 2 * math.pi
    elif sweep and dth < 0:
        dth += 2 * math.pi
    n = force or max(1, int(math.ceil(abs(dth * 4 / math.pi) - 1e-9)))
    out = []
    step = dth / n
    t = 4.0 / 3.0 * math.tan(step / 4)
    a = th1
    px, py = x0, y0
    for i in range(n):
        a2 = a + step
        c1, s1, c2, s2 = math.cos(a), math.sin(a), math.cos(a2), math.sin(a2)
        e1x, e1y = -rx * s1, ry * c1         # derivative directions in ellipse space
        e2x, e2y = -rx * s2, ry * c2
        q1x = px + t * (cphi * e1x - sphi * e1y)
        q1y = py + t * (sphi * e1x + cphi * e1y)
        ex = ccx + cphi * rx * c2 - sphi * ry * s2
        ey = ccy + sphi * rx * c2 + cphi * ry * s2
        if i == n - 1:
            ex, ey = x1, y1
        q2x = ex - t * (cphi * e2x - sphi * e2y)
        q2y = ey - t * (sphi * e2x + cphi * e2y)
        out.append(('C', q1x, q1y, q2x, q2y, ex, ey))
        px, py = ex, ey
        a = a2
    return out


def morph_ops(node_lists):
    """Absolute ops for keyframes of one morph, with matching arc subdivisions. Returns a list of
    op lists, or None when they cannot line up."""
    counts = None
    if any(arc_count(n) for n in node_lists):
        per = []
        for nodes in node_lists:
            used = []
            to_ops(nodes, used_segments=used)
            per.append(used)
        if len(set(len(u) for u in per)) != 1:
            return None
        counts = [max(c) for c in zip(*per)]
    out = [to_ops(n, counts) for n in node_lists]
    if len(set(signature(o) for o in out)) != 1:
        return None
    return out


def signature(ops):
    return tuple(o[0] for o in ops)


def op_points(op):
    return list(zip(op[1::2], op[2::2]))


# ---- even-odd -> non-zero ---------------------------------------------------------------

def contours(ops):
    """Split ops into contours: lists of ops starting with M."""
    out, cur = [], None
    for op in ops:
        if op[0] == 'M':
            cur = [op]
            out.append(cur)
        else:
            if cur is None:
                cur = [('M', 0.0, 0.0)]
                out.append(cur)
            cur.append(op)
            if op[0] == 'Z':
                # a drawing op after Z without M starts at the same subpath start
                cur = [('M', cur[0][1], cur[0][2])]
                out.append(cur)
    return [c for c in out if len(c) > 1]


def flatten_contour(c, steps=8):
    pts = [(c[0][1], c[0][2])]
    for op in c[1:]:
        p0 = pts[-1]
        if op[0] == 'L':
            pts.append((op[1], op[2]))
        elif op[0] == 'Q':
            for i in range(1, steps + 1):
                t = i / steps
                u = 1 - t
                pts.append((u * u * p0[0] + 2 * u * t * op[1] + t * t * op[3], u * u * p0[1] + 2 * u * t * op[2] + t * t * op[4]))
        elif op[0] == 'C':
            for i in range(1, steps + 1):
                t = i / steps
                u = 1 - t
                pts.append((u ** 3 * p0[0] + 3 * u * u * t * op[1] + 3 * u * t * t * op[3] + t ** 3 * op[5],
                            u ** 3 * p0[1] + 3 * u * u * t * op[2] + 3 * u * t * t * op[4] + t ** 3 * op[6]))
    return pts


def _area(pts):
    a = 0.0
    for i in range(len(pts)):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % len(pts)]
        a += x0 * y1 - x1 * y0
    return a / 2


def _inside(pt, poly):
    x, y = pt
    inside = False
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        if (y0 > y) != (y1 > y):
            xi = x0 + (y - y0) * (x1 - x0) / (y1 - y0)
            if xi > x:
                inside = not inside
    return inside


def evenodd_flips(ops):
    """Which contours to reverse so a non-zero fill equals the even-odd fill (exact for
    contours that do not cross each other): a contour nested at even depth keeps the
    outermost contour's winding, at odd depth the opposite."""
    cs = contours(ops)
    polys = [flatten_contour(c) for c in cs]
    flips = []
    areas = [_area(p) for p in polys]
    for i, p in enumerate(polys):
        if abs(areas[i]) < 1e-9:
            flips.append(False)
            continue
        # sample a few points of the contour; the majority vote decides containment
        samples = [p[k * len(p) // 5] for k in range(5)]
        depth = 0
        for j, q in enumerate(polys):
            if j == i or abs(areas[j]) < 1e-9:
                continue
            if sum(_inside(s, q) for s in samples) >= 3:
                depth += 1
        want_positive = (depth % 2 == 0)
        flips.append((areas[i] > 0) != want_positive)
    return flips


def reverse_contours(ops, flips):
    """Rebuild ops with the flagged contours reversed. Closed contours get an explicit
    closing line so every keyframe of a morph keeps the same structure."""
    cs = contours(ops)
    out = []
    for c, flip in zip(cs, flips):
        closed = c[-1][0] == 'Z'
        body = c[1:-1] if closed else c[1:]
        if not flip:
            out.extend(c)
            continue
        start = (c[0][1], c[0][2])
        segs = []
        p = start
        for op in body:
            segs.append((p, op))
            p = (op[-2], op[-1])
        if closed:
            segs.append((p, ('L', start[0], start[1])))
            end = start
        else:
            end = p
        out.append(('M', end[0], end[1]))
        for p0, op in reversed(segs):
            if op[0] == 'L':
                out.append(('L', p0[0], p0[1]))
            elif op[0] == 'Q':
                out.append(('Q', op[1], op[2], p0[0], p0[1]))
            elif op[0] == 'C':
                out.append(('C', op[3], op[4], op[1], op[2], p0[0], p0[1]))
        if closed:
            out.append(('Z',))
    return out


def svg_d(ops, fmt=lambda v: '%.4f' % v):
    parts = []
    for op in ops:
        parts.append(op[0] + ' '.join(fmt(v) for v in op[1:]))
    return ' '.join(parts)


def bounds(ops):
    xs, ys = [], []
    for op in ops:
        xs.extend(op[1::2])
        ys.extend(op[2::2])
    if not xs:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def strip_degenerate(ops, eps=1e-4):
    """For a filled (never stroked) path: the same fill with fewer ops. Drops segments that do
    not move (a lineTo / curve whose points all equal the current point), a lineTo back to the
    contour start just before its close (close draws it), and contours left without area (no
    segment, or a single line). Icon exports end with such zero-size contours."""
    def same(a, b):
        return abs(a[0] - b[0]) < eps and abs(a[1] - b[1]) < eps

    out = []
    for c in contours(ops):
        start = (c[0][1], c[0][2])
        cur = start
        body = []
        for op in c[1:]:
            if op[0] == 'Z':
                break
            pts = op_points(op)
            if all(same(p, cur) for p in pts):
                continue
            body.append(op)
            cur = pts[-1]
        # a fill closes every contour, so the line back to the start is implied
        while body and body[-1][0] == 'L' and same(op_points(body[-1])[-1], start):
            body.pop()
        if not body or (len(body) == 1 and body[0][0] == 'L'):
            continue
        out.append(('M', start[0], start[1]))
        out.extend(body)
        out.append(('Z',))
    return out
