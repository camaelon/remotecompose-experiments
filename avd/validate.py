#!/usr/bin/env python3
"""
validate.py — convert the AVD corpus and check every result three ways.

    python3 validate.py --work /tmp/avd-validate [--python VENV/bin/python] [--only NAME] [--source aosp]

For every <animated-vector> under assets/avds/source/<source>/ (and with --selectors, every
<animated-selector> transition):
  1. convert   avd2rc -> JSON                              (work/json/...)
  2. json2rc   JSON -> .rc with the TypeScript converter    (work/rc/...)
  3. java      JSON -> .rc with androidx's Java parser; byte-compare with json2rc
  4. render    the .rc with the C++ player (rc2image, RC_BG=transparent, --anim t) at
               t = 0, 25 %, 50 %, 75 % and 100 % of the animation
  5. oracle    oracle.py evaluates the drawable at the same t (Android's animator semantics,
               its own code) into an SVG, rasterised by rsvg-convert
  6. compare   SSIM of the two renders composited on grey; > 0.95 passes
and writes work/REPORT.md, work/report.json and, for failing frames, side-by-side images
work/diff/<name>-<i>.png (player | oracle | difference).

Steps 4-6 need Pillow and numpy: run with a venv's python (`--python` re-executes there).
"""

import argparse
import concurrent.futures as cf
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))
from avdrc import convert as conv  # noqa: E402
from avdrc.emit import Options  # noqa: E402
from avdrc.xmlutil import ConvertError  # noqa: E402
import oracle  # noqa: E402

CORPUS = REPO / 'assets' / 'avds' / 'source'
RC2IMAGE = REPO / 'players' / 'cpp' / 'build' / 'tools' / 'rc2image' / 'rc2image'
JSON2RC_DIR = REPO / 'players' / 'typescript' / 'build-json2rc'
JAVA_JSON = REPO / 'players' / 'conformance' / 'java-json.sh'
PASS = 0.95
MAX_SIDE = 160


def find_inputs(sources, selectors, only):
    out = []
    for src in sources:
        for p in sorted((CORPUS / src).rglob('*.xml')):
            head = p.read_bytes()[:4096]
            if b'<animated-vector' in head or (selectors and b'<animated-selector' in head):
                rel = p.relative_to(CORPUS)
                if only and only not in str(rel):
                    continue
                out.append((src, rel, p))
    return out


def json2rc_batch(pairs):
    """[(json, rc)] -> {json: error or None}, in one node process."""
    script = """
const {convert} = require(%r);
const fs = require('fs');
const jobs = JSON.parse(fs.readFileSync(0, 'utf8'));
const out = {};
for (const [j, r] of jobs) {
  try { fs.writeFileSync(r, Buffer.from(convert(fs.readFileSync(j, 'utf8')))); out[j] = null; }
  catch (e) { out[j] = String(e && e.message || e); }
}
process.stdout.write(JSON.stringify(out));
""" % str(JSON2RC_DIR / 'Parser.js')
    r = subprocess.run(['node', '-e', script], input=json.dumps(pairs), capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit('json2rc batch failed: ' + r.stderr[-500:])
    return json.loads(r.stdout)


def java_one(j, r):
    p = subprocess.run(['bash', str(JAVA_JSON), j, r], capture_output=True, text=True)
    if p.returncode != 0 or not os.path.exists(r):
        lines = [l for l in (p.stderr or '').splitlines() if 'Exception' in l or 'Error' in l]
        return (lines[0] if lines else (p.stderr or 'failed').strip()[-200:])
    return None


def render_cpp(rc, png, w, h, t):
    env = dict(os.environ, RC_BG='transparent')
    r = subprocess.run([str(RC2IMAGE), str(rc), str(png), str(w), str(h), '--anim', '%.6f' % t], env=env, capture_output=True, text=True)
    return r.returncode == 0 and os.path.exists(png)


def ssim(a, b):
    """Mean SSIM (8x8 box windows) of two float images (H, W, 3) in 0..255."""
    import numpy as np
    C1, C2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2

    def box(x, k=7):
        pad = k // 2
        x = np.pad(x, ((pad, pad), (pad, pad)), mode='edge')
        c = x.cumsum(0).cumsum(1)
        c = np.pad(c, ((1, 0), (1, 0)))
        return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)
    vals = []
    for ch in range(3):
        x, y = a[..., ch], b[..., ch]
        mx, my = box(x), box(y)
        sxx = box(x * x) - mx * mx
        syy = box(y * y) - my * my
        sxy = box(x * y) - mx * my
        s = ((2 * mx * my + C1) * (2 * sxy + C2)) / ((mx * mx + my * my + C1) * (sxx + syy + C2))
        vals.append(s.mean())
    return float(sum(vals) / 3)


