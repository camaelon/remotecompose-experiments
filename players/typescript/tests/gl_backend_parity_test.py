#!/usr/bin/env python3
"""Does the GL backend (modes 6/7) draw what the software backend draws?

Two things have to hold, and only one of them is about pixels.

The GPU path must actually run. An unimplemented backend falls back to software by design,
and a fallback produces a *correct image* — so comparing pictures cannot tell "the GL backend
works" from "the GL backend is missing and nobody noticed". The player publishes
`__rcGlModelDraws` for exactly this reason, and this test fails if it is zero.

The pixels must then agree. Not bit-exactly: the software-vs-Java test demands that and is
right to, because both are the same algorithm in two languages. Here they are two different
rasterizers, and four differences are structural rather than bugs — see GL_DIVERGENCES in
WebGL3DRenderer.ts. Rounding moves whole faces by one 8-bit level; the GPU antialiases and
the software path does not; the two disagree about pixels whose centre sits on an edge; and
the near plane clips rather than rejects. So the bar is: the *interiors* agree closely and
the disagreement is confined to a thin boundary.

Build the two documents first — same geometry, same camera, differing only in the mode byte
of each drawMesh3D (software-smooth = 1 vs gl-smooth = 7):

    # in the rcJson corpus
    python3 tools/rcdev.py build /tmp/gl_parity_sw.json /tmp/gl_parity_gl.json
    cp render/gl_parity_{sw,gl}.rc /tmp/

and the bundle:

    npx esbuild src/web/main.ts --bundle --outfile=/tmp/rcbundle.js \
        --format=iife --target=es2020 --global-name=RC

Run with --broken=fallback to strip the GL dispatch, so every mesh silently falls back to
software. Measured: the two images come out **bit-identical** — 0 differing pixels, worst
difference 0 — and the run fails only on the draw counter. That is the argument for the
counter, demonstrated rather than asserted: a pure image comparison reports a flawless pass
on a backend that never ran. Run with --broken=shade to leave the dispatch alone and corrupt
the shader's ambient term, so the GL path runs and the pixels are wrong (18% differing,
interior off by 82). Both must fail or this test is not measuring what it claims to.

Keep the document SMALL. It was first written against a 212-mesh crane, which took the
headless software GL renderer past 400 s for no extra coverage; one torus exercises the same
pipeline and the whole run takes about a second.
"""

import base64
import pathlib
import re
import subprocess
import sys

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
# The generated page embeds the whole ~1MB bundle, so it goes to a scratch dir rather
# than next to this file — leak.html is checked in at 27k lines for want of this.
SCRATCH = pathlib.Path("/tmp")
BUNDLE = pathlib.Path("/tmp/rcbundle.js")
RC_SW = pathlib.Path("/tmp/gl_parity_sw.rc")
RC_GL = pathlib.Path("/tmp/gl_parity_gl.rc")
SIZE = 400

# A channel difference at or below this is the rounding described above, not a disagreement.
LEVEL_TOLERANCE = 8
# Pixels allowed to exceed it, as a fraction of the pixels either backend painted. Edges are
# the whole budget: a 400x400 render of this scene has roughly 3% of its painted pixels on a
# silhouette or a crease.
MAX_DIFFERING = 0.06
# No interior pixel may be wrong by more than this. "Interior" cannot mean "opaque": this
# document paints a full-canvas background, so every pixel is opaque and the silhouette ends
# up inside the metric it was supposed to be excluded from. It means "not near an edge" —
# a pixel whose 3x3 neighbourhood in the software image is flat. A shading bug shifts whole
# faces and has no local gradient, so it lands squarely in here; edge coverage and
# antialiasing have a large local gradient and are excluded, which is the point.
MAX_INTERIOR_DELTA = 24
EDGE_GRADIENT = 16


def broken_mode() -> str:
    for a in sys.argv[1:]:
        if a.startswith("--broken"):
            return a.split("=", 1)[1] if "=" in a else "fallback"
    return ""


def patch(bundle: str, mode: str) -> str:
    if mode == "fallback":
        # Remove the GL dispatch so modes 6/7 fall through to software, the state this whole
        # change is meant to move away from.
        # The bundler keeps the imported constant by name rather than inlining its value,
        # so match the name. Matching `=== 3` found nothing and the broken run exited on the
        # patch instead of on the assertion — which still looked like a non-zero exit.
        out, n = re.subn(r"if \(!wire && backend === MODE_BACKEND_GL\) \{",
                         "if (false) {", bundle, count=1)
        if n != 1:
            sys.exit(f"could not strip the GL dispatch (matched {n})")
        return out
    if mode == "shade":
        # Same dispatch, wrong shader: the GPU path runs and the picture is wrong.
        out, n = re.subn(r"const float AMBIENT = 0\.2;", "const float AMBIENT = 0.5;",
                         bundle, count=1)
        if n != 1:
            sys.exit(f"could not corrupt the shader (matched {n})")
        return out
    sys.exit(f"unknown --broken mode {mode!r} (expected fallback or shade)")


