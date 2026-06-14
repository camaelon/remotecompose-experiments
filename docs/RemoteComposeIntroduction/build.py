#!/usr/bin/env python3
"""Build the self-contained RemoteCompose introduction page.

Inlines the minified TypeScript player bundle and a curated set of
example .rc documents (base64) into a single index.html.

Usage:
    python3 build.py
"""

import base64
import os
import subprocess
import sys
import textwrap

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT  = os.path.abspath(os.path.join(SCRIPT_DIR, "..", ".."))
OUT_PATH   = os.path.join(SCRIPT_DIR, "index.html")
TS_DIR     = os.path.join(REPO_ROOT, "players", "typescript")

# Sources — these live in the upstream sandbox, not yet imported here.
ORIGAMI = "/Users/john/code/github/Origami"

# (id, title, rc_path, width, height, blurb)
EXAMPLES = [
    ("primitives",
     "Drawing primitives",
     f"{ORIGAMI}/Final/john/includes/canvas_primitives.rc",
     400, 400,
     "Rectangles, rounded rectangles, circles, arcs, paths, gradients "
     "and anchored text — the core canvas vocabulary in one document."),

    ("pie",
     "Pie chart",
     f"{ORIGAMI}/advanced_samples/pie_chart.rc",
     400, 400,
     "A chart built from sectors, anchored labels, and a centred title. "
     "All values are computed at paint time from the document's data, "
     "not baked at authoring."),

    ("advanced",
     "Advanced operators",
     f"{ORIGAMI}/Final/john/includes/canvas_advanced.rc",
     400, 400,
     "Stunning effects via shaders, particles, anchored text and other "
     "advanced operators — the runtime transpiles AGSL to whatever the "
     "backend speaks (Skia / WebGL / native)."),

    ("clock",
     "Analog clock",
     f"{ORIGAMI}/advanced_samples/fancy_clock2.rc",
     400, 400,
     "Hour, minute, and second hands driven by the document's expression "
     "engine reading system time variables.  No JavaScript on the page "
     "side — the document itself is doing the math every frame."),

    ("regression",
     "Linear regression",
     f"{ORIGAMI}/advanced_samples/linear_regression.rc",
     400, 400,
     "Live least-squares fit through a draggable scatter — the slope, "
     "intercept and residual error are all expression-evaluator outputs "
     "recomputed every frame as the points move."),

    ("balls",
     "Particle system",
     f"{ORIGAMI}/advanced_samples/balls_animation_example.rc",
     400, 400,
     "Hundreds of particles emitted from a source, each updated by an "
     "RPN expression every frame: position += velocity, "
     "velocity += gravity.  Document fits in 4.5 KB."),

    ("pendulum",
     "Double pendulum",
     f"{ORIGAMI}/advanced_samples/double_pendulum_example.rc",
     400, 400,
     "Coupled-ODE dynamics of a chaotic double pendulum, computed by "
     "the engine's expression evaluator.  The trail is a path that "
     "appends a vertex per frame."),

    ("cube",
     "3D rendering",
     f"{ORIGAMI}/advanced_samples/cube3d.rc",
     400, 400,
     "Eight vertices, six faces, projected onto the canvas via "
     "matrix-expression operations the engine exposes natively.  "
     "Back-face culling is a 2D cross-product check."),

    ("rpn",
     "Live expression tree",
     f"{ORIGAMI}/strataPitch/includes/rpn_eval.rc",
     400, 400,
     "A visual tour of the RPN evaluator: an expression is rendered as "
     "a tree, with each node showing its current numeric value as the "
     "input variables animate.  Self-documenting."),

    ("watch",
     "Skeletonized watch movement",
     f"{ORIGAMI}/strataPitch/includes/watch_movement.rc",
     500, 500,
     "Six gears with verified 60 : 1 + 12 : 1 reduction trains, real "
     "interlocking tooth counts, balance wheel + pallet fork + escape "
     "wheel + hour / minute / second hands.  All geometry is computed; "
     "all motion is the document's own expressions."),
]


