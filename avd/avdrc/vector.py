"""<vector> drawables as a tree of VGroup / VPath / VClip with their static properties."""

from . import colors, pathdata
from .xmlutil import ConvertError, attr, children, inline, local


class Gradient:
    __slots__ = ('type', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'stops', 'tile')

    def __init__(self):
        self.type = 'linear'
        self.x1 = self.y1 = self.x2 = self.y2 = 0.0
        self.cx = self.cy = self.r = 0.0
        self.stops = []         # [(offset, Color)]
        self.tile = 'clamp'


class VNode:
    kind = 'node'
    name = None


class VGroup(VNode):
    kind = 'group'
    PROPS = ('rotation', 'pivotX', 'pivotY', 'scaleX', 'scaleY', 'translateX', 'translateY')

    def __init__(self):
        self.name = None
        self.rotation = 0.0
        self.pivotX = self.pivotY = 0.0
        self.scaleX = self.scaleY = 1.0
        self.translateX = self.translateY = 0.0
        self.children = []


class VPath(VNode):
    kind = 'path'
    PROPS = ('pathData', 'fillColor', 'strokeColor', 'strokeWidth', 'strokeAlpha', 'fillAlpha',
             'trimPathStart', 'trimPathEnd', 'trimPathOffset')

    def __init__(self):
        self.name = None
        self.pathData = []
        self.fillColor = None       # Color | Gradient | None
        self.strokeColor = None
        self.strokeWidth = 0.0
        self.strokeAlpha = 1.0
        self.fillAlpha = 1.0
        self.trimPathStart = 0.0
        self.trimPathEnd = 1.0
        self.trimPathOffset = 0.0
        self.strokeLineCap = 'butt'
        self.strokeLineJoin = 'miter'
        self.strokeMiterLimit = 4.0
        self.fillType = 'nonZero'


class VClip(VNode):
    kind = 'clip'
    PROPS = ('pathData',)

    def __init__(self):
        self.name = None
        self.pathData = []


class Vector:
    kind = 'vector'
    PROPS = ('alpha',)

    def __init__(self):
        self.name = None
        self.width = self.height = 24.0
        self.vw = self.vh = 24.0
        self.tint = None
        self.tint_mode = 'src_in'
        self.alpha = 1.0
        self.auto_mirrored = False
        self.root = VGroup()
        self.targets = {}           # name -> node (the last definition wins, as in VectorDrawable)

    def walk(self):
        def rec(g):
            for c in g.children:
                yield c
                if c.kind == 'group':
                    yield from rec(c)
        return rec(self.root)


def parse_vector(el, res, path):
    if local(el.tag) != 'vector':
        raise ConvertError('expected <vector>, got <%s>' % local(el.tag))
    v = Vector()
    num = lambda e, n, d: res.number(attr(e, n), d)
    v.name = res.name(attr(el, 'name'))
    v.width = num(el, 'width', None)
    v.height = num(el, 'height', None)
    if v.width is None or v.height is None:
        raise ConvertError('<vector> needs width and height')
    v.vw = num(el, 'viewportWidth', None)
    v.vh = num(el, 'viewportHeight', None)
    if not v.vw or not v.vh or v.vw <= 0 or v.vh <= 0:
        raise ConvertError('<vector> needs a positive viewportWidth and viewportHeight')
    tint = attr(el, 'tint')
    if tint is not None:
        v.tint = colors.parse_color(tint, res, path)
    v.tint_mode = attr(el, 'tintMode', 'src_in')
    v.alpha = num(el, 'alpha', 1.0)
    v.auto_mirrored = attr(el, 'autoMirrored', 'false') == 'true'
    if v.name:
        v.targets[v.name] = v
    _children(v, v.root, el, res, path)
    return v


def _children(v, group, el, res, path):
    num = lambda e, n, d: res.number(attr(e, n), d)
    for c in children(el):
        tag = local(c.tag)
        if tag == 'group':
            g = VGroup()
            g.name = res.name(attr(c, 'name'))
            for p in VGroup.PROPS:
                setattr(g, p, num(c, p, getattr(g, p)))
            group.children.append(g)
            if g.name:
                v.targets[g.name] = g
            _children(v, g, c, res, path)
        elif tag == 'path':
            p = VPath()
            p.name = res.name(attr(c, 'name'))
            p.pathData = pathdata.parse(res.value(attr(c, 'pathData', ''), 'string'))
            p.fillColor = _paint(c, 'fillColor', res, path)
            p.strokeColor = _paint(c, 'strokeColor', res, path)
            for k in ('strokeWidth', 'strokeAlpha', 'fillAlpha', 'trimPathStart', 'trimPathEnd', 'trimPathOffset', 'strokeMiterLimit'):
                setattr(p, k, num(c, k, getattr(p, k)))
            p.strokeLineCap = attr(c, 'strokeLineCap', 'butt')
            p.strokeLineJoin = attr(c, 'strokeLineJoin', 'miter')
            ft = attr(c, 'fillType', 'nonZero')
            p.fillType = 'evenOdd' if ft in ('evenOdd', '1') else 'nonZero'
            group.children.append(p)
            if p.name:
                v.targets[p.name] = p
        elif tag == 'clip-path':
            cp = VClip()
            cp.name = res.name(attr(c, 'name'))
            cp.pathData = pathdata.parse(res.value(attr(c, 'pathData', ''), 'string'))
            group.children.append(cp)
            if cp.name:
                v.targets[cp.name] = cp
        else:
            res.warn('<%s> inside a vector (ignored)' % tag)


def _paint(el, name, res, path):
    raw = attr(el, name)
    if raw is not None:
        return colors.parse_color(raw, res, path)
    g = inline(el, name)
    if g is None:
        return None
    if local(g.tag) == 'gradient':
        return parse_gradient(g, res, path)
    if local(g.tag) == 'selector':
        return colors.color_state_list(g, res, path)
    raise ConvertError('unsupported inline %s <%s>' % (name, local(g.tag)))


def parse_gradient(el, res, path):
    num = lambda n, d: res.number(attr(el, n), d)
    g = Gradient()
    t = attr(el, 'type', 'linear')
    g.type = {'0': 'linear', '1': 'radial', '2': 'sweep'}.get(t, t)
    g.x1, g.y1, g.x2, g.y2 = num('startX', 0.0), num('startY', 0.0), num('endX', 0.0), num('endY', 0.0)
    g.cx, g.cy, g.r = num('centerX', 0.0), num('centerY', 0.0), num('gradientRadius', 0.0)
    g.tile = {'0': 'clamp', '1': 'repeat', '2': 'mirror'}.get(attr(el, 'tileMode', 'clamp'), attr(el, 'tileMode', 'clamp'))
    items = children(el, 'item')
    if items:
        for it in items:
            g.stops.append((res.number(attr(it, 'offset'), 0.0), colors.parse_color(attr(it, 'color'), res, path)))
    else:
        sc, cc, ec = attr(el, 'startColor'), attr(el, 'centerColor'), attr(el, 'endColor')
        g.stops.append((0.0, colors.parse_color(sc or '#00000000', res, path)))
        if cc is not None:
            g.stops.append((0.5, colors.parse_color(cc, res, path)))
        g.stops.append((1.0, colors.parse_color(ec or '#00000000', res, path)))
    if g.type == 'radial' and g.r <= 0:
        raise ConvertError('<gradient> tag requires \'gradientRadius\' attribute with radial type')
    return g
