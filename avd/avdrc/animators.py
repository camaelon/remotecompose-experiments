"""Animator XML: <set>, <objectAnimator>, <propertyValuesHolder>, <keyframe>.

`load(ref_or_element)` gives a tree of AnimSet / ObjAnim nodes with every value parsed
(floats, Color, path nodes) and keyframes completed as AnimatorInflater does (fractions
distributed, keyframes at 0 and 1 added). `schedule(tree)` flattens it into placed
animators with absolute start times — AnimatorSet ordering, startOffset, repeats.
"""

import math

from . import colors, interpolators, pathdata
from .xmlutil import ConvertError, attr, children, inline, local

INF = float('inf')
DEFAULT_DURATION = 0.3       # ValueAnimator's default, seconds


class Keyframe:
    __slots__ = ('fraction', 'value', 'interp')

    def __init__(self, fraction, value, interp):
        self.fraction = fraction
        self.value = value          # None: the target's value when the animator starts
        self.interp = interp        # interpolator of the interval ending here (None: linear)

    def __repr__(self):
        return 'Kf(%s, %r)' % (self.fraction, self.value)


class Holder:
    """One animated property: keyframes, or a motion path for one axis."""
    __slots__ = ('prop', 'vtype', 'keyframes', 'motion', 'axis')

    def __init__(self, prop, vtype, keyframes=None, motion=None, axis=None):
        self.prop = prop
        self.vtype = vtype          # float | int | color | path
        self.keyframes = keyframes
        self.motion = motion        # absolute ops of a motion path (propertyXName / YName)
        self.axis = axis            # 0 = x, 1 = y for motion paths

    def __repr__(self):
        return 'Holder(%s %s %r)' % (self.prop, self.vtype, self.keyframes if self.motion is None else 'motion')


class AnimSet:
    def __init__(self, ordering, kids):
        self.ordering = ordering
        self.children = kids


class ObjAnim:
    def __init__(self, duration, offset, repeat, mode, interp, holders):
        self.duration = duration
        self.offset = offset
        self.repeat = repeat        # 0.. or -1 (infinite)
        self.mode = mode            # 'restart' | 'reverse'
        self.interp = interp        # Interp; ValueAnimator's default is accelerate-decelerate
        self.holders = holders

    def total(self):
        if self.repeat < 0:
            return INF
        return self.duration * (self.repeat + 1)


class Placed:
    """An animator at its absolute start time in the timeline."""
    __slots__ = ('anim', 'start', 'order')

    def __init__(self, anim, start, order):
        self.anim = anim
        self.start = start
        self.order = order

    @property
    def end(self):
        return self.start + self.anim.total()


def _is_color_literal(v):
    return v is not None and (v.startswith('#') or v.startswith('@color/') or v.startswith('@android:color/') or (v.startswith('?') and 'olor' in v))


