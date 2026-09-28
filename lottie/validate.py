#!/usr/bin/env python3
"""
validate.py — convert the lottie-test-files corpus and score the players' renders against
the After Effects reference PNGs that ship with it.

    python3 validate.py --test-files ~/Documents/GitHub/lottie-test-files \
                        --out test-files --work /tmp/lottie-validate --player cpp

Steps (each can be skipped with --skip-*):
  1. convert  every data/<category>/<name>.json  ->  <out>/data/<category>/<name>.rc
  2. render   every reference frame  <name>-NN.png  with the chosen player(s) into a
              render set  <work>/render-<player>/<category>/<name>-NN.png
  3. report   run the corpus' own tools/report (UQI image similarity, score = uqi^3,
              anything above 0.95 counts as a pass) and tools/html-report
  4. summary  print a per-example table and write <out>/RESULTS.md

The C++ renderer is players/cpp/build/tools/rc2image (RC_BG=transparent, --anim frame/fr);
the TypeScript renderer is players/typescript/frames.mjs.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))
import lottie2rc  # noqa: E402

RC2IMAGE = REPO / 'players' / 'cpp' / 'build' / 'tools' / 'rc2image' / 'rc2image'
FRAMES_MJS = REPO / 'players' / 'typescript' / 'frames.mjs'


def find_examples(data_dir: Path):
    """-> list of (relative stem, json path, [(frame number, reference png)])."""
    out = []
    for js in sorted(data_dir.glob('*/*.json')):
        if js.name.endswith('-meta.json') or 'asset' in js.name:
            continue
        stem = js.with_suffix('')
        frames = []
        for png in sorted(js.parent.glob(js.stem + '-*.png')):
            m = re.match(re.escape(js.stem) + r'-(\d+)$', png.stem)
            if m:
                frames.append((int(m.group(1)), png))
        out.append((stem.relative_to(data_dir), js, frames))
    return out


def convert_all(examples, data_dir, out_dir, args):
    log = []
    for rel, js, _ in examples:
        with open(js, encoding='utf-8') as fh:
            doc = json.load(fh)
        data, conv = lottie2rc.convert_document(doc, base_dir=str(js.parent), fit=not args.no_fit,
                                                compact_paths=args.compact_paths, rcz=args.rcz, bezier_op=args.bezier_op, compact_delta=args.compact_delta, keyframe_op=args.keyframe_op, quantize=args.quantize, focal_op=args.focal_op)
        dst = out_dir / 'data' / rel.with_suffix('.rc')
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(data)
        warnings = sorted(conv.warnings)
        log.append((str(rel), len(data), doc.get('w'), doc.get('h'), doc.get('fr'), warnings))
        print('%-45s %6d bytes  %s' % (rel, len(data), '; '.join(warnings)))
    return log


def render_cpp(rc: Path, out_png: Path, w, h, seconds):
    env = dict(os.environ, RC_BG='transparent')
    cmd = [str(RC2IMAGE), str(rc), str(out_png), str(w), str(h), '--anim', '%.6f' % seconds]
    r = subprocess.run(cmd, env=env, capture_output=True, text=True)
    return r.returncode == 0 and out_png.exists(), (r.stderr or r.stdout)[-300:]


def render_ts(rc: Path, out_png: Path, w, h, seconds):
    cmd = ['node', str(FRAMES_MJS), str(rc), str(out_png), '%.6f' % seconds, '--width', str(w), '--height', str(h)]
    r = subprocess.run(cmd, cwd=str(FRAMES_MJS.parent), capture_output=True, text=True)
    return r.returncode == 0 and out_png.exists(), (r.stderr or r.stdout)[-300:]


def render_all(examples, data_dir, out_dir, work, player, args):
    render_dir = work / ('render-' + player)
    if render_dir.exists():
        shutil.rmtree(render_dir)
    render_dir.mkdir(parents=True)
    times = {}
    failures = []
    fn = render_cpp if player == 'cpp' else render_ts
    for rel, js, frames in examples:
        with open(js, encoding='utf-8') as fh:
            doc = json.load(fh)
        fr = float(doc.get('fr', 30))
        rc = out_dir / 'data' / rel.with_suffix('.rc')
        for frame, ref in frames:
            dst = render_dir / rel.parent / ('%s-%02d.png' % (rel.name, frame))
            dst.parent.mkdir(parents=True, exist_ok=True)
            # sample slightly inside the frame: the document's clock adds 1/1000 frame itself,
            # this only guards against float32 rounding in `time * fps`
            t0 = time.perf_counter_ns()
            ok, err = fn(rc, dst, doc.get('w'), doc.get('h'), frame / fr)
            times[str(rel.parent / dst.name)] = time.perf_counter_ns() - t0
            if not ok:
                failures.append((str(rel), frame, err.strip()))
                print('FAIL', rel, frame, err.strip()[-120:])
    meta = {
        'title': 'lottie2rc -> %s player' % player,
        'label': 'rc-' + player,
        'comment': 'Lottie JSON converted by lottie/lottie2rc.py, rendered by the %s player' % player,
        'command': 'lottie/validate.py --player ' + player,
        'skipped': [],
        'format': 'json',
        'times': times,
    }
    (render_dir / 'meta.json').write_text(json.dumps(meta, indent=1))
    return render_dir, failures


def run_report(tools, python, data_dir, render_dirs, work):
    report = work / 'report.json'
    cmd = [python, str(tools / 'report'), '--reference', str(data_dir), '-o', str(report)] + [str(d) for d in render_dirs]
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=str(tools.parent))
    if r.returncode != 0:
        print(r.stdout[-2000:], r.stderr[-2000:])
        raise SystemExit('tools/report failed')
    html = work / 'report.html'
    subprocess.run([python, str(tools / 'html-report'), str(report), '-o', str(html)], capture_output=True, text=True, cwd=str(tools.parent))
    return report, html


def summarize(report_path, log, out_dir, players):
    rep = json.load(open(report_path))
    rows = []
    per_test = {}
    for t in rep['tests']:
        scores = [(res.get('uqi', 0.0), res.get('score', 0.0), res.get('status', '?')) for res in t['results']]
        rows.append((t['test'], t['file'], scores))
        per_test.setdefault(t['test'], []).append(scores)
    warn_map = {rel: w for rel, _, _, _, _, w in log}

    lines = ['# lottie2rc validation results', '',
             'Scores are the lottie-test-files `tools/report` metric: UQI image similarity between the',
             'player render and the After Effects reference PNG, cubed; a UQI above 0.95 counts as 1.0.',
             '', '| example | frame | ' + ' | '.join('%s uqi' % p for p in players) + ' | converter warnings |',
             '|:---|---:|' + '---:|' * len(players) + ':---|']
    totals = [0.0] * len(players)
    n = 0
    for test, file, scores in rows:
        n += 1
        for i, (u, s, st) in enumerate(scores):
            totals[i] += s
        frame = re.sub(r'.*-(\d+)\.png$', r'\1', file)
        cells = ' | '.join(('%.3f' % u if st == 'ok' else st) for (u, s, st) in scores)
        warns = '; '.join(warn_map.get(test, []))
        lines.append('| %s | %s | %s | %s |' % (test, frame, cells, warns))
    lines.append('')
    for i, p in enumerate(players):
        lines.append('**%s: %.1f%% (%d frames)**  ' % (p, 100.0 * totals[i] / max(1, n), n))
    lines.append('')
    # per-feature roll-up from the report
    feats = rep.get('features', {})
    lines += ['## By feature', '', '| feature | ' + ' | '.join(players) + ' |', '|:---|' + '---:|' * len(players)]
    for name in sorted(feats):
        f = feats[name]
        cells = ' | '.join('%.0f%%' % (100.0 * f['score'][i] / max(1, f['max'])) for i in range(len(players)))
        lines.append('| %s | %s |' % (name, cells))
    text = '\n'.join(lines) + '\n'
    (out_dir / 'RESULTS.md').write_text(text)
    for i, p in enumerate(players):
        print('%s: %.1f%% over %d frames' % (p, 100.0 * totals[i] / max(1, n), n))
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--test-files', default=os.path.expanduser('~/Documents/GitHub/lottie-test-files'))
    ap.add_argument('--out', default=str(HERE / 'test-files'))
    ap.add_argument('--work', default='/tmp/lottie-validate')
    ap.add_argument('--player', default='cpp', help='cpp, ts, or both')
    ap.add_argument('--python', default=sys.executable, help='python with Pillow/opencv/sewar for tools/report')
    ap.add_argument('--no-fit', action='store_true')
    ap.add_argument('--compact-paths', action='store_true', help='emit PATH_DATA_COMPACT_X')
    ap.add_argument('--rcz', action='store_true', help='wrap documents in the RCZ1 container')
    ap.add_argument('--bezier-op', action='store_true', help='use the BEZIER_EASE_X operator for easing')
    ap.add_argument('--compact-delta', action='store_true', help='delta form of the compact paths')
    ap.add_argument('--keyframe-op', action='store_true', help='use the KEYFRAMES_X operator')
    ap.add_argument('--quantize', type=float, default=None, help='quantise keyframe lists to this grid (FLOAT_LIST_COMPACT_X)')
    ap.add_argument('--focal-op', action='store_true', help='focal radial gradients (FOCAL_RADIAL_GRADIENT_X)')
    ap.add_argument('--skip-convert', action='store_true')
    ap.add_argument('--skip-render', action='store_true')
    ap.add_argument('--only', help='substring filter on the example name')
    args = ap.parse_args()

    tf = Path(args.test_files).expanduser().resolve()
    data_dir = tf / 'data'
    out_dir = Path(args.out).resolve()
    work = Path(args.work).resolve()
    work.mkdir(parents=True, exist_ok=True)
    examples = find_examples(data_dir)
    if args.only:
        examples = [e for e in examples if args.only in str(e[0])]
    print('%d examples' % len(examples))

    log = []
    if not args.skip_convert:
        log = convert_all(examples, data_dir, out_dir, args)
    players = ['cpp', 'ts'] if args.player == 'both' else [args.player]
    render_dirs = []
    for p in players:
        if args.skip_render:
            render_dirs.append(work / ('render-' + p))
        else:
            rd, failures = render_all(examples, data_dir, out_dir, work, p, args)
            render_dirs.append(rd)
            if failures:
                print('%d render failures with %s' % (len(failures), p))
    report, html = run_report(tf / 'tools', args.python, data_dir, render_dirs, work)
    print('report:', report, html)
    summarize(report, log, out_dir, players)


if __name__ == '__main__':
    main()
