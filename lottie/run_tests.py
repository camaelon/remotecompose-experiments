#!/usr/bin/env python3
"""
run_tests.py — regression suite for the synthetic Lottie tests under tests/.

    python3 run_tests.py                 # convert, render on both players, compare with the references
    python3 run_tests.py --update        # (re)generate the reference images from the C++ player
    python3 run_tests.py --only text     # substring filter
    python3 run_tests.py --player ts     # one player

Each test is converted with two option sets: `rcx` (the experimental players in this
repository: --keyframe-op --compact-delta --blur-op --quantize 0.0625) and `mainline` (the
default output). The rcx C++ render is the reference (tests/<group>/ref/<name>-<t>.png) and
every other render — TypeScript rcx, C++ mainline, TypeScript mainline — is compared with it:
pixels differing by more than 32 in any channel, as a share of the pixels either image draws.
Tests that need an experimental op (`rcx_only` in tests/tests.json) skip the mainline
comparison. tests/text/placements.json holds per-character placements (glyph origin, rotation,
scale, opacity) that were checked against lottie-web's renderedLetters on 2026-09-20; the
converter's placements must still match them.
"""

import argparse
import json
import math
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))
import lottie2rc  # noqa: E402

RC2IMAGE = REPO / 'players' / 'cpp' / 'build' / 'tools' / 'rc2image' / 'rc2image'
FRAMES_MJS = REPO / 'players' / 'typescript' / 'frames.mjs'
SIZE = 400
PROFILES = {
    'rcx': dict(keyframe_op=True, compact_paths=True, compact_delta=True, blur_op=True, focal_op=True, quantize=0.0625),
    'mainline': dict(),
}
MAX_SHARE = 0.05     # a render may differ from the reference on 5 % of the drawn pixels (anti-aliasing)
MAX_ABS = 400        # ... or 400 pixels, whichever is larger
EXACT_ABS = 60       # the C++ rcx render must reproduce its own reference (regenerated) this closely


def load_png(path):
    from PIL import Image
    import numpy as np
    return np.asarray(Image.open(path).convert('RGBA')).astype(int)


def compare(a, b):
    import numpy as np
    diff = (np.abs(a - b).max(axis=2) > 32).sum()
    drawn = max(1, int(((a[..., 3] > 0) | (b[..., 3] > 0)).sum()))
    return int(diff), drawn


def render_cpp(rc, png, t):
    env = dict(os.environ, RC_BG='transparent')
    r = subprocess.run([str(RC2IMAGE), str(rc), str(png), str(SIZE), str(SIZE), '--anim', '%.6f' % t], env=env, capture_output=True, text=True)
    return r.returncode == 0 and png.exists()


def render_ts(rc, png, t):
    r = subprocess.run(['node', str(FRAMES_MJS), str(rc), str(png), '%.6f' % t, '--width', str(SIZE), '--height', str(SIZE)],
                       cwd=str(FRAMES_MJS.parent), capture_output=True, text=True)
    return r.returncode == 0 and png.exists()


