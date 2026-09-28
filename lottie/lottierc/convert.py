"""The converter: layers, shapes, paints, masks, mattes, effects, repeaters, text — and the command line."""

import argparse
import base64
import json
import math
import os

from .wire import (CANVAS_CONTENT_ID, COND_GT, CV_HEIGHT, CV_WIDTH, LOTTIE_BLEND, PB_ALPHA, PB_COLOR, PB_STYLE,
    RcWriter, STYLE_FILL, f2bits, parse_hex_color)
from .props import Prop, Transform
from .shapes import rect_shape, shape_to_floats
from .tracks import Sampler, Track, X_DIV, X_MIN, X_MUL, X_STEP, X_SUB, X_TAN, transform_tracks
from .paints import PaintMixin, PaintState, ShadowPass, BlurEffect
from .profile import Profile
from .gaps import gaps_text
from .paths import PathMixin
from .mattes import MaskMatteMixin
from .text import TextMixin
from .groups import GroupMixin


class Converter(GroupMixin, PaintMixin, PathMixin, MaskMatteMixin, TextMixin):
    def __init__(self, doc, profile=None, base_dir='.', verbose=False, **options):
        """`profile` is a Profile (how to convert); keyword options build one when it is None."""
        self.doc = doc
        self.profile = profile if profile is not None else Profile(**options)
        self.effects = []            # active layer effects, innermost last (see emit_layer)
        self.debug_text = None       # a list to collect per-character text placements into (run_tests.py)
        self.base_dir = base_dir
        self.fr = float(doc.get('fr', 30))
        self.ip = float(doc.get('ip', 0))
        self.op = float(doc.get('op', 1))
        self.width = int(doc.get('w', 100))
        self.height = int(doc.get('h', 100))
        self.assets = {a['id']: a for a in doc.get('assets', []) if 'id' in a}
        self.fps = float(self.profile.fps) if self.profile.fps else self.fr
        self.verbose = verbose
        self.warnings = {}
        self.path_cache = {}
        self.bitmap_cache = {}
        self.color_cache = {}
        self.paint_state = PaintState()  # what the previous paint carried (gradient, dash, blend, filter, blur)
        self.glyph_sources = {}      # font name -> glyph source (text layers)
        self.glyph_ids = {}          # glyph -> compound path id

        span = max(1e-6, self.op - self.ip)
        self.n_frames = max(1, int(math.ceil(span * self.fps / self.fr - 1e-6)))
        self.S = self.n_frames + 1           # sample count

        self.w = RcWriter()
        self.w.write_header(self.width, self.height, fps=self.fps, description=doc.get('nm'))
        self.sampler = Sampler(self.w, self.n_frames, self.fps, self.fr, self.ip, self.profile)

    # ── diagnostics ───────────────────────────────────────────────────────
    def warn(self, key, detail=None):
        self.warnings.setdefault(key, set())
        if detail is not None:
            self.warnings[key].add(str(detail))

    def tb(self, track, clock, hold=False):
        return self.sampler.track_bits(track, clock, hold=hold)

    # ── entry point ───────────────────────────────────────────────────────
    def convert(self):
        w = self.w
        w.save()
        if self.profile.bg is not None:
            w.paint([PB_COLOR, self.profile.bg, PB_STYLE | (STYLE_FILL << 16)])
            w.draw_rect(f2bits(-1e6), f2bits(-1e6), f2bits(1e6), f2bits(1e6))
        if self.profile.fit:
            cw = w.component_value(CV_WIDTH, CANVAS_CONTENT_ID)
            ch = w.component_value(CV_HEIGHT, CANVAS_CONTENT_ID)
            s = w.expression_in_draw([cw, f2bits(self.width), X_DIV, ch, f2bits(self.height), X_DIV, X_MIN])
            tx = w.expression_in_draw([cw, f2bits(self.width), s, X_MUL, X_SUB, f2bits(2.0), X_DIV])
            ty = w.expression_in_draw([ch, f2bits(self.height), s, X_MUL, X_SUB, f2bits(2.0), X_DIV])
            w.translate(tx, ty)
            w.scale(s, s)
        # Lottie players clip to the composition bounds; strokes and shapes that stray outside
        # them (a 5.9x-scaled letter whose tail is all that should show) must not appear in
        # the letterbox. Also true without --fit: nothing draws outside w x h.
        w.clip_rect(f2bits(0.0), f2bits(0.0), f2bits(float(self.width)), f2bits(float(self.height)))
        self.emit_layers(self.doc.get('layers', []), self.sampler.root_clock, Track.constant(1.0), 0)
        w.restore()
        self.sampler.finish()
        return w.to_bytes(rcz=self.profile.rcz)

    # ── layers ────────────────────────────────────────────────────────────
    def emit_layers(self, layers, clock, alpha, blend):
        by_ind = {l.get('ind'): l for l in layers if 'ind' in l}
        for idx in range(len(layers) - 1, -1, -1):
            layer = layers[idx]
            matte = None
            if layer.get('tt'):
                if idx > 0 and layers[idx - 1].get('td'):
                    matte = layers[idx - 1]
                elif 'tp' in layer and layer['tp'] in by_ind:
                    matte = by_ind[layer['tp']]
                else:
                    self.warn('matte without a matte layer above it', layer.get('nm'))
            self.emit_layer(layer, clock, alpha, by_ind, matte, blend)

    def precomp_child_clock(self, layer, clock):
        """Frame of a precomp's children: time remap when present, else offset by `st`
        and divided by the stretch `sr` (ICompElement.prepareFrame)."""
        if 'tm' in layer:
            tm = self.sampler.prop_track(Prop(layer['tm'], [0]), 0, clock).scale(self.fr)
            return self.sampler.track_clock(clock, tm)
        st = float(layer.get('st', 0))
        sr = float(layer.get('sr', 1)) or 1.0
        return self.sampler.child_clock(clock, st, sr)

    def parent_chain(self, layer, by_ind):
        chain = []
        seen = set()
        p = layer.get('parent')
        while p is not None and p in by_ind and p not in seen:
            seen.add(p)
            chain.append(by_ind[p])
            p = by_ind[p].get('parent')
        return list(reversed(chain))   # root-most first

    def emit_layer(self, layer, clock, alpha, by_ind, matte, blend):
        if layer.get('hd') or layer.get('td'):
            return
        ty = layer.get('ty')
        name = layer.get('nm', '?')
        if ty in (6, 7, 8, 9, 13):
            self.warn({6: 'audio layers', 13: 'camera layers'}.get(ty, 'layer type %s' % ty), name)
            return
        if ty not in (0, 1, 2, 3, 4, 5):
            self.warn('layer type %s' % ty, name)
            return
        if ty == 3:
            return  # nulls only matter as parents
        effects, shadow = self.layer_effects(layer)
        if layer.get('bm'):
            if layer['bm'] in LOTTIE_BLEND:
                blend = LOTTIE_BLEND[layer['bm']]
            else:
                self.warn('blend mode %s' % layer['bm'], name)

        ip, op = float(layer.get('ip', -1e9)), float(layer.get('op', 1e9))
        vis_samples = [1.0 if ip <= t < op else 0.0 for t in clock.times]
        if not any(vis_samples):
            return
        w = self.w

        conditional = not all(vis_samples)
        if conditional:
            vis = Track(lambda t: 1.0 if ip <= t < op else 0.0,
                        [clock.bits, f2bits(ip - 1e-3), X_STEP, f2bits(op), clock.bits, X_STEP, X_MUL])
            w.cond_begin(COND_GT, self.tb(vis, clock, hold=True), f2bits(0.5))
        w.save()

        first_visible = next(k for k in range(len(vis_samples)) if vis_samples[k] > 0)
        depth = len(self.effects)
        if shadow is not None:
            # the shadow pass: the same content, offset, every paint forced to the shadow colour
            # (a SRC_IN colour filter keeps only the content's alpha) and, with --blur-op, softened
            w.save()
            w.translate(f2bits(shadow.dx), f2bits(shadow.dy))
            self.effects.append(ShadowPass(shadow.rgb, shadow.o))
            if shadow.sigma > 0:
                self.effects.append(BlurEffect(Track.constant(shadow.sigma)))
            self.emit_layer_body(layer, clock, alpha, by_ind, matte, blend, first_visible)
            del self.effects[depth:]
            w.restore()
        if shadow is None or not shadow.only:
            self.effects += effects
            self.emit_layer_body(layer, clock, alpha, by_ind, matte, blend, first_visible)
            del self.effects[depth:]
        w.restore()
        if conditional:
            w.cond_end()

    def emit_layer_body(self, layer, clock, alpha, by_ind, matte, blend, first_visible):
        """Matte clip, transforms, masks and content of a layer (inside its save)."""
        w, ty = self.w, layer.get('ty')
        if matte is not None:
            self.emit_matte_clip(matte, clock, by_ind, first_visible, layer.get('tt'))

        for p in self.parent_chain(layer, by_ind):
            self.emit_transform(Transform(p.get('ks'), auto_orient=bool(p.get('ao'))), clock)
        tr = Transform(layer.get('ks'), auto_orient=bool(layer.get('ao')))
        tracks = self.emit_transform(tr, clock)
        alpha = alpha.mul(tracks['o'])

        if layer.get('masksProperties'):
            self.emit_masks(layer, clock)

        if ty == 4:
            self.render_group(layer.get('shapes', []), clock, alpha, [], [], [], blend)
        elif ty == 1:
            sw, sh = float(layer.get('sw', 0)), float(layer.get('sh', 0))
            color = parse_hex_color(layer.get('sc', '#000000'))
            pid = self.path_id(shape_to_floats(rect_shape([sw / 2, sh / 2], [sw, sh], 0)))
            self.emit_paint_fill(color, alpha, clock, blend)
            w.draw_path(pid)
        elif ty == 2:
            self.emit_image(layer, alpha, clock, blend)
        elif ty == 5:
            self.emit_text(layer, clock, alpha, blend)
        elif ty == 0:
            asset = self.assets.get(layer.get('refId'))
            if asset is None or 'layers' not in asset:
                self.warn('missing precomp asset', layer.get('refId'))
            else:
                self.emit_layers(asset['layers'], self.precomp_child_clock(layer, clock), alpha, blend)

    # ── images ────────────────────────────────────────────────────────────
    def emit_image(self, layer, alpha, clock, blend):
        asset = self.assets.get(layer.get('refId'))
        if asset is None:
            self.warn('missing image asset', layer.get('refId'))
            return
        aid = asset['id']
        if aid not in self.bitmap_cache:
            data = None
            p = asset.get('p', '')
            if isinstance(p, str) and p.startswith('data:'):
                try:
                    data = base64.b64decode(p.split(',', 1)[1])
                except Exception:
                    data = None
            elif p:
                path = os.path.join(self.base_dir, asset.get('u', '') or '', p)
                if os.path.exists(path):
                    with open(path, 'rb') as fh:
                        data = fh.read()
            if not data:
                self.warn('image asset could not be read', p[:60])
                self.bitmap_cache[aid] = None
            else:
                if not data.startswith(b'\x89PNG'):
                    self.warn('non-PNG image asset (player must decode it)', p[:40])
                self.bitmap_cache[aid] = self.w.bitmap_data(asset.get('w', 0), asset.get('h', 0), data)
        bid = self.bitmap_cache[aid]
        if bid is None:
            return
        ints = [PB_COLOR, 0xFFFFFFFF, PB_ALPHA, self.tb(alpha, clock), PB_STYLE | (STYLE_FILL << 16)]
        ints += self.blend_ints(blend)
        self.w.paint(ints)
        self.w.draw_bitmap(bid, f2bits(0.0), f2bits(0.0), f2bits(float(asset.get('w', 0))), f2bits(float(asset.get('h', 0))))

    # ── transforms ────────────────────────────────────────────────────────
    def emit_transform(self, tr, clock):
        w = self.w
        tk = transform_tracks(tr, self.sampler, clock)
        b = lambda track: self.tb(track, clock)
        zero = lambda track: track.is_const() and abs(track.const) < 1e-9
        one = lambda track: track.is_const() and abs(track.const - 1) < 1e-9
        if not (zero(tk['px']) and zero(tk['py'])):
            w.translate(b(tk['px']), b(tk['py']))
        if not zero(tk['r']):
            w.rotate(b(tk['r']))
        if not zero(tk['sk']):
            sa = tk['sa']
            w.rotate(b(sa.neg()))
            w.skew(b(Track(lambda t: math.tan(math.radians(-tk['sk'].fn(t))),
                           (tk['sk'].scale(-math.pi / 180.0).tokens + [X_TAN]) if tk['sk'].tokens is not None else None)),
                   f2bits(0.0))
            w.rotate(b(sa))
        if not (one(tk['sx']) and one(tk['sy'])):
            w.scale(b(tk['sx']), b(tk['sy']))
        if not (zero(tk['ax']) and zero(tk['ay'])):
            w.translate(b(tk['ax'].neg()), b(tk['ay'].neg()))
        return tk



