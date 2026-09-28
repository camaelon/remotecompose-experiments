# lottie2rc validation results

Scores are the lottie-test-files `tools/report` metric: UQI image similarity between the
player render and the After Effects reference PNG, cubed; a UQI above 0.95 counts as 1.0.

| example | frame | cpp uqi | ts uqi | converter warnings |
|:---|---:|---:|---:|:---|
| layers/image-layer | 00 | 1.000 | 1.000 |  |
| layers/image-layer-transform | 00 | 1.000 | 1.000 |  |
| layers/layer-order | 00 | 1.000 | 1.000 |  |
| layers/mask | 00 | 0.986 | 0.995 |  |
| layers/mask-expansion | 00 | 0.842 | 0.847 | mask expansion |
| layers/mask-multiple | 00 | 0.981 | 0.993 |  |
| layers/matte-above | 00 | 0.957 | 0.958 |  |
| layers/matte-below | 00 | 0.954 | 0.957 |  |
| layers/null-parent | 00 | 0.992 | 0.996 |  |
| layers/parent-interleaved | 00 | 0.997 | 0.998 |  |
| layers/precomp | 00 | 1.000 | 1.000 |  |
| layers/precomp-nested | 00 | 0.992 | 0.996 |  |
| layers/precomp-time-start | 00 | 0.998 | 0.999 |  |
| layers/precomp-time-start | 35 | 0.977 | 0.980 |  |
| layers/precomp-time-start | 45 | 0.974 | 0.980 |  |
| layers/precomp-time-start | 60 | 0.980 | 0.983 |  |
| layers/precomp-time-stretch | 00 | 0.992 | 0.993 |  |
| layers/precomp-time-stretch | 05 | 0.984 | 0.988 |  |
| layers/precomp-time-stretch | 15 | 0.978 | 0.984 |  |
| layers/precomp-time-stretch | 30 | 0.986 | 0.989 |  |
| layers/precomp-transform | 00 | 0.993 | 0.996 |  |
| layers/solid-layer | 00 | 1.000 | 1.000 |  |
| layers/time-range | 00 | 1.000 | 1.000 |  |
| layers/time-range | 09 | 1.000 | 1.000 |  |
| layers/time-range | 10 | 0.998 | 0.999 |  |
| layers/time-range | 49 | 0.998 | 0.999 |  |
| layers/time-range | 50 | 1.000 | 1.000 |  |
| properties/bezier-ease | 00 | 0.980 | 0.993 |  |
| properties/bezier-ease | 05 | 0.980 | 0.992 |  |
| properties/bezier-ease | 15 | 0.988 | 0.993 |  |
| properties/bezier-ease | 30 | 0.983 | 0.987 |  |
| properties/bezier-ease | 60 | 0.982 | 0.991 |  |
| properties/bezier-linear | 00 | 0.980 | 0.993 |  |
| properties/bezier-linear | 05 | 0.980 | 0.992 |  |
| properties/bezier-linear | 15 | 0.988 | 0.993 |  |
| properties/bezier-linear | 30 | 0.983 | 0.987 |  |
| properties/bezier-linear | 60 | 0.982 | 0.991 |  |
| properties/color-ease | 00 | 1.000 | 1.000 |  |
| properties/color-ease | 05 | 1.000 | 1.000 |  |
| properties/color-ease | 15 | 1.000 | 1.000 |  |
| properties/color-ease | 60 | 1.000 | 1.000 |  |
| properties/color-linear | 00 | 1.000 | 1.000 |  |
| properties/color-linear | 05 | 1.000 | 1.000 |  |
| properties/color-linear | 15 | 1.000 | 1.000 |  |
| properties/color-linear | 60 | 1.000 | 1.000 |  |
| properties/gradient-ease | 00 | 0.968 | 0.968 |  |
| properties/gradient-ease | 05 | 0.968 | 0.968 |  |
| properties/gradient-ease | 15 | 0.969 | 0.969 |  |
| properties/gradient-ease | 60 | 0.966 | 0.966 |  |
| properties/gradient-linear | 00 | 0.968 | 0.968 |  |
| properties/gradient-linear | 05 | 0.969 | 0.969 |  |
| properties/gradient-linear | 15 | 0.969 | 0.969 |  |
| properties/gradient-linear | 60 | 0.966 | 0.966 |  |
| properties/multidimensional-ease | 00 | 0.992 | 0.995 |  |
| properties/multidimensional-ease | 05 | 0.994 | 0.994 |  |
| properties/multidimensional-ease | 15 | 0.994 | 0.995 |  |
| properties/multidimensional-ease | 60 | 0.994 | 0.996 |  |
| properties/multidimensional-linear | 00 | 0.992 | 0.995 |  |
| properties/multidimensional-linear | 05 | 0.995 | 0.996 |  |
| properties/multidimensional-linear | 15 | 0.990 | 0.995 |  |
| properties/multidimensional-linear | 60 | 0.994 | 0.996 |  |
| properties/position-ease | 00 | 0.999 | 1.000 |  |
| properties/position-ease | 05 | 0.999 | 1.000 |  |
| properties/position-ease | 15 | 0.999 | 0.999 |  |
| properties/position-ease | 60 | 0.999 | 1.000 |  |
| properties/position-hold | 00 | 0.999 | 1.000 |  |
| properties/position-hold | 05 | 0.999 | 1.000 |  |
| properties/position-hold | 15 | 0.999 | 1.000 |  |
| properties/position-hold | 60 | 0.999 | 1.000 |  |
| properties/position-linear | 00 | 0.999 | 1.000 |  |
| properties/position-linear | 05 | 0.998 | 0.999 |  |
| properties/position-linear | 15 | 0.998 | 0.999 |  |
| properties/position-linear | 60 | 0.999 | 1.000 |  |
| properties/position-path-auto-orient | 00 | 0.977 | 0.989 |  |
| properties/position-path-auto-orient | 05 | 0.973 | 0.987 |  |
| properties/position-path-auto-orient | 15 | 0.978 | 0.990 |  |
| properties/position-path-auto-orient | 30 | 0.979 | 0.989 |  |
| properties/position-path-auto-orient | 60 | 0.978 | 0.990 |  |
| properties/position-path-ease | 00 | 0.982 | 0.992 |  |
| properties/position-path-ease | 05 | 0.982 | 0.991 |  |
| properties/position-path-ease | 15 | 0.981 | 0.991 |  |
| properties/position-path-ease | 60 | 0.978 | 0.990 |  |
| properties/position-path-linear | 00 | 0.982 | 0.992 |  |
| properties/position-path-linear | 05 | 0.982 | 0.991 |  |
| properties/position-path-linear | 15 | 0.978 | 0.989 |  |
| properties/position-path-linear | 60 | 0.980 | 0.991 |  |
| properties/scalar-ease | 00 | 0.997 | 0.998 |  |
| properties/scalar-ease | 05 | 0.996 | 0.998 |  |
| properties/scalar-ease | 15 | 0.985 | 0.990 |  |
| properties/scalar-ease | 30 | 0.996 | 0.997 |  |
| properties/scalar-ease | 60 | 0.997 | 0.998 |  |
| properties/scalar-linear | 00 | 0.997 | 0.998 |  |
| properties/scalar-linear | 05 | 0.985 | 0.993 |  |
| properties/scalar-linear | 15 | 0.993 | 0.998 |  |
| properties/scalar-linear | 30 | 0.996 | 0.997 |  |
| properties/scalar-linear | 60 | 0.997 | 0.998 |  |
| shape-modifiers/bloat | 00 | 0.979 | 0.976 |  |
| shape-modifiers/offset-path | 00 | 0.988 | 0.993 |  |
| shape-modifiers/offset-path-round | 00 | 0.987 | 0.992 |  |
| shape-modifiers/pucker | 00 | 0.949 | 0.954 |  |
| shape-modifiers/round-corners | 00 | 0.978 | 0.986 |  |
| shape-modifiers/trim-group | 00 | 0.989 | 0.990 |  |
| shape-modifiers/trim-individually | 00 | 0.979 | 0.983 |  |
| shape-modifiers/trim-simultaneously | 00 | 0.965 | 0.974 |  |
| shape-modifiers/zig-zag | 00 | 0.985 | 0.995 |  |
| shape-modifiers/zig-zag-smooth | 00 | 0.957 | 0.986 |  |
| shape-style/default | 00 | 0.991 | 0.996 |  |
| shape-style/fill | 00 | 1.000 | 1.000 |  |
| shape-style/fill-blend-darken | 00 | 0.990 | 0.995 |  |
| shape-style/fill-opacity | 00 | 1.000 | 1.000 |  |
| shape-style/gradient-linear | 00 | 0.997 | 0.997 |  |
| shape-style/gradient-linear-alpha | 00 | 0.970 | 0.969 |  |
| shape-style/gradient-linear-midpoint | 00 | 0.869 | 0.869 |  |
| shape-style/gradient-radial | 00 | 0.975 | 0.975 |  |
| shape-style/gradient-radial-highlight | 00 | 0.760 | 0.760 | radial gradient highlight needs --focal-op (drawn concentric) |
| shape-style/stroke | 00 | 0.979 | 0.987 |  |
| shape-style/stroke-dash | 00 | 0.974 | 0.986 |  |
| shape-style/stroke-gradient | 00 | 0.983 | 0.986 |  |
| shape-style/winding-evenodd | 00 | 0.961 | 0.966 |  |
| shape-style/winding-nonzero | 00 | 0.971 | 0.975 |  |
| shapes/bezier | 00 | 0.989 | 0.991 |  |
| shapes/bezier-open | 00 | 0.992 | 0.992 |  |
| shapes/ellipse | 00 | 0.996 | 0.997 |  |
| shapes/group-order | 00 | 1.000 | 1.000 |  |
| shapes/polygon | 00 | 0.996 | 0.998 |  |
| shapes/polygon-round | 00 | 0.992 | 0.995 |  |
| shapes/rectangle | 00 | 1.000 | 1.000 |  |
| shapes/rectangle-round | 00 | 0.993 | 0.998 |  |
| shapes/star | 00 | 0.979 | 0.991 |  |
| shapes/star-round | 00 | 0.981 | 0.990 |  |
| transform/anchor | 00 | 0.995 | 0.997 |  |
| transform/group-anchor | 00 | 0.993 | 0.993 |  |
| transform/group-opacity | 00 | 1.000 | 1.000 |  |
| transform/group-position | 00 | 1.000 | 1.000 |  |
| transform/group-rotate | 00 | 0.992 | 0.994 |  |
| transform/group-scale | 00 | 1.000 | 1.000 |  |
| transform/group-skew | 00 | 0.992 | 0.992 |  |
| transform/group-skew-axis | 00 | 0.990 | 0.989 |  |
| transform/identity | 00 | 1.000 | 1.000 |  |
| transform/position | 00 | 1.000 | 1.000 |  |
| transform/position-split | 00 | 1.000 | 1.000 |  |
| transform/rotate | 00 | 0.996 | 0.998 |  |
| transform/scale | 00 | 0.985 | 0.985 |  |

