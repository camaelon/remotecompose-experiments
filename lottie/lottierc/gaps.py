"""What the converter does not do, in one place. Each entry names the feature, what the
output shows instead, and the warning the converter prints when it meets it (a `%` in the
key is filled with the item). `lottie2rc.py --list-gaps` prints this list; README.md's
"Not converted" section is generated from it. Missing assets, fonts or matte layers are input
problems, warned about but not listed here."""

GAPS = [
    # (area, feature, what happens, warning key or None)
    ('text', 'text on a path', 'drawn on a straight baseline', 'text on a path (drawn straight)'),
    ('text', 'box text wrapping', 'the box position is applied, lines are not wrapped', 'box text (drawn without wrapping)'),
    ('text', 'selector ease high / low and smoothness', 'ignored', 'text selector ease / smoothness (ignored)'),
    ('text', 'animator skew and per-character stroke colour / width', 'ignored', 'text animator skew / stroke properties (ignored)'),
    ('text', 'a font that is not installed', 'the family\'s regular face, then Helvetica, then Arial', 'font %s not installed, using %s'),
    ('effects', 'effects other than Fill, Tint, Drop Shadow and Gaussian Blur', 'not applied', 'effect type %d'),
    ('effects', 'tint over a gradient fill', 'the gradient is drawn untinted', 'tint effect over a gradient (not applied)'),
    ('effects', 'an animated drop-shadow direction or distance', 'the first keyframe is used', 'animated drop shadow offset (first keyframe used)'),
    ('effects', 'drop-shadow softness without --blur-op', 'a hard shadow', 'drop shadow softness needs --blur-op (hard shadow drawn)'),
    ('effects', 'Gaussian blur without --blur-op', 'not applied', 'Gaussian blur effect needs --blur-op (not applied)'),
    ('gradients', 'a radial gradient highlight without --focal-op', 'drawn concentric', 'radial gradient highlight needs --focal-op (drawn concentric)'),
    ('shapes', 'inward offset paths', 'drawn unoffset (the band would have to exist as a path)', 'inward offset path (drawn unoffset)'),
    ('shapes', 'an offset path under a stroke style', 'the stroke is drawn unoffset', 'offset path under a stroke (stroke drawn unoffset)'),
    ('shapes', 'twist', 'not applied', 'twist'),
    ('shapes', 'merge paths over a nested group', 'the group\'s shapes are not folded into the merge', 'merge paths over a nested group (the group is not merged)'),
    ('shapes', 'a morphing shape whose keyframes have different vertex counts', 'the first keyframe is drawn', 'morphing shape with differing vertex counts'),
    ('shapes', 'an "individually" trim over a morphing shape', 'the first keyframe\'s length sets the shares', 'individual trim over a morphing shape uses the first keyframe length'),
    ('strokes', 'animated dashes', 'the first keyframe is used', 'animated dashes (first keyframe used)'),
    ('masks', 'mask expansion', 'ignored', 'mask expansion'),
    ('masks', 'mask opacity and feather', 'treated as 100 %, not feathered', 'mask opacity (treated as 100%)'),
    ('masks', 'lighten / darken / difference mask modes', 'treated as add', 'mask mode "%s" (treated as add)'),
    ('masks', 'inverted and non-inverted add masks on one layer', 'all treated like the first', 'mixed inverted/non-inverted add masks'),
    ('mattes', 'luma mattes', 'treated as alpha mattes', 'luma mattes (treated as alpha mattes)'),
    ('mattes', 'a precomp matte, or a matte group whose transform animates', 'baked at the first visible frame', 'animated matte (baked at frame %g)'),
    ('layers', 'audio, camera and other non-drawing layer types', 'skipped', 'layer type %s'),
    ('layers', 'blend modes RemoteCompose has no equivalent for', 'normal blending', 'blend mode %s'),
    ('layers', 'expressions (`x` fields)', 'ignored; bodymovin bakes most of them', None),
    ('layers', 'a repeater with an animated count in --sampled mode', 'the count is fixed at its maximum', 'animated repeater count (sampled mode: fixed at %d)'),
    ('assets', 'image formats other than PNG', 'passed through for the player to decode', 'non-PNG image asset (player must decode it)'),
]


def gaps_markdown():
    """The list as markdown bullets, grouped by area, for README.md."""
    out, area = [], None
    for a, feature, effect, _ in GAPS:
        if a != area:
            out.append('- **%s**: %s' % (a, ''))
            area = a
        out[-1] += ('' if out[-1].endswith(': ') else '; ') + '%s (%s)' % (feature, effect)
    return '\n'.join(out)


def gaps_text():
    width = max(len(f) for _, f, _, _ in GAPS)
    return '\n'.join('%-8s %-*s  %s' % (a, width, f, e) for a, f, e, _ in GAPS)