def b64(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode("ascii")


def ensure_bundle():
    """Build a minified bundle of the TypeScript player, return its path."""
    bundle = "/tmp/rc_bundle.intro.min.js"
    print("Building player bundle…")
    subprocess.run(
        ["npx", "esbuild",
         os.path.join(TS_DIR, "src/web/main.ts"),
         "--bundle", "--minify", "--format=iife", "--target=es2020",
         "--global-name=RC",
         f"--outfile={bundle}"],
        cwd=TS_DIR, check=True, stdout=subprocess.DEVNULL,
    )
    return bundle


def html_template(bundle_js, examples_html):
    return textwrap.dedent(f"""\
    <!DOCTYPE html>
    <html lang="en">
    <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>RemoteCompose — An Introduction</title>
    <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    html, body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
        Roboto, Helvetica, Arial, sans-serif;
      background: #0F1116; color: #DDE2EA;
      line-height: 1.55; font-size: 16px;
    }}
    body {{ max-width: 920px; margin: 0 auto; padding: 56px 28px 96px; }}
    h1 {{ font-size: 42px; font-weight: 700; letter-spacing: -0.02em; color: #fff; margin-bottom: 6px; }}
    .tag {{ font-size: 17px; color: #95A1B6; margin-bottom: 28px; max-width: 64ch; }}
    h2 {{ font-size: 24px; font-weight: 600; color: #fff;
          margin: 56px 0 14px; letter-spacing: -0.01em; }}
    h3 {{ font-size: 18px; font-weight: 600; color: #fff; margin: 0 0 8px; }}
    p {{ color: #BCC4D2; margin-bottom: 12px; max-width: 70ch; }}
    p.lead {{ color: #DDE2EA; }}
    code {{ background: #1A1F2A; padding: 1px 6px; border-radius: 3px;
            font-size: 13.5px; color: #E7C887; font-family: ui-monospace, "SF Mono", Menlo, monospace; }}
    pre {{ background: #1A1F2A; padding: 14px 16px; border-radius: 6px;
           overflow-x: auto; margin: 12px 0; }}
    pre code {{ background: none; padding: 0; color: #C0C8D6; font-size: 13px; }}
    a {{ color: #8AB4F8; text-decoration: none; }}
    a:hover {{ text-decoration: underline; }}

    ul {{ margin: 8px 0 16px 24px; color: #BCC4D2; }}
    ul li {{ margin-bottom: 4px; }}

    .features {{ display: grid; grid-template-columns: repeat(2, 1fr);
                gap: 8px 24px; margin: 14px 0 6px; }}
    .features div {{ color: #BCC4D2; font-size: 14.5px; }}
    .features b {{ color: #E7C887; font-weight: 600; }}

    .examples {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                 gap: 28px; margin-top: 12px; }}
    .ex {{ background: #161A22; border: 1px solid #2A3142;
           border-radius: 8px; padding: 18px 18px 14px;
           display: flex; flex-direction: column; }}
    .ex .canvas-wrap {{ background: #000; border-radius: 4px;
                       overflow: hidden; margin-bottom: 12px;
                       display: flex; align-items: center; justify-content: center;
                       aspect-ratio: 1 / 1; }}
    .ex canvas {{ max-width: 100%; max-height: 100%; display: block; }}
    .ex .blurb {{ color: #95A1B6; font-size: 14px; }}
    .ex small {{ color: #6A7283; display: block; margin-top: 8px; font-size: 12px; }}

    .players {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                gap: 16px; margin-top: 12px; }}
    .player {{ background: #161A22; border: 1px solid #2A3142;
               border-radius: 8px; padding: 14px 16px; }}
    .player b {{ color: #E7C887; font-weight: 600; display: block; margin-bottom: 4px; }}
    .player span {{ color: #95A1B6; font-size: 14px; }}

    footer {{ margin-top: 64px; padding-top: 24px; border-top: 1px solid #2A3142;
              color: #6A7283; font-size: 13px; }}
    </style>
    </head>
    <body>

    <h1>RemoteCompose</h1>
    <p class="tag">A compact binary UI / canvas format for streaming
       interactive scenes — drawing, layout, expressions, animations,
       particles, paths, shaders, bitmaps — to remote players.</p>

    <p class="lead">A RemoteCompose document is a single binary file
       (typically a few KB) that any compatible player can load and
       render identically. Players exist on macOS, iOS, Android,
       Compose Multiplatform Desktop, the browser, Node, and embedded
       devices. <strong>Every demo on this page is the same `.rc`
       binary playing in your browser through the TypeScript port of
       the runtime.</strong></p>

    <h2>What it offers</h2>
    <div class="features">
      <div><b>Compact</b> — A complete animated scene fits in 1–10 KB. The watch movement at the bottom is 24 KB; the pendulum is 2.5 KB.</div>
      <div><b>Self-contained</b> — One file carries layout, paint state, expressions, animations, paths, fonts, bitmaps, and shaders.</div>
      <div><b>Expression engine</b> — A stack-based RPN evaluator with ~40 operators (arithmetic, trig, logic, splines, springs, system variables) drives any value: positions, colours, text, paint parameters.</div>
      <div><b>Layout</b> — Compose-style intrinsic-size + measure / position passes, with modifiers (padding, background, border, offset, visibility, …).</div>
      <div><b>Drawing</b> — Canvas primitives, paths, gradients, text alignment, clip rects, transforms, blend modes.</div>
      <div><b>Animation</b> — Time variables (animation time, delta time, wall-clock components) drive expressions; particle systems are container ops with per-particle expressions.</div>
      <div><b>Shaders</b> — AGSL fragment shaders embed in the document and run on whatever GPU pipeline the player has (Skia / Metal / WebGL).</div>
      <div><b>Touch &amp; input</b> — Touch position / velocity are first-class system variables; documents can be interactive without any host-side glue.</div>
    </div>

    <h2>Examples</h2>
    <p>All ten render in this page right now, with no external requests.
       Each is the result of loading one `.rc` file (a few KB) into the
       in-browser player.</p>

    <div class="examples">
    {examples_html}
    </div>

    <h2>Available players</h2>
    <p>One binary format, many runtimes.  All produce identical output
       on the same document.</p>

    <div class="players">
      <div class="player">
        <b>C++ (rcX)</b>
        <span>Skia bridge, GLFW desktop viewer (macOS, Metal &amp; CPU),
              SwiftUI iOS / iPadOS app with Metal-backed Skia, headless
              <code>rc → PNG</code> and <code>rc → JSON</code> tools.</span>
      </div>
      <div class="player">
        <b>Compose Multiplatform</b>
        <span>Kotlin Multiplatform engine + JVM Desktop host, sharing
              modules with the upstream Android implementation.</span>
      </div>
      <div class="player">
        <b>TypeScript</b>
        <span>Browser Canvas2D player (this page), Node-side rendering,
              static-deck-site generator, single-file standalone HTML
              builder, VS Code custom-editor extension.</span>
      </div>
      <div class="player">
        <b>Android (upstream)</b>
        <span>The reference implementation lives in AndroidX — Compose
              and View hosts, an offline player, Bitmap exporters.
              Documents authored anywhere render identically there.</span>
      </div>
    </div>

    <footer>
      <p>Source: <a href="https://github.com/androidx/androidx/tree/androidx-main/compose/remote">androidx.compose.remote</a> ·
         Experimental tooling: this repo, <code>players/</code> and <code>samples/</code>.</p>
      <p>This page is one HTML file. View source — the bundled player and every example are inlined. License: Apache 2.0.</p>
    </footer>

    <script>
    {bundle_js}
    </script>
    <script>
    (function () {{
      function decodeBase64(s) {{
        var bin = atob(s);
        var len = bin.length;
        var arr = new Uint8Array(len);
        for (var i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
        return arr.buffer;
      }}

      // RcdPlayer ctors take a canvas; hand each example its own.
      var canvases = document.querySelectorAll("canvas[data-rc]");
      var dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

      canvases.forEach(function (canvas) {{
        var w = parseInt(canvas.getAttribute("width"),  10) || 400;
        var h = parseInt(canvas.getAttribute("height"), 10) || 400;
        canvas.width  = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width  = w + "px";
        canvas.style.height = h + "px";

        var b64data = canvas.getAttribute("data-rc");
        var buf = decodeBase64(b64data);

        try {{
          var player = new RC.RcdPlayer(canvas);
          player.loadFromArrayBuffer(buf).catch(function (err) {{
            console.error("loadFromArrayBuffer failed:", canvas.id, err);
          }});
        }} catch (err) {{
          console.error("RcdPlayer init failed:", canvas.id, err);
        }}
      }});
    }})();
    </script>

    </body>
    </html>
    """)


def render_examples():
    parts = []
    for ex_id, title, rc_path, w, h, blurb in EXAMPLES:
        if not os.path.exists(rc_path):
            print(f"warning: missing {rc_path}", file=sys.stderr)
            continue
        b64data = b64(rc_path)
        size = os.path.getsize(rc_path)
        size_h = (f"{size} B" if size < 1024 else f"{size/1024:.1f} KB")
        parts.append(textwrap.dedent(f"""\
            <div class="ex" id="ex-{ex_id}">
              <div class="canvas-wrap">
                <canvas id="canvas-{ex_id}" data-rc="{b64data}"
                        width="{w}" height="{h}"></canvas>
              </div>
              <h3>{title}</h3>
              <p class="blurb">{blurb}</p>
              <small>{size_h} · {os.path.basename(rc_path)}</small>
            </div>
            """))
    return "\n".join(parts)


def main():
    bundle_path = ensure_bundle()
    with open(bundle_path, encoding="ascii") as f:
        bundle_js = f.read()

    examples_html = render_examples()
    html = html_template(bundle_js, examples_html)

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"wrote {OUT_PATH} ({os.path.getsize(OUT_PATH):,} bytes)")


if __name__ == "__main__":
    main()
