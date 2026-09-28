"""Glyph sources for text layers: the document's own `chars`, or an installed font through fontTools."""

import math
import os

from .wire import (COND_GT, PB_ALPHA, PB_COLOR, PB_COLOR_ID, PB_STROKE_JOIN, PB_STROKE_WIDTH, PB_STYLE, STYLE_FILL,
    STYLE_STROKE, f2bits, rgb_to_argb)
from .props import Prop
from .shapes import shape_to_floats
from .tracks import Track, X_MUL, X_STEP



class Glyph:
    """A glyph in a 100-unit em: `contours` are Lottie shapes (y down, baseline at 0) and
    `advance` the horizontal advance, both scaled so that font size 100 draws at 1:1."""
    __slots__ = ('contours', 'advance')

    def __init__(self, contours, advance):
        self.contours, self.advance = contours, advance


class CharsGlyphs:
    """Glyphs from the document's `chars` list (bodymovin's glyph export), matched by
    character, style and family the way lottie-web's FontManager.getCharData does."""

    def __init__(self, chars, family, style):
        self.table = {}
        for c in chars:                          # a chars entry carries `style`, the font list `fStyle`
            if c.get('fFamily') == family and (c.get('style') or c.get('fStyle')) == style and 'ch' in c:
                self.table[c['ch']] = c
        self.cache = {}

    def empty(self):
        return not self.table

    def glyph(self, ch):
        if ch in self.cache:
            return self.cache[ch]
        c = self.table.get(ch)
        g = None
        if c is not None:
            contours = []

            def walk(items):
                for it in items:
                    if it.get('ty') == 'sh':
                        sh = (it.get('ks') or {}).get('k')
                        if isinstance(sh, dict) and sh.get('v'):
                            contours.append(sh)
                    elif it.get('ty') == 'gr':
                        walk(it.get('it', []))
            walk(((c.get('data') or {}).get('shapes')) or [])
            g = Glyph(contours, float(c.get('w', 0) or 0))
        self.cache[ch] = g
        return g


