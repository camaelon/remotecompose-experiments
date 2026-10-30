"""Resource references: `@drawable/x`, `@anim/x`, `@android:interpolator/x`, `?attr/x`, values.

A converted file lives in a source tree (one of the corpus folders, or an app's `src/`), with
any number of `res` directories. `@type/name` resolves to `<res>/<type>[-qualifiers]/name.xml`,
preferring the referencing file's own res directory, then the res directory that shares the
longest path with it, then anywhere in the tree. Framework resources (`@android:...`), and the
values files the corpus does not contain (`@integer/`, `@dimen/`, `@string/` of Material's
motion tokens), come from the built-in tables in `values.py`.
"""

import os
import re

from . import values
from .xmlutil import ConvertError, parse_file

REF_RE = re.compile(r'^@(?:\+|\*)?(?:(?P<pkg>[a-zA-Z_.]+):)?(?P<type>[a-z]+)/(?P<name>[A-Za-z0-9_.]+)$')
ATTR_RE = re.compile(r'^\?(?:(?P<pkg>[a-zA-Z_.]+):)?(?:attr/)?(?P<name>[A-Za-z0-9_]+)$')

#: types whose files may sit in each other's folders (AAPT is lenient about anim / animator)
TYPE_ALIASES = {
    'anim': ('anim', 'animator', 'interpolator'),
    'animator': ('animator', 'anim', 'interpolator'),
    'interpolator': ('interpolator', 'anim', 'animator'),
    'drawable': ('drawable', 'mipmap'),
    'color': ('color',),
}

_INDEX_CACHE = {}


def find_tree_root(path):
    """The top of the source tree a file belongs to: the nearest ancestor holding a licence
    file or a .git, else the parent of the file's res directory."""
    d = os.path.dirname(os.path.abspath(path))
    for _ in range(14):
        for marker in ('NOTICE', 'LICENSE', 'LICENSE.txt', '.git', 'SOURCES.md'):
            if os.path.exists(os.path.join(d, marker)):
                return d
        parent = os.path.dirname(d)
        if parent == d:
            break
        d = parent
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(path))))


def _qual_rank(quals):
    """Sort key for resource folder qualifiers: on a current device a `-vNN` folder wins over
    the plain one; anything else (night, land, watch, ldrtl, ...) is a configuration we do not
    render, so it comes last."""
    if not quals:
        return (1, 0)
    if all(re.fullmatch(r'v\d+', q) for q in quals):
        return (0, -max(int(q[1:]) for q in quals))
    return (2, len(quals))


class ResourceIndex:
    def __init__(self, root):
        self.root = os.path.abspath(root)
        self.entries = {}          # (type, name) -> [(resdir, quals, path)]
        for dirpath, dirnames, filenames in os.walk(self.root):
            dirnames[:] = [d for d in dirnames if not d.startswith('.')]
            base = os.path.basename(dirpath)
            parts = base.split('-')
            rtype = parts[0]
            if rtype not in ('drawable', 'anim', 'animator', 'interpolator', 'color', 'mipmap', 'xml'):
                continue
            resdir = os.path.dirname(dirpath)
            for fn in filenames:
                if fn.endswith('.xml'):
                    self.entries.setdefault((rtype, fn[:-4]), []).append((resdir, tuple(parts[1:]), os.path.join(dirpath, fn)))

    @classmethod
    def for_root(cls, root):
        root = os.path.abspath(root)
        if root not in _INDEX_CACHE:
            _INDEX_CACHE[root] = cls(root)
        return _INDEX_CACHE[root]

    def find(self, rtype, name, from_path):
        from_res = _res_dir_of(from_path)
        best = None
        for t in TYPE_ALIASES.get(rtype, (rtype,)):
            for resdir, quals, path in self.entries.get((t, name), ()):
                common = len(os.path.commonpath([resdir, from_res])) if from_res else 0
                key = (0 if resdir == from_res else 1, -common, 0 if t == rtype else 1, _qual_rank(quals), path)
                if best is None or key < best[0]:
                    best = (key, path)
        return best[1] if best else None


