#!/usr/bin/env python3
"""Save what each 3D backend actually drew, side by side.

The parity test reports numbers; this writes the two images so they can be looked at. A
backend that drew nothing at all still scores well on a document whose background covers the
canvas, so at least once somebody has to see the picture.

    python3 tests/gl_backend_shot.py            # -> /tmp/gl_sw.png, /tmp/gl_gl.png
"""

import base64
import pathlib
import re
import subprocess
import sys

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SCRATCH = pathlib.Path("/tmp")
BUNDLE = pathlib.Path("/tmp/rcbundle.js")
DOCS = {"sw": pathlib.Path("/tmp/gl_parity_sw.rc"), "gl": pathlib.Path("/tmp/gl_parity_gl.rc")}
SIZE = 400

for p in [BUNDLE, *DOCS.values()]:
    if not p.exists():
        sys.exit(f"missing {p} — see gl_backend_parity_test.py for how to build it")

page = SCRATCH / "gl_shot.html"
page.write_text(f"""<!doctype html>
<meta charset="utf-8">
<body><div id="result">RUNNING</div>
<script>{BUNDLE.read_text()}</script>
<script>
const DOCS = {{
  sw: "{base64.b64encode(DOCS['sw'].read_bytes()).decode()}",
  gl: "{base64.b64encode(DOCS['gl'].read_bytes()).decode()}"
}};
function bytes(b64) {{
  const s = atob(b64), a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a.buffer;
}}
async function shot(b64) {{
  const host = document.createElement('div');
  document.body.appendChild(host);
  const h = RC.createPlayer(host, {{ width: {SIZE}, height: {SIZE} }});
  await h.loadFromArrayBuffer(bytes(b64));
  h.player.repaint();
  await new Promise(r => setTimeout(r, 150));
  h.player.repaint();
  await new Promise(r => setTimeout(r, 150));
  return host.querySelector('canvas').toDataURL('image/png');
}}
(async () => {{
  try {{
    const sw = await shot(DOCS.sw);
    const gl = await shot(DOCS.gl);
    const d = document.createElement('div');
    d.id = 'png';
    d.textContent = 'SW:' + sw + '\\nGL:' + gl;
    document.body.appendChild(d);
    document.getElementById('result').textContent = 'RESULT ok draws=' +
      (globalThis.__rcGlModelDraws | 0);
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

n = 0
for tag, name in (("SW", "/tmp/gl_sw.png"), ("GL", "/tmp/gl_gl.png")):
    m = re.search(rf"{tag}:data:image/png;base64,([A-Za-z0-9+/=]+)", out)
    if not m:
        print(f"  no {tag} image in the DOM")
        continue
    pathlib.Path(name).write_bytes(base64.b64decode(m.group(1)))
    print(f"  wrote {name}")
    n += 1
draws = re.search(r"draws=(\d+)", out)
print(f"  GPU draws: {draws.group(1) if draws else '?'}")
sys.exit(0 if n == 2 else 1)