class FontGlyphs:
    """Glyph outlines from an installed font through fontTools, in the same 100-unit em."""
    _index = None
    DIRS = ('/System/Library/Fonts', '/System/Library/Fonts/Supplemental', '/Library/Fonts',
            os.path.expanduser('~/Library/Fonts'), '/usr/share/fonts', 'C:/Windows/Fonts')

    def __init__(self, ttfont, label, substituted):
        self.font, self.label, self.substituted = ttfont, label, substituted
        self.upm = float(ttfont['head'].unitsPerEm)
        self.glyph_set = ttfont.getGlyphSet()
        self.cmap = ttfont.getBestCmap() or {}
        self.cache = {}

    @classmethod
    def index(cls):
        """(family, style) / full name / PostScript name -> (path, face number), lower-cased."""
        if cls._index is not None:
            return cls._index
        idx = {}
        try:
            from fontTools.ttLib import TTFont, TTCollection
        except ImportError:
            cls._index = idx
            return idx
        import logging
        logging.getLogger('fontTools').setLevel(logging.ERROR)
        for d in cls.DIRS:
            if not os.path.isdir(d):
                continue
            for fn in sorted(os.listdir(d)):
                path = os.path.join(d, fn)
                ext = fn.lower().rsplit('.', 1)[-1]
                if ext not in ('ttf', 'otf', 'ttc'):
                    continue
                try:
                    fonts = TTCollection(path, lazy=True).fonts if ext == 'ttc' else [TTFont(path, lazy=True)]
                except Exception:
                    continue
                for k, f in enumerate(fonts):
                    try:
                        nm = f['name']
                        fam, sty = nm.getDebugName(1), nm.getDebugName(2)
                        full, ps = nm.getDebugName(4), nm.getDebugName(6)
                    except Exception:
                        continue
                    for key in ((fam or '').lower() + '|' + (sty or '').lower(), (full or '').lower(), (ps or '').lower()):
                        if key and key != '|' and key not in idx:
                            idx[key] = (path, k)
                for f in fonts:                     # collections share one reader: close after all faces
                    try:
                        f.close()
                    except Exception:
                        pass
        cls._index = idx
        return idx

    @classmethod
    def find(cls, fname, family, style):
        idx = cls.index()
        if not idx:
            return None
        tries = [((fname or '').lower(), False), ((family or '').lower() + '|' + (style or '').lower(), False),
                 ((family or '').lower() + '|regular', True), ('helvetica|regular', True), ('arial|regular', True)]
        for key, substituted in tries:
            hit = idx.get(key)
            if hit is None:
                continue
            try:
                from fontTools.ttLib import TTFont
                tt = TTFont(hit[0], fontNumber=hit[1] if hit[0].lower().endswith('.ttc') else -1)
            except Exception:
                continue
            return cls(tt, os.path.basename(hit[0]) + ('#%d' % hit[1] if hit[0].lower().endswith('.ttc') else ''), substituted)
        return None

    def empty(self):
        return False

    def glyph(self, ch):
        if ch in self.cache:
            return self.cache[ch]
        g = None
        name = self.cmap.get(ord(ch))
        if name is not None and name in self.glyph_set:
            from fontTools.pens.basePen import BasePen
            scale = 100.0 / self.upm

            class Pen(BasePen):
                def __init__(pen, gs):
                    super().__init__(gs)
                    pen.contours, pen.cur = [], None

                def pt(pen, p):
                    return [p[0] * scale, -p[1] * scale]

                def _moveTo(pen, p):
                    pen.cur = {'v': [pen.pt(p)], 'i': [[0.0, 0.0]], 'o': [[0.0, 0.0]], 'c': True}

                def _lineTo(pen, p):
                    pen.cur['v'].append(pen.pt(p)); pen.cur['i'].append([0.0, 0.0]); pen.cur['o'].append([0.0, 0.0])

                def _curveToOne(pen, p1, p2, p3):
                    c = pen.cur
                    last = c['v'][-1]; a, b, e = pen.pt(p1), pen.pt(p2), pen.pt(p3)
                    c['o'][-1] = [a[0] - last[0], a[1] - last[1]]
                    c['v'].append(e); c['i'].append([b[0] - e[0], b[1] - e[1]]); c['o'].append([0.0, 0.0])

                def _qCurveToOne(pen, p1, p2):
                    c = pen.cur
                    last = c['v'][-1]; q, e = pen.pt(p1), pen.pt(p2)
                    c['o'][-1] = [(q[0] - last[0]) * 2 / 3, (q[1] - last[1]) * 2 / 3]
                    c['v'].append(e); c['i'].append([(q[0] - e[0]) * 2 / 3, (q[1] - e[1]) * 2 / 3]); c['o'].append([0.0, 0.0])

                def _closePath(pen):
                    c = pen.cur
                    if c and len(c['v']) > 1 and abs(c['v'][0][0] - c['v'][-1][0]) < 1e-9 and abs(c['v'][0][1] - c['v'][-1][1]) < 1e-9:
                        c['i'][0] = c['i'][-1]
                        for k in ('v', 'i', 'o'):
                            c[k].pop()
                    if c and len(c['v']) >= 2:
                        pen.contours.append(c)
                    pen.cur = None

                def _endPath(pen):
                    pen._closePath()

            pen = Pen(self.glyph_set)
            try:
                gl = self.glyph_set[name]
                gl.draw(pen)
                g = Glyph(pen.contours, gl.width * scale)
            except Exception:
                g = None
        self.cache[ch] = g
        return g


