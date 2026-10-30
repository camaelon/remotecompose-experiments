#!/usr/bin/env python3
"""
convert_icons.py — convert the Material Symbols icon set (assets/icons/source/material-symbols/)
into RemoteCompose, with a catalog and a gallery.

    python3 avd/convert_icons.py                  # incremental: only what changed
    python3 avd/convert_icons.py --force          # everything
    python3 avd/convert_icons.py --only home      # names containing "home" (no catalog / gallery)

Every `symbols/android/<name>/materialsymbols<style>/<name>[_fill1]_24px.xml` becomes
`assets/icons/converted/material-symbols/<same path>.json` (RemoteCompose JSON) and `.rc`
(json2rc), converted by avd2rc with the icon options: one themed colour for every paint
(`--tint onSurface`, replacing the drawables' `?attr/colorControlNormal` tint over white fills)
and zero-area contours dropped (`--strip-degenerate`). Then:

  material-symbols/catalog.json  one entry per icon (styles, fills, categories, tags,
                                 popularity, variant files and .rc sizes; no path data)
  index.html + gallery/          a gallery rendering every icon with the TypeScript player,
                                 its documents in per-style / fill JS chunks loaded on demand

Incremental: a file is converted again when its JSON is older than its XML, or when the
converter's sources or options changed (`.stamp`). Conversion runs on every core, json2rc in
parallel node processes.
"""

import argparse
import base64
import concurrent.futures as cf
import hashlib
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

SRC_ROOT = REPO / 'assets' / 'icons' / 'source' / 'material-symbols'
SRC = SRC_ROOT / 'symbols' / 'android'
META = SRC_ROOT / 'metadata.json'
OUT_TOP = REPO / 'assets' / 'icons' / 'converted'
OUT = OUT_TOP / 'material-symbols'
GALLERY = OUT_TOP / 'gallery'
PLAYER = REPO / 'players' / 'typescript' / 'build-mcp' / 'player.min.js'
JSON2RC = REPO / 'players' / 'typescript' / 'build-json2rc' / 'Parser.js'
STYLES = ('outlined', 'rounded', 'sharp')
TINT = 'onSurface'
CHUNK = 256          # icons per gallery data chunk
OPTIONS = {'tint': TINT, 'strip_degenerate': True}


def variant_key(style, filled):
    return style + ('-filled' if filled else '')


def rel_stem(name, style, filled):
    return '%s/materialsymbols%s/%s%s_24px' % (name, style, name, '_fill1' if filled else '')


def find_sources():
    """-> {name: {(style, filled): xml path}}"""
    out = {}
    for name in sorted(os.listdir(SRC)):
        d = SRC / name
        if not d.is_dir():
            continue
        for style in STYLES:
            for filled in (False, True):
                p = SRC / (rel_stem(name, style, filled) + '.xml')
                if p.exists():
                    out.setdefault(name, {})[(style, filled)] = p
    return out


def stamp():
    h = hashlib.sha256()
    for p in sorted((HERE / 'avdrc').glob('*.py')):
        h.update(p.name.encode())
        h.update(p.read_bytes())
    h.update(json.dumps(OPTIONS, sort_keys=True).encode())
    return h.hexdigest()[:16]


# ---------------------------------------------------------------------------- conversion
def _convert_batch(jobs):
    """Worker: [(xml, json, name, filled)] -> [(json, error or None, warnings)]."""
    from avdrc import convert as conv
    from avdrc.emit import Options
    from avdrc.xmlutil import ConvertError
    out = []
    for xml, js, name, filled in jobs:
        try:
            desc = name.replace('_', ' ') + (' filled' if filled else '')
            rs = conv.convert_file(xml, Options(description=desc, **OPTIONS), res_root=str(SRC_ROOT))
            if len(rs) != 1:
                raise ConvertError('%d documents' % len(rs))
            text = conv.dumps(rs[0].doc) + '\n'
            os.makedirs(os.path.dirname(js), exist_ok=True)
            with open(js, 'w') as fh:
                fh.write(text)
            out.append((js, None, rs[0].warnings))
        except ConvertError as e:
            out.append((js, str(e), []))
        except Exception as e:  # a converter bug: report it, keep going
            out.append((js, 'CRASH %s: %s' % (type(e).__name__, e), []))
    return out


