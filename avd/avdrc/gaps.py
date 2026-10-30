"""What the converter does not do, in one place (`avd2rc.py --list-gaps`; CONVERT.md lists it
too). Each entry: (area, feature, what the output shows instead)."""

GAPS = [
    ('paint', 'fillType="evenOdd"', 'contours are re-oriented so a non-zero fill matches (the JSON has no fill type); exact unless contours cross each other'),
    ('paint', 'strokeMiterLimit other than 4', 'the player default (4) is used (the JSON paint has no miter limit)'),
    ('paint', 'tintMode other than src_in / src_atop / multiply', 'treated as src_in'),
    ('paint', 'non-uniform scale on strokes', 'the stroke scales with the canvas; VectorDrawable strokes with one isotropic factor'),
    ('paint', 'root alpha over overlapping paths', 'applied per paint, not as one layer (overlaps show through)'),
    ('colour', 'colour animation', 'two layers per transition whose alphas compose to the interpolated colour, with the weight warped towards linear-light interpolation; hue changes such as red to blue stay darker mid-way than Android'),
    ('colour', 'animated gradients, an animated colour over a gradient', 'the static gradient is drawn'),
    ('colour', 'theme attributes and @color/ resources the corpus lacks', 'the library colour of the nearest role (unknown: onSurface), with a warning'),
    ('path', 'pathType morphs between arcs', 'arcs are subdivided alike in every keyframe and the cubics are interpolated (Android interpolates the arc parameters)'),
    ('animation', 'repeatMode="reverse" with an odd repeat count, followed by another animator on the same property', 'the sequence is assumed to end at the last keyframe'),
    ('animation', 'overshooting interpolators in the middle intervals of a multi-keyframe animator', 'clamped to the interval'),
    ('animation', 'animators on properties a node does not have (group alpha, group pathData)', 'ignored, as Android ignores them'),
    ('selector', '<animated-selector> state logic', 'each AVD transition is converted on its own (one document per transition)'),
    ('resources', '@string / @integer / @dimen values the corpus lacks (Material switch, checkbox and password paths), private framework interpolators', 'the file is reported unconverted; pass --values FILE.xml'),
    ('drawable', 'autoMirrored', 'ignored (no layout direction)'),
]


def gaps_text():
    w = max(len(f) for _, f, _ in GAPS)
    return '\n'.join('%-10s %-*s  %s' % (a, w, f, e) for a, f, e in GAPS)


def gaps_markdown():
    return '\n'.join('- **%s** — %s: %s' % (a, f, e) for a, f, e in GAPS)