**cpp: 99.0% (143 frames)**  
**ts: 99.1% (143 frames)**  

## By feature

| feature | cpp | ts |
|:---|---:|---:|
| layers/image-layer | 100% | 100% |
| layers/image-layer-transform | 100% | 100% |
| layers/layer-order | 100% | 100% |
| layers/mask | 100% | 100% |
| layers/mask-expansion | 60% | 61% |
| layers/mask-multiple | 100% | 100% |
| layers/matte-above | 100% | 100% |
| layers/matte-below | 100% | 100% |
| layers/null-parent | 100% | 100% |
| layers/parent-interleaved | 100% | 100% |
| layers/precomp | 100% | 100% |
| layers/precomp-nested | 100% | 100% |
| layers/precomp-time-start | 100% | 100% |
| layers/precomp-time-stretch | 100% | 100% |
| layers/precomp-transform | 100% | 100% |
| layers/solid-layer | 100% | 100% |
| layers/time-range | 100% | 100% |
| properties/bezier-ease | 100% | 100% |
| properties/bezier-linear | 100% | 100% |
| properties/color-ease | 100% | 100% |
| properties/color-linear | 100% | 100% |
| properties/gradient-ease | 100% | 100% |
| properties/gradient-linear | 100% | 100% |
| properties/multidimensional-ease | 100% | 100% |
| properties/multidimensional-linear | 100% | 100% |
| properties/position-ease | 100% | 100% |
| properties/position-hold | 100% | 100% |
| properties/position-linear | 100% | 100% |
| properties/position-path-auto-orient | 100% | 100% |
| properties/position-path-ease | 100% | 100% |
| properties/position-path-linear | 100% | 100% |
| properties/scalar-ease | 100% | 100% |
| properties/scalar-linear | 100% | 100% |
| shape-modifiers/bloat | 100% | 100% |
| shape-modifiers/offset-path | 100% | 100% |
| shape-modifiers/offset-path-round | 100% | 100% |
| shape-modifiers/pucker | 85% | 100% |
| shape-modifiers/round-corners | 100% | 100% |
| shape-modifiers/trim-group | 100% | 100% |
| shape-modifiers/trim-individually | 100% | 100% |
| shape-modifiers/trim-simultaneously | 100% | 100% |
| shape-modifiers/zig-zag | 100% | 100% |
| shape-modifiers/zig-zag-smooth | 100% | 100% |
| shape-style/default | 100% | 100% |
| shape-style/fill | 100% | 100% |
| shape-style/fill-blend-darken | 100% | 100% |
| shape-style/fill-opacity | 100% | 100% |
| shape-style/gradient-linear | 100% | 100% |
| shape-style/gradient-linear-alpha | 100% | 100% |
| shape-style/gradient-linear-midpoint | 66% | 66% |
| shape-style/gradient-radial | 100% | 100% |
| shape-style/gradient-radial-highlight | 44% | 44% |
| shape-style/stroke | 100% | 100% |
| shape-style/stroke-dash | 100% | 100% |
| shape-style/stroke-gradient | 100% | 100% |
| shape-style/winding-evenodd | 100% | 100% |
| shape-style/winding-nonzero | 100% | 100% |
| shapes/bezier | 100% | 100% |
| shapes/bezier-open | 100% | 100% |
| shapes/ellipse | 100% | 100% |
| shapes/group-order | 100% | 100% |
| shapes/polygon | 100% | 100% |
| shapes/polygon-round | 100% | 100% |
| shapes/rectangle | 100% | 100% |
| shapes/rectangle-round | 100% | 100% |
| shapes/star | 100% | 100% |
| shapes/star-round | 100% | 100% |
| transform/anchor | 100% | 100% |
| transform/group-anchor | 100% | 100% |
| transform/group-opacity | 100% | 100% |
| transform/group-position | 100% | 100% |
| transform/group-rotate | 100% | 100% |
| transform/group-scale | 100% | 100% |
| transform/group-skew | 100% | 100% |
| transform/group-skew-axis | 100% | 100% |
| transform/identity | 100% | 100% |
| transform/position | 100% | 100% |
| transform/position-split | 100% | 100% |
| transform/rotate | 100% | 100% |
| transform/scale | 100% | 100% |
