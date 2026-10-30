"""Input documents: <animated-vector>, <vector>, and <animated-selector> transitions."""

import os

from . import animators, vector
from .xmlutil import ConvertError, attr, children, inline, local, parse_file


class Doc:
    """One drawable to convert: a vector and its (target name, animator tree) pairs."""

    def __init__(self, name, vec, targets, path, kind):
        self.name = name
        self.vector = vec
        self.targets = targets
        self.path = path
        self.kind = kind            # 'animated-vector' | 'vector' | 'transition'


def load(path, res):
    """-> [Doc]. A selector gives one Doc per <transition> whose drawable is an AVD."""
    root = parse_file(path)
    res.files.add(os.path.abspath(path))
    tag = local(root.tag)
    base = os.path.splitext(os.path.basename(path))[0]
    if tag == 'vector':
        return [Doc(base, vector.parse_vector(root, res, path), [], path, 'vector')]
    if tag == 'animated-vector':
        return [load_avd(root, path, res, base)]
    if tag == 'animated-selector':
        docs = []
        for tr in children(root, 'transition'):
            a = (attr(tr, 'fromId') or '?').split('/')[-1]
            b = (attr(tr, 'toId') or '?').split('/')[-1]
            name = '%s__%s_to_%s' % (base, a, b)
            ref = attr(tr, 'drawable')
            try:
                if ref is not None:
                    el, p = res.load(ref, path, ('drawable',))
                    if isinstance(el, tuple):
                        raise ConvertError('framework drawable %s' % ref)
                else:
                    kids = children(tr)
                    if not kids:
                        raise ConvertError('transition without drawable')
                    el, p = kids[0], path
                if local(el.tag) != 'animated-vector':
                    res.warn('transition %s is a <%s> (skipped)' % (name, local(el.tag)))
                    continue
                docs.append(load_avd(el, p, res, name, kind='transition'))
            except ConvertError as e:
                res.warn('transition %s: %s' % (name, e))
        if not docs:
            raise ConvertError('animated-selector without convertible AVD transitions')
        return docs
    raise ConvertError('not a vector drawable: <%s>' % tag)


def load_avd(root, path, res, name, kind='animated-vector'):
    ref = attr(root, 'drawable')
    if ref is not None:
        el, vpath = res.load(ref, path, ('drawable',))
        if isinstance(el, tuple):
            raise ConvertError('framework drawable %s' % ref)
    else:
        el, vpath = inline(root, 'drawable'), path
        if el is None:
            raise ConvertError('<animated-vector> without a drawable')
    if local(el.tag) != 'vector':
        raise ConvertError('AVD drawable is a <%s>, not a <vector>' % local(el.tag))
    vec = vector.parse_vector(el, res, vpath)
    loader = animators.Loader(res)
    targets = []
    for t in children(root, 'target'):
        tname = res.name(attr(t, 'name'))
        anim = attr(t, 'animation')
        tree = loader.load(anim if anim is not None else inline(t, 'animation'), path)
        if tree is None:
            raise ConvertError('target %s without animation' % tname)
        targets.append((tname, tree))
    return Doc(name, vec, targets, path, kind)
