# Converted animated vector drawables

RemoteCompose versions of the animated vector drawables in `../source/`, converted by
`avd/avd2rc.py` (regenerate everything with `python3 avd/convert_corpus.py`). Each
`x.xml` animated vector became `x.json` (RemoteCompose JSON, what json2rc and the Java
parser read) and `x.rc` (the document, via json2rc); a selector transition becomes
`<selector>__<from>_to_<to>.json`. Open `index.html` for a gallery playing every one in the
TypeScript player.

These files are derived works of the sources listed in [`../SOURCES.md`](../SOURCES.md): they
were modified (converted) by avd2rc and remain under the Apache License 2.0; each source
folder carries its licence / NOTICE file. The licence grants no trademark rights.

| source | converted | not converted |
| :--- | ---: | ---: |
| [AOSP frameworks/base](aosp/index.html) | 140 | 4 |
| [material-components-android](material-components/index.html) | 10 | 25 |
| [AndroidX](androidx/index.html) | 102 | 8 |

Files that are not converted need values the corpus does not contain (Material's
`@string/` path data and `@dimen/` sizes) or are intentionally invalid test inputs; each
gallery lists them with the reason.
