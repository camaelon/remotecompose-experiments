"""Colours: literals, `@color/` resources and theme attributes.

A colour is either a literal ARGB or a theme colour of the component library
(examples/components/theme/default.json) with an alpha. Theme colours are written to the
document as named themed colours (`{"light": ..., "dark": ...}` in resources.colors) so the
result follows the light / dark / mono themes like every library component.
"""

import re

from .xmlutil import ConvertError, attr, children, local

#: the library palette (examples/components/theme/default.json), light and dark
THEME = {
    'background': ('#FFF5F7FA', '#FF101828'),
    'surface': ('#FFFFFFFF', '#FF1C2433'),
    'surfaceHigh': ('#FFE8ECF2', '#FF263042'),
    'onSurface': ('#FF111827', '#FFE6EAF2'),
    'muted': ('#FF5A6475', '#FF8A94A6'),
    'outline': ('#FF878F9E', '#FF3A4556'),
    'track': ('#FFB0B8C4', '#FF2A3342'),
    'primary': ('#FF1565D8', '#FF4DA3FF'),
    'onPrimary': ('#FFFFFFFF', '#FFFFFFFF'),
    'secondary': ('#FF6B3FD9', '#FF7C4DFF'),
    'success': ('#FF2E7D32', '#FF66BB6A'),
    'warning': ('#FFA15C00', '#FFFFB74D'),
    'error': ('#FFC62828', '#FFEF5350'),
    'disabled': ('#FFE3E7ED', '#FF3A4556'),
    'onDisabled': ('#FF7D8696', '#FF8A94A6'),
}

#: Android / AppCompat / Material theme attributes -> library colour
THEME_ATTRS = {
    'colorControlNormal': 'muted',
    'colorControlActivated': 'primary',
    'colorControlHighlight': 'track',
    'colorAccent': 'primary',
    'colorPrimary': 'primary',
    'colorPrimaryDark': 'primary',
    'colorPrimaryVariant': 'primary',
    'colorAccentPrimary': 'primary',
    'colorAccentPrimaryVariant': 'primary',
    'colorOnPrimary': 'onPrimary',
    'colorPrimaryContainer': 'surfaceHigh',
    'colorOnPrimaryContainer': 'primary',
    'colorSecondary': 'secondary',
    'colorOnSecondary': 'onPrimary',
    'colorTertiary': 'secondary',
    'colorSurface': 'surface',
    'colorSurfaceVariant': 'surfaceHigh',
    'colorSurfaceContainer': 'surfaceHigh',
    'colorSurfaceContainerHighest': 'surfaceHigh',
    'colorOnSurface': 'onSurface',
    'colorOnSurfaceVariant': 'muted',
    'colorOnBackground': 'onSurface',
    'colorBackground': 'background',
    'colorForeground': 'onSurface',
    'textColorPrimary': 'onSurface',
    'textColorSecondary': 'muted',
    'textColorTertiary': 'muted',
    'colorOutline': 'outline',
    'colorOutlineVariant': 'outline',
    'colorError': 'error',
    'colorOnError': 'onPrimary',
    'colorSwitchThumbNormal': 'surfaceHigh',
    'colorButtonNormal': 'surfaceHigh',
}

ANDROID_COLORS = {
    'white': 0xFFFFFFFF, 'black': 0xFF000000, 'transparent': 0x00000000,
    'darker_gray': 0xFFAAAAAA, 'background_dark': 0xFF000000, 'background_light': 0xFFFFFFFF,
}


class Color:
    """A literal ARGB (`theme` None) or a theme colour name with an alpha (0..1)."""
    __slots__ = ('argb', 'theme')

    def __init__(self, argb=0xFF000000, theme=None):
        self.argb = argb & 0xFFFFFFFF
        self.theme = theme

    @classmethod
    def themed(cls, name, alpha=1.0):
        return cls((int(round(alpha * 255)) & 0xFF) << 24, name)

    @property
    def alpha(self):
        return ((self.argb >> 24) & 0xFF) / 255.0

    def with_alpha(self, a):
        return Color((int(round(max(0.0, min(1.0, a)) * 255)) << 24) | (self.argb & 0xFFFFFF), self.theme)

    def rgb(self, dark=True):
        """(r, g, b) 0..255 — for a theme colour, the light or dark value."""
        argb = self.argb
        if self.theme:
            argb = parse_hex(THEME[self.theme][1 if dark else 0])
        return ((argb >> 16) & 0xFF, (argb >> 8) & 0xFF, argb & 0xFF)

    def opaque_hex(self):
        return '#FF%06X' % (self.argb & 0xFFFFFF)

    def __eq__(self, other):
        return isinstance(other, Color) and other.argb == self.argb and other.theme == self.theme

    def __hash__(self):
        return hash((self.argb, self.theme))

    def __repr__(self):
        return 'Color(%s%08X)' % (self.theme + ' ' if self.theme else '', self.argb)


def parse_hex(s):
    s = s.strip()
    if not re.fullmatch(r'#[0-9A-Fa-f]{3,8}', s) or len(s) not in (4, 5, 7, 9):
        raise ConvertError('bad colour %r' % s)
    h = s[1:]
    if len(h) in (3, 4):
        h = ''.join(c * 2 for c in h)
    if len(h) == 6:
        h = 'FF' + h
    return int(h, 16)


def parse_color(raw, res, from_path):
    """A colour attribute value -> Color. Unknown theme attributes and colours that are not in
    the corpus become onSurface, with a warning."""
    if raw is None:
        return None
    raw = raw.strip()
    if raw.startswith('#'):
        return Color(parse_hex(raw))
    if raw.startswith('?'):
        m = re.match(r'^\?(?:([a-zA-Z_.]+):)?(?:attr/)?([A-Za-z0-9_]+)$', raw)
        name = m.group(2) if m else raw
        if name in THEME_ATTRS:
            return Color.themed(THEME_ATTRS[name])
        res.warn('theme attribute %s (drawn in onSurface)' % raw)
        res.unknown_colors = getattr(res, 'unknown_colors', []) + [raw]
        return Color.themed('onSurface')
    m = re.match(r'^@(?:([a-zA-Z_.]+):)?color/([A-Za-z0-9_.]+)$', raw)
    if m:
        pkg, name = m.group(1), m.group(2)
        if pkg == 'android':
            if name in ANDROID_COLORS:
                return Color(ANDROID_COLORS[name])
        else:
            if name in ('white', 'black', 'transparent'):
                path = None
            else:
                path = res.index(from_path).find('color', name, from_path)
            if path is None and name in ANDROID_COLORS:
                return Color(ANDROID_COLORS[name])
            if path is not None:
                from .xmlutil import parse_file
                return color_state_list(parse_file(path), res, path)
        res.warn('colour %s not in the corpus (drawn in onSurface)' % raw)
        res.unknown_colors = getattr(res, 'unknown_colors', []) + [raw]
        return Color.themed('onSurface')
    raise ConvertError('bad colour value %r' % raw)


def color_state_list(root, res, path):
    """<selector> colour state list -> its default colour (the first item without states)."""
    if local(root.tag) != 'selector':
        raise ConvertError('%s is not a colour state list' % path)
    items = children(root, 'item')
    chosen = None
    for it in items:
        if not any(k.split('}')[-1].startswith('state_') for k in it.keys()):
            chosen = it
            break
    if chosen is None and items:
        chosen = items[0]
    if chosen is None:
        raise ConvertError('empty colour state list %s' % path)
    c = parse_color(attr(chosen, 'color'), res, path)
    a = attr(chosen, 'alpha')
    if a is not None:
        c = c.with_alpha(c.alpha * res.number(a))
    return c
