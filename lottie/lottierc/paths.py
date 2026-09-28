"""Path tracks: shapes and modifiers as per-keyframe paths, morph tweens, trims, PATH_COMBINE folds."""

from .wire import COND_EQ, f2bits
from .props import Prop
from .shapes import (ellipse_shape, pucker_bloat_shape, rect_shape, round_corners_shape, shape_length, shape_to_floats, star_shape, zigzag_shape)
from .tracks import Track


class PathMixin:
    """Converter methods that turn shapes into path tracks and draw them."""

    # ── merge paths ───────────────────────────────────────────────────────
    def current_path_id(self, track, clock, winding=0):
        """A path id holding the track's path at the current frame: the static id, or a
        PATH_TWEEN output refreshed every frame (segment chosen as in draw_path_track)."""
        w = self.w
        ids = self.track_ids(track, winding)
        U = track.get('U')
        if len(ids) == 1 or U is None:
            return ids[0]
        out = w.alloc_id()
        K = len(ids)
        seg = U.floor().min(Track.constant(float(K - 2)))
        used = sorted({int(seg.fn(t)) for t in clock.times})
        if len(used) == 1:
            j = used[0]
            w.path_tween(out, ids[j], ids[j + 1], self.tb(U.sub(Track.constant(float(j))), clock))
            return out
        seg_bits = self.tb(seg, clock, hold=True)
        u_bits = self.tb(U.sub(Track(lambda t: seg.fn(t), [seg_bits])), clock)
        for j in used:
            w.cond_begin(COND_EQ, seg_bits, f2bits(float(j)))
            w.path_tween(out, ids[j], ids[j + 1], u_bits)
            w.cond_end()
        return out

    def combine_tracks(self, tracks, op, clock):
        """Fold `tracks` (topmost first) with one PATH_COMBINE per further input; -> a track
        whose single path id is the result, refreshed every frame."""
        w = self.w
        out = w.alloc_id()
        acc = self.current_path_id(tracks[0], clock)
        for tr in tracks[1:]:
            w.path_combine(out, acc, self.current_path_id(tr, clock), op)
            acc = out
        return {'floats': [None], 'shapes': [], 'ids': {0: [out], 1: [out]}, 'U': None, 'merged': True}

    # ── path tracks ───────────────────────────────────────────────────────
    def path_id(self, floats, winding=0):
        key = (winding, tuple(floats))
        hit = self.path_cache.get(key)
        if hit is None:
            if self.profile.compact_paths:
                hit = self.w.path_data_compact(list(floats), winding, self.profile.quantum, delta=self.profile.compact_delta)
            else:
                hit = self.w.path_data(list(floats), winding)
            self.path_cache[key] = hit
        return hit

    def track_ids(self, track, winding):
        ids = track.setdefault('ids', {})
        if winding not in ids:
            ids[winding] = [self.path_id(f, winding) for f in track['floats']]
        return ids[winding]

    def apply_modifiers(self, sh, modifiers, t):
        for m in modifiers:
            ty = m.get('ty')
            if ty == 'rd':
                sh = round_corners_shape(sh, Prop(m.get('r'), [0]).at(t)[0])
            elif ty == 'pb':
                sh = pucker_bloat_shape(sh, Prop(m.get('a'), [0]).at(t)[0])
            elif ty == 'zz':
                s = Prop(m.get('s'), [0]).at(t)[0]
                r = Prop(m.get('r'), [0]).at(t)[0]
                pt = int(Prop(m.get('pt'), [1]).at(t)[0])
                sh = zigzag_shape(sh, s, r, pt)
        return sh

    def modifier_times(self, modifiers):
        kts = set()
        for m in modifiers:
            for key in ('r', 'a', 's', 'pt'):
                if key in m:
                    kts.update(Prop(m[key], [0]).keyframe_times())
        return kts

    @staticmethod
    def _static_track(sh):
        return {'floats': [shape_to_floats(sh)], 'shapes': [sh]}

    def _prop_progress(self, prop, clock):
        """U track from a property's own keyframes (its easing and holds included)."""
        kf = prop.k
        times = [float(k['t']) for k in kf]
        eas = []
        for j in range(len(kf) - 1):
            k0 = kf[j]
            eas.append('hold' if k0.get('h') else self.sampler._easing(k0, 0))
        return self.sampler.keyframe_progress_track(times, eas, clock)

    def build_path_track(self, item, clock, modifiers):
        """-> dict(floats=[path tokens per keyframe], shapes=[shape dicts], U=Track|None)."""
        ty = item.get('ty')
        direction = int(item.get('d', 1) or 1)
        t0 = clock.times[0]
        if ty == 'sh':
            prop = Prop(item.get('ks'), {'v': [], 'i': [], 'o': [], 'c': False}, is_shape=True)
            mkts = self.modifier_times(modifiers)
            if not prop.animated and not mkts:
                return self._static_track(self.apply_modifiers(prop.value or {}, modifiers, t0))
            if prop.animated and not mkts:
                shapes = []
                for j in range(len(prop.k)):
                    sh = prop.value_at_keyframe(j)
                    sh = sh[0] if isinstance(sh, list) else sh
                    shapes.append(self.apply_modifiers(sh or {}, modifiers, prop.k[j]['t']))
                lens = {len(s.get('v') or []) for s in shapes}
                if len(lens) > 1:
                    self.warn('morphing shape with differing vertex counts', item.get('nm'))
                return {'floats': [shape_to_floats(s) for s in shapes], 'shapes': shapes,
                        'U': self._prop_progress(prop, clock)}
            kts = sorted(set(prop.keyframe_times()) | mkts)

            def make(t):
                sh = prop.at(t)
                sh = sh[0] if isinstance(sh, list) else sh
                return self.apply_modifiers(sh or {}, modifiers, t)
            return self.linear_keyframe_track(make, kts, clock)

        # parametric primitives
        if ty == 'el':
            props = {'p': Prop(item.get('p'), [0, 0]), 's': Prop(item.get('s'), [100, 100])}
            def base(t): return ellipse_shape(props['p'].at(t), props['s'].at(t), direction)
        elif ty == 'rc':
            props = {'p': Prop(item.get('p'), [0, 0]), 's': Prop(item.get('s'), [100, 100]), 'r': Prop(item.get('r'), [0])}
            def base(t): return rect_shape(props['p'].at(t), props['s'].at(t), props['r'].at(t)[0], direction)
        elif ty == 'sr':
            props = {'pt': Prop(item.get('pt'), [5]), 'p': Prop(item.get('p'), [0, 0]), 'r': Prop(item.get('r'), [0]),
                     'or': Prop(item.get('or'), [100]), 'os': Prop(item.get('os'), [0]),
                     'ir': Prop(item.get('ir'), [50]), 'is': Prop(item.get('is'), [0])}
            kind = int(item.get('sy', 1))
            def base(t):
                return star_shape(kind, props['pt'].at(t)[0], props['p'].at(t), props['r'].at(t)[0],
                                  props['or'].at(t)[0], props['os'].at(t)[0], props['ir'].at(t)[0],
                                  props['is'].at(t)[0], direction)
        else:
            return {'floats': [], 'shapes': []}

        def make(t):
            return self.apply_modifiers(base(t), modifiers, t)
        animated = [p for p in props.values() if p.animated]
        kts = sorted({kt for p in animated for kt in p.keyframe_times()} | self.modifier_times(modifiers))
        if not kts:
            return self._static_track(make(t0))
        if animated and not self.modifier_times(modifiers) and \
                all(p.keyframe_times() == animated[0].keyframe_times() for p in animated):
            shapes = [make(kt) for kt in kts]
            return {'floats': [shape_to_floats(s) for s in shapes], 'shapes': shapes,
                    'U': self._prop_progress(animated[0], clock)}
        return self.linear_keyframe_track(make, kts, clock)

    def linear_keyframe_track(self, make, kts, clock):
        """Paths at each keyframe time, tweened linearly in time between them."""
        if len(kts) == 1:
            return self._static_track(make(kts[0]))
        shapes = [make(kt) for kt in kts]
        U = self.sampler.keyframe_progress_track(kts, [None] * (len(kts) - 1), clock)
        return {'floats': [shape_to_floats(s) for s in shapes], 'shapes': shapes, 'U': U}

    # ── trims ─────────────────────────────────────────────────────────────
    def trim_windows(self, tms, tracks, clock):
        """Windows for a list of trim modifiers applied in order: each one trims what the
        previous left, so its window is mapped into the previous window (a wrap of a later trim
        is folded into the first segment — an approximation for that rare case)."""
        wins = self.trim_windows_one(tms[0], tracks, clock)
        for tm in tms[1:]:
            nxt = self.trim_windows_one(tm, tracks, clock)
            out = []
            for (st, en, st2, en2), (ns, ne, ns2, ne2) in zip(wins, nxt):
                span = en.sub(st)
                span2 = en2.sub(st2)
                lo = ns.min(ns2.add(ne2).min(ns))    # start of the later trim's window (0 when it wraps)
                hi = ne.max(ne2.add(ns2))            # end, folding a wrapped tail on
                out.append((st.add(span.mul(lo)), st.add(span.mul(hi)), st2.add(span2.mul(lo)), st2.add(span2.mul(hi))))
            wins = out
        return wins

    def trim_windows_one(self, tm, tracks, clock):
        """Per-path (start, end, start2, end2) Tracks for one trim modifier, following
        lottie-web's TrimModifier: start/end are clamped to [0, 1], the offset rotates the
        window, a window running past 1 wraps into a second segment. m=1 ("simultaneously")
        gives every path the same window; m=2 ("individually") treats the paths as one long
        path, in list order, and hands each its share by arc length. All of it is arithmetic
        on the keyframed s / e / o, so it stays a closed form of time."""
        pt = lambda key, dflt: self.sampler.prop_track(Prop(tm.get(key), [dflt]), 0, clock)
        s = self.sampler.share(pt('s', 0).scale(0.01).clamp01(), clock)
        e = self.sampler.share(pt('e', 100).scale(0.01).clamp01(), clock)
        o = pt('o', 0).scale(1.0 / 360.0).fract()
        lo, hi = s.min(e), s.max(e)
        a = lo.add(o).fract()                  # window start in [0, 1)
        b = a.add(hi.sub(lo))                  # window end, up to 2
        seg1 = (a, b.min(1.0))
        seg2 = (Track.constant(0.0), b.sub(1.0).max(0.0))
        sequential = int(tm.get('m', 1)) == 2 and len(tracks) > 1
        if not sequential:
            return [(seg1[0], seg1[1], seg2[0], seg2[1]) for _ in tracks]
        lengths = [max(1e-9, shape_length(tr['shapes'][0])) if tr.get('shapes') else 1e-9 for tr in tracks]
        if any(len(tr.get('shapes', [])) > 1 for tr in tracks):
            self.warn('individual trim over a morphing shape uses the first keyframe length')
        total = sum(lengths)
        out, added = [], 0.0
        for L_ in lengths:
            def share(g, A=added, L_=L_):
                return g.scale(total).sub(A).scale(1.0 / L_).clamp01()
            out.append((share(seg1[0]), share(seg1[1]), share(seg2[0]), share(seg2[1])))
            added += L_
        return out

    def draw_path_track(self, track, window, clock, winding=0):
        w, sb = self.w, self.sampler.bits
        ids = self.track_ids(track, winding)
        if not ids:
            return
        U = track.get('U')

        def emit_full(p1, p2, tween_bits):
            if p1 == p2:
                w.draw_path(p1)
            else:
                w.draw_tween_path(p1, p2, tween_bits, f2bits(0.0), f2bits(1.0))

        def emit_draw(p1, p2, tween_bits):
            if window is None:
                emit_full(p1, p2, tween_bits)
                return
            st, en, st2, en2 = window
            vis1 = [en.fn(t) - st.fn(t) for t in clock.times]
            vis2 = [en2.fn(t) - st2.fn(t) for t in clock.times]
            if all(v <= 1e-9 for v in vis1) and all(v <= 1e-9 for v in vis2):
                return  # never visible
            if all(v >= 1 - 1e-9 for v in vis1):
                emit_full(p1, p2, tween_bits)     # a full window: an untrimmed draw
                return
            w.draw_tween_path(p1, p2, tween_bits, self.tb(st, clock), self.tb(en, clock))
            if any(v > 1e-6 for v in vis2):
                w.draw_tween_path(p1, p2, tween_bits, self.tb(st2, clock), self.tb(en2, clock))

        if len(ids) == 1 or U is None:
            emit_draw(ids[0], ids[0], f2bits(0.0))
            return
        K = len(ids)
        seg = U.floor().min(Track.constant(float(K - 2)))
        seg_samples = [seg.fn(t) for t in clock.times]
        used = sorted({int(s) for s in seg_samples})
        if len(used) == 1:
            j = used[0]
            u = U.sub(Track.constant(float(j)))
            emit_draw(ids[j], ids[j + 1], self.tb(u, clock))
            return
        seg_bits = self.tb(seg, clock, hold=True)
        u = U.sub(Track(lambda t: seg.fn(t), [seg_bits]))
        u_bits = self.tb(u, clock)
        for j in used:
            w.cond_begin(COND_EQ, seg_bits, f2bits(float(j)))
            emit_draw(ids[j], ids[j + 1], u_bits)
            w.cond_end()