def json2rc_batch(pairs):
    script = """
const {convert} = require(%r);
const fs = require('fs');
const out = {};
for (const [j, r] of JSON.parse(fs.readFileSync(0, 'utf8'))) {
  try { fs.writeFileSync(r, Buffer.from(convert(fs.readFileSync(j, 'utf8')))); out[j] = null; }
  catch (e) { out[j] = String(e && e.message || e); }
}
process.stdout.write(JSON.stringify(out));
""" % str(JSON2RC)
    r = subprocess.run(['node', '-e', script], input=json.dumps(pairs), capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit('json2rc failed: ' + r.stderr[-400:])
    return json.loads(r.stdout)


def split(seq, n):
    k = max(1, (len(seq) + n - 1) // n)
    return [seq[i:i + k] for i in range(0, len(seq), k)]


def convert_all(sources, force, jobs, only):
    st = stamp()
    stamp_file = OUT / '.stamp'
    if not only and (not stamp_file.exists() or stamp_file.read_text().strip() != st):
        force = True
    todo = []
    for name, vs in sources.items():
        if only and only not in name:
            continue
        for (style, filled), xml in vs.items():
            js = OUT / (rel_stem(name, style, filled) + '.json')
            if force or not js.exists() or js.stat().st_mtime < xml.stat().st_mtime:
                todo.append((str(xml), str(js), name, filled))
    errors = {}
    warnings = 0
    t0 = time.time()
    if todo:
        with cf.ProcessPoolExecutor(jobs) as ex:
            for res in ex.map(_convert_batch, split(todo, jobs * 8)):
                for js, err, w in res:
                    if err:
                        errors[js] = err
                    warnings += len(w)
    print('converted %d files in %.1fs (%d failed, %d warnings)' % (len(todo) - len(errors), time.time() - t0, len(errors), warnings))
    # json2rc: every JSON whose .rc is missing or older
    t0 = time.time()
    pairs = []
    for name, vs in sources.items():
        if only and only not in name:
            continue
        for (style, filled) in vs:
            js = OUT / (rel_stem(name, style, filled) + '.json')
            rc = js.with_suffix('.rc')
            if js.exists() and str(js) not in errors and (not rc.exists() or rc.stat().st_mtime < js.stat().st_mtime):
                pairs.append([str(js), str(rc)])
    if pairs:
        with cf.ThreadPoolExecutor(jobs) as ex:
            for res in ex.map(json2rc_batch, split(pairs, jobs)):
                for j, e in res.items():
                    if e:
                        errors[j] = 'json2rc: ' + e
    print('json2rc %d files in %.1fs' % (len(pairs), time.time() - t0))
    if not only and not errors:
        stamp_file.write_text(st + '\n')
    return errors


# ---------------------------------------------------------------------------- catalog
def load_meta():
    m = json.loads(META.read_text())
    return {i['name']: i for i in m['icons']}


def dedupe(tags):
    seen, out = set(), []
    for t in tags:
        k = t.lower()
        if k not in seen:
            seen.add(k)
            out.append(t)
    return out


def derived(name, meta):
    """Categories and tags for an icon Google's metadata does not list: the name's words, and the
    categories of the longest listed icon whose name is a prefix of it (auto_fix_high -> auto_fix)."""
    parts = name.split('_')
    cats = []
    for k in range(len(parts) - 1, 0, -1):
        m = meta.get('_'.join(parts[:k]))
        if m:
            cats = m['categories']
            break
    tags = dedupe([name.replace('_', ' ')] + [p for p in parts if p])
    return cats, tags


def build_catalog(sources, errors):
    meta = load_meta()
    icons = []
    missing = []
    for name, vs in sources.items():
        m = meta.get(name)
        if m:
            cats, tags, pop = m['categories'], dedupe(m['tags']), m.get('popularity', 0)
        else:
            cats, tags = derived(name, meta)
            pop = 0
        variants = {}
        mirrored = False
        for style in STYLES:
            for filled in (False, True):
                if (style, filled) not in vs:
                    continue
                stem = rel_stem(name, style, filled)
                js = OUT / (stem + '.json')
                rc = OUT / (stem + '.rc')
                if str(js) in errors or not rc.exists():
                    missing.append(stem)
                    continue
                if not mirrored and b'autoMirrored="true"' in vs[(style, filled)].read_bytes()[:600]:
                    mirrored = True
                variants[variant_key(style, filled)] = {'path': stem, 'rcBytes': rc.stat().st_size}
        if not variants:
            continue
        e = {'name': name,
             'styles': [s for s in STYLES if any(k.split('-')[0] == s for k in variants)],
             'fills': sorted({k.endswith('-filled') for k in variants}),
             'categories': cats, 'tags': tags, 'popularity': pop}
        if not m:
            e['tagsDerived'] = True
        if mirrored:
            e['autoMirrored'] = True
        e['variants'] = variants
        icons.append(e)
    cat = {
        'source': 'Material Symbols (google/material-design-icons, symbols/android), 24 px, weight 400, grade 0; Apache License 2.0',
        'converter': 'avd/avd2rc.py (avd/convert_icons.py): --tint %s --strip-degenerate' % TINT,
        'size': {'width': 24, 'height': 24, 'viewport': 960},
        'tint': '@colors.' + TINT,
        'styles': list(STYLES),
        'variants': 'keyed <style> or <style>-filled; path + ".json" / ".rc" are the files, relative to this catalog',
        'count': len(icons),
        'categories': sorted({c for i in icons for c in i['categories']}),
        'icons': icons,
    }
    (OUT / 'catalog.json').write_text(json.dumps(cat, separators=(',', ':'), ensure_ascii=False) + '\n')
    return cat, missing


# ---------------------------------------------------------------------------- gallery
def write_gallery(cat):
    if GALLERY.exists():
        shutil.rmtree(GALLERY)
    GALLERY.mkdir(parents=True)
    shutil.copy(PLAYER, GALLERY / 'player.min.js')
    # popular first, the gallery's default order, so the first screen needs the first chunk only
    icons = sorted(cat['icons'], key=lambda i: (-i['popularity'], i['name']))
    cats = cat['categories']
    # the index: name, categories (indexes), tags (deduped against the name), popularity,
    # a variant bitmask (bit = style index * 2 + filled) and the chunk slot
    index = []
    chunks = {}
    for k, ic in enumerate(icons):
        mask = 0
        for vk in ic['variants']:
            st, _, f = vk.partition('-')
            mask |= 1 << (STYLES.index(st) * 2 + (1 if f else 0))
        words = set(ic['name'].split('_'))
        tags = [t for t in ic['tags'] if t.lower() not in words and t.lower() != ic['name'].replace('_', ' ')]
        index.append([ic['name'], [cats.index(c) for c in ic['categories']], '|'.join(tags), ic['popularity'], mask])
        for vk, v in ic['variants'].items():
            chunks.setdefault((vk, k // CHUNK), {})[k % CHUNK] = base64.b64encode((OUT / (v['path'] + '.rc')).read_bytes()).decode('ascii')
    (GALLERY / 'index.js').write_text('// generated by avd/convert_icons.py: [name, category indexes, tags joined by |, popularity, variant mask (bit = style * 2 + filled)]\n'
                                     'window.ICONS_INDEX = ' + json.dumps({'styles': list(STYLES), 'categories': cats, 'chunk': CHUNK, 'icons': index},
                                                                          separators=(',', ':'), ensure_ascii=False) + ';\n')
    sizes = {}
    for (vk, n), items in sorted(chunks.items()):
        d = GALLERY / vk
        d.mkdir(exist_ok=True)
        arr = [items.get(i, '') for i in range(max(items) + 1)]
        text = 'ICONS_CHUNK(%s,%d,%s);\n' % (json.dumps(vk), n, json.dumps(arr, separators=(',', ':')))
        (d / ('%d.js' % n)).write_text(text)
        sizes[vk] = sizes.get(vk, 0) + len(text)
    html = (HERE / 'icons_gallery.html').read_text()
    (OUT_TOP / 'index.html').write_text(html)
    return sizes


def write_readme(cat):
    src_bytes = sum(p.stat().st_size for p in SRC.rglob('*.xml'))
    js = sum(p.stat().st_size for p in OUT.rglob('*.json') if p.name != 'catalog.json')
    rc = sum(p.stat().st_size for p in OUT.rglob('*.rc'))
    n = sum(len(i['variants']) for i in cat['icons'])
    shutil.copy(SRC_ROOT / 'LICENSE', OUT / 'LICENSE')
    shutil.copy(SRC_ROOT / 'LICENSE', OUT_TOP / 'LICENSE')
    text = '''# Converted icons

RemoteCompose versions of the icon sets in [`../source/`](../SOURCES.md).

| folder | source | icons | documents | source XML | JSON | .rc |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `material-symbols/` | Material Symbols, Android vector drawables, 24 px ([SOURCES.md](../SOURCES.md)) | {icons:,} | {n:,} | {src:,} B | {js:,} B | {rc:,} B |

Each `<name>/materialsymbols<style>/<name>[_fill1]_24px.xml` was converted by
`avd/avd2rc.py` (regenerate with `python3 avd/convert_icons.py`; it is incremental) into
`<same path>.json` (RemoteCompose JSON, what json2rc and the Java parser read) and `.rc`
(the document, via json2rc). `material-symbols/catalog.json` lists every icon (styles, filled
variants, categories, tags, popularity, files and `.rc` sizes); icons Google's metadata does not
list get tags from their name (`tagsDerived`). Open [`index.html`](index.html) for a searchable
gallery rendered by the TypeScript player (it works from `file://`).

A converted icon is a 24 × 24 dp document with one canvas that fills its component, scaled from
the 960-unit viewport, and one path (an op list in `resources.paths`) filled with one themed
colour, `@colors.{tint}` (light / dark values in `resources.colors`): the drawables' own tint,
`?attr/colorControlNormal` over white fills, became that single colour so a host can recolour
the icon by replacing it.

## License

These files are derived works of Material Symbols by Google: they were modified (converted to
RemoteCompose) by avd2rc and remain under the Apache License 2.0 —
[`LICENSE`](LICENSE) (also in `material-symbols/`). The license grants no trademark rights.
'''.format(icons=cat['count'], n=n, src=src_bytes, js=js, rc=rc, tint=TINT)
    (OUT_TOP / 'README.md').write_text(text)
    return src_bytes, js, rc, n


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--force', action='store_true', help='convert everything again')
    ap.add_argument('--only', help='only icon names containing this (skips catalog and gallery)')
    ap.add_argument('--jobs', type=int, default=os.cpu_count() or 4)
    args = ap.parse_args()
    if not PLAYER.exists():
        raise SystemExit('build the player first: node mcp/lib/web-player.mjs --build')
    sources = find_sources()
    print('%d icons, %d files' % (len(sources), sum(len(v) for v in sources.values())))
    OUT.mkdir(parents=True, exist_ok=True)
    errors = convert_all(sources, args.force, args.jobs, args.only)
    for js, e in sorted(errors.items()):
        print('FAIL %s: %s' % (os.path.relpath(js, OUT), e))
    if args.only:
        return 1 if errors else 0
    cat, missing = build_catalog(sources, errors)
    sizes = write_gallery(cat)
    src_bytes, js, rc, n = write_readme(cat)
    print('catalog: %d icons, %d documents, %d B' % (cat['count'], n, (OUT / 'catalog.json').stat().st_size))
    print('source XML %d B, JSON %d B, .rc %d B' % (src_bytes, js, rc))
    print('gallery index %d B; chunks: %s' % ((GALLERY / 'index.js').stat().st_size,
                                             ', '.join('%s %d B' % kv for kv in sorted(sizes.items()))))
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
