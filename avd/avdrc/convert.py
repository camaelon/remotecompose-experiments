"""Conversion entry points and the command line."""

import argparse
import json
import os
import subprocess
import sys

from . import avd, gaps
from .emit import Emitter, Options
from .resources import Resources
from .xmlutil import ConvertError, local, parse_file

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(HERE)
JSON2RC = os.path.join(REPO, 'players', 'typescript', 'build-json2rc', 'cli.js')
JAVA_JSON = os.path.join(REPO, 'players', 'conformance', 'java-json.sh')


class Result:
    def __init__(self, name, doc, warnings, kind, stats=None, end=None, sources=()):
        self.sources = sorted(sources)      # the XML files this drawable was built from
        self.name = name
        self.doc = doc
        self.warnings = warnings
        self.kind = kind
        self.stats = stats or {}
        self.end = end


def convert_file(path, opts=None, res_root=None, values=None):
    """-> [Result]: one per drawable in the file (a selector gives one per transition)."""
    opts = opts or Options()
    res = Resources(res_root, values)
    docs = avd.load(path, res)
    out = []
    for d in docs:
        o = Options(**vars(opts))
        if o.description is None:
            o.description = d.name.replace('_', ' ')
        em = Emitter(d, res, o)
        doc = em.build()
        out.append(Result(d.name, doc, list(res.warnings), d.kind, em.stats, em.end, res.files))
    return out


def dumps(doc):
    return json.dumps(doc, separators=(',', ':'), ensure_ascii=False)


def json_to_rc(json_path, rc_path, java=False):
    cmd = ['bash', JAVA_JSON, json_path, rc_path] if java else ['node', JSON2RC, json_path, rc_path]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(rc_path):
        raise ConvertError('%s failed: %s' % ('java' if java else 'json2rc', (r.stderr or r.stdout).strip()[-300:]))


def load_values(path):
    """<resources> values file -> {(type, name): value}."""
    root = parse_file(path)
    out = {}
    for el in root:
        if not isinstance(el.tag, str):
            continue
        t = local(el.tag)
        name = el.get('name')
        if t == 'item':
            t = el.get('type', 'item')
        if name:
            out[(t, name)] = (el.text or '').strip()
    return out


def is_convertible(path):
    try:
        with open(path, 'rb') as fh:
            head = fh.read(4096)
    except OSError:
        return False
    return b'<animated-vector' in head or b'<animated-selector' in head


def main(argv=None):
    ap = argparse.ArgumentParser(prog='avd2rc.py', description='Convert Android (animated) vector drawables to RemoteCompose JSON.')
    ap.add_argument('inputs', nargs='*', help='XML files, or directories (every animated-vector / animated-selector inside)')
    ap.add_argument('-o', '--output', help='output JSON file (one input) or directory')
    ap.add_argument('--rc', help='also write .rc through json2rc (file for one input, or a directory)')
    ap.add_argument('--res-root', help='source tree to resolve @drawable/@anim/... in (default: found from the file)')
    ap.add_argument('--values', action='append', default=[], help='a res/values XML file supplying @integer/@dimen/@string values')
    g = ap.add_mutually_exclusive_group()
    g.add_argument('--loop', action='store_true', help='loop the whole animation')
    g.add_argument('--once', action='store_true', help='play once and hold the end (default)')
    ap.add_argument('--trigger', metavar='VAR', help='start time read from variable VAR; a click on the canvas replays')
    ap.add_argument('--size', nargs=2, type=float, metavar=('W', 'H'), help='document size (default: the vector width/height in dp)')
    ap.add_argument('--max-tokens', type=int, default=32, help='longest expression (Android: 32)')
    ap.add_argument('--no-theme', action='store_true', help='theme colours as dark literal colours')
    ap.add_argument('--tint', metavar='COLOR', help="one colour for every paint, replacing the vector's tint: a theme colour name (onSurface, primary, ...) or #AARRGGBB")
    ap.add_argument('--strip-degenerate', action='store_true', help='drop zero-area contours and repeated points of filled paths')
    ap.add_argument('--profile', choices=('mainline',), default='mainline', help='output profile (mainline: byte-identical with the Java parser)')
    ap.add_argument('--vectors', action='store_true', help='in directory mode, also convert plain <vector> files')
    ap.add_argument('--pretty', action='store_true', help='indented JSON')
    ap.add_argument('--list-gaps', action='store_true', help='print what is not converted and exit')
    ap.add_argument('-v', '--verbose', action='store_true')
    args = ap.parse_args(argv)
    if args.list_gaps:
        print(gaps.gaps_text())
        return 0
    if not args.inputs:
        ap.error('no input')
    values = {}
    for v in args.values:
        values.update(load_values(v))
    opts = Options(mode='loop' if args.loop else 'once', trigger=args.trigger,
                   size=tuple(args.size) if args.size else None, max_tokens=args.max_tokens,
                   theme=not args.no_theme, tint=args.tint, strip_degenerate=args.strip_degenerate)
    files = []
    for inp in args.inputs:
        if os.path.isdir(inp):
            for dp, dn, fns in os.walk(inp):
                dn.sort()
                for fn in sorted(fns):
                    p = os.path.join(dp, fn)
                    if fn.endswith('.xml') and (is_convertible(p) or (args.vectors and b'<vector' in open(p, 'rb').read(2048))):
                        files.append(p)
        else:
            files.append(inp)
    single = len(files) == 1 and not any(os.path.isdir(i) for i in args.inputs)
    failures = 0
    for path in files:
        try:
            results = convert_file(path, opts, args.res_root, values)
        except ConvertError as e:
            failures += 1
            print('FAIL %s: %s' % (path, e), file=sys.stderr)
            continue
        for r in results:
            text = json.dumps(r.doc, indent=1) if args.pretty else dumps(r.doc)
            if single and len(results) == 1 and args.output and not os.path.isdir(args.output):
                out = args.output
            elif args.output:
                os.makedirs(args.output, exist_ok=True)
                out = os.path.join(args.output, r.name + '.json')
            else:
                out = os.path.splitext(path)[0] + ('' if r.name == os.path.splitext(os.path.basename(path))[0] else '.' + r.name) + '.json'
            with open(out, 'w') as fh:
                fh.write(text)
            msg = '%s -> %s (%d B)' % (path, out, len(text))
            if args.rc:
                if single and len(results) == 1 and not os.path.isdir(args.rc) and args.rc.endswith('.rc'):
                    rc = args.rc
                else:
                    os.makedirs(args.rc, exist_ok=True)
                    rc = os.path.join(args.rc, r.name + '.rc')
                try:
                    json_to_rc(out, rc)
                    msg += ', %s (%d B)' % (rc, os.path.getsize(rc))
                except ConvertError as e:
                    failures += 1
                    msg += ', rc FAILED: %s' % e
            print(msg)
            if args.verbose:
                for w in r.warnings:
                    print('  warning: ' + w)
    return 1 if failures else 0