def main() -> int:
    mode = broken_mode()
    for p in (BUNDLE, RC_SW, RC_GL):
        if not p.exists():
            sys.exit(f"missing {p} — see the docstring for how to build it")
    bundle = BUNDLE.read_text()
    if mode:
        bundle = patch(bundle, mode)

    page = SCRATCH / "gl_parity.html"
    page.write_text(f"""<!doctype html>
<meta charset="utf-8">
<body><div id="result">RUNNING</div>
<script>{bundle}</script>
<script>
const DOCS = {{
  sw: "{base64.b64encode(RC_SW.read_bytes()).decode()}",
  gl: "{base64.b64encode(RC_GL.read_bytes()).decode()}"
}};
function bytes(b64) {{
  const s = atob(b64), a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a.buffer;
}}
async function render(b64) {{
  const host = document.createElement('div');
  document.body.appendChild(host);
  const h = RC.createPlayer(host, {{ width: {SIZE}, height: {SIZE} }});
  await h.loadFromArrayBuffer(bytes(b64));
  h.player.repaint();
  await new Promise(r => setTimeout(r, 120));
  h.player.repaint();
  await new Promise(r => setTimeout(r, 120));
  const cv = host.querySelector('canvas');
  const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  return {{ px, w: cv.width, h: cv.height, url: cv.toDataURL('image/png') }};
}}
(async () => {{
  try {{
    globalThis.__rcGlModelDraws = 0;
    const a = await render(DOCS.sw);
    const afterSw = globalThis.__rcGlModelDraws | 0;
    const b = await render(DOCS.gl);
    const afterGl = globalThis.__rcGlModelDraws | 0;

    const W = a.w, H = a.h;
    const diff = new Int32Array(W * H);
    let painted = 0, differing = 0, maxDelta = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {{
      const i = (y * W + x) * 4;
      if (a.px[i + 3] === 0 && b.px[i + 3] === 0) continue;
      painted++;
      let d = 0;
      for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs(a.px[i + k] - b.px[i + k]));
      diff[y * W + x] = d;
      if (d > maxDelta) maxDelta = d;
      if (d > {LEVEL_TOLERANCE}) differing++;
    }}
    // Local gradient of the SOFTWARE image, used to mask out edges.
    let bothOpaque = 0, maxInterior = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {{
      let g = 0;
      const c = (y * W + x) * 4;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {{
        const n = ((y + dy) * W + (x + dx)) * 4;
        for (let k = 0; k < 4; k++) g = Math.max(g, Math.abs(a.px[c + k] - a.px[n + k]));
      }}
      if (g > {EDGE_GRADIENT}) continue;       // on an edge: excluded by design
      bothOpaque++;
      const d = diff[y * W + x];
      if (d > maxInterior) maxInterior = d;
    }}
    globalThis.__pngSw = a.url; globalThis.__pngGl = b.url;
    document.getElementById('result').textContent =
      `RESULT size=${{a.w}}x${{a.h}} painted=${{painted}} differing=${{differing}} ` +
      `maxDelta=${{maxDelta}} interior=${{bothOpaque}} maxInterior=${{maxInterior}} ` +
      `drawsAfterSw=${{afterSw}} drawsAfterGl=${{afterGl}}`;
    if (location.search.indexOf('png') >= 0) {{
      const d = document.createElement('div');
      d.id = 'png';
      d.textContent = 'PNGSW ' + a.url + ' PNGGL ' + b.url;
      document.body.appendChild(d);
    }}
  }} catch (e) {{
    document.getElementById('result').textContent = 'ERROR ' + (e && e.message);
  }}
}})();
</script>
""")

    out = subprocess.run(
        [CHROME, "--headless=new", "--enable-unsafe-swiftshader",
         "--virtual-time-budget=90000", "--dump-dom", f"file://{page}"],
        capture_output=True, text=True, timeout=400,
    ).stdout

    label = f"BROKEN ({mode})" if mode else "GL backend"
    m = re.search(r"RESULT size=(\d+)x(\d+) painted=(\d+) differing=(\d+) maxDelta=(\d+) "
                  r"interior=(\d+) maxInterior=(\d+) drawsAfterSw=(\d+) drawsAfterGl=(\d+)", out)
    if not m:
        err = re.search(r"ERROR [^<]*", out)
        print(f"  {label}: no result in DOM\n   {err.group(0) if err else out[:300]}")
        return 2
    w, h, painted, differing, max_delta, interior, max_interior, after_sw, after_gl = map(
        int, m.groups())

    frac = differing / painted if painted else 1.0
    print(f"  {label}  {w}x{h}")
    print(f"    pixels painted by either backend   : {painted}")
    print(f"    GPU draws after the software doc   : {after_sw}   (must be 0)")
    print(f"    GPU draws after the GL doc         : {after_gl}   (must be > 0)")
    print(f"    differing by more than {LEVEL_TOLERANCE:<2} levels    : {differing} "
          f"({frac * 100:.2f}%, allowed {MAX_DIFFERING * 100:.0f}%)")
    print(f"    worst difference anywhere          : {max_delta}")
    print(f"    pixels away from any edge          : {interior}")
    print(f"    worst difference in the interior   : {max_interior} "
          f"(allowed {MAX_INTERIOR_DELTA})")

    fails = []
    if painted == 0:
        fails.append("nothing was drawn")
    if after_sw != 0:
        fails.append("the software document took the GPU path")
    if after_gl <= 0:
        fails.append("the GL document never reached the GPU path (silent fallback)")
    if frac > MAX_DIFFERING:
        fails.append(f"too many differing pixels ({frac * 100:.2f}%)")
    if max_interior > MAX_INTERIOR_DELTA:
        fails.append(f"interior shading differs by {max_interior}")

    print(f"    => {'PASS' if not fails else 'FAIL: ' + '; '.join(fails)}")
    ok = not fails
    # A --broken run must fail. If it passes, the test is not measuring what it claims.
    return 0 if ok != bool(mode) else 1


if __name__ == "__main__":
    sys.exit(main())
