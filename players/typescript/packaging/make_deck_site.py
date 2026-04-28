#!/usr/bin/env python3
"""
Build a self-contained website for viewing an RC deck.

Usage:
    make_deck_site.py <deck-dir> [<output-dir>]

`<deck-dir>` is a directory containing `.rc` (slides) and/or media files
(`.mp4`, `.mov`, `.webp`, `.m4v`).  `<output-dir>` defaults to
`<deck-dir>/web/`.

The output directory ends up containing:
  - All slide and media files (copied)
  - bundle.js (TypeScript web player, taken from ../web-player/)
  - index.html (presentation viewer with keyboard navigation)

Prerequisite: the player bundle must be built once via
`npm run bundle` from the typescript player root.
"""
import argparse
import os
import re
import shutil
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
BUNDLE_SRC = os.path.join(PROJECT_ROOT, "web-player", "bundle.js")

# Filled in by main() once the deck dir is known.
DECK_DIR = ""
WEB_DIR  = ""

MEDIA_EXTS = {".mp4", ".mov", ".webp", ".m4v"}


def collect_files():
    """Collect .rc and media files from the talk directory, sorted by name.

    Returns a single list in filename order so that videos and RC slides
    are interleaved according to their numeric prefix (e.g. 21_race.mp4
    appears between 20_xxx.rc and 22_xxx.rc).
    """
    slide_files = []
    for f in sorted(os.listdir(DECK_DIR)):
        ext = os.path.splitext(f)[1].lower()
        full = os.path.join(DECK_DIR, f)
        if not os.path.isfile(full):
            continue
        if ext == ".rc" or ext in MEDIA_EXTS:
            slide_files.append(f)
    return slide_files


def slide_display_name(filename):
    """Convert '02_t_01_to_02_foo__bar.rc' → a readable display name."""
    stem = os.path.splitext(filename)[0]
    # Strip leading number prefix
    stem = re.sub(r"^\d+_", "", stem)
    # Transition files: t_NN_to_NN_slug__slug
    m = re.match(r"t_\d+_to_\d+_(.+)__(.+)", stem)
    if m:
        return m.group(2).replace("_", " ").title()
    return stem.replace("_", " ").title()


def _human_size(nbytes):
    """Format byte count as human-readable string."""
    if nbytes < 1024:
        return f"{nbytes} B"
    elif nbytes < 1024 * 1024:
        return f"{nbytes / 1024:.1f} KB"
    else:
        return f"{nbytes / (1024 * 1024):.1f} MB"


def generate_html(all_files):
    """Generate the presentation HTML page."""
    # Build slide entries with file sizes
    slide_entries = []
    total_size = 0
    for f in all_files:
        ext = os.path.splitext(f)[1].lower()
        is_media = ext in MEDIA_EXTS
        label = slide_display_name(f) if not is_media else f
        fpath = os.path.join(WEB_DIR, f) if os.path.exists(os.path.join(WEB_DIR, f)) \
                else os.path.join(DECK_DIR, f)
        size = os.path.getsize(fpath) if os.path.exists(fpath) else 0
        total_size += size
        slide_entries.append({"file": f, "label": label, "media": is_media,
                              "size": size, "size_h": _human_size(size)})

    # Compute cumulative percentage for each entry
    for e in slide_entries:
        e["pct"] = round(e["size"] / total_size * 100, 1) if total_size > 0 else 0

    sidebar_items_js = ",\n      ".join(
        f'{{"file":"{e["file"]}","label":{repr(e["label"])},'
        f'"media":{str(e["media"]).lower()},'
        f'"size":"{e["size_h"]}","pct":{e["pct"]}}}'
        for e in slide_entries
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>RemoteCompose Slides</title>
<style>
* {{ box-sizing: border-box; margin: 0; padding: 0; }}
html, body {{ height: 100%; overflow: hidden; }}
body {{
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #111; color: #eee;
  display: flex; flex-direction: column;
}}

/* Header bar */
header {{
  height: 44px; background: #1a1a2e; border-bottom: 1px solid #333;
  display: flex; align-items: center; padding: 0 16px; gap: 16px;
  flex-shrink: 0; z-index: 10;
}}
header h1 {{ font-size: 15px; font-weight: 600; color: #8ab4f8; white-space: nowrap; }}
#slide-counter {{ font-size: 13px; color: #888; margin-left: auto; white-space: nowrap; }}
#btn-sidebar {{
  background: none; border: 1px solid #555; color: #aaa; border-radius: 4px;
  padding: 4px 10px; font-size: 12px; cursor: pointer;
}}
#btn-sidebar:hover {{ background: #333; color: #fff; }}
#btn-fullscreen {{
  background: none; border: 1px solid #555; color: #aaa; border-radius: 4px;
  padding: 4px 10px; font-size: 12px; cursor: pointer;
}}
#btn-fullscreen:hover {{ background: #333; color: #fff; }}
#btn-present {{
  background: none; border: 1px solid #8ab4f8; color: #8ab4f8; border-radius: 4px;
  padding: 4px 10px; font-size: 12px; cursor: pointer;
}}
#btn-present:hover {{ background: #8ab4f8; color: #111; }}

