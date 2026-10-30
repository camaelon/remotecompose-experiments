# Converted icons

RemoteCompose versions of the icon sets in [`../source/`](../SOURCES.md).

| folder | source | icons | documents | source XML | JSON | .rc |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `material-symbols/` | Material Symbols, Android vector drawables, 24 px ([SOURCES.md](../SOURCES.md)) | 4,157 | 24,942 | 25,276,974 B | 63,787,495 B | 35,876,037 B |

Each `<name>/materialsymbols<style>/<name>[_fill1]_24px.xml` was converted by
`avd/avd2rc.py` (regenerate with `python3 avd/convert_icons.py`; it is incremental) into
`<same path>.json` (RemoteCompose JSON, what json2rc and the Java parser read) and `.rc`
(the document, via json2rc). `material-symbols/catalog.json` lists every icon (styles, filled
variants, categories, tags, popularity, files and `.rc` sizes); icons Google's metadata does not
list get tags from their name (`tagsDerived`). Open [`index.html`](index.html) for a searchable
gallery rendered by the TypeScript player (it works from `file://`).

A converted icon is a 24 × 24 dp document with one canvas that fills its component, scaled from
the 960-unit viewport, and one path (an op list in `resources.paths`) filled with one themed
colour, `@colors.onSurface` (light / dark values in `resources.colors`): the drawables' own tint,
`?attr/colorControlNormal` over white fills, became that single colour so a host can recolour
the icon by replacing it.

## License

These files are derived works of Material Symbols by Google: they were modified (converted to
RemoteCompose) by avd2rc and remain under the Apache License 2.0 —
[`LICENSE`](LICENSE) (also in `material-symbols/`). The license grants no trademark rights.

## In git

Only `catalog.json`, this README, `LICENSE` and the gallery page (`index.html`) are
committed. The per-icon `.json`/`.rc` files and the gallery's data chunks (`gallery/`) are
regenerated from `../source/` with `python3 avd/convert_icons.py` (incremental, about 10 s from
scratch); `mcp/deploy/setup.sh` runs it on every deploy.
