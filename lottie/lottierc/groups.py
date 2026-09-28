"""Shape groups: styles applied to the shapes before them, merge paths, repeaters as loops."""

from .wire import f2bits, nan_id
from .props import Prop, Transform
from .shapes import MERGE_OPS, MOD_TYPES, SHAPE_TYPES, STYLE_TYPES
from .tracks import Track, X_DIV


class GroupMixin:
    """Converter methods for shape groups, merge paths and repeaters."""

    # ── shapes ────────────────────────────────────────────────────────────
    def render_group(self, items, clock, alpha, inh_styles, inh_trims, inh_mods, blend):
        """items: a shape list (layer `shapes` or a group's `it`).
        inh_*: styles / trim paths / shape modifiers of enclosing groups that sit after this
        group in their list, so they apply to everything drawn here (lottie-web semantics)."""
        w = self.w
        items = self.fold_repeater(items)
        tr_item = next((it for it in items if it.get('ty') == 'tr'), None)
        w.save()
        if tr_item is not None:
            tk = self.emit_transform(Transform(tr_item), clock)
            alpha = alpha.mul(tk['o'])
        _Group(self, items, clock, alpha, inh_styles, inh_trims, inh_mods, blend).run()
        w.restore()

    @staticmethod
    def fold_repeater(items):
        """A repeater (lottie-web RepeaterModifier) replaces every item before it in the list by
        `copies` groups of those items, each under its own transform and opacity; items after
        it style the copies as usual. The last repeater wraps the earlier ones. The copies are
        one synthetic group item carrying the repeater under REPEATER."""
        rep_idx = max((i for i, it in enumerate(items) if it.get('ty') == 'rp' and not it.get('hd')), default=None)
        if rep_idx is None:
            return items
        return [{'ty': 'gr', 'nm': items[rep_idx].get('nm', 'repeater'), 'it': items[:rep_idx],
                 REPEATER: items[rep_idx]}] + items[rep_idx + 1:]

    # ── repeaters ─────────────────────────────────────────────────────────
    def emit_repeater(self, rep, body, clock, alpha, inh_styles, inh_trims, inh_mods, blend):
        """Copies of `body` under the repeater's transform, as one LoopOperation whose index
        drives every copy-dependent value through expressions (sampled mode unrolls instead).

        Copy k (k = 0 .. copies-1 in the order lottie-web builds them) sits at iteration
        n = offset + k: translate(anchor + n·position) · rotate(n·rotation) · scale(scale^n)
        · translate(-anchor), with opacity so + (eo - so) · i / (copies - 1) where i is the
        copy's index in the shape list (k for composite Above, copies-1-k for Below). Below
        draws k = 0 first (the original underneath), Above draws it last."""
        w, S = self.w, self.sampler
        pt = lambda prop, d=0: S.prop_track(prop, d, clock)
        tr = rep.get('tr') or {}
        # lottie-web: copies = ceil(c); the clock sits a thousandth of a frame past the keyframe,
        # so back off by as much before rounding or an integer count at a keyframe gains a copy
        count = pt(Prop(rep.get('c'), [1])).sub(0.001).ceil()
        offset = pt(Prop(rep.get('o'), [0]))
        below = int(rep.get('m', 1) or 1) == 2
        a = Prop(tr.get('a'), [0, 0]); p = Prop(tr.get('p'), [0, 0]); sc = Prop(tr.get('s'), [100, 100])
        ax, ay, px, py = pt(a, 0), pt(a, 1), pt(p, 0), pt(p, 1)
        sx, sy = pt(sc, 0).scale(0.01), pt(sc, 1).scale(0.01)
        rot = pt(Prop(tr.get('r'), [0]))
        so, eo = pt(Prop(tr.get('so'), [100])).scale(0.01), pt(Prop(tr.get('eo'), [100])).scale(0.01)
        zero = lambda t: t.is_const() and abs(t.const) < 1e-9
        one = lambda t: t.is_const() and abs(t.const - 1) < 1e-9
        whole = offset.is_const() and float(offset.const).is_integer()

        def spow(sv, n):
            """The scale of iteration n: s^n for whole iterations; for a fractional offset
            lottie-web scales the fractional part linearly, s^floor(n) · (1 + (s - 1)·fract(n))."""
            if whole:
                return sv.pow(n)
            return sv.pow(n.floor()).mul(Track.constant(1.0).add(sv.sub(1.0).mul(n.fract())))

        def emit_copy(j, copies):
            """j: loop index Track (0 first drawn); copies: the copy count Track."""
            k = j if below else copies.sub(1).sub(j)
            i = copies.sub(1).sub(k) if below else k
            n = k.add(offset)
            w.save()
            tx, ty = ax.add(n.mul(px)), ay.add(n.mul(py))
            if not (zero(tx) and zero(ty)):
                w.translate(self.tb(tx, clock), self.tb(ty, clock))
            r = n.mul(rot)
            if not zero(r):
                w.rotate(self.tb(r, clock))
            if not (one(sx) and one(sy)):
                w.scale(self.tb(spow(sx, n), clock), self.tb(spow(sy, n), clock))
            if not (zero(ax) and zero(ay)):
                w.translate(self.tb(ax.neg(), clock), self.tb(ay.neg(), clock))
            a_copy = alpha
            if not (one(so) and one(eo)):
                # i / max(copies - 1, 1), written as a division so the tokens stay short
                denom = copies.sub(1).max(1.0)
                frac = i._binary(denom, X_DIV, lambda x, y: x / y)
                a_copy = alpha.mul(so.add(eo.sub(so).mul(frac)))
            self.render_group(body, clock, a_copy, inh_styles, inh_trims, inh_mods, blend)
            w.restore()

        if not S.keyframes:
            # sampled mode: no loop index to drive expressions, so unroll a fixed count
            cnt = max(int(round(count.fn(t))) for t in clock.times) if not count.is_const() else int(count.const)
            if not count.is_const():
                self.warn('animated repeater count (sampled mode: fixed at %d)' % cnt, rep.get('nm'))
            for j in range(max(0, cnt)):
                emit_copy(Track.constant(float(j)), Track.constant(float(cnt)))
            return

        index_id = w.alloc_id()
        j = Track(lambda t: 0.0, [nan_id(index_id)])
        # expressions created inside the body are children of the loop: nothing created here may
        # be reused outside it (or by another loop), and the paint state is unknown at both ends
        saved = (S.expr_cache, S.cache, self.color_cache)
        S.expr_cache, S.cache, self.color_cache = dict(S.expr_cache), dict(S.cache), dict(self.color_cache)
        self.paint_state.forget()
        w.loop_begin(index_id, f2bits(0.0), f2bits(1.0), self.tb(count, clock))
        w.inline += 1
        emit_copy(j, count)
        w.inline -= 1
        w.loop_end()
        S.expr_cache, S.cache, self.color_cache = saved
        self.paint_state.forget()


