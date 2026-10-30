"""Interpolators: what an `android:interpolator` names, as a small description.

`Interp(kind, params)` kinds: linear, accelerate(f), decelerate(f), accel_decel,
anticipate(T), overshoot(T), anticipate_overshoot(T), bounce, cycle(n), path(ops) — a
pathInterpolator as cubic / quadratic control points or a whole path (absolute ops in the
unit square). `value(x)` evaluates it; the emitter turns it into an expression (closed form
where there is one, a sampled table read through the spline operator otherwise).
"""

import math

from . import pathdata, values
from .xmlutil import ConvertError, attr, inline, local


class Interp:
    __slots__ = ('kind', 'params', '_samples')

    def __init__(self, kind, *params):
        self.kind = kind
        self.params = tuple(params)
        self._samples = None

    def key(self):
        return (self.kind, self.params)

    def __eq__(self, o):
        return isinstance(o, Interp) and o.key() == self.key()

    def __hash__(self):
        return hash(self.key())

    def __repr__(self):
        return 'Interp(%s%s)' % (self.kind, ', %r' % (self.params,) if self.params else '')

    # -- evaluation ------------------------------------------------------------------
    def value(self, x):
        k, p = self.kind, self.params
        if k == 'linear':
            return x
        if k == 'accelerate':
            return x * x if p[0] == 1 else x ** (2 * p[0])
        if k == 'decelerate':
            return 1 - (1 - x) * (1 - x) if p[0] == 1 else 1 - (1 - x) ** (2 * p[0])
        if k == 'accel_decel':
            return math.cos((x + 1) * math.pi) / 2 + 0.5
        if k == 'anticipate':
            T = p[0]
            return x * x * ((T + 1) * x - T)
        if k == 'overshoot':
            T = p[0]
            x -= 1
            return x * x * ((T + 1) * x + T) + 1
        if k == 'anticipate_overshoot':
            T = p[0]
            if x < 0.5:
                y = 2 * x
                return 0.5 * (y * y * ((T + 1) * y - T))
            y = 2 * x - 2
            return 0.5 * (y * y * ((T + 1) * y + T) + 2)
        if k == 'bounce':
            def b(t):
                return t * t * 8
            t = x * 1.1226
            if t < 0.3535:
                return b(t)
            if t < 0.7408:
                return b(t - 0.54719) + 0.7
            if t < 0.9644:
                return b(t - 0.8526) + 0.9
            return b(t - 1.0435) + 0.95
        if k == 'cycle':
            return math.sin(2 * p[0] * math.pi * x)
        if k == 'path':
            return self._path_value(x)
        raise ValueError(k)

    def _path_value(self, x):
        if self._samples is None:
            self._samples = path_samples(self.params[0])
        xs, ys = self._samples
        if x <= 0:
            return 0.0
        if x >= 1:
            return 1.0
        lo, hi = 0, len(xs) - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if x < xs[mid]:
                hi = mid
            else:
                lo = mid
        d = xs[hi] - xs[lo]
        if d == 0:
            return ys[lo]
        return ys[lo] + (ys[hi] - ys[lo]) * (x - xs[lo]) / d

    def is_cubic(self):
        """(x1, y1, x2, y2) when this is one cubic from (0,0) to (1,1)."""
        if self.kind != 'path':
            return None
        ops = self.params[0]
        if len(ops) == 2 and ops[0][0] == 'M' and ops[1][0] == 'C' and ops[0][1:] == (0.0, 0.0) and ops[1][5:] == (1.0, 1.0):
            return ops[1][1:5]
        return None


def path_samples(ops, per_segment=200):
    """Dense (x, y) samples of an interpolator path, x non-decreasing."""
    pts = pathdata.flatten_contour(list(ops), steps=per_segment)
    xs, ys = [], []
    for x, y in pts:
        if xs and x < xs[-1]:
            x = xs[-1]
        xs.append(x)
        ys.append(y)
    return xs, ys


def cubic(x1, y1, x2, y2):
    return Interp('path', (('M', 0.0, 0.0), ('C', float(x1), float(y1), float(x2), float(y2), 1.0, 1.0)))


LINEAR = Interp('linear')
ACCEL_DECEL = Interp('accel_decel')

