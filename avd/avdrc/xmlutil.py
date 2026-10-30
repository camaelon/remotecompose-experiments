"""XML helpers: namespaced attributes and `aapt:attr` inline resources."""

import xml.etree.ElementTree as ET

ANDROID = 'http://schemas.android.com/apk/res/android'
AAPT = 'http://schemas.android.com/aapt'
APP = 'http://schemas.android.com/apk/res-auto'


class ConvertError(Exception):
    """The input cannot be converted (invalid, or depends on something we cannot resolve)."""


def local(tag):
    return tag.split('}')[-1] if isinstance(tag, str) else ''


def parse_file(path):
    try:
        return ET.parse(path).getroot()
    except ET.ParseError as e:
        raise ConvertError('XML parse error in %s: %s' % (path, e))


def attr(el, name, default=None):
    """android:NAME (or app:NAME / bare NAME) as a string, else `default`."""
    for key in ('{%s}%s' % (ANDROID, name), '{%s}%s' % (APP, name), name):
        v = el.get(key)
        if v is not None:
            return v.strip()
    return default


def inline(el, name):
    """The element given inline as <aapt:attr name="android:NAME"><x/></aapt:attr>, or None."""
    for child in el:
        if local(child.tag) == 'attr' and child.tag.startswith('{%s}' % AAPT):
            n = child.get('name', '')
            if n.split(':')[-1] == name:
                for sub in child:
                    if isinstance(sub.tag, str):
                        return sub
    return None


def children(el, *names):
    """Element children, skipping aapt:attr wrappers and comments; filtered by local name."""
    out = []
    for c in el:
        if not isinstance(c.tag, str):
            continue
        if c.tag.startswith('{%s}' % AAPT):
            continue
        if names and local(c.tag) not in names:
            continue
        out.append(c)
    return out
