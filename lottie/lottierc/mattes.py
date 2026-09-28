"""Masks and mattes as clips, and the baking fallback for what cannot be expressed."""

import math

from .wire import f2bits
from .props import M_ID, Prop, Transform, m_mul
from .shapes import (INVERT_RECT, MOD_TYPES, SHAPE_TYPES, ellipse_shape, rect_shape, star_shape, transform_shape_floats)
from .tracks import Track, X_MUL, X_TAN, transform_tracks


class MaskMatteMixin:
    """Converter methods for masks, mattes and the baked fallbacks."""

    # ── masks ─────────────────────────────────────────────────────────────
    def emit_masks(self, layer, clock):
        """Layer masks as clips, in layer space: each mask path is a path track (keyframed
        paths become PATH_TWEEN ids refreshed every frame), several add masks are one compound
        path when static and a PATH_COMBINE union otherwise, an inverted mask is the path
        subtracted from a huge rectangle, intersect and subtract masks clip one by one."""
        t0 = clock.times[0]
        adds, subs, inters = [], [], []
        for m in layer.get('masksProperties', []):
            mode = m.get('mode', 'a')
            if mode == 'n':
                continue
            track = self.build_path_track({'ty': 'sh', 'ks': m.get('pt')}, clock, [])
            if not track['floats'] or not any(track['floats']):
                continue
            if Prop(m.get('o'), [100]).at(t0)[0] < 100:
                self.warn('mask opacity (treated as 100%)', layer.get('nm'))
            xp = Prop(m.get('x'), [0])
            if max(abs(xp.at(t)[0]) for t in clock.times) > 1e-6:
                self.warn('mask expansion', layer.get('nm'))
            inv = bool(m.get('inv'))
            if mode in ('a', 'l', 'd', 'f'):
                if mode != 'a':
                    self.warn('mask mode "%s" (treated as add)' % mode, layer.get('nm'))
                adds.append((track, inv))
            elif mode == 's':
                subs.append((track, inv))
            elif mode == 'i':
                inters.append((track, inv))
        if adds:
            invs = {inv for _, inv in adds}
            if len(invs) > 1:
                self.warn('mixed inverted/non-inverted add masks', layer.get('nm'))
            self.clip_union([tr for tr, _ in adds], invs == {True}, clock)
        for tr, inv in inters:
            self.clip_union([tr], inv, clock)
        for tr, inv in subs:
            self.clip_union([tr], not inv, clock)

    def clip_union(self, tracks, inverted, clock):
        """Clip to the union of path tracks (inverted: to everything but it)."""
        w = self.w
        if all(len(tr['floats']) == 1 and not tr.get('merged') for tr in tracks):
            floats = []
            for tr in tracks:
                floats += tr['floats'][0]
            if inverted:
                w.clip_path(self.path_id(INVERT_RECT + floats, winding=1))
            else:
                w.clip_path(self.path_id(floats, winding=0))
            return
        if len(tracks) == 1 and inverted:
            w.clip_path(self.current_path_id(self.inverted_track(tracks[0]), clock, winding=1))
            return
        union = tracks[0] if len(tracks) == 1 else self.combine_tracks(tracks, 3, clock)
        pid = self.current_path_id(union, clock)
        if inverted:
            out = w.alloc_id()
            w.path_combine(out, self.path_id(list(INVERT_RECT), winding=0), pid, 0)   # rect minus the union
            pid = out
        w.clip_path(pid)

    @staticmethod
    def inverted_track(track):
        """The same path track with a huge rectangle in front of every keyframe's path, so that
        with the even-odd rule it fills everything but the shape."""
        return {'floats': [INVERT_RECT + f for f in track['floats']], 'shapes': track.get('shapes', []),
                'U': track.get('U')}

    # ── mattes ────────────────────────────────────────────────────────────
    def emit_matte_clip(self, matte, clock, by_ind, sample_k, tt):
        """Clip the layer to its matte. The matte's transform chain is applied with matrix ops
        and undone with their inverses around the clip, so an animated matte transform costs
        nothing; its shapes are path tracks (keyframed paths tween every frame) with static
        group transforms folded into the points. Precomp mattes and animated group transforms
        fall back to baking the matte at the first visible frame."""
        if tt in (3, 4):
            self.warn('luma mattes (treated as alpha mattes)', matte.get('nm'))
        inverted = tt in (2, 4)
        tracks = self.matte_tracks(matte, clock)
        if tracks is not None:
            chain = [Transform(p.get('ks'), auto_orient=bool(p.get('ao'))) for p in self.parent_chain(matte, by_ind)]
            chain.append(Transform(matte.get('ks'), auto_orient=bool(matte.get('ao'))))
            for tr in chain:
                self.emit_transform(tr, clock)
            if tracks:
                self.clip_union(tracks, inverted, clock)
            elif not inverted:
                self.w.clip_path(self.path_id([], winding=0))      # an empty matte hides the layer
            for tr in reversed(chain):
                self.emit_transform_inverse(tr, clock)
            return
        t_comp = clock.times[sample_k]
        floats, animated = self.bake_layer_paths(matte, clock, by_ind, sample_k, M_ID)
        if animated:
            self.warn('animated matte (baked at frame %g)' % t_comp, matte.get('nm'))
        if not floats:
            return
        if inverted:
            pid = self.path_id(INVERT_RECT + floats, winding=1)
        else:
            pid = self.path_id(floats, winding=0)
        self.w.clip_path(pid)

    def matte_tracks(self, layer, clock):
        """Path tracks of a matte layer in its own space, static group transforms folded in;
        None when the layer needs baking (a precomp, or a group whose transform animates)."""
        ty = layer.get('ty')
        if ty == 1:
            sw, sh = float(layer.get('sw', 0)), float(layer.get('sh', 0))
            return [self._static_track(rect_shape([sw / 2, sh / 2], [sw, sh], 0))]
        if ty == 2:
            asset = self.assets.get(layer.get('refId')) or {}
            aw, ah = float(asset.get('w', 0)), float(asset.get('h', 0))
            return [self._static_track(rect_shape([aw / 2, ah / 2], [aw, ah], 0))]
        if ty != 4:
            return None
        t0 = clock.times[0]

        def collect(items, m, inherited_mods):
            tr_item = next((it for it in items if it.get('ty') == 'tr'), None)
            if tr_item is not None:
                tr = Transform(tr_item)
                if tr.is_animated():
                    return None
                m = m_mul(m, tr.matrix(t0))
            mods = [(i, it) for i, it in enumerate(items) if it.get('ty') in MOD_TYPES and not it.get('hd')]
            out = []
            for i, it in enumerate(items):
                if it.get('hd'):
                    continue
                if it.get('ty') == 'gr':
                    sub_ = collect(it.get('it', []), m, [mm for (mi, mm) in mods if mi > i] + inherited_mods)
                    if sub_ is None:
                        return None
                    out += sub_
                elif it.get('ty') in SHAPE_TYPES:
                    track = self.build_path_track(it, clock, [mm for (mi, mm) in mods if mi > i and mm.get('ty') != 'op'] + inherited_mods)
                    if not track['floats']:
                        continue
                    if m != M_ID:
                        shapes = track.get('shapes') or []
                        if len(shapes) != len(track['floats']):
                            return None
                        track = {'floats': [transform_shape_floats(sh, m) for sh in shapes], 'shapes': shapes, 'U': track.get('U')}
                    out.append(track)
            return out

        return collect(layer.get('shapes', []), M_ID, [])

    def emit_transform_inverse(self, tr, clock):
        """Matrix ops undoing emit_transform(tr): T(a) · S(1/s) · Skew⁻¹ · R(-r) · T(-p)."""
        w = self.w
        tk = transform_tracks(tr, self.sampler, clock)
        b = lambda track: self.tb(track, clock)
        zero = lambda track: track.is_const() and abs(track.const) < 1e-9
        one = lambda track: track.is_const() and abs(track.const - 1) < 1e-9
        if not (zero(tk['ax']) and zero(tk['ay'])):
            w.translate(b(tk['ax']), b(tk['ay']))
        if not (one(tk['sx']) and one(tk['sy'])):
            w.scale(b(Track.constant(1.0).div(tk['sx'])), b(Track.constant(1.0).div(tk['sy'])))
        if not zero(tk['sk']):
            sa = tk['sa']
            w.rotate(b(sa.neg()))
            w.skew(b(Track(lambda t: -math.tan(math.radians(-tk['sk'].fn(t))),
                          (tk['sk'].scale(-math.pi / 180.0).tokens + [X_TAN, f2bits(-1.0), X_MUL]) if tk['sk'].tokens is not None else None)),
                   f2bits(0.0))
            w.rotate(b(sa))
        if not zero(tk['r']):
            w.rotate(b(tk['r'].neg()))
        if not (zero(tk['px']) and zero(tk['py'])):
            w.translate(b(tk['px'].neg()), b(tk['py'].neg()))

    def bake_layer_paths(self, layer, clock, by_ind, k, parent_m):
        """Every path of a layer (and, for precomps, of its children) at sample k, transformed
        into the space `parent_m` maps into. Returns (floats, was_anything_animated)."""
        animated = False
        t = clock.times[k]
        m = parent_m
        for p in self.parent_chain(layer, by_ind):
            ptr = Transform(p.get('ks'), auto_orient=bool(p.get('ao')))
            animated |= ptr.is_animated()
            m = m_mul(m, ptr.matrix(t))
        tr = Transform(layer.get('ks'), auto_orient=bool(layer.get('ao')))
        animated |= tr.is_animated()
        m = m_mul(m, tr.matrix(t))
        out = []
        ty = layer.get('ty')
        if ty == 4:
            f, an = self.bake_group(layer.get('shapes', []), t, m, [])
            out += f
            animated |= an
        elif ty == 1:
            sw, sh = float(layer.get('sw', 0)), float(layer.get('sh', 0))
            out += transform_shape_floats(rect_shape([sw / 2, sh / 2], [sw, sh], 0), m)
        elif ty == 2:
            asset = self.assets.get(layer.get('refId')) or {}
            aw, ah = float(asset.get('w', 0)), float(asset.get('h', 0))
            out += transform_shape_floats(rect_shape([aw / 2, ah / 2], [aw, ah], 0), m)
        elif ty == 0:
            asset = self.assets.get(layer.get('refId'))
            if asset and 'layers' in asset:
                child = self.precomp_child_clock(layer, clock)
                if 'tm' in layer:
                    animated = True
                cby = {l.get('ind'): l for l in asset['layers'] if 'ind' in l}
                for ch in asset['layers']:
                    if ch.get('hd') or ch.get('ty') not in (0, 1, 2, 4):
                        continue
                    f, an = self.bake_layer_paths(ch, child, cby, k, m)
                    out += f
                    animated |= an
        return out, animated

    def bake_group(self, items, t, m, inherited_mods):
        animated = False
        tr_item = next((it for it in items if it.get('ty') == 'tr'), None)
        if tr_item is not None:
            tr = Transform(tr_item)
            animated |= tr.is_animated()
            m = m_mul(m, tr.matrix(t))
        mods = [(i, it) for i, it in enumerate(items) if it.get('ty') in MOD_TYPES and not it.get('hd')]
        out = []
        for i, it in enumerate(items):
            if it.get('hd'):
                continue
            ty = it.get('ty')
            if ty == 'gr':
                f, an = self.bake_group(it.get('it', []), t, m, [mm for (mi, mm) in mods if mi > i] + inherited_mods)
                out += f
                animated |= an
            elif ty in SHAPE_TYPES:
                sh, an = self.shape_at(it, t)
                animated |= an
                if sh:
                    sh = self.apply_modifiers(sh, [mm for (mi, mm) in mods if mi > i] + inherited_mods, t)
                    out += transform_shape_floats(sh, m)
        return out, animated

    def shape_at(self, item, t):
        ty = item.get('ty')
        direction = int(item.get('d', 1) or 1)
        if ty == 'sh':
            prop = Prop(item.get('ks'), None, is_shape=True)
            v = prop.at(t)
            v = v[0] if isinstance(v, list) else v
            return v, prop.animated
        if ty == 'el':
            p, s = Prop(item.get('p'), [0, 0]), Prop(item.get('s'), [100, 100])
            return ellipse_shape(p.at(t), s.at(t), direction), p.animated or s.animated
        if ty == 'rc':
            p, s, r = Prop(item.get('p'), [0, 0]), Prop(item.get('s'), [100, 100]), Prop(item.get('r'), [0])
            return rect_shape(p.at(t), s.at(t), r.at(t)[0], direction), p.animated or s.animated or r.animated
        if ty == 'sr':
            props = {n: Prop(item.get(n), d) for n, d in (('pt', [5]), ('p', [0, 0]), ('r', [0]), ('or', [100]),
                                                          ('os', [0]), ('ir', [50]), ('is', [0]))}
            sh = star_shape(int(item.get('sy', 1)), props['pt'].at(t)[0], props['p'].at(t), props['r'].at(t)[0],
                            props['or'].at(t)[0], props['os'].at(t)[0], props['ir'].at(t)[0], props['is'].at(t)[0],
                            direction)
            return sh, any(p.animated for p in props.values())
        return None, False