def _res_dir_of(path):
    if not path:
        return None
    return os.path.dirname(os.path.dirname(os.path.abspath(path)))


class Resources:
    """Resolves references for one conversion and records what it had to guess."""

    def __init__(self, root=None, values_extra=None):
        self.root = root
        self.extra = values_extra or {}     # (type, name) -> value, from --values files
        self.warnings = []
        self.unresolved = []
        self.files = set()          # every XML file read for this conversion

    def index(self, from_path):
        root = self.root or find_tree_root(from_path)
        return ResourceIndex.for_root(root)

    def warn(self, msg):
        if msg not in self.warnings:
            self.warnings.append(msg)

    # ---- file resources -------------------------------------------------------------
    def file(self, ref, from_path, kinds):
        """Path of the XML file `ref` (@type/name) names, or a built-in key ('builtin', ...)."""
        m = REF_RE.match(ref)
        if not m:
            raise ConvertError('bad resource reference %r' % ref)
        pkg, rtype, name = m.group('pkg'), m.group('type'), m.group('name')
        if rtype not in kinds:
            raise ConvertError('expected %s reference, got %r' % ('/'.join(kinds), ref))
        if pkg == 'builtin':
            return ('builtin', rtype, name)
        if pkg == 'android':
            # the framework's own res tree when it is in the corpus (aosp/core/res), else built-in
            path = self.index(from_path).find(rtype, name, from_path)
            if path and '/core/res/res/' not in path:
                path = None
            return path or ('builtin', rtype, name)
        path = self.index(from_path).find(rtype, name, from_path)
        if path is None:
            self.unresolved.append(ref)
            raise ConvertError('unresolved resource %s (not in the source tree)' % ref)
        return path

    def load(self, ref, from_path, kinds):
        """(root element, path) for a file reference; ('builtin', ...) passes through."""
        p = self.file(ref, from_path, kinds)
        if isinstance(p, tuple):
            return p, None
        self.files.add(os.path.abspath(p))
        return parse_file(p), p

    # ---- values -----------------------------------------------------------------------
    def value(self, raw, kind, from_path=None):
        """A scalar attribute value with references resolved: @integer/x, @dimen/x, @string/x,
        @fraction/x, ?attr/x. Returns the literal string."""
        if raw is None:
            return None
        raw = raw.strip()
        if raw.startswith('?'):
            m = ATTR_RE.match(raw)
            name = m.group('name') if m else raw
            v = values.THEME_ATTR_VALUES.get(name)
            if v is None:
                self.unresolved.append(raw)
                raise ConvertError('unresolved theme attribute %s' % raw)
            return v
        m = REF_RE.match(raw)
        if m and m.group('type') in ('integer', 'dimen', 'string', 'fraction', 'bool'):
            key = (m.group('type'), m.group('name'))
            if key in self.extra:
                return self.extra[key]
            table = values.ANDROID_VALUES if m.group('pkg') == 'android' else values.VALUES
            if key in table:
                return table[key]
            if m.group('type') == 'string' and kind == 'name':
                return raw       # names only need to match each other
            self.unresolved.append(raw)
            raise ConvertError('unresolved value %s (no values resources in the corpus)' % raw)
        return raw

    def number(self, raw, default=None, from_path=None):
        if raw is None:
            return default
        v = self.value(raw, 'number', from_path)
        v = re.sub(r'(dp|dip|sp|px|%)$', '', v.strip())
        try:
            return float(v)
        except ValueError:
            raise ConvertError('not a number: %r' % raw)

    def name(self, raw):
        """A target / element name: `@string/x` names match by reference, as AAPT would."""
        if raw is None:
            return None
        try:
            return self.value(raw, 'name')
        except ConvertError:
            return raw
