"""Paints: colour and gradient bundles, layer effects as paint attributes, offset-path paints."""

import math

from .wire import (BLEND_SRC_ATOP, BLEND_SRC_IN, BLEND_SRC_OVER, CE_ARGB, CE_IDARGB, GRAD_FOCAL_RADIAL_X, GRAD_LINEAR, GRAD_RADIAL,
    LOTTIE_BLEND, PB_ALPHA, PB_BLEND_MODE, PB_BLUR_X, PB_CLEAR_COLOR_FILTER, PB_COLOR, PB_COLOR_FILTER, PB_COLOR_FILTER_ID,
    PB_COLOR_ID, PB_GRADIENT, PB_PATH_EFFECT, PB_SHADER, PB_STROKE_CAP, PB_STROKE_JOIN, PB_STROKE_MITER, PB_STROKE_WIDTH,
    PB_STYLE, PPE_DASH, STYLE_FILL, STYLE_FILL_AND_STROKE, STYLE_STROKE, f2bits, id_from_nan, rgb_to_argb)
from .props import Prop, _lst
from .shapes import expand_midpoints, interp_stops
from .tracks import Track

class PaintState:
    """What the previous paint carried, so the next one can clear it when it no longer
    applies: a gradient shader, a dash effect, a blend mode, a colour filter, a blur. The
    players keep paint state between draws, so a paint that stops using one of these has to
    say so explicitly."""
    __slots__ = ('gradient', 'dash', 'blend', 'filter', 'blur')

    def __init__(self):
        self.gradient = self.dash = self.blend = self.filter = self.blur = False

    def forget(self):
        """The state is unknown (either end of a loop body): the next paint re-spells its
        gradient, dash and blend."""
        self.gradient = self.dash = self.blend = True


class FillEffect:
    """Layer effect Fill (21): every paint's colour becomes `rgb` at opacity `o` (a SRC_ATOP colour filter)."""
    kind = 'fill'
    __slots__ = ('rgb', 'o')

    def __init__(self, rgb, o):
        self.rgb, self.o = rgb, o


class ShadowPass:
    """The drop shadow's first pass: paints keep only the content's alpha in `rgb` at `o` (SRC_IN)."""
    kind = 'shadow'
    __slots__ = ('rgb', 'o')

    def __init__(self, rgb, o):
        self.rgb, self.o = rgb, o


class TintEffect:
    """Layer effect Tint (20): solid colours become black + (white - black) · luma, blended by `amount`."""
    kind = 'tint'
    __slots__ = ('black', 'white', 'amount')

    def __init__(self, black, white, amount):
        self.black, self.white, self.amount = black, white, amount


class BlurEffect:
    """A Gaussian blur of every draw in the layer (BLUR_X), sigma in px."""
    kind = 'blur'
    __slots__ = ('sigma',)

    def __init__(self, sigma):
        self.sigma = sigma


class DropShadow:
    """Layer effect Drop Shadow (25), resolved: colour and opacity Tracks, the offset, the blur sigma, shadow-only."""
    __slots__ = ('rgb', 'o', 'dx', 'dy', 'sigma', 'only')

    def __init__(self, rgb, o, dx, dy, sigma, only):
        self.rgb, self.o, self.dx, self.dy, self.sigma, self.only = rgb, o, dx, dy, sigma, only