class TextMixin:
    """Converter methods for text layers."""

    # ── text layers ───────────────────────────────────────────────────────
    def glyph_source(self, font):
        """Glyph outlines for a font entry of the document's `fonts.list`: the document's own
        `chars` (bodymovin's "glyphs" export) when it has them, else a system font found by
        family and style through fontTools. Cached per font name."""
        key = font.get('fName') or (font.get('fFamily'), font.get('fStyle'))
        cache = self.glyph_sources
        if key in cache:
            return cache[key]
        chars = self.doc.get('chars') or []
        src = None
        if chars:
            src = CharsGlyphs(chars, font.get('fFamily'), font.get('fStyle'))
        if src is None or src.empty():
            fs = FontGlyphs.find(font.get('fName'), font.get('fFamily'), font.get('fStyle'))
            if fs is None:
                self.warn('no font for %s (text layer skipped)' % (font.get('fName') or font.get('fFamily')))
            elif fs.substituted:
                self.warn('font %s not installed, using %s' % (font.get('fName') or font.get('fFamily'), fs.label))
            src = fs
        cache[key] = src
        return src

    def emit_text(self, layer, clock, alpha, blend):
        """A text layer: every character is a glyph path drawn under its own matrix, with the
        text animators applied per character as expressions (lottie-web's model, see
        TextAnimatorProperty.getMeasures)."""
        w = self.w
        td = layer.get('t') or {}
        docs = (td.get('d') or {}).get('k') or []
        if not docs:
            return
        name = layer.get('nm', '?')
        if (td.get('p') or {}).get('m') is not None:
            self.warn('text on a path (drawn straight)', name)
        fonts = {f.get('fName'): f for f in (self.doc.get('fonts') or {}).get('list', [])}
        for k, kf in enumerate(docs):
            d = kf.get('s') or {}
            if len(docs) > 1:
                t0 = float(kf.get('t', 0))
                t1 = float(docs[k + 1].get('t', 0)) if k + 1 < len(docs) else 1e9
                vis = Track(lambda t, t0=t0, t1=t1: 1.0 if t0 <= t < t1 else 0.0,
                            [clock.bits, f2bits(t0 - 1e-3), X_STEP, f2bits(t1 - 1e-3), clock.bits, X_STEP, X_MUL])
                if all(vis.fn(t) <= 0 for t in clock.times):
                    continue
                w.cond_begin(COND_GT, self.tb(vis, clock, hold=True), f2bits(0.5))
            self.emit_text_document(d, fonts, td, clock, alpha, blend, name)
            if len(docs) > 1:
                w.cond_end()

    def emit_text_document(self, d, fonts, td, clock, alpha, blend, name):
        """One text document: lay the characters out, then draw each glyph under its own
        matrix with the animators' per-character tracks."""
        w = self.w
        lay = self.layout_text(d, fonts, td, clock, name)
        if lay is None:
            return
        if not lay.per_char_paint and lay.fill_argb is not None and not lay.stroke_over:
            self.emit_paint_fill(lay.fill_argb, alpha, clock, blend)
        x_pos, line_no = 0.0, 0
        x_shift = Track.constant(0.0)         # accumulated animated tracking on this line
        first_on_line = True
        for i, L in enumerate(lay.letters):
            if L['n']:
                line_no += 1
                x_pos, x_shift, first_on_line = 0.0, Track.constant(0.0), True
                continue
            # animated tracking opens space between characters: it moves this character and
            # everything after it, never the first character of a line (lottie-web's result)
            if lay.has_tracking and not first_on_line:
                x_shift = x_shift.add(lay.tracking_of(self, i, clock))
                if not x_shift.is_const():
                    x_shift = Track(x_shift.fn, [self.tb(x_shift, clock)])   # keep the chain linear
            first_on_line = False
            g = L['glyph']
            if g is not None and g.contours:
                pl = self.char_placement(lay, i, x_pos, x_shift, line_no, clock)
                if self.debug_text is not None:
                    self.debug_text.append((L['val'], pl['tx'], pl['ty'], pl['rot'], pl['sx'], pl['sy'], pl['anx'], pl['any'],
                                            pl['opacity'], pl['col'], pl['offf'], pl['ax_al'], pl['ay_al']))
                self.draw_glyph(lay, g, pl, alpha, clock, blend)
            x_pos += L['l'] + lay.tracking

    def layout_text(self, d, fonts, td, clock, name):
        """A text document laid out as lottie-web's completeTextData does -> _TextLayout, or
        None when there is nothing to draw (no font, no fill and no stroke)."""
        text = str(d.get('t', '')).replace('\u0003', '\r')
        size = float(d.get('s', 36) or 36)
        fname = d.get('f')
        font = fonts.get(fname) or {'fName': fname, 'fFamily': fname, 'fStyle': 'Regular'}
        glyphs = self.glyph_source(font)
        if glyphs is None:
            return None
        lay = _TextLayout()
        lay.size = size
        lay.tracking = float(d.get('tr', 0) or 0) * 0.001 * size
        lay.line_h = float(d.get('lh') or size * 1.2)
        lay.ls = float(d.get('ls', 0) or 0)
        lay.just = int(d.get('j', 0) or 0)
        lay.just_mult = {1: -1.0, 2: -0.5}.get(lay.just, 0.0)
        lay.fc, lay.sc = d.get('fc'), d.get('sc')
        lay.sw = float(d.get('sw', 0) or 0)
        lay.stroke_over = bool(d.get('of'))
        lay.ascent = float(font.get('ascent', 0) or 0) * size / 100.0
        lay.box_pos = d.get('ps')
        lay.y_off = size * 1.2 * 0.714
        if d.get('sz'):
            self.warn('box text (drawn without wrapping)', name)
        lay.fill_argb = rgb_to_argb(list(lay.fc[:3]) + [1.0]) if lay.fc else None
        lay.stroke_argb = rgb_to_argb(list(lay.sc[:3]) + [1.0]) if lay.sc and lay.sw > 0 else None
        if lay.fill_argb is None and lay.stroke_argb is None:
            return None

        # letters and line widths
        letters, line = [], 0
        for ch in text:
            if ch == '\r':
                letters.append({'n': True, 'val': '', 'l': 0.0, 'line': line, 'glyph': None})
                line += 1
                continue
            g = glyphs.glyph(ch)
            letters.append({'n': False, 'val': ch, 'l': (g.advance * size / 100.0) if g else 0.0, 'line': line, 'glyph': g})
        n = len(letters)
        line_widths, width, pending_spaces = [], -lay.tracking, 0.0
        for L in letters:
            if L['n']:
                line_widths.append(width)
                width, pending_spaces = -2 * lay.tracking, 0.0
            if L['val'] == ' ':
                pending_spaces += L['l'] + lay.tracking
            else:
                width += L['l'] + lay.tracking + pending_spaces
                pending_spaces = 0.0
        line_widths.append(width)
        lay.letters, lay.line_widths = letters, line_widths

        # anchor grouping: each letter's group width `an` and its offset `add` inside the group
        grouping = int((td.get('m') or {}).get('g', 1) or 1)
        lay.align = Prop((td.get('m') or {}).get('a'), [0, 0]).at(clock.times[0])
        for L in letters:
            L['an'], L['add'] = L['l'], 0.0
        if grouping in (2, 3):
            start, acc = 0, 0.0
            for i, L in enumerate(letters):
                L['add'] = acc
                acc += L['l']
                ends = (L['val'] in ('', ' ')) if grouping == 2 else (L['val'] == '')
                if ends or i == n - 1:
                    if ends:
                        acc -= L['l']
                    for k in range(start, i + 1):
                        letters[k]['an'] = acc
                    start, acc = i + 1, 0.0

        # animators: per-letter selector indexes (based on characters / characters without
        # spaces / words / lines), the character count each one ranges over, its properties
        lay.animators = td.get('a') or []
        lay.totals = []
        for j, an in enumerate(lay.animators):
            based = int((an.get('s') or {}).get('b', 1) or 1)
            ind = 0
            for i, L in enumerate(letters):
                L.setdefault('idx', []).append(ind)
                if (based == 1 and L['val'] != '') or (based == 2 and L['val'] not in ('', ' ')) \
                        or (based == 3 and (L['n'] or L['val'] == ' ' or i == n - 1)) or (based == 4 and (L['n'] or i == n - 1)):
                    ind += 1
            lay.totals.append(ind)
        lay.aprops = []
        for an in lay.animators:
            a = an.get('a') or {}
            lay.aprops.append({k: a.get(k) for k in ('p', 'a', 's', 'r', 'o', 'fc', 't', 'sw', 'sc', 'sk')})
        lay.per_char_paint = any(ap['o'] or ap['fc'] or ap['sw'] or ap['sc'] for ap in lay.aprops)
        lay.has_tracking = any(ap['t'] for ap in lay.aprops)
        for ap in lay.aprops:
            if ap['sk'] or ap['sc'] or ap['sw']:
                self.warn('text animator skew / stroke properties (ignored)', name)
        return lay

    def char_placement(self, lay, i, x_pos, x_shift, line_no, clock):
        """Tracks placing character i: translation, rotation, scale, anchor, opacity and fill
        colour after every animator (lottie-web's getMeasures), plus the grouping pivot."""
        L = lay.letters[i]
        pt = lambda prop, dim=0: self.sampler.prop_track(prop, dim, clock)
        # justification (per line) with lottie-web's animated-tracking correction
        jx = 0.0
        if lay.just == 1:
            jx = -lay.line_widths[L['line']]
        elif lay.just == 2:
            jx = -lay.line_widths[L['line']] / 2.0
        just_track = Track.constant(jx)
        if lay.has_tracking and lay.just_mult:
            lo, hi = lay.line_span(i)
            just_track = just_track.add(lay.line_tracking(self, lo + 1, hi, clock).scale(lay.just_mult))
        offf = L['an'] / 2.0 - L['add']
        ax_al, ay_al = lay.align[0] * L['an'] * 0.005, lay.align[1] * lay.y_off * 0.01
        box = lay.box_pos
        tx = just_track.add(x_shift).add(Track.constant(x_pos + offf + ax_al + (box[0] if box else 0.0)))
        ty = Track.constant(line_no * lay.line_h - lay.ls + ay_al + ((box[1] + lay.ascent) if box else 0.0))
        rot, sx, sy = Track.constant(0.0), Track.constant(1.0), Track.constant(1.0)
        anx, any_ = Track.constant(0.0), Track.constant(0.0)
        opacity = Track.constant(1.0)
        col = [Track.constant(v) for v in (lay.fc[:3] if lay.fc else (0, 0, 0))]
        for jj, an in enumerate(lay.animators):
            ap = lay.aprops[jj]
            if not any(ap[k] for k in ('p', 'a', 's', 'r', 'o', 'fc')):
                continue
            m = self.selector_mult(an, L['idx'][jj], lay.totals[jj], clock)
            if ap['p']:
                tx = tx.add(pt(Prop(ap['p'], [0, 0]), 0).mul(m)); ty = ty.add(pt(Prop(ap['p'], [0, 0]), 1).mul(m))
            if ap['a']:
                anx = anx.add(pt(Prop(ap['a'], [0, 0]), 0).mul(m)); any_ = any_.add(pt(Prop(ap['a'], [0, 0]), 1).mul(m))
            if ap['s']:
                sx = sx.mul(Track.constant(1.0).add(pt(Prop(ap['s'], [100, 100]), 0).scale(0.01).sub(1.0).mul(m)))
                sy = sy.mul(Track.constant(1.0).add(pt(Prop(ap['s'], [100, 100]), 1).scale(0.01).sub(1.0).mul(m)))
            if ap['r']:
                rot = rot.add(pt(Prop(ap['r'], [0])).mul(m))
            if ap['o']:
                o = pt(Prop(ap['o'], [100])).scale(0.01)
                opacity = opacity.add(o.mul(m).sub(opacity).mul(m))   # lottie-web's accumulation
            if ap['fc'] and lay.fc:
                col = [c.add(pt(Prop(ap['fc'], [0, 0, 0, 1]), dim).sub(c).mul(m)) for dim, c in enumerate(col)]
        return {'tx': tx, 'ty': ty, 'rot': rot, 'sx': sx, 'sy': sy, 'anx': anx, 'any': any_, 'opacity': opacity,
                'col': col, 'offf': offf, 'ax_al': ax_al, 'ay_al': ay_al}

    def draw_glyph(self, lay, g, pl, alpha, clock, blend):
        """Save, the character's matrix (translate · rotate · scale · un-pivot · glyph scale),
        fill and / or stroke of the glyph path, restore."""
        w = self.w
        rot, sx, sy = pl['rot'], pl['sx'], pl['sy']
        w.save()
        w.translate(self.tb(pl['tx'], clock), self.tb(pl['ty'], clock))
        if not (rot.is_const() and abs(rot.const) < 1e-9):
            w.rotate(self.tb(rot, clock))
        if not (sx.is_const() and sy.is_const() and abs(sx.const - 1) < 1e-9 and abs(sy.const - 1) < 1e-9):
            w.scale(self.tb(sx, clock), self.tb(sy, clock))
        w.translate(self.tb(pl['anx'].neg().sub(pl['offf'] + pl['ax_al']), clock), self.tb(pl['any'].neg().sub(pl['ay_al']), clock))
        w.scale(f2bits(lay.size / 100.0), f2bits(lay.size / 100.0))
        pid = self.glyph_path_id(g)
        a_char = alpha.mul(pl['opacity']) if lay.per_char_paint else alpha
        col = pl['col']

        def draw_fill():
            if lay.fill_argb is None:
                return
            if lay.per_char_paint:
                if all(c.is_const() for c in col):
                    self.emit_paint_fill(rgb_to_argb([c.const for c in col] + [1.0]), a_char, clock, blend)
                else:
                    ints = [PB_COLOR_ID, self.color_id(col[0], col[1], col[2], Track.constant(1.0), clock),
                            PB_ALPHA, self.tb(a_char, clock), PB_STYLE | (STYLE_FILL << 16)] + self.effect_ints(clock) + self.blend_ints(blend)
                    w.paint(ints)
            elif lay.stroke_over and lay.stroke_argb is not None:
                self.emit_paint_fill(lay.fill_argb, alpha, clock, blend)
            w.draw_path(pid)

        def draw_stroke():
            if lay.stroke_argb is None:
                return
            ints = [PB_COLOR, lay.stroke_argb & 0xFFFFFFFF, PB_ALPHA, self.tb(a_char, clock), PB_STYLE | (STYLE_STROKE << 16),
                    PB_STROKE_WIDTH, f2bits(lay.sw / (lay.size / 100.0)), PB_STROKE_JOIN | (1 << 16)] + self.effect_ints(clock) + self.blend_ints(blend)
            w.paint(ints)
            w.draw_path(pid)

        if lay.stroke_over:
            draw_fill(); draw_stroke()
        else:
            draw_stroke(); draw_fill()
        w.restore()

    def glyph_path_id(self, g):
        cache = self.glyph_ids
        if id(g) not in cache:
            floats = []
            for c in g.contours:
                floats += shape_to_floats(c)
            cache[id(g)] = self.path_id(floats, winding=0)
        return cache[id(g)]

    def selector_mult(self, animator, ind, total, clock):
        """The range selector's weight for character index `ind` of `total`, as a Track of time
        (lottie-web TextSelectorProp.getMult): start / end / offset in percent of the
        animator's character count or in indexes, one of six shapes, times the amount."""
        sel = animator.get('s') or {}
        total = max(1, int(total or 1))
        pt = lambda prop, d: self.sampler.prop_track(Prop(prop, d), 0, clock)
        div = 1.0 if int(sel.get('r', 1) or 1) == 2 else 100.0 / total
        o = pt(sel.get('o'), [0]).scale(1.0 / div)
        s = pt(sel.get('s'), [0]).scale(1.0 / div).add(o)
        e = pt(sel.get('e'), [100 if int(sel.get('r', 1) or 1) != 2 else total]).scale(1.0 / div).add(o)
        lo, hi = s.min(e), s.max(e)
        shape = int(sel.get('sh', 1) or 1)
        span = hi.sub(lo).max(1e-6)
        if shape == 1:                                   # square: coverage of [ind, ind+1]
            m = hi.min(ind + 1.0).sub(lo.max(float(ind))).clamp01()
        else:
            v = Track.constant(ind + 0.5).sub(lo)
            if shape == 2:
                m = v.div(span).clamp01()
            elif shape == 3:
                m = Track.constant(1.0).sub(v.div(span).clamp01())
            elif shape == 4:
                m = Track.constant(1.0).sub(v.div(span).clamp01().scale(2.0).sub(1.0).abs())
            elif shape == 5:
                x = v.max(0.0).min(span).sub(span.scale(0.5))
                half = span.scale(0.5)
                m = Track.constant(1.0).sub(x.mul(x).div(half.mul(half))).max(0.0).sqrt()
            else:                                        # 6 smooth
                m = Track.constant(1.0).add(v.max(0.0).min(span).div(span).scale(2 * math.pi).add(math.pi).cos()).scale(0.5)
        t0 = clock.times[0]
        if abs(Prop(sel.get('xe'), [0]).at(t0)[0]) > 1e-6 or abs(Prop(sel.get('ne'), [0]).at(t0)[0]) > 1e-6 \
                or abs(Prop(sel.get('sm'), [100]).at(t0)[0] - 100) > 1e-6:
            self.warn('text selector ease / smoothness (ignored)')
        return m.mul(pt(sel.get('a'), [100]).scale(0.01))