class Loader:
    def __init__(self, res):
        self.res = res

    def load(self, ref_or_el, from_path):
        if isinstance(ref_or_el, str):
            root, path = self.res.load(ref_or_el, from_path, ('anim', 'animator'))
            if isinstance(root, tuple):
                raise ConvertError('framework animator %s' % ref_or_el)
            return self.node(root, path)
        return self.node(ref_or_el, from_path)

    def node(self, el, path):
        tag = local(el.tag)
        if tag == 'set':
            ordering = attr(el, 'ordering', 'together')
            ordering = 'sequentially' if ordering in ('sequentially', '1') else 'together'
            kids = [self.node(c, path) for c in children(el) if local(c.tag) in ('set', 'objectAnimator', 'animator')]
            return AnimSet(ordering, kids)
        if tag in ('objectAnimator', 'animator'):
            return self.object_animator(el, path)
        raise ConvertError('unsupported animator <%s>' % tag)

    def number(self, el, name, default):
        return self.res.number(attr(el, name), default)

    def interp(self, el, path):
        ref = attr(el, 'interpolator')
        if ref is None:
            ref = inline(el, 'interpolator')
        return interpolators.load(ref, self.res, path)

    def object_animator(self, el, path):
        duration = self.number(el, 'duration', DEFAULT_DURATION * 1000) / 1000.0
        offset = self.number(el, 'startOffset', 0) / 1000.0
        rc = attr(el, 'repeatCount', '0')
        repeat = -1 if rc in ('infinite', '-1') else int(self.res.number(rc, 0))
        rm = attr(el, 'repeatMode', 'restart')
        mode = 'reverse' if rm in ('reverse', '2') else 'restart'
        interp = self.interp(el, path)
        if interp is None:
            interp = interpolators.ACCEL_DECEL
        vtype = attr(el, 'valueType')
        holders = []
        pvhs = children(el, 'propertyValuesHolder')
        if pvhs:
            for pvh in pvhs:
                h = self.holder(pvh, attr(pvh, 'propertyName'), attr(pvh, 'valueType'), path)
                if h is not None:
                    holders.append(h)
        else:
            motion = attr(el, 'pathData')
            if motion is None and inline(el, 'pathData') is not None:
                motion = inline(el, 'pathData').text
            px, py = attr(el, 'propertyXName'), attr(el, 'propertyYName')
            if motion is not None and (px or py):
                ops = pathdata.to_ops(pathdata.parse(self.res.value(motion, 'string')))
                for axis, prop in ((0, px), (1, py)):
                    if prop:
                        holders.append(Holder(prop, 'float', motion=ops, axis=axis))
            elif motion is not None:
                raise ConvertError('propertyXName or propertyYName is needed for PathData')
            else:
                prop = attr(el, 'propertyName')
                h = self.holder(el, prop, vtype, path)
                if h is not None:
                    holders.append(h)
        return ObjAnim(duration, offset, repeat, mode, interp, holders)

    def holder(self, el, prop, vtype, path):
        if prop is None:
            raise ConvertError('objectAnimator without propertyName')
        vtype = {'floatType': 'float', 'intType': 'int', 'colorType': 'color', 'pathType': 'path'}.get(vtype, None)
        kfs = children(el, 'keyframe')
        if kfs:
            if vtype is None:
                v = attr(kfs[0], 'value')
                vtype = 'color' if _is_color_literal(v) else 'float'
            frames = []
            for k in kfs:
                fr = self.res.number(attr(k, 'fraction'), -1.0)
                raw = attr(k, 'value')
                ki = self.interp(k, path)
                frames.append(Keyframe(fr, self.value(raw, vtype, path) if raw is not None else None, ki))
            return Holder(prop, vtype, complete_keyframes(frames))
        vf, vt = attr(el, 'valueFrom'), attr(el, 'valueTo')
        if vf is None and vt is None:
            return None
        if vtype is None:
            vtype = 'color' if (_is_color_literal(vf) or _is_color_literal(vt)) else 'float'
            if prop == 'pathData':
                vtype = 'path'
        a = self.value(vf, vtype, path) if vf is not None else None
        b = self.value(vt, vtype, path) if vt is not None else None
        if vtype == 'path':
            if a is None or b is None:
                raise ConvertError('path morph needs valueFrom and valueTo')
            if not pathdata.can_morph(a, b):
                raise ConvertError("Can't morph from %s to %s" % (vf[:30], vt[:30]))
        if vt is None or vf is None:
            # a single value is the end value (PropertyValuesHolder.ofFloat(name, v)): the
            # animation starts from the target's current value
            return Holder(prop, vtype, [Keyframe(0.0, None, None), Keyframe(1.0, a if vt is None else b, None)])
        return Holder(prop, vtype, [Keyframe(0.0, a, None), Keyframe(1.0, b, None)])

    def value(self, raw, vtype, path):
        if vtype == 'color':
            return colors.parse_color(raw, self.res, path)
        if vtype == 'path':
            return pathdata.parse(self.res.value(raw, 'string'))
        v = self.res.number(raw)
        return float(int(v)) if vtype == 'int' else v


def complete_keyframes(frames):
    """AnimatorInflater.loadPvh: keyframes at 0 and 1, missing fractions distributed."""
    frames = list(frames)
    last, first = frames[-1], frames[0]
    if last.fraction < 1:
        if last.fraction < 0:
            last.fraction = 1.0
        else:
            frames.append(Keyframe(1.0, last.value, None))
    if first.fraction != 0:
        if first.fraction < 0:
            first.fraction = 0.0
        else:
            frames.insert(0, Keyframe(0.0, first.value, None))
    n = len(frames)
    for i in range(n):
        if frames[i].fraction < 0:
            if i == 0:
                frames[i].fraction = 0.0
            elif i == n - 1:
                frames[i].fraction = 1.0
            else:
                j = i
                while j + 1 < n - 1 and frames[j + 1].fraction < 0:
                    j += 1
                gap = frames[j + 1].fraction - frames[i - 1].fraction
                inc = gap / (j - i + 2)
                for q in range(i, j + 1):
                    frames[q].fraction = frames[q - 1].fraction + inc
    return frames


def schedule(tree, start=0.0, out=None):
    """Flatten a tree into Placed animators (in document order). Returns (placed, end)."""
    if out is None:
        out = []
    if isinstance(tree, ObjAnim):
        out.append(Placed(tree, start + tree.offset, len(out)))
        return out, start + tree.offset + tree.total()
    end = start
    t = start
    for c in tree.children:
        if tree.ordering == 'together':
            _, e = schedule(c, start, out)
            end = max(end, e)
        else:
            if t == INF:
                break
            _, t = schedule(c, t, out)
            end = t
    return out, end