BUILTIN = {
    'linear': LINEAR,
    'linear_interpolator': LINEAR,
    'accelerate_quad': Interp('accelerate', 1.0),
    'accelerate_interpolator': Interp('accelerate', 1.0),
    'accelerate_cubic': Interp('accelerate', 1.5),
    'accelerate_quint': Interp('accelerate', 2.5),
    'decelerate_quad': Interp('decelerate', 1.0),
    'decelerate_interpolator': Interp('decelerate', 1.0),
    'decelerate_cubic': Interp('decelerate', 1.5),
    'decelerate_quint': Interp('decelerate', 2.5),
    'accelerate_decelerate': ACCEL_DECEL,
    'accelerate_decelerate_interpolator': ACCEL_DECEL,
    'anticipate': Interp('anticipate', 2.0),
    'anticipate_interpolator': Interp('anticipate', 2.0),
    'overshoot': Interp('overshoot', 2.0),
    'overshoot_interpolator': Interp('overshoot', 2.0),
    'anticipate_overshoot': Interp('anticipate_overshoot', 3.0),
    'anticipate_overshoot_interpolator': Interp('anticipate_overshoot', 3.0),
    'bounce': Interp('bounce'),
    'bounce_interpolator': Interp('bounce'),
    'cycle': Interp('cycle', 1.0),
    'cycle_interpolator': Interp('cycle', 1.0),
    'fast_out_slow_in': cubic(0.4, 0.0, 0.2, 1.0),
    'fast_out_linear_in': cubic(0.4, 0.0, 1.0, 1.0),
    'linear_out_slow_in': cubic(0.0, 0.0, 0.2, 1.0),
    'fast_out_extra_slow_in': Interp('path', tuple(pathdata.to_ops(pathdata.parse(values.EMPHASIZED_PATH)))),
    # Material 3 motion easing (motionEasing*Interpolator theme attributes)
    'm3_standard': cubic(0.2, 0.0, 0.0, 1.0),
    'm3_standard_decelerate': cubic(0.0, 0.0, 0.0, 1.0),
    'm3_standard_accelerate': cubic(0.3, 0.0, 1.0, 1.0),
    'm3_emphasized': Interp('path', tuple(pathdata.to_ops(pathdata.parse(values.EMPHASIZED_PATH)))),
    'm3_emphasized_decelerate': cubic(0.05, 0.7, 0.1, 1.0),
    'm3_emphasized_accelerate': cubic(0.3, 0.0, 0.8, 0.15),
}


def load(ref_or_el, res, from_path):
    """An interpolator from an attribute value (reference / theme attribute) or an inline
    element. Invalid path interpolators raise ConvertError, as Android throws."""
    if ref_or_el is None:
        return None
    if not isinstance(ref_or_el, str):
        return from_element(ref_or_el, res, from_path)
    ref = ref_or_el.strip()
    if ref.startswith('?'):
        ref = res.value(ref, 'interpolator')
    loaded, path = res.load(ref, from_path, ('interpolator', 'anim', 'animator'))
    if isinstance(loaded, tuple):
        name = loaded[2]
        if name not in BUILTIN:
            raise ConvertError('unknown framework interpolator %s' % ref)
        return BUILTIN[name]
    return from_element(loaded, res, path)


def from_element(el, res, path):
    tag = local(el.tag)
    num = lambda n, d: res.number(attr(el, n), d)
    if tag == 'linearInterpolator':
        return LINEAR
    if tag == 'accelerateInterpolator':
        return Interp('accelerate', num('factor', 1.0))
    if tag == 'decelerateInterpolator':
        return Interp('decelerate', num('factor', 1.0))
    if tag == 'accelerateDecelerateInterpolator':
        return ACCEL_DECEL
    if tag == 'anticipateInterpolator':
        return Interp('anticipate', num('tension', 2.0))
    if tag == 'overshootInterpolator':
        return Interp('overshoot', num('tension', 2.0))
    if tag == 'anticipateOvershootInterpolator':
        return Interp('anticipate_overshoot', num('tension', 2.0) * num('extraTension', 1.5))
    if tag == 'bounceInterpolator':
        return Interp('bounce')
    if tag == 'cycleInterpolator':
        return Interp('cycle', num('cycles', 1.0))
    if tag == 'pathInterpolator':
        return path_interpolator(el, res, path)
    raise ConvertError('unsupported interpolator <%s>' % tag)


def path_interpolator(el, res, path):
    pd = attr(el, 'pathData')
    if pd is not None:
        pd = res.value(pd, 'string')
        nodes = pathdata.parse(pd)
        ops = pathdata.to_ops(nodes)
        if not ops or ops[0][0] != 'M':
            raise ConvertError('path interpolator must start with M')
        if abs(ops[0][1]) > 1e-6 or abs(ops[0][2]) > 1e-6:
            raise ConvertError('The Path must start at (0,0)')
        if abs(ops[-1][-2] - 1) > 1e-6 or abs(ops[-1][-1] - 1) > 1e-6:
            raise ConvertError('The Path must end at (1,1)')
        # x must not go backwards (Android: "The Path cannot loop back on itself")
        xs = [x for x, _ in pathdata.flatten_contour(ops, 32)]
        if any(b < a - 1e-6 for a, b in zip(xs, xs[1:])):
            raise ConvertError('The Path cannot loop back on itself')
        return Interp('path', tuple(tuple(float(v) if i else v for i, v in enumerate(op)) for op in ops))
    x1, y1 = attr(el, 'controlX1'), attr(el, 'controlY1')
    x2, y2 = attr(el, 'controlX2'), attr(el, 'controlY2')
    if x1 is None or y1 is None:
        raise ConvertError('pathInterpolator requires controlX1 and controlY1')
    x1, y1 = res.number(x1), res.number(y1)
    if x2 is None and y2 is None:
        return Interp('path', (('M', 0.0, 0.0), ('Q', x1, y1, 1.0, 1.0)))
    if x2 is None or y2 is None:
        raise ConvertError('pathInterpolator requires both controlX2 and controlY2')
    return cubic(x1, y1, res.number(x2), res.number(y2))
