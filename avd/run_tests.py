#!/usr/bin/env python3
"""
run_tests.py — regression suite for avd2rc over the synthetic drawables in tests/.

    python3 run_tests.py --python VENV/bin/python      # all checks
    python3 run_tests.py --update                      # rewrite tests/ref/*.json after an intended change
    python3 run_tests.py --only morph --no-java

For every test in tests/tests.json:
  1. convert tests/res/drawable/<name>.xml (resources resolved in tests/res) and compare the
     JSON with tests/ref/<id>.json — any change in output shows up here first;
  2. json2rc and the Java parser must give byte-identical .rc;
  3. the TypeScript player (avd/tsrender.mjs, with Android-style trimming) renders 5 frames,
     each compared with the oracle (oracle.py); SSIM must exceed 0.95.
Plus unit checks of the pieces with exact answers (path parsing, keyframe completion,
expression splitting, interpolator tables).
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from avdrc import convert as conv, pathdata, animators, expr  # noqa: E402
from avdrc.emit import Options  # noqa: E402
from avdrc.interpolators import BUILTIN  # noqa: E402

TESTS = HERE / 'tests'
RES = TESTS / 'res'
REF = TESTS / 'ref'


def unit_checks():
    fails = []

    def check(name, cond):
        if not cond:
            fails.append(name)
    # PathParser grammar: implicit separators, repeated commands, empty commands
    n = pathdata.parse('M1.5.5-2-3l1e1,2c')
    check('parse numbers', n[0] == ('M', [1.5, 0.5, -2.0, -3.0]) and n[1] == ('l', [10.0, 2.0]) and n[2] == ('c', []))
    ops = pathdata.to_ops(pathdata.parse('M0,0 2,0 h3 v4 z m1,1 l1,0'))
    check('implicit lineTo / relative after Z', ops == [('M', 0.0, 0.0), ('L', 2.0, 0.0), ('L', 5.0, 0.0), ('L', 5.0, 4.0), ('Z',), ('M', 1.0, 1.0), ('L', 2.0, 1.0)])
    check('path starts at origin', pathdata.to_ops(pathdata.parse('L1,1'))[0] == ('M', 0.0, 0.0))
    a = pathdata.parse('M0,0 A5,5 0 0,1 10,0')
    b = pathdata.parse('M0,0 A1,1 0 0,1 10,0')
    m = pathdata.morph_ops([a, b])
    check('arc morph lines up', m is not None and len(m[0]) == len(m[1]))
    # even-odd -> non-zero: the nested square is reversed
    sq = pathdata.to_ops(pathdata.parse('M0,0 h10 v10 h-10 z M2,2 h6 v6 h-6 z'))
    check('even-odd flips', pathdata.evenodd_flips(sq) == [False, True])
    # keyframe completion (AnimatorInflater.loadPvh)
    K = animators.Keyframe
    kf = animators.complete_keyframes([K(-1, 1.0, None), K(-1, 2.0, None), K(-1, 3.0, None), K(-1, 4.0, None)])
    check('keyframe fractions', [round(k.fraction, 4) for k in kf] == [0.0, 0.3333, 0.6667, 1.0])
    kf = animators.complete_keyframes([K(0.5, 1.0, None)])
    check('keyframe at 0 and 1 added', [k.fraction for k in kf] == [0.0, 0.5, 1.0])
    # expressions: within the token limit after splitting
    pool = expr.Pool(8)
    e = expr.V('a')
    for i in range(10):
        e = e * (expr.V('b') + i)
    pool.ref(e)
    check('token limit', all(expr.N(1).size() <= 8 for _ in [0]) and all(len(c['variable']['value'].split()) < 40 for c in pool.commands))
    # interpolator tables: fast_out_slow_in within tolerance through the spline
    from avdrc.emit import Emitter
    fosi = BUILTIN['fast_out_slow_in']
    check('cubic interpolator', abs(fosi.value(0.5) - 0.7743) < 2e-3)
    return fails


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--update', action='store_true', help='rewrite tests/ref/*.json')
    ap.add_argument('--only')
    ap.add_argument('--no-java', action='store_true')
    ap.add_argument('--no-render', action='store_true')
    ap.add_argument('--python', help='python with Pillow + numpy (re-executes)')
    args = ap.parse_args()
    if args.python and os.path.realpath(sys.executable) != os.path.realpath(args.python):
        os.execv(args.python, [args.python] + [a for a in sys.argv if not a.startswith('--python')])
    import validate
    import oracle
    from avdrc import avd as avdmod
    from avdrc.resources import Resources
    from avdrc.emit import Emitter

    failures = ['unit: ' + f for f in unit_checks()]
    manifest = json.loads((TESTS / 'tests.json').read_text())
    REF.mkdir(exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix='avd-tests-'))
    jobs = []
    for t in manifest['tests']:
        tid = t.get('id', t['name'])
        if args.only and args.only not in tid:
            continue
        src = RES / 'drawable' / (t['name'] + '.xml')
        opts = Options(**t.get('options', {}))
        results = conv.convert_file(str(src), opts, str(RES))
        want = t.get('variant', src.stem)
        r = [x for x in results if x.name == want][0]
        text = json.dumps(r.doc, indent=1, sort_keys=False) + '\n'
        ref = REF / (tid + '.json')
        status = []
        if args.update or not ref.exists():
            ref.write_text(text)
            status.append('ref written')
        elif ref.read_text() != text:
            failures.append('%s: JSON differs from tests/ref/%s.json' % (tid, tid))
            status.append('JSON CHANGED')
        jp = tmp / (tid + '.json')
        jp.write_text(text)
        rc = tmp / (tid + '.rc')
        try:
            conv.json_to_rc(str(jp), str(rc))
        except Exception as e:
            failures.append('%s: json2rc: %s' % (tid, e))
            continue
        if not args.no_java:
            jr = tmp / (tid + '.java.rc')
            err = validate.java_one(str(jp), str(jr))
            if err or jr.read_bytes() != rc.read_bytes():
                failures.append('%s: Java parser %s' % (tid, err or 'bytes differ'))
                status.append('JAVA DIFFERS')
            else:
                status.append('java identical')
        if not args.no_render:
            docs = avdmod.load(str(src), Resources(str(RES)))
            d = [x for x in docs if x.name == want][0]
            em = Emitter(d, Resources(str(RES)), Options())
            em.build_timeline()
            v = d.vector
            scale = 160 / max(v.width, v.height)
            W, H = int(round(v.width * scale)), int(round(v.height * scale))
            # with --trigger the clock is shifted by the variable's initial -1000 s
            shift = 1000.0 if t.get('options', {}).get('trigger') else 0.0
            for i, tt in enumerate(validate.sample_times(em.span)):
                jobs.append((tid, rc, d, i, tt, shift, W, H))
        print('%-24s %6d B JSON %6d B rc  %s' % (tid, len(text), rc.stat().st_size, ', '.join(status)))
    if jobs:
        spec = [[str(rc), str(tmp / ('%s-%d.png' % (tid, i))), W, H, tt - shift] for tid, rc, d, i, tt, shift, W, H in jobs]
        subprocess.run(['node', str(HERE / 'tsrender.mjs'), '--android-trim'], input=json.dumps(spec), capture_output=True, text=True)
        worst = {}
        for tid, rc, d, i, tt, shift, W, H in jobs:
            png = tmp / ('%s-%d.png' % (tid, i))
            ref_png = tmp / ('%s-%d.oracle.png' % (tid, i))
            svg, _ = oracle.render_svg(d, W, H, tt)
            oracle.rasterize(svg, str(tmp / ('%s-%d.svg' % (tid, i))), str(ref_png), W, H)
            if not png.exists():
                failures.append('%s: frame %d did not render' % (tid, i))
                continue
            s, _ = validate.compare(png, ref_png)
            worst[tid] = min(worst.get(tid, 1.0), s)
            if s <= validate.PASS:
                validate.compare(png, ref_png, tmp / ('%s-%d.diff.png' % (tid, i)))
                failures.append('%s: frame %d (t=%.3f) SSIM %.3f vs the oracle (%s)' % (tid, i, tt, s, tmp / ('%s-%d.diff.png' % (tid, i))))
        print('worst SSIM per test: ' + ', '.join('%s %.3f' % kv for kv in worst.items()))
    if failures:
        print('\n%d FAILURE(S):' % len(failures))
        for f in failures:
            print('  ' + f)
        return 1
    print('\nall passed (work files in %s)' % tmp)
    return 0


if __name__ == '__main__':
    sys.exit(main())
