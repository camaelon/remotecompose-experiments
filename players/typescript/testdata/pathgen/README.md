# PathGenerator conformance

`src/core/operations/utilities/PathGenerator.ts` is a port of `remote-core`'s
`PathGenerator`, and the point of the port is that it is *bit-identical*, not merely
similar. This directory is the evidence and the way to re-check it.

## Re-running

```bash
# 1. regenerate the reference output (needs the androidx-main3 jars built)
AX=/Users/john/code/androidx-main3/out/androidx/compose/remote
CORE=$(find $AX/remote-core/build/libs -name 'remote-core-*.jar' | grep -v sources | sort | tail -1)
javac -cp "$CORE" PathOracle.java && java -cp "$CORE:." PathOracle > oracle.txt

# 2. diff the TypeScript port against it
npx esbuild ../../src/core/operations/utilities/PathGenerator.ts \
    --bundle --outfile=pg.mjs --format=esm --platform=node
node compare.mjs
```

`PathOracle` prints, for each case, the reference's emitted path as raw float bits **and**
the points it sampled. `compare.mjs` feeds those exact sampled points through the
TypeScript generator, so only the generator is under test — expression evaluation
differences cannot mask or cause a failure.

Coverage: 5 curve shapes × counts {2,3,5,17,128} × loop {false,true} × modes {0,2,4}. The
shapes are chosen for the branches, not for looking like real data: `flat` makes every
delta zero, `absx` puts a sign change and a corner at the origin, `step` drives the
Fritsch–Carlson rescale, `mono` is already monotone, `sinsin` is the demo's own function.

Current result: **100/100 bit-identical, 0 ulp.**

## The 5 skipped cases

`remote-core` throws `ArrayIndexOutOfBoundsException` on small point counts, so those cases
have no reference output to compare against. `Monotonic.asPath` sizes its buffer
`new Path(segs * 10)` where `Spline.asPath` uses `new Path(x.length * 10)`; a 2-point
non-looping path needs 12 floats and gets 10. Counts 2 and 3 fail, 4 and up are fine. It is
a defect in the reference, not in the port — this port grows its buffer on demand and
produces the path.

## MakeDemoGraphs2.java

Generates `ts_broken/path_modes.rc`: the same function, domain and sample count as
`DemoGraphsKt::demoGraphs2`, drawn three times — once per path mode — so one render shows
all three against each other.

`demoGraphs2` itself cannot be run off-device. It reaches the plotting helpers in the demo
app's `XYGraph.kt`, which are extensions on `RemoteComposeContextAndroid` and take
`android.graphics` types (`Painter.setShader` wants a `Shader.TileMode`), so the chain needs
Android at both compile and run time. `addPathExpression` — the operation that actually
stresses the spline engine — is on the JVM-safe writer, so that is what this reproduces.