def placements(doc, base_dir):
    """The converter's per-character placements at the manifest's frames (see emit_text)."""
    conv = lottie2rc.Converter(doc, base_dir=base_dir, **PROFILES['rcx'])
    conv.debug_text = []
    conv.convert()
    out = {}
    for frame in placements.frames:
        rows = []
        for (ch, tx, ty, rot, sx, sy, anx, any_, op, col, offf, axl, ayl) in conv.debug_text:
            r = math.radians(rot.fn(frame)); c, s = math.cos(r), math.sin(r)
            ox, oy = -anx.fn(frame) - offf - axl, -any_.fn(frame) - ayl
            gx = tx.fn(frame) + c * sx.fn(frame) * ox - s * sy.fn(frame) * oy
            gy = ty.fn(frame) + s * sx.fn(frame) * ox + c * sy.fn(frame) * oy
            rows.append([ch, round(gx, 2), round(gy, 2), round(rot.fn(frame), 2), round(sx.fn(frame), 3), round(op.fn(frame), 3)])
        out[str(frame)] = rows
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--update', action='store_true', help='regenerate the reference images and the text placements')
    ap.add_argument('--player', default='both', help='cpp, ts or both')
    ap.add_argument('--only', help='substring filter on the test name')
    ap.add_argument('--work', default='/tmp/lottie-tests')
    args = ap.parse_args()

    manifest = json.load(open(HERE / 'tests' / 'tests.json'))
    work = Path(args.work); work.mkdir(parents=True, exist_ok=True)
    players = ['cpp', 'ts'] if args.player == 'both' else [args.player]
    fixture_path = HERE / 'tests' / 'text' / 'placements.json'
    fixture = json.load(open(fixture_path)) if fixture_path.exists() and not args.update else {}
    new_fixture = {}
    failures, checks = [], 0

    for group, spec in manifest['groups'].items():
        gdir = HERE / 'tests' / group
        refdir = gdir / 'ref'; refdir.mkdir(exist_ok=True)
        for js in sorted(gdir.glob('*.json')):
            if js.name in ('tests.json', 'placements.json'):
                continue
            name = js.stem
            if args.only and args.only not in name:
                continue
            doc = json.load(open(js))
            times = spec.get('times', [0, 1])
            rcx_only = name in spec.get('rcx_only', []) or spec.get('all_rcx_only', False)
            rcs = {}
            for prof, opts in PROFILES.items():
                data, conv = lottie2rc.convert_document(doc, base_dir=str(gdir), **opts)
                rcs[prof] = work / ('%s.%s.rc' % (name, prof)); rcs[prof].write_bytes(data)
            for t in times:
                ref = refdir / ('%s-%s.png' % (name, ('%g' % t).replace('.', '_')))
                if args.update or not ref.exists():
                    if not render_cpp(rcs['rcx'], ref, t):
                        failures.append('%s/%s t=%g: C++ render failed' % (group, name, t)); continue
                a = load_png(ref)
                for prof in PROFILES:
                    if prof == 'mainline' and rcx_only:
                        continue
                    for pl in players:
                        png = work / ('%s.%s.%s.%g.png' % (name, prof, pl, t))
                        ok = (render_cpp if pl == 'cpp' else render_ts)(rcs[prof], png, t)
                        checks += 1
                        if not ok:
                            failures.append('%s/%s %s %s t=%g: render failed' % (group, name, prof, pl, t)); continue
                        diff, drawn = compare(a, load_png(png))
                        limit = EXACT_ABS if (prof == 'rcx' and pl == 'cpp') else max(MAX_ABS, MAX_SHARE * drawn)
                        if diff > limit:
                            failures.append('%s/%s %s %s t=%g: %d pixels differ from the reference (limit %d, drawn %d)' % (group, name, prof, pl, t, diff, limit, drawn))
            if group == 'text':
                placements.frames = spec.get('placement_frames', [0, 15, 30])
                got = placements(doc, str(gdir))
                new_fixture[name] = got
                exp = fixture.get(name)
                if exp is not None:
                    checks += 1
                    for frame, rows in exp.items():
                        mine = got.get(frame, [])
                        if len(mine) != len(rows):
                            failures.append('text/%s frame %s: %d placements, expected %d' % (name, frame, len(mine), len(rows))); break
                        for r, m in zip(rows, mine):
                            if r[0] != m[0] or any(abs(float(x) - float(y)) > 0.05 for x, y in zip(r[1:], m[1:])):
                                failures.append('text/%s frame %s: %s expected %s got %s' % (name, frame, r[0], r[1:], m[1:])); break
    if args.update or not fixture_path.exists():
        json.dump(new_fixture, open(fixture_path, 'w'), indent=0, sort_keys=True)
        print('wrote', fixture_path)
    print('%d checks, %d failures' % (checks, len(failures)))
    for f in failures:
        print('  FAIL', f)
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