# ─────────────────────────────────────────────────────────────────────────────
# API + CLI
# ─────────────────────────────────────────────────────────────────────────────

def convert_document(doc, base_dir='.', profile=None, **options):
    """Convert a parsed Lottie document with a Profile (or Profile keyword options).
    Returns (bytes, converter) — the converter carries `warnings` and `w.counts`."""
    conv = Converter(doc, profile=profile, base_dir=base_dir, **options)
    data = conv.convert()
    return data, conv


def convert_file(path, out_path, args):
    with open(path, 'r', encoding='utf-8') as fh:
        doc = json.load(fh)
    if 'layers' not in doc:
        print('%s: skipped (not a Lottie document, no "layers")' % path)
        return False
    profile = Profile.from_args(args)
    profile.bg = parse_hex_color(args.bg) if args.bg else None
    data, conv = convert_document(doc, base_dir=os.path.dirname(os.path.abspath(path)), profile=profile)
    with open(out_path, 'wb') as fh:
        fh.write(data)
    print('%s -> %s  (%d bytes, %dx%d, %g fps, %d frames)' % (
        os.path.basename(path), out_path, len(data), conv.width, conv.height, conv.fps, conv.n_frames))
    if args.verbose:
        for k in sorted(conv.w.counts):
            print('   %-18s %d' % (k, conv.w.counts[k]))
    for key in sorted(conv.warnings):
        names = sorted(conv.warnings[key])
        extra = ''
        if names:
            shown = ', '.join(names[:4]) + (', ...' if len(names) > 4 else '')
            extra = ' [%s]' % shown
        print('   warning: %s%s' % (key, extra))
    return True