def compare(png_a, png_b, diff_png=None):
    import numpy as np
    from PIL import Image
    A = np.asarray(Image.open(png_a).convert('RGBA')).astype(float)
    B = np.asarray(Image.open(png_b).convert('RGBA')).astype(float)
    if A.shape != B.shape:
        return 0.0, 1.0

    def over_grey(X):
        a = X[..., 3:4] / 255.0
        return X[..., :3] * a + 128.0 * (1 - a)
    ga, gb = over_grey(A), over_grey(B)
    s = ssim(ga, gb)
    d = np.abs(ga - gb).max(axis=2)
    drawn = max(1, int(((A[..., 3] > 8) | (B[..., 3] > 8)).sum()))
    share = float((d > 48).sum()) / drawn
    if diff_png is not None:
        h, w = ga.shape[:2]
        canvas = np.zeros((h, w * 3 + 8, 3))
        canvas[:] = 60
        canvas[:, :w] = ga
        canvas[:, w + 4:2 * w + 4] = gb
        canvas[:, 2 * w + 8:] = np.clip(d[..., None] * 2, 0, 255)
        Image.fromarray(canvas.astype('uint8')).save(diff_png)
    return s, share


def sample_times(T):
    if T <= 0:
        return [0.0]
    return [0.0, 0.25 * T, 0.5 * T, 0.75 * T, T]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--work', default='/tmp/avd-validate')
    ap.add_argument('--python', help='re-run under this python (with Pillow + numpy)')
    ap.add_argument('--source', action='append', help='aosp, material-components, androidx (default: all)')
    ap.add_argument('--only', help='substring filter on the relative path')
    ap.add_argument('--selectors', action='store_true', help='also convert animated-selector transitions')
    ap.add_argument('--no-java', action='store_true')
    ap.add_argument('--no-render', action='store_true')
    ap.add_argument('--jobs', type=int, default=8)
    ap.add_argument('--player', default='both', choices=('ts', 'cpp', 'both'))
    args = ap.parse_args()
    if args.python and os.path.realpath(sys.executable) != os.path.realpath(args.python):
        os.execv(args.python, [args.python] + [a for a in sys.argv if not a.startswith('--python')] + [])
    work = Path(args.work).resolve()
    sources = args.source or ['aosp', 'material-components', 'androidx']
    inputs = find_inputs(sources, args.selectors, args.only)
    print('%d input files' % len(inputs))
    for sub in ('json', 'rc', 'java', 'png-ts', 'png-cpp', 'oracle', 'diff'):
        d = work / sub
        if d.exists() and not args.only:
            shutil.rmtree(d)
        d.mkdir(parents=True, exist_ok=True)

    # 1. convert
    entries = []
    t0 = time.time()
    for src, rel, path in inputs:
        try:
            results = conv.convert_file(str(path), Options())
        except ConvertError as e:
            entries.append({'source': src, 'file': str(rel), 'name': path.stem, 'converted': False, 'error': str(e), 'xml_bytes': path.stat().st_size})
            continue
        except Exception as e:  # a converter bug: keep going, report it
            entries.append({'source': src, 'file': str(rel), 'name': path.stem, 'converted': False, 'error': 'CRASH %s: %s' % (type(e).__name__, e), 'xml_bytes': path.stat().st_size})
            continue
        for r in results:
            stem = str(rel.with_suffix(''))
            if r.name != path.stem:
                stem += '.' + r.name
            jp = work / 'json' / (stem + '.json')
            jp.parent.mkdir(parents=True, exist_ok=True)
            text = conv.dumps(r.doc)
            jp.write_text(text)
            entries.append({'source': src, 'file': str(rel), 'name': r.name, 'converted': True, 'json': str(jp),
                            'json_bytes': len(text), 'xml_bytes': sum(os.path.getsize(f) for f in r.sources), 'warnings': r.warnings,
                            'end': r.end, 'stem': stem, 'kind': r.kind, '_doc': r})
    print('converted %d/%d in %.1fs' % (sum(e['converted'] for e in entries), len(entries), time.time() - t0))

    # 2. json2rc
    ok = [e for e in entries if e['converted']]
    pairs = []
    for e in ok:
        rc = work / 'rc' / (e['stem'] + '.rc')
        rc.parent.mkdir(parents=True, exist_ok=True)
        e['rc'] = str(rc)
        pairs.append([e['json'], e['rc']])
    errs = json2rc_batch(pairs)
    for e in ok:
        e['json2rc_error'] = errs.get(e['json'])
        if e['json2rc_error'] is None:
            e['rc_bytes'] = os.path.getsize(e['rc'])

    # 3. java
    if not args.no_java:
        with cf.ThreadPoolExecutor(args.jobs) as ex:
            futs = {}
            for e in ok:
                jr = work / 'java' / (e['stem'] + '.rc')
                jr.parent.mkdir(parents=True, exist_ok=True)
                futs[ex.submit(java_one, e['json'], str(jr))] = (e, jr)
            for f in cf.as_completed(futs):
                e, jr = futs[f]
                err = f.result()
                e['java_error'] = err
                e['java_identical'] = err is None and e.get('json2rc_error') is None and jr.read_bytes() == Path(e['rc']).read_bytes()
        print('java identical: %d/%d' % (sum(bool(e.get('java_identical')) for e in ok), len(ok)))

    # 4-6. render, oracle, compare
    report_players = []
    if not args.no_render:
        jobs = []
        for e in ok:
            if e.get('json2rc_error'):
                continue
            r = e['_doc']
            em_end = r.end
            vec = None
            from avdrc import avd as avdmod
            from avdrc.resources import Resources
            docs = avdmod.load(str(CORPUS / e['file']), Resources())
            d = [x for x in docs if x.name == e['name']][0]
            vec = d.vector
            scale = MAX_SIDE / max(vec.width, vec.height)
            W, H = max(8, int(round(vec.width * scale))), max(8, int(round(vec.height * scale)))
            from avdrc.emit import Emitter
            em = Emitter(d, Resources(), Options())
            em.build_timeline()
            times = sample_times(em.span)
            e['times'] = times
            e['frames'] = []
            for i, t in enumerate(times):
                jobs.append((e, d, i, t, W, H))

        players = ['ts', 'cpp'] if args.player == 'both' else [args.player]
        for e in ok:
            if 'frames' in e:
                e['frames'] = [{'i': i, 't': round(t, 4)} for i, t in enumerate(e['times'])]
        t0 = time.time()

        def base_of(e, i):
            return e['stem'].replace('/', '__') + '-%d' % i

        def oracle_job(job):
            e, d, i, t, W, H = job
            b = base_of(e, i)
            svg, notes = oracle.render_svg(d, W, H, t)
            oracle.rasterize(svg, str(work / 'oracle' / (b + '.svg')), str(work / 'oracle' / (b + '.png')), W, H)
            e['frames'][i]['notes'] = notes
        with cf.ThreadPoolExecutor(args.jobs) as ex:
            list(ex.map(oracle_job, jobs))
        for pl in players:
            (work / ('png-' + pl)).mkdir(exist_ok=True)
        if 'cpp' in players:
            def cpp_job(job):
                e, d, i, t, W, H = job
                png = work / 'png-cpp' / (base_of(e, i) + '.png')
                if not render_cpp(e['rc'], png, W, H, t) and png.exists():
                    png.unlink()
            with cf.ThreadPoolExecutor(args.jobs) as ex:
                list(ex.map(cpp_job, jobs))
        if 'ts' in players:
            batches = [jobs[k::args.jobs] for k in range(args.jobs)]

            def ts_batch(batch):
                spec = [[e['rc'], str(work / 'png-ts' / (base_of(e, i) + '.png')), W, H, t] for e, d, i, t, W, H in batch]
                subprocess.run(['node', str(HERE / 'tsrender.mjs'), '--android-trim'], input=json.dumps(spec), capture_output=True, text=True)
            with cf.ThreadPoolExecutor(args.jobs) as ex:
                list(ex.map(ts_batch, batches))

        def cmp_job(job):
            e, d, i, t, W, H = job
            b = base_of(e, i)
            ref = work / 'oracle' / (b + '.png')
            fr = e['frames'][i]
            for pl in players:
                png = work / ('png-' + pl) / (b + '.png')
                if not png.exists():
                    fr[pl] = 0.0
                    fr[pl + '_error'] = 'render failed'
                    continue
                s_, share = compare(png, ref)
                fr[pl] = round(s_, 4)
                if s_ <= PASS:
                    (work / 'diff' / pl).mkdir(exist_ok=True)
                    compare(png, ref, work / 'diff' / pl / (b + '.png'))
        with cf.ThreadPoolExecutor(args.jobs) as ex:
            list(ex.map(cmp_job, jobs))
        print('rendered %d frames in %.1fs' % (len(jobs), time.time() - t0))
        report_players[:] = players

    write_report(entries, work, sources, report_players)