class PaintMixin:
    """Converter methods that build PaintBundle ints and emit paints."""

    def layer_effects(self, layer):
        """Parse a layer's effects -> (paint effects, drop shadow or None). Fill (21) becomes a
        SRC_ATOP colour filter with the fill colour at the effect's opacity; Tint (20) is applied
        to solid paint colours in emit_paint (black + (white - black) · luma, by amount); Gaussian
        Blur (29) and a shadow's softness need BLUR_X (--blur-op). Anything else is a warning."""
        effects, shadow = [], None
        name = layer.get('nm', '?')
        rc = self.sampler.root_clock
        pt = lambda prop: self.sampler.prop_track(prop, 0, rc)
        rgb = lambda prop: tuple(self.sampler.prop_track(prop, d, rc) for d in range(3))
        for ef in layer.get('ef') or []:
            if ef.get('en', 1) == 0:
                continue
            ety = int(ef.get('ty', 0) or 0)
            props = ef.get('ef') or []
            val = lambda i, d: Prop((props[i] or {}).get('v') if i < len(props) else None, d)
            if ety == 21:
                effects.append(FillEffect(rgb(val(2, [1, 1, 1, 1])), pt(val(6, [1]))))
            elif ety == 20:
                effects.append(TintEffect(rgb(val(0, [0, 0, 0, 1])), rgb(val(1, [1, 1, 1, 1])), pt(val(2, [100])).scale(0.01)))
            elif ety == 25:
                direction, distance, softness, only = val(2, [135]), val(3, [5]), val(4, [0]), val(5, [0])
                t0 = rc.times[0]
                if direction.animated or distance.animated:
                    self.warn('animated drop shadow offset (first keyframe used)', name)
                ang = math.radians(direction.at(t0)[0] - 90.0)
                dist = distance.at(t0)[0]
                sigma = softness.at(t0)[0] / 4.0      # lottie-web: stdDeviation = softness / 4
                if sigma > 0 and not self.profile.blur_op:
                    self.warn('drop shadow softness needs --blur-op (hard shadow drawn)', name)
                    sigma = 0.0
                shadow = DropShadow(rgb(val(0, [0, 0, 0, 1])), pt(val(1, [127.5])).scale(1.0 / 255.0),
                                    dist * math.cos(ang), dist * math.sin(ang), sigma, bool(only.at(t0)[0]))
            elif ety == 29:
                if self.profile.blur_op:
                    effects.append(BlurEffect(pt(val(0, [0])).scale(0.3)))   # lottie-web: sigma = 0.3 · blurriness
                else:
                    self.warn('Gaussian blur effect needs --blur-op (not applied)', name)
            else:
                self.warn('effect type %d' % ety, name)
        return effects, shadow

    # ── paints ────────────────────────────────────────────────────────────
    def blend_ints(self, blend):
        if blend:
            self.paint_state.blend = True
            return [PB_BLEND_MODE | (blend << 16)]
        if self.paint_state.blend:
            self.paint_state.blend = False
            return [PB_BLEND_MODE | (BLEND_SRC_OVER << 16)]
        return []

    def effect_ints(self, clock):
        """Paint attributes for the active layer effects: a fill effect is a SRC_ATOP colour
        filter (its colour at its opacity, so the blend with the original is exact), the shadow
        pass a SRC_IN one (the content's alpha in the shadow colour), a blur is BLUR_X. Each is
        cleared again by the next paint once it is no longer active."""
        ints = []
        filt = next((e for e in reversed(self.effects) if isinstance(e, (FillEffect, ShadowPass))), None)
        if filt is not None:
            mode = BLEND_SRC_IN if isinstance(filt, ShadowPass) else BLEND_SRC_ATOP
            r, g, b = filt.rgb
            a = filt.o
            if all(t.is_const() for t in (r, g, b, a)):
                ints += [PB_COLOR_FILTER | (mode << 16), rgb_to_argb([r.const, g.const, b.const, min(1.0, max(0.0, a.const))])]
            else:
                ints += [PB_COLOR_FILTER_ID | (mode << 16), self.color_id(r, g, b, a, clock)]
            self.paint_state.filter = True
        elif self.paint_state.filter:
            ints.append(PB_CLEAR_COLOR_FILTER)
            self.paint_state.filter = False
        blurs = [e.sigma for e in self.effects if isinstance(e, BlurEffect)]
        if blurs:
            sigma = blurs[0]
            for extra in blurs[1:]:            # blurs compose as the root of the summed variances
                sigma = Track.hypot(sigma, extra)
            ints += [PB_BLUR_X, self.tb(sigma, clock)]
            self.paint_state.blur = True
        elif self.paint_state.blur:
            ints += [PB_BLUR_X, f2bits(0.0)]
            self.paint_state.blur = False
        return ints

    def tinting(self):
        return any(isinstance(e, TintEffect) for e in self.effects)

    def tinted(self, rgb):
        """Apply the active tint effects to colour channel Tracks (0..1)."""
        r, g, b = rgb
        for e in self.effects:
            if not isinstance(e, TintEffect):
                continue
            luma = r.scale(0.299).add(g.scale(0.587)).add(b.scale(0.114))
            amt = e.amount
            out = []
            for c, bk, wh in zip((r, g, b), e.black, e.white):
                mapped = bk.add(wh.sub(bk).mul(luma))
                out.append(c.add(mapped.sub(c).mul(amt)))
            r, g, b = out
        return r, g, b

    def emit_paint_fill(self, argb, alpha, clock, blend=0):
        if self.tinting():
            rgb = [((argb >> sh) & 0xFF) / 255.0 for sh in (16, 8, 0)]
            r, g, b = self.tinted(tuple(Track.constant(v) for v in rgb))
            if all(t.is_const() for t in (r, g, b)):
                ints = [PB_COLOR, rgb_to_argb([r.const, g.const, b.const, 1.0]) & 0xFFFFFFFF]
            else:
                ints = [PB_COLOR_ID, self.color_id(r, g, b, Track.constant(1.0), clock)]
        else:
            ints = [PB_COLOR, argb & 0xFFFFFFFF]
        ints += [PB_ALPHA, self.tb(alpha, clock), PB_STYLE | (STYLE_FILL << 16)]
        ints += self.effect_ints(clock)
        if self.paint_state.gradient:
            ints += [PB_SHADER, 0]
            self.paint_state.gradient = False
        ints += self.blend_ints(blend)
        self.w.paint(ints)

    def color_ints(self, cp, clock):
        """PaintBundle ints for a colour property, plus the colour's own alpha Track."""
        pt = lambda d: self.sampler.prop_track(cp, d, clock)
        a = pt(3) if len(_lst(cp.value if not cp.animated else [0, 0, 0, 1])) > 3 or cp.animated else Track.constant(1.0)
        tint = self.tinting()
        if not cp.animated and not tint:
            return [PB_COLOR, rgb_to_argb(list(cp.value[:3]) + [1.0])], a
        r, g, b = pt(0), pt(1), pt(2)
        if tint:
            norm = lambda tr: tr.scale(1 / 255.0) if (tr.is_const() and tr.const > 1.0) else tr
            r, g, b = self.tinted((norm(r), norm(g), norm(b)))
            if all(t.is_const() for t in (r, g, b)):
                return [PB_COLOR, rgb_to_argb([r.const, g.const, b.const, 1.0])], a
        cid = self.color_id(r, g, b, Track.constant(1.0), clock)
        return [PB_COLOR_ID, cid], a

    def color_id(self, r, g, b, a, clock):
        """A colour id driven by channel Tracks (ColorExpression, ARGB mode)."""
        norm = lambda tr: tr.scale(1 / 255.0) if (tr.is_const() and tr.const > 1.0) else tr
        r, g, b, a = norm(r), norm(g), norm(b), norm(a)
        bits = tuple(self.tb(tr, clock) for tr in (r, g, b))
        if a.is_const():
            mode, alpha_field = CE_ARGB, int(round(min(1.0, max(0.0, a.const)) * 1024))
        else:
            mode, alpha_field = CE_IDARGB, id_from_nan(self.tb(a, clock))
        key = (mode, alpha_field) + bits
        hit = self.color_cache.get(key)
        if hit is None:
            hit = self.w.color_expression(mode, alpha_field, *bits)
            self.color_cache[key] = hit
        return hit

    def offset_spec(self, style, offsets, clock, is_open=False):
        """How the paint realises the offset-path modifiers under a style: an outward offset of
        a fill is the same path drawn fill-and-stroke with a stroke twice the amount wide and
        the modifier's join, since the renderer's stroker is the offset algorithm. Returns
        (amount Track, join, miter limit, open) or None; an open path's offset is the band
        around it, a stroke twice the amount wide with round caps for a round join and butt
        caps otherwise (After Effects). Inward offsets and offsets under a stroke would need the
        band as a path (subtracted, or outlined) and are drawn unoffset."""
        if not offsets:
            return None
        pt = lambda prop, d=0: self.sampler.prop_track(prop, d, clock)
        amount = Track.constant(0.0)
        for m in offsets:
            amount = amount.add(pt(Prop(m.get('a'), [0])))
        last = offsets[-1]
        if amount.is_const() and abs(amount.const) < 1e-9:
            return None
        if style.get('ty') not in ('fl', 'gf'):
            self.warn('offset path under a stroke (stroke drawn unoffset)', last.get('nm'))
            return None
        if min(amount.fn(t) for t in clock.times) < -1e-9:
            self.warn('inward offset path (drawn unoffset)', last.get('nm'))
            return None
        join = {1: 0, 2: 1, 3: 2}.get(int(last.get('lj', 1) or 1), 0)
        miter = float(Prop(last.get('ml'), [4]).at(clock.times[0])[0]) if join == 0 else None
        return amount, join, miter, is_open

    def emit_paint(self, style, clock, alpha, blend, offset=None):
        ty = style.get('ty')
        pt = lambda prop, d=0: self.sampler.prop_track(prop, d, clock)
        a = alpha.mul(pt(Prop(style.get('o'), [100])).scale(0.01))
        ints = []
        gradient = ty in ('gf', 'gs')
        if gradient:
            ints += [PB_COLOR, 0xFFFFFFFF]
            if self.tinting():
                self.warn('tint effect over a gradient (not applied)', style.get('nm'))
        else:
            cints, ca = self.color_ints(Prop(style.get('c'), [0, 0, 0, 1]), clock)
            ints += cints
            a = a.mul(ca)
        ints += [PB_ALPHA, self.tb(a, clock)]
        ints += self.effect_ints(clock)
        stroke = ty in ('st', 'gs')
        if offset is not None and not stroke:
            amount, join, miter, is_open = offset
            ints.append(PB_STYLE | ((STYLE_STROKE if is_open else STYLE_FILL_AND_STROKE) << 16))
            ints += [PB_STROKE_WIDTH, self.tb(amount.scale(2.0), clock)]
            ints.append(PB_STROKE_JOIN | (join << 16))
            if is_open:
                ints.append(PB_STROKE_CAP | ((1 if join == 1 else 0) << 16))
            if miter is not None:
                ints += [PB_STROKE_MITER, f2bits(miter)]
            if self.paint_state.dash:           # the stroke half must not inherit a dash
                ints.append(PB_PATH_EFFECT)
                self.paint_state.dash = False
        else:
            ints.append(PB_STYLE | ((STYLE_STROKE if stroke else STYLE_FILL) << 16))
        if stroke:
            ints += [PB_STROKE_WIDTH, self.tb(pt(Prop(style.get('w'), [1])), clock)]
            cap = {1: 0, 2: 1, 3: 2}.get(int(style.get('lc', 1)), 0)
            join = {1: 0, 2: 1, 3: 2}.get(int(style.get('lj', 1)), 0)
            ints.append(PB_STROKE_CAP | (cap << 16))
            ints.append(PB_STROKE_JOIN | (join << 16))
            if 'ml' in style and int(style.get('lj', 1)) == 1:
                ints += [PB_STROKE_MITER, f2bits(float(style['ml']))]
            dashes = style.get('d')
            if dashes:
                intervals, phase = [], 0.0
                for d in dashes:
                    v = Prop(d.get('v'), [0])
                    if v.animated:
                        self.warn('animated dashes (first keyframe used)', style.get('nm'))
                    val = v.at(clock.times[0])[0]
                    if d.get('n') == 'o':
                        phase = val
                    else:
                        intervals.append(val)
                if len(intervals) % 2 == 1:
                    intervals = intervals * 2
                if intervals and any(x > 0 for x in intervals):
                    data = [PPE_DASH, f2bits(phase), len(intervals)] + [f2bits(x) for x in intervals]
                    ints.append(PB_PATH_EFFECT | (len(data) << 16))
                    ints += data
                    self.paint_state.dash = True
                elif self.paint_state.dash:
                    ints.append(PB_PATH_EFFECT)
                    self.paint_state.dash = False
            elif self.paint_state.dash:
                ints.append(PB_PATH_EFFECT)
                self.paint_state.dash = False
        if gradient:
            ints += self.gradient_ints(style, clock)
            self.paint_state.gradient = True
        elif self.paint_state.gradient:
            ints += [PB_SHADER, 0]
            self.paint_state.gradient = False
        bm = int(style.get('bm', 0) or 0)
        if bm:
            if bm in LOTTIE_BLEND:
                blend = LOTTIE_BLEND[bm]
            else:
                self.warn('blend mode %s' % bm, style.get('nm'))
        ints += self.blend_ints(blend)
        self.w.paint(ints)

    def gradient_ints(self, style, clock):
        g = style.get('g', {})
        ncol = int(g.get('p', 0))
        kp = Prop(g.get('k'), [])
        k0 = _lst(kp.at(clock.times[0]))
        if ncol <= 0:
            ncol = len(k0) // 4
        nalpha = max(0, (len(k0) - 4 * ncol) // 2)
        colors, id_mask, stops = [], 0, []
        if not kp.animated:
            alphas = [(k0[4 * ncol + 2 * j], k0[4 * ncol + 2 * j + 1]) for j in range(nalpha)]
            st = [(k0[4 * j], k0[4 * j + 1], k0[4 * j + 2], k0[4 * j + 3],
                   interp_stops(alphas, k0[4 * j]) if alphas else 1.0) for j in range(ncol)]
            for (off, r, gg, b, a) in expand_midpoints(st):
                stops.append(f2bits(off))
                colors.append(rgb_to_argb([r, gg, b, a]))
        else:
            pt = lambda d: self.sampler.prop_track(kp, d, clock)
            alpha_offs = [pt(4 * ncol + 2 * j) for j in range(nalpha)]
            alpha_vals = [pt(4 * ncol + 2 * j + 1) for j in range(nalpha)]
            for j in range(ncol):
                off = pt(4 * j)
                stops.append(self.tb(off, clock))
                if nalpha:
                    # the stop's alpha, read off the (possibly moving) alpha stops: sampled
                    fo = off.fn
                    ao, av = alpha_offs, alpha_vals
                    a = Track(lambda t, fo=fo, ao=ao, av=av: interp_stops([(x.fn(t), y.fn(t)) for x, y in zip(ao, av)], fo(t)))
                else:
                    a = Track.constant(1.0)
                r, gg, b = pt(4 * j + 1), pt(4 * j + 2), pt(4 * j + 3)
                if all(tr.is_const() for tr in (r, gg, b, a)):
                    colors.append(rgb_to_argb([r.const, gg.const, b.const, a.const]))
                else:
                    colors.append(self.color_id(r, gg, b, a, clock))
                    id_mask |= 1 << j
        gtype = int(style.get('t', 1))
        sp, ep = Prop(style.get('s'), [0, 0]), Prop(style.get('e'), [100, 0])
        pt2 = lambda prop, d: self.sampler.prop_track(prop, d, clock)
        sx, sy, ex, ey = pt2(sp, 0), pt2(sp, 1), pt2(ep, 0), pt2(ep, 1)
        # a radial highlight moves the focal point: start + h% of the radius along the
        # end-point angle plus the highlight angle (lottie-web, |h| capped just under 100 %)
        focal = None
        if gtype == 2:
            hl = pt2(Prop(style.get('h'), [0]), 0).scale(0.01)
            if not (hl.is_const() and abs(hl.const) < 1e-6) and not self.profile.focal_op:
                self.warn('radial gradient highlight needs --focal-op (drawn concentric)', style.get('nm'))
            elif not (hl.is_const() and abs(hl.const) < 1e-6):
                dx, dy = ex.sub(sx), ey.sub(sy)
                radius = Track.hypot(dx, dy)
                ang = dy.atan2(dx).add(pt2(Prop(style.get('a'), [0]), 0).scale(math.pi / 180.0))
                dist = radius.mul(hl.max(-0.99).min(0.99))
                focal = (sx.add(ang.cos().mul(dist)), sy.add(ang.sin().mul(dist)))
        gt = GRAD_FOCAL_RADIAL_X if focal is not None else (GRAD_RADIAL if gtype == 2 else GRAD_LINEAR)
        ints = [PB_GRADIENT | (gt << 16), ((id_mask << 16) | len(colors)) & 0xFFFFFFFF]
        ints += colors
        ints.append(len(stops))
        ints += stops
        if gtype == 2:
            radius = Track.hypot(ex.sub(sx), ey.sub(sy))
            if radius.is_const():
                radius = Track.constant(max(1e-3, radius.const))
            ints += [self.tb(sx, clock), self.tb(sy, clock), self.tb(radius, clock)]
            if focal is not None:
                ints += [self.tb(focal[0], clock), self.tb(focal[1], clock)]
            ints.append(0)
        else:
            ints += [self.tb(sx, clock), self.tb(sy, clock), self.tb(ex, clock), self.tb(ey, clock), 0]
        return ints