class _TextLayout:
    """A laid-out text document: letters (with advance, line, glyph, grouping width and offset,
    animator indexes), line widths, the document's metrics and colours, and the animators."""
    letters = line_widths = animators = totals = aprops = None

    def line_span(self, i):
        """(first index, one past the last) of the line holding letter i."""
        lo = max(0, i - 1)
        while lo > 0 and not self.letters[lo - 1]['n']:
            lo -= 1
        hi = i
        while hi < len(self.letters) and not self.letters[hi]['n']:
            hi += 1
        return lo, hi

    def tracking_of(self, conv, i, clock):
        """The animated tracking every animator adds at letter i."""
        pt = lambda prop: conv.sampler.prop_track(prop, 0, clock)
        trk = Track.constant(0.0)
        for jj, an in enumerate(self.animators):
            if self.aprops[jj]['t']:
                trk = trk.add(pt(Prop(self.aprops[jj]['t'], [0])).mul(conv.selector_mult(an, self.letters[i]['idx'][jj], self.totals[jj], clock)))
        return trk

    def line_tracking(self, conv, i_from, i_to, clock):
        """The animated tracking summed over letters i_from .. i_to-1 (it shifts the
        justification of a centred or right-aligned line)."""
        total = Track.constant(0.0)
        for k in range(i_from, i_to):
            if not self.letters[k]['n']:
                total = total.add(self.tracking_of(conv, k, clock))
        return total
