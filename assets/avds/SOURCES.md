# Animated vector drawables: sources and licenses

Each folder under `source/` holds every `<animated-vector>` (and `<animated-selector>` built from them) found in
the source below, plus everything they reference (vectors, animators, interpolators), at its
original path in that repository. Collected 2026-10-30 with a sparse clone (resource XML only).

| Folder | Source | Commit | License |
| :--- | :--- | :--- | :--- |
| `source/aosp/` | https://android.googlesource.com/platform/frameworks/base (`core/res/res`, `packages/SystemUI/res`, `packages/SettingsLib`) | 1cdfff555f4a21f71ccc978290e2e212e2f8b168 (2025-03-26) | Apache License 2.0 (see `source/aosp/NOTICE`) |
| `source/material-components/` | https://github.com/material-components/material-components-android | 66b0eeb53afeb6025ffbbd37734b08e5bce197ed (2026-10-16) | Apache License 2.0 (`source/material-components/LICENSE`) |
| `source/androidx/` | https://github.com/androidx/androidx | 74730ead1f12670f0c1077205910e3f3804f96f8 (2026-10-30) | Apache License 2.0 (`source/androidx/LICENSE.txt`) |

Redistributing these files, or what avd2rc converts them into, requires keeping the license
text and NOTICE, and stating that the files were modified (converted). The license grants no
trademark rights.

Counts: aosp 112 animated vectors (274 files with dependencies), material-components 24 (58),
androidx 86 (237).