/* Present mode: hide header + sidebar */
body.present-mode header {{ display: none; }}
body.present-mode .sidebar {{ display: none; }}
body.present-mode .progress-bar {{ display: none; }}
body.present-mode .main {{
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  width: 100vw; height: 100vh;
}}
body.present-mode .canvas-area {{
  width: 100vw; height: 100vh;
}}
body.present-mode canvas {{
  max-width: 100vw; max-height: 100vh;
}}

/* Force flex centering + black bg when canvas-area is the fullscreen element.
   The UA :fullscreen stylesheet can override inherited styles, so restate
   the ones we need to keep the RC canvas centered on the screen. */
.canvas-area:fullscreen,
.canvas-area:-webkit-full-screen {{
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  background: #000 !important;
  width: 100vw !important;
  height: 100vh !important;
}}


/* Layout */
.main {{ display: flex; flex: 1; overflow: hidden; }}

/* Sidebar */
.sidebar {{
  width: 240px; flex-shrink: 0; background: #1a1a2e; border-right: 1px solid #333;
  display: flex; flex-direction: column; overflow: hidden;
  transition: margin-left 0.2s ease;
}}
.sidebar.hidden {{ margin-left: -240px; }}
.sidebar-header {{
  padding: 10px 14px; font-size: 11px; font-weight: 600; color: #666;
  text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #333;
  flex-shrink: 0;
}}
.slide-list {{ flex: 1; overflow-y: auto; padding: 4px 0; }}
.slide-list::-webkit-scrollbar {{ width: 6px; }}
.slide-list::-webkit-scrollbar-thumb {{ background: #444; border-radius: 3px; }}
.slide-item {{
  padding: 8px 14px; font-size: 13px; cursor: pointer;
  color: #999; transition: background 0.15s; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
  border-left: 3px solid transparent;
}}
.slide-item:hover {{ background: #252540; color: #ccc; }}
.slide-item.active {{ background: #252550; color: #fff; border-left-color: #8ab4f8; }}
.slide-item .idx {{ color: #555; font-size: 11px; margin-right: 6px; }}
.slide-item.media {{ color: #6a9; }}

/* Tooltip */
.slide-tooltip {{
  display: none; position: fixed; z-index: 100;
  background: #1e1e30; border: 1px solid #444; border-radius: 6px;
  padding: 8px 12px; pointer-events: none;
  font-size: 11px; line-height: 1.6; color: #ccc;
  max-width: 360px; box-shadow: 0 4px 16px rgba(0,0,0,0.5);
}}
.slide-tooltip .tt-file {{ color: #8ab4f8; word-break: break-all; }}
.slide-tooltip .tt-row {{ display: flex; justify-content: space-between; gap: 16px; }}
.slide-tooltip .tt-label {{ color: #888; }}
.slide-tooltip .tt-val {{ color: #eee; }}
.slide-tooltip .tt-bar {{ height: 4px; background: #333; border-radius: 2px; margin-top: 4px; }}
.slide-tooltip .tt-fill {{ height: 100%; background: #8ab4f8; border-radius: 2px; }}

/* Canvas area */
.canvas-area {{
  flex: 1; display: flex; align-items: center; justify-content: center;
  background: #000; position: relative; overflow: hidden;
}}
canvas {{ display: block; }}
video {{
  display: none; max-width: 100%; max-height: 100%;
  background: #000;
}}
video.active {{ display: block; }}

/* Nav arrows (hover zones) */
.nav-zone {{
  position: absolute; top: 0; bottom: 0; width: 15%; z-index: 5;
  cursor: pointer; display: flex; align-items: center; opacity: 0;
  transition: opacity 0.2s;
}}
.nav-zone:hover {{ opacity: 1; }}
.nav-zone.left {{ left: 0; justify-content: flex-start; padding-left: 20px; }}
.nav-zone.right {{ right: 0; justify-content: flex-end; padding-right: 20px; }}
.nav-arrow {{
  font-size: 48px; color: rgba(255,255,255,0.5); user-select: none;
  text-shadow: 0 2px 8px rgba(0,0,0,0.8);
}}

/* Progress bar at bottom */
.progress-bar {{
  height: 3px; background: #222; flex-shrink: 0;
}}
.progress-fill {{
  height: 100%; background: #8ab4f8; transition: width 0.3s ease;
}}
</style>
</head>
<body>

<header>
  <h1>RemoteCompose Slides</h1>
  <button id="btn-sidebar">Slides</button>
  <button id="btn-fullscreen">Fullscreen</button>
  <button id="btn-present">Present</button>
  <span id="slide-counter"></span>
</header>

<div class="main">
  <div class="sidebar" id="sidebar">
    <div class="sidebar-header">Slide Deck</div>
    <div class="slide-list" id="slide-list"></div>
  </div>

  <div id="slide-tooltip" class="slide-tooltip"></div>

  <div class="canvas-area" id="canvas-area">
    <canvas id="canvas"></canvas>
    <video id="video" loop muted></video>
    <div class="nav-zone left" id="nav-prev"><span class="nav-arrow">&#x276E;</span></div>
    <div class="nav-zone right" id="nav-next"><span class="nav-arrow">&#x276F;</span></div>
  </div>
</div>

<div class="progress-bar"><div class="progress-fill" id="progress"></div></div>

<script src="bundle.js"></script>
<script>
(function() {{
  const SLIDES = [
      {sidebar_items_js}
  ];

  const canvas = document.getElementById('canvas');
  const video = document.getElementById('video');
  const canvasArea = document.getElementById('canvas-area');
  const slideList = document.getElementById('slide-list');
  const counter = document.getElementById('slide-counter');
  const progress = document.getElementById('progress');
  const sidebar = document.getElementById('sidebar');

  let player = null;
  let currentIdx = -1;

  function getPlayer() {{
    if (!player) {{
      player = new window.RC.RcdPlayer(canvas);
    }}
    return player;
  }}

  // Fit canvas to the available area maintaining 16:9 aspect ratio
  function fitCanvas() {{
    const inPresent = document.body.classList.contains('present-mode');
    // In present mode, bypass the flex container and use the raw viewport
    // so we pick up the full fullscreen size even during layout transitions.
    let boxW, boxH;
    if (inPresent) {{
      boxW = window.innerWidth;
      boxH = window.innerHeight;
    }} else {{
      const area = canvasArea.getBoundingClientRect();
      boxW = area.width;
      boxH = area.height;
    }}
    const aspect = 16 / 9;
    let w = boxW;
    let h = boxH;
    if (w / h > aspect) {{
      w = h * aspect;
    }} else {{
      h = w / aspect;
    }}
    w = Math.round(w);
    h = Math.round(h);
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    if (player) {{
      try {{ player.resize(w, h); }} catch (err) {{}}
    }}
    video.style.width = w + 'px';
    video.style.height = h + 'px';
  }}

  // Build sidebar
  const tooltip = document.getElementById('slide-tooltip');
  let tooltipVisible = false;

  function showTooltip(s, i, e) {{
    // Break filename into path segments for display
    const file = s.file;
    const parts = file.replace(/\.(rc|mp4|mov|webp|m4v)$/, '').split('_');
    const ext = file.split('.').pop().toUpperCase();
    const type = s.media ? 'Video' : 'RC Slide';

    tooltip.innerHTML =
      '<div class="tt-file">' + file + '</div>' +
      '<div class="tt-row"><span class="tt-label">Type:</span><span class="tt-val">' + type + ' (' + ext + ')</span></div>' +
      '<div class="tt-row"><span class="tt-label">Size:</span><span class="tt-val">' + s.size + '</span></div>' +
      '<div class="tt-row"><span class="tt-label">Deck share:</span><span class="tt-val">' + s.pct + '%</span></div>' +
      '<div class="tt-bar"><div class="tt-fill" style="width:' + Math.max(1, s.pct) + '%"></div></div>' +
      '<div class="tt-row"><span class="tt-label">Slide:</span><span class="tt-val">' + (i + 1) + ' / ' + SLIDES.length + '</span></div>';
    tooltip.style.display = 'block';
    tooltipVisible = true;
    positionTooltip(e);
  }}

  function positionTooltip(e) {{
    const r = tooltip.getBoundingClientRect();
    let x = e.clientX + 12;
    let y = e.clientY - 8;
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - 12;
    if (y + r.height > window.innerHeight - 8) y = window.innerHeight - r.height - 8;
    if (y < 4) y = 4;
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
  }}

  function hideTooltip() {{
    tooltip.style.display = 'none';
    tooltipVisible = false;
  }}

  SLIDES.forEach((s, i) => {{
    const div = document.createElement('div');
    div.className = 'slide-item' + (s.media ? ' media' : '');
    div.innerHTML = '<span class="idx">' + (i + 1) + '</span>' + s.label;
    div.addEventListener('click', () => goTo(i));
    div.addEventListener('mouseenter', (e) => showTooltip(s, i, e));
    div.addEventListener('mousemove', (e) => {{ if (tooltipVisible) positionTooltip(e); }});
    div.addEventListener('mouseleave', hideTooltip);
    div.addEventListener('contextmenu', hideTooltip);
    slideList.appendChild(div);
  }});

  async function goTo(idx) {{
    if (idx < 0 || idx >= SLIDES.length) return;
    currentIdx = idx;
    const s = SLIDES[idx];

    // Update sidebar
    document.querySelectorAll('.slide-item.active').forEach(e => e.classList.remove('active'));
    const items = slideList.querySelectorAll('.slide-item');
    if (items[idx]) {{
      items[idx].classList.add('active');
      items[idx].scrollIntoView({{ block: 'nearest' }});
    }}

    // Update counter & progress
    counter.textContent = (idx + 1) + ' / ' + SLIDES.length;
    progress.style.width = ((idx + 1) / SLIDES.length * 100) + '%';

    if (s.media) {{
      // Show video, hide canvas
      canvas.style.display = 'none';
      video.classList.add('active');
      video.src = s.file;
      video.play().catch(() => {{}});
    }} else {{
      // Show canvas, hide video
      video.classList.remove('active');
      video.pause();
      canvas.style.display = 'block';
      fitCanvas();
      try {{
        const res = await fetch(s.file);
        const data = await res.arrayBuffer();
        const p = getPlayer();
        await p.loadFromArrayBuffer(data);
        fitCanvas();
      }} catch (e) {{
        console.error('Failed to load', s.file, e);
      }}
    }}
  }}

  function next() {{ goTo(currentIdx + 1); }}
  function prev() {{ goTo(currentIdx - 1); }}

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {{
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {{
      e.preventDefault(); next();
    }} else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {{
      e.preventDefault(); prev();
    }} else if (e.key === 'Home') {{
      e.preventDefault(); goTo(0);
    }} else if (e.key === 'End') {{
      e.preventDefault(); goTo(SLIDES.length - 1);
    }} else if (e.key === 'f' || e.key === 'F') {{
      toggleFullscreen();
    }} else if (e.key === 's' || e.key === 'S') {{
      sidebar.classList.toggle('hidden');
    }} else if (e.key === 'Escape') {{
      if (document.body.classList.contains('present-mode')) {{
        exitPresent();
      }}
    }}
  }});

  // Click navigation
  document.getElementById('nav-prev').addEventListener('click', prev);
  document.getElementById('nav-next').addEventListener('click', next);

  // Sidebar toggle
  document.getElementById('btn-sidebar').addEventListener('click', () => {{
    sidebar.classList.toggle('hidden');
    setTimeout(fitCanvas, 250);
  }});

  // Fullscreen
  function toggleFullscreen() {{
    if (!document.fullscreenElement) {{
      document.documentElement.requestFullscreen().catch(() => {{}});
    }} else {{
      document.exitFullscreen();
    }}
  }}
  document.getElementById('btn-fullscreen').addEventListener('click', toggleFullscreen);

  // Present mode: fullscreen + hide header/sidebar; Escape restores
  let sidebarHiddenBeforePresent = false;

  function enterPresent() {{
    if (document.body.classList.contains('present-mode')) return;
    sidebarHiddenBeforePresent = sidebar.classList.contains('hidden');
    document.body.classList.add('present-mode');
    if (!document.fullscreenElement) {{
      canvasArea.requestFullscreen().catch(() => {{}});
    }}
    fitCanvas();
  }}

  function exitPresent() {{
    if (!document.body.classList.contains('present-mode')) return;
    document.body.classList.remove('present-mode');
    if (!sidebarHiddenBeforePresent) {{
      sidebar.classList.remove('hidden');
    }} else {{
      sidebar.classList.add('hidden');
    }}
    if (document.fullscreenElement) {{
      document.exitFullscreen().catch(() => {{}});
    }}
    fitCanvas();
  }}

  document.getElementById('btn-present').addEventListener('click', enterPresent);

  document.addEventListener('fullscreenchange', () => {{
    if (!document.fullscreenElement && document.body.classList.contains('present-mode')) {{
      exitPresent();
    }}
    setTimeout(fitCanvas, 50);
  }});

  // Resize handling
  window.addEventListener('resize', fitCanvas);
  new ResizeObserver(fitCanvas).observe(canvasArea);
  new ResizeObserver(fitCanvas).observe(document.documentElement);

  // Start on first slide
  fitCanvas();
  goTo(0);
}})();
</script>
</body>
</html>
"""


def main():
    parser = argparse.ArgumentParser(
        description="Build a static deck site from a directory of .rc and "
                    "media files.")
    parser.add_argument("deck_dir",
        help="directory containing .rc / .mp4 / .mov / .webp / .m4v files")
    parser.add_argument("output_dir", nargs="?", default=None,
        help="output directory (default: <deck_dir>/web/)")
    args = parser.parse_args()

    global DECK_DIR, WEB_DIR
    DECK_DIR = os.path.abspath(args.deck_dir)
    WEB_DIR  = os.path.abspath(args.output_dir) if args.output_dir \
                else os.path.join(DECK_DIR, "web")

    if not os.path.isdir(DECK_DIR):
        print(f"error: deck dir not found: {DECK_DIR}", file=sys.stderr)
        sys.exit(1)

    all_files = collect_files()
    if not all_files:
        print("error: no .rc or media files found in", DECK_DIR, file=sys.stderr)
        sys.exit(1)

    # Create output directory
    if os.path.exists(WEB_DIR):
        shutil.rmtree(WEB_DIR)
    os.makedirs(WEB_DIR)

    # Copy bundle.js (built once via `npm run bundle` from the player root)
    if not os.path.exists(BUNDLE_SRC):
        print(f"error: {BUNDLE_SRC} not found — run `npm run bundle` "
              f"from the typescript player root first", file=sys.stderr)
        sys.exit(1)
    shutil.copy2(BUNDLE_SRC, os.path.join(WEB_DIR, "bundle.js"))
    print(f"copied bundle.js")

    # Copy all slide files (RC + media interleaved by sort order)
    n_rc = n_media = 0
    for f in all_files:
        shutil.copy2(os.path.join(DECK_DIR, f), os.path.join(WEB_DIR, f))
        ext = os.path.splitext(f)[1].lower()
        if ext in MEDIA_EXTS:
            n_media += 1
        else:
            n_rc += 1
    print(f"copied {n_rc} .rc files, {n_media} media files")

    # Write index.html
    html = generate_html(all_files)
    html_path = os.path.join(WEB_DIR, "index.html")
    with open(html_path, "w") as f:
        f.write(html)
    print(f"wrote {html_path}")

    print(f"\nDone! To serve:\n  cd {WEB_DIR} && python3 -m http.server 8000")
    print(f"  Then open http://localhost:8000")


if __name__ == "__main__":
    main()