def write_report(entries, work, sources, players):
    for e in entries:
        e.pop('_doc', None)
    (work / 'report.json').write_text(json.dumps(entries, indent=1))
    lines = ['# avd2rc corpus validation', '',
             'Frames: each player\'s render vs the oracle (oracle.py -> SVG -> rsvg-convert), SSIM on grey, pass > %.2f.' % PASS,
             'Frames are sampled at 0, 25, 50, 75 and 100 % of the animation (one period for infinite ones).', '',
             '| source | files | converted | json2rc ok | Java-identical | ' + ' | '.join('frames pass (%s)' % p for p in players) + ' | XML B | JSON B | .rc B |',
             '|:---|---:|---:|---:|---:|' + '---:|' * len(players) + '---:|---:|---:|']
    for src in sources + ['total']:
        es = [e for e in entries if src == 'total' or e['source'] == src]
        if not es:
            continue
        conv_ = [e for e in es if e['converted']]
        rcok = [e for e in conv_ if not e.get('json2rc_error')]
        jid = [e for e in conv_ if e.get('java_identical')]
        frames = [f for e in conv_ for f in e.get('frames', [])]
        cells = []
        for p in players:
            fp = [f for f in frames if f.get(p, 0) > PASS]
            cells.append('%d/%d (%.1f%%)' % (len(fp), len(frames), 100.0 * len(fp) / max(1, len(frames))))
        xb = sum(e['xml_bytes'] for e in conv_)      # the AVD and every file it references
        jb = sum(e.get('json_bytes', 0) for e in conv_)
        rb = sum(e.get('rc_bytes', 0) for e in conv_)
        lines.append('| %s | %d | %d | %d | %d | %s | %d | %d | %d |' % (src, len(es), len(conv_), len(rcok), len(jid), ' | '.join(cells), xb, jb, rb))
    lines += ['', '## Files', '', '| file | status | java | ' + ' | '.join('%s ssim' % p for p in players) + ' | warnings |', '|:---|:---|:---|' + ':---|' * len(players) + ':---|']
    for e in entries:
        if not e['converted']:
            lines.append('| %s | **not converted**: %s | |%s |' % (e['file'], e['error'].replace('|', '/'), ' |' * len(players)))
            continue
        st = 'ok' if not e.get('json2rc_error') else 'json2rc: ' + e['json2rc_error'][:80]
        java = 'identical' if e.get('java_identical') else ('—' if 'java_identical' not in e else ('differs' if e.get('java_error') is None else 'java: ' + str(e.get('java_error'))[:60]))
        cells = [' '.join(('%.2f' % f.get(p, 0)) + ('' if f.get(p, 0) > PASS else '✗') for f in e.get('frames', [])) for p in players]
        name = e['file'] + ('' if e['name'] == Path(e['file']).stem else ' (%s)' % e['name'])
        lines.append('| %s | %s | %s | %s | %s |' % (name, st, java, ' | '.join(cells), '; '.join(e.get('warnings', []))[:200].replace('|', '/')))
    (work / 'REPORT.md').write_text('\n'.join(lines) + '\n')
    print('\n'.join(lines[:11]))
    print('report:', work / 'REPORT.md')


if __name__ == '__main__':
    main()