REPEATER = '_lottierc_repeater'      # key of the synthetic group item that stands for a repeater's copies


class _Group:
    """One shape list being rendered: which items are styles, trims, modifiers and shapes,
    what is inherited from enclosing groups, and the per-group caches (path tracks, merge
    results) that every style after them shares. `run` walks the list bottom-up."""

    def __init__(self, conv, items, clock, alpha, inh_styles, inh_trims, inh_mods, blend):
        self.c, self.w = conv, conv.w
        self.items, self.clock, self.alpha, self.blend = items, clock, alpha, blend
        self.inh_styles, self.inh_trims, self.inh_mods = inh_styles, inh_trims, inh_mods
        self.styles = [(i, it) for i, it in enumerate(items) if it.get('ty') in STYLE_TYPES and not it.get('hd')]
        self.trims = [(i, it) for i, it in enumerate(items) if it.get('ty') == 'tm' and not it.get('hd')]
        self.mods = [(i, it) for i, it in enumerate(items) if it.get('ty') in MOD_TYPES and not it.get('hd')]
        self.shape_idx = [i for i, it in enumerate(items) if it.get('ty') in SHAPE_TYPES and not it.get('hd')]
        # Merge paths (skottie semantics): a merge item folds every shape before it in the list
        # into one path — the topmost shape (lowest index) is the base and the ones below are
        # applied in list order: add = union, subtract = base minus the rest, intersect, exclude
        # = xor. Mode 1 (merge) only appends, which is what drawing the shapes together already
        # does. The fold is one PATH_COMBINE per input, emitted once per group and reused by
        # every style after the merge; a morphing input first gets a PATH_TWEEN id.
        self.merges = [(i, it) for i, it in enumerate(items)
                       if it.get('ty') == 'mm' and not it.get('hd') and int(it.get('mm', 1) or 1) in MERGE_OPS]
        self.tracks = {}
        self.merged_cache = {}

    # what applies to the shape at index pi: everything after it in the list, then the inherited
    def mods_for(self, pi):
        return [m for (mi, m) in self.mods if mi > pi] + self.inh_mods

    def trims_for(self, pi):
        return [t for (ti, t) in self.trims if ti > pi] + self.inh_trims

    def offsets_for(self, pi):
        return tuple(m for m in self.mods_for(pi) if m.get('ty') == 'op')

    def track(self, pi):
        if pi not in self.tracks:
            self.tracks[pi] = self.c.build_path_track(self.items[pi], self.clock, self.mods_for(pi))
        return self.tracks[pi]

    def merged_units(self, targets, style_idx):
        """-> (targets left separate, merged unit or None) for a style at `style_idx`."""
        ms = [(mi, m) for (mi, m) in self.merges if mi < style_idx]
        if not ms:
            return targets, None
        remaining, acc, acc_idx = list(targets), None, None
        for mi, m in ms:
            inputs = [pi for pi in remaining if pi < mi]
            remaining = [pi for pi in remaining if pi > mi]
            if mi in self.merged_cache:
                acc, acc_idx = self.merged_cache[mi]
                continue
            if any(self.items[k].get('ty') == 'gr' and not self.items[k].get('hd') for k in range(mi)):
                self.c.warn('merge paths over a nested group (the group is not merged)', m.get('nm'))
            seq = ([acc] if acc is not None else []) + [self.track(pi) for pi in inputs]
            if not seq:
                continue
            acc = seq[0] if len(seq) == 1 else self.c.combine_tracks(seq, MERGE_OPS[int(m.get('mm'))], self.clock)
            acc_idx = mi
            self.merged_cache[mi] = (acc, acc_idx)
        if acc is None:
            return remaining, None
        return remaining, {'track': acc, 'trims': self.trims_for(acc_idx), 'offs': self.offsets_for(acc_idx), 'is_open': False}

    def draw_with(self, style, targets, style_idx):
        """Draw `targets` (path indices in list order) with one style at `style_idx`."""
        if not targets:
            return
        c, w, clock = self.c, self.w, self.clock
        is_fill = style.get('ty') in ('fl', 'gf')
        winding = 1 if (is_fill and int(style.get('r', 1) or 1) == 2) else 0
        targets, merged = self.merged_units(targets, style_idx)
        units = []
        for pi in targets:
            offs = self.offsets_for(pi)
            # an offset open path is a band, drawn as a stroke; a closed one grows by a stroke
            is_open = bool(offs) and any(not sh.get('c', False) for sh in self.track(pi).get('shapes', []))
            units.append({'track': self.track(pi), 'trims': self.trims_for(pi), 'offs': offs, 'is_open': is_open})
        if merged is not None:
            units.append(merged)      # the merge sits below the shapes after it
        groups = []
        for u in units:
            key = (tuple(id(t) for t in u['trims']) or None, tuple(id(m) for m in u['offs']), u['is_open'])
            for g in groups:
                if g[0] == key:
                    g[1].append(u)
                    break
            else:
                groups.append((key, [u]))
        for (tm, _, is_open), us in groups:
            c.emit_paint(style, clock, self.alpha, self.blend, offset=c.offset_spec(style, us[0]['offs'], clock, is_open))
            trs = [u['track'] for u in us]
            if tm is None and is_fill and all(len(t['floats']) == 1 and not t.get('merged') for t in trs):
                floats = []
                for t in reversed(trs):
                    floats += t['floats'][0]
                if floats:
                    w.draw_path(c.path_id(floats, winding))
                continue
            windows = c.trim_windows(us[0]['trims'], trs, clock) if tm is not None else [None] * len(trs)
            for tr_, win in reversed(list(zip(trs, windows))):   # bottom-most first
                c.draw_path_track(tr_, win, clock, winding)

    def run(self):
        c, items, n = self.c, self.items, len(self.items)
        for i in range(n - 1, -1, -1):
            it = items[i]
            if it.get('hd'):
                continue
            ty = it.get('ty')
            if ty == 'gr':
                args = ([s for (si, s) in self.styles if si > i] + self.inh_styles,
                        [t for (ti, t) in self.trims if ti > i] + self.inh_trims,
                        [m for (mi, m) in self.mods if mi > i] + self.inh_mods, self.blend)
                if it.get(REPEATER) is not None:
                    c.emit_repeater(it[REPEATER], it['it'], self.clock, self.alpha, *args)
                else:
                    c.render_group(it.get('it', []), self.clock, self.alpha, *args)
            elif ty in STYLE_TYPES:
                self.draw_with(it, [pi for pi in self.shape_idx if pi < i], i)
            elif ty == 'tw':
                c.warn('twist', it.get('nm'))
        for style in reversed(self.inh_styles):
            self.draw_with(style, list(self.shape_idx), n)
