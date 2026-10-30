"""avdrc — Android (animated) vector drawables to RemoteCompose JSON.

Modules: xmlutil (XML / aapt:attr), resources + values (reference resolution, built-in
framework and Material values), colors (literals, theme colours), pathdata (path parsing,
normalisation, morph compatibility, even-odd re-orientation), interpolators, animators
(parse + schedule), vector (the <vector> tree), avd (input documents), expr (expression AST,
token limit), emit (the JSON document), convert (CLI), gaps.
"""
from .convert import convert_file, main  # noqa: F401
from .emit import Emitter, Options  # noqa: F401
from .xmlutil import ConvertError  # noqa: F401