def main(argv=None):
    ap = argparse.ArgumentParser(prog='lottie2rc', description='Convert Lottie JSON animations to RemoteCompose .rc documents.')
    ap.add_argument('inputs', nargs='*', help='Lottie .json files')
    ap.add_argument('--list-gaps', action='store_true', help='print what the converter does not convert, and exit')
    ap.add_argument('--profile', choices=sorted(Profile.PRESETS), default='mainline',
                    help='option preset: mainline (default; any RemoteCompose player) or rcx (the experimental players here: '
                         'compact delta paths, KEYFRAMES_X, BLUR_X, the focal gradient, quantised lists, RCZ1). Flags below add to it.')
    ap.add_argument('-o', '--output', help='output .rc (single input only)')
    ap.add_argument('-d', '--outdir', help='output directory (default: next to each input)')
    ap.add_argument('--fps', type=float, help='sampling rate (default: the Lottie frame rate)')
    ap.add_argument('--no-loop', action='store_true', help='hold the last frame instead of looping')
    ap.add_argument('--no-fit', action='store_true', help='do not scale the composition to the window')
    ap.add_argument('--no-interp', action='store_true', help='hold sampled values instead of interpolating between frames')
    ap.add_argument('--bg', help='background colour to paint first, e.g. #FFFFFF')
    ap.add_argument('--compact-paths', action='store_true',
                    help='EXPERIMENTAL: emit PATH_DATA_COMPACT_X (byte verbs, int16 fixed-point coordinates)')
    ap.add_argument('--compact-delta', action='store_true',
                    help='EXPERIMENTAL: the delta form of PATH_DATA_COMPACT_X (int8 point-to-point deltas); implies --compact-paths')
    ap.add_argument('--quantum', type=float, default=None, help='pixels per unit for --compact-paths (default 1/16 px)')
    ap.add_argument('--rcz', action='store_true', help='EXPERIMENTAL: wrap the document in the RCZ1 zlib container')
    ap.add_argument('--max-tokens', type=int, default=None,
                    help='longest FloatExpression to emit; longer ones are split into a chain (Android: 32; 0 = unlimited)')
    ap.add_argument('--bezier-op', action='store_true',
                    help='EXPERIMENTAL: ease with the BEZIER_EASE_X expression operator (rcX players) instead of A_SPLINE tables')
    ap.add_argument('--keyframe-op', action='store_true',
                    help='EXPERIMENTAL: one KEYFRAMES_X expression per property (rcX players) instead of per-segment arithmetic')
    ap.add_argument('--quantize', type=float, default=None, metavar='Q',
                    help='EXPERIMENTAL: store keyframe lists and tables as 16-bit integers on a grid of Q units (px, degrees, percent; '
                         'Q/256 for colours and other unit values), rcX players; e.g. 0.0625')
    ap.add_argument('--focal-op', action='store_true',
                    help='EXPERIMENTAL: radial gradients with a highlight as the focal gradient type (rcX players)')
    ap.add_argument('--blur-op', action='store_true',
                    help='EXPERIMENTAL: soften drop shadows and apply Gaussian-blur effects with the BLUR_X paint attribute (rcX players)')
    ap.add_argument('--sampled', action='store_true',
                    help='store every animated value as one float per frame instead of keyframe expressions')
    ap.add_argument('-v', '--verbose', action='store_true')
    args = ap.parse_args(argv)
    if args.list_gaps:
        print(gaps_text())
        return 0
    if not args.inputs:
        ap.error('no input files')
    if args.output and len(args.inputs) != 1:
        ap.error('-o works with a single input; use -d for several')
    if args.outdir:
        os.makedirs(args.outdir, exist_ok=True)
    for path in args.inputs:
        if args.output:
            out = args.output
        else:
            base = os.path.splitext(os.path.basename(path))[0] + '.rc'
            out = os.path.join(args.outdir, base) if args.outdir else os.path.join(os.path.dirname(path) or '.', base)
        convert_file(path, out, args)
    return 0
