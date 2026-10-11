#!/usr/bin/env python3
"""Does RcPlayerHandle.destroy() release the WebGL context?

A browser allows only ~16 live WebGL contexts and silently kills the oldest beyond that -
measured here at 300 created, 284 already lost. A gallery that creates a player per card and
discards it therefore blanks its earliest documents unless each one hands its context back.

`RcdPlayer.destroy()` does hand it back: it reaches CanvasPaintContext.destroy() ->
WebGLShaderRenderer.destroy() -> WEBGL_lose_context.loseContext(). `stop()` does not.

Testing this by counting blank canvases does NOT work: dropping the canvas lets GC reclaim the
context anyway, so the leaky version also passes. The observable, deterministic difference is
whether the shader renderer has been released at the moment destroy() returns - so that is what
is asserted, holding every handle alive so GC cannot mask the result either way.

Run with --broken to patch the bundle back to `player.stop()`. The test must fail there.
"""

import base64
import re
import subprocess
import sys
import pathlib

N = 24
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SCRATCH = pathlib.Path(__file__).parent
# Build with:
#   npx esbuild src/web/main.ts --bundle --outfile=/tmp/rcbundle.js \
#       --format=iife --target=es2020 --global-name=RC
BUNDLE = pathlib.Path("/tmp/rcbundle.js")
# Any .rc that actually contains a shader. rcJson/render/shader_aurora.rc works; note that
# recompiling the rc-corpus shader JSON with rcj does NOT - rcj lacks drawTextRun, so the
# shader is silently dropped and the document renders blank, which looks like a player bug.
RC = pathlib.Path("/tmp/shader_test.rc")

broken = "--broken" in sys.argv
bundle = BUNDLE.read_text()
if broken:
    bundle, n = re.subn(r"(destroy\(\) \{\s*)player\.destroy\(\);", r"\1player.stop();",
                        bundle, count=1)
    if n != 1:
        sys.exit(f"could not patch bundle for the control run (matched {n})")

page = SCRATCH / "leak.html"
page.write_text(f"""<!doctype html>
<meta charset="utf-8">
<body><div id="result">RUNNING</div>
<script>{bundle}</script>
<script>
const B64 = "{base64.b64encode(RC.read_bytes()).decode()}";
function bytes() {{
  const s = atob(B64), a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a.buffer;
}}
(async () => {{
  const kept = [];                 // hold everything: GC must not influence the result
  let drew = 0, released = 0, stillHeld = 0;
  for (let i = 0; i < {N}; i++) {{
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = RC.createPlayer(host, {{ width: 128, height: 128 }});
    kept.push(h);
    await h.loadFromArrayBuffer(bytes());
    h.player.repaint();
    await new Promise(r => setTimeout(r, 40));    // shader compile needs a beat
    h.player.repaint();

    // Confirm this document actually exercised WebGL, else the test proves nothing.
    const pc = h.player.paintContext;
    if (pc && pc.shaderRenderer) drew++;

    h.destroy();

    const after = h.player.paintContext;
    if (!after || after.shaderRenderer == null) released++;
    else stillHeld++;
  }}
  document.getElementById('result').textContent =
    `RESULT usedGL=${{drew}} released=${{released}} stillHeld=${{stillHeld}} of {N}`;
}})();
</script>
""")

out = subprocess.run(
    [CHROME, "--headless=new", "--enable-unsafe-swiftshader",
     "--virtual-time-budget=90000", "--dump-dom", f"file://{page}"],
    capture_output=True, text=True, timeout=400,
).stdout

m = re.search(r"RESULT usedGL=(\d+) released=(\d+) stillHeld=(\d+)", out)
label = "CONTROL (destroy -> stop, old behaviour)" if broken else "FIXED (destroy -> destroy)"
if not m:
    print(f"  {label}: no result in DOM\n   {out[:300]}")
    sys.exit(2)
used, released, held = map(int, m.groups())
print(f"  {label}")
print(f"    documents that took a WebGL context : {used}/{N}")
print(f"    context released by destroy()       : {released}/{N}")
print(f"    context still held after destroy()  : {held}/{N}")
if used == 0:
    print("    INVALID: no document used WebGL, the test measured nothing")
    sys.exit(2)
sys.exit(0 if held == 0 else 1)
