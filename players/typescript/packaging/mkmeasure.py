#!/usr/bin/env python3
"""mkmeasure.py — build the standalone operation-measurement demo page.

    python3 packaging/mkmeasure.py       # -> web-player/measure.html

One self-contained HTML file: the whole TypeScript player is inlined, so it runs from
`file://` with no server and no network. Drop a `.rc` document on it and it plays while a
panel shows what executed, per frame, per type and per instance.

It is regenerated rather than hand-maintained because it embeds the player bundle, which
goes stale the moment that bundle is rebuilt:

    cd players/typescript && npm run bundle
    python3 packaging/mkmeasure.py

**This page is a demo of the hooks, not a profiler.** It is deliberately a thin consumer:
everything it shows is computed from the `FrameMeasurement` objects the player hands it,
using no player internals. If a real profiler could not be built on what this page uses,
the hooks are inadequate — that is the thing this page exists to test.

It also runs the invariants as a live assertion rather than a claim: the breakdowns must
sum to the total, and the total must equal `getOpsPerFrame()`. Those are shown in the
footer every frame, so a document that breaks attribution says so on screen instead of
quietly reporting a plausible-looking number.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUNDLE = ROOT / "web-player" / "bundle.js"
OUT = ROOT / "web-player" / "measure.html"

PAGE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>RemoteCompose — operation measurement</title>
<style>
  :root{--bg:#0b0f14;--panel:#141b24;--fg:#d7dee8;--muted:#8b95a5;--accent:#3ddc84;
        --line:#2a3644;--warn:#ff4d6d;--amber:#ffb454;
        --mono:ui-monospace,SFMono-Regular,Menlo,monospace}
  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0;background:var(--bg);color:var(--fg);
       font:14px/1.5 system-ui,-apple-system,sans-serif;
       display:flex;flex-direction:column;overscroll-behavior:none}
  header{padding:14px 20px 8px;text-align:center}
  h1{margin:0 0 3px;font-size:17px;font-weight:600}
  h1 b{color:var(--accent);font-weight:600}
  header p{margin:0;color:var(--muted);font-size:12.5px}
  .bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:center;
       padding:9px 16px;border-bottom:1px solid var(--line)}
  .bar label{color:var(--muted);font-size:12px;display:flex;align-items:center;gap:5px}
  select,button{background:#1b2330;color:var(--fg);border:1px solid var(--line);
       border-radius:8px;padding:5px 12px;font:inherit;font-size:12.5px;cursor:pointer}
  button:hover,select:hover{border-color:var(--accent);color:var(--accent)}
  button[aria-pressed="true"]{background:var(--accent);color:#08110b;border-color:var(--accent)}
  main{flex:1;display:flex;gap:16px;padding:16px;min-height:0;align-items:flex-start;overflow:auto;
       justify-content:center;flex-wrap:wrap}
  #stage{display:flex;flex-direction:column;align-items:center;gap:10px}
  #frame{position:relative;background:var(--panel);border-radius:14px;padding:10px;
         line-height:0;box-shadow:0 10px 40px rgba(0,0,0,.55)}
  canvas#c{display:block;border-radius:8px;touch-action:none}
  #empty{color:var(--muted);text-align:center;font-size:13px;line-height:1.7}
  #empty code{font-family:var(--mono);color:var(--fg)}

  #panel{flex:1;min-width:340px;max-width:620px;display:none;flex-direction:column;gap:12px;
         max-height:calc(100vh - 190px);overflow:auto}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
  .card h2{margin:0 0 9px;font-size:11px;font-weight:600;letter-spacing:.09em;
           text-transform:uppercase;color:var(--muted)}
  .nums{display:flex;gap:20px;flex-wrap:wrap;align-items:baseline}
  .num{display:flex;flex-direction:column;gap:1px}
  .num b{font:600 21px/1.1 var(--mono);color:var(--accent)}
  .num span{font-size:10.5px;color:var(--muted);letter-spacing:.05em;text-transform:uppercase}
  .num.dim b{color:var(--fg)}
  canvas#spark{display:block;width:100%;height:56px;margin-top:10px;border-radius:6px;
               background:#0e141c}
  table{width:100%;border-collapse:collapse;font-family:var(--mono);font-size:12px}
  th{text-align:right;color:var(--muted);font-weight:500;font-size:10.5px;padding:0 0 5px;
     letter-spacing:.05em;text-transform:uppercase}
  /* Match the cells' left padding, or narrow headers collide: the instance table has a
     leading #id column, which pushes `operation` into second place and ran the headers
     together as OPERATIONFRAMEPEAK. */
  th:not(:first-child){padding-left:14px}
  th:first-child,td:first-child{text-align:left}
  td{padding:2px 0;white-space:nowrap}
  td:not(:first-child){text-align:right;padding-left:14px}
  tbody tr:hover{background:#1b2330}
  .bar-cell{width:100%;padding-left:14px!important}
  .barfill{display:block;height:7px;border-radius:3px;background:var(--accent);opacity:.5;
           min-width:1px}
  .muted{color:var(--muted)}
  .amber{color:var(--amber)}
  footer{padding:8px 16px;border-top:1px solid var(--line);font-family:var(--mono);
         font-size:11.5px;color:var(--muted);text-align:center}
  footer.err{color:var(--warn)}
  #check{font-family:var(--mono);font-size:11.5px;text-align:center;padding:6px 16px 0}
  #check.ok{color:var(--muted)}
  #check.bad{color:var(--warn);font-weight:600}
  #drop{position:fixed;inset:0;display:none;align-items:center;justify-content:center;
        background:rgba(11,15,20,.9);border:3px dashed var(--accent);color:var(--accent);
        font-size:19px;z-index:9}
  #drop.on{display:flex}
</style>
</head>
<body>

<header>
  <h1>RemoteCompose <b>operation measurement</b></h1>
  <p>Drop a <code>.rc</code> document. Everything below comes from the per-frame
     measurement hook — no player internals are read.<br>
     <b>in paint</b> is the frame's draw work; <b>between frames</b> is everything that
     ran outside it — click and touch actions, and on the very first frame the document's
     one-time load pass. Tap the canvas to see it move.</p>
</header>

<div class="bar">
  <button id="open">Open file…</button>
  <input id="file" type="file" accept=".rc,.rcd" hidden>
  <button id="measure" aria-pressed="true">Measurement: on</button>
  <button id="reset">Reset totals</button>
  <label>Theme
    <select id="theme">
      <option value="auto">auto</option>
      <option value="light">light</option>
      <option value="dark">dark</option>
    </select>
  </label>
  <label>Viewport
    <select id="aspect">
      <option value="2:3">2:3</option>
      <option value="9:16">9:16</option>
      <option value="1:1">1:1</option>
      <option value="4:3">4:3</option>
      <option value="3:2">3:2</option>
      <option value="fill">fill</option>
    </select>
  </label>
  <label>Size
    <select id="vsize">
      <option value="360">S</option>
      <option value="520" selected>M</option>
      <option value="720">L</option>
    </select>
  </label>
  <label>Rank by
    <select id="rank">
      <option value="last">this frame</option>
      <option value="total">total</option>
      <option value="peak">peak frame</option>
    </select>
  </label>
</div>

<main>
  <div id="stage">
    <div id="frame"><canvas id="c" width="400" height="400"></canvas></div>
    <p id="empty">No document loaded.<br>Drop a <code>.rc</code> file, or use
       <code>Open file…</code>.</p>
  </div>

  <div id="panel">
    <div class="card">
      <h2>Per frame</h2>
      <div class="nums">
        <div class="num"><b id="n-last">0</b><span>this frame</span></div>
        <div class="num dim"><b id="n-peak">0</b><span>peak</span></div>
        <div class="num dim"><b id="n-mean">0</b><span>mean</span></div>
        <div class="num dim"><b id="n-paint">0</b><span>in paint</span></div>
        <div class="num dim"><b id="n-between">0</b><span>between frames</span></div>
        <div class="num dim"><b id="n-frames">0</b><span>frames</span></div>
        <div class="num dim"><b id="n-types">0</b><span>types</span></div>
        <div class="num dim"><b id="n-inst">0</b><span>instances</span></div>
      </div>
      <canvas id="spark" width="600" height="56"></canvas>
    </div>

    <div class="card">
      <h2>By operation type</h2>
      <table><thead><tr>
        <th>operation</th><th>op</th><th>frame</th><th>peak</th><th>total</th>
        <th class="bar-cell"></th>
      </tr></thead><tbody id="types"></tbody></table>
    </div>

    <div class="card">
      <h2>By operation instance <span class="muted">— top 25</span></h2>
      <table><thead><tr>
        <th>#id</th><th>operation</th><th>frame</th><th>peak</th><th>total</th>
        <th class="bar-cell"></th>
      </tr></thead><tbody id="insts"></tbody></table>
    </div>
  </div>
</main>

<div id="check" class="ok">—</div>
<footer id="status">ready</footer>
<div id="drop">release to load</div>

<script>__PLAYER__</script>
<script>
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var status = $("status"), empty = $("empty"), panel = $("panel"), check = $("check");
  var canvas = $("c");
  var player = null, lastName = "", lastBuf = null, measuring = true;

  if (!window.RC || !window.RC.RcdPlayer) {
    status.textContent = "player bundle failed to load";
    status.className = "err";
    return;
  }

  function say(msg, isErr) {
    status.textContent = msg;
    status.className = isErr ? "err" : "";
  }

  // ---------------------------------------------------------------------------
  // The consumer. This is the part a real profiler would own: the hook hands over
  // one frame at a time and keeps nothing, so accumulating across frames — totals,
  // peaks, history — is the consumer's job and is done entirely here.
  //
  // Note what is *not* here: no reference to any player object, no walk of the
  // operation tree, no opcode table. A FrameMeasurement is self-describing.
  // ---------------------------------------------------------------------------
  var acc = null;
  function freshAcc() {
    return {
      frames: 0, total: 0, peak: 0, last: 0,
      lastPaint: 0, lastBetween: 0, betweenTotal: 0, loadOps: 0,
      history: [],                 // per-frame totals, for the sparkline
      types: new Map(),            // key -> {name, opCode, total, peak, last}
      insts: new Map(),            // id  -> {name, total, peak, last}
      badFrames: 0, lastProblem: ""
    };
  }

  function accumulate(a, m, opsPerFrame) {
    a.frames++;
    a.last = m.total;
    a.total += m.total;
    if (m.total > a.peak) a.peak = m.total;
    a.history.push(m.total);
    if (a.history.length > 600) a.history.shift();

    // Anything not seen this frame executed zero times this frame. Clearing first
    // keeps "frame" honest instead of showing a stale count from an earlier frame.
    a.types.forEach(function (t) { t.last = 0; });
    a.insts.forEach(function (t) { t.last = 0; });

    var i, r, e;
    for (i = 0; i < m.byType.length; i++) {
      r = m.byType[i];
      e = a.types.get(r.key);
      if (!e) { e = { name: r.name, opCode: r.opCode, total: 0, peak: 0, last: 0 };
                a.types.set(r.key, e); }
      e.last = r.count; e.total += r.count;
      if (r.count > e.peak) e.peak = r.count;
    }
    for (i = 0; i < m.byInstance.length; i++) {
      r = m.byInstance[i];
      e = a.insts.get(r.id);
      if (!e) { e = { name: r.name, total: 0, peak: 0, last: 0 }; a.insts.set(r.id, e); }
      e.last = r.count; e.total += r.count;
      if (r.count > e.peak) e.peak = r.count;
    }

    // Live invariants. A breakdown that does not add up to its own total is worse
    // than no breakdown, so the page checks rather than assumes — and says so on
    // screen when it fails.
    var st = 0, si = 0;
    for (i = 0; i < m.byType.length; i++) st += m.byType[i].count;
    for (i = 0; i < m.byInstance.length; i++) si += m.byInstance[i].count;
    st += m.unattributed; si += m.unattributed;
    var problem = "";
    if (st !== m.total) problem = "byType sums to " + st + ", total " + m.total;
    else if (si !== m.total) problem = "byInstance sums to " + si + ", total " + m.total;
    else if (m.total !== m.inPaint + m.betweenFrames)
      problem = "total " + m.total + " != inPaint " + m.inPaint
              + " + between " + m.betweenFrames;
    // inPaint, NOT total: `total` also carries work done between frames — click and touch
    // handlers running their actions — which the engine's own counter discards. Comparing
    // total here would flag a false failure the moment anyone taps the document.
    else if (opsPerFrame !== null && opsPerFrame !== m.inPaint)
      problem = "inPaint " + m.inPaint + " != getOpsPerFrame() " + opsPerFrame;
    if (problem) { a.badFrames++; a.lastProblem = problem; }
    a.unattributed = m.unattributed;
    a.lastPaint = m.inPaint;
    a.lastBetween = m.betweenFrames;
    // Frame 0 carries the document's load pass, which is one-time and would otherwise
    // read as recurring input cost. Keep it out of the running total, and label it.
    if (m.frame === 0) a.loadOps = m.betweenFrames;
    else a.betweenTotal += m.betweenFrames;
  }

  // ---------------------------------------------------------------------------
  // Rendering the panel. Throttled to ~10 Hz: at 60 fps, rebuilding two tables per
  // frame would make the page's own cost dominate what it is trying to show.
  // ---------------------------------------------------------------------------
  var pending = false, lastPaint = 0;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function (t) {
      pending = false;
      if (t - lastPaint < 100) { schedule(); return; }
      lastPaint = t;
      draw();
    });
  }

  function rankKey() { return $("rank").value; }

  function rows(map, isInst) {
    var k = rankKey(), out = [];
    map.forEach(function (v, key) { out.push({ key: key, v: v }); });
    out.sort(function (a, b) {
      var d = b.v[k] - a.v[k];
      return d || (b.v.total - a.v.total) || (a.v.name < b.v.name ? -1 : 1);
    });
    return isInst ? out.slice(0, 25) : out;
  }

  function fmt(n) { return n.toLocaleString(); }

  function fill(tbody, list, isInst) {
    var k = rankKey();
    var max = 0, i;
    for (i = 0; i < list.length; i++) max = Math.max(max, list[i].v[k]);
    var html = "";
    for (i = 0; i < list.length; i++) {
      var v = list[i].v;
      var pct = max > 0 ? (v[k] / max * 100) : 0;
      var cls = v.last === 0 ? ' class="muted"' : "";
      html += "<tr" + cls + ">";
      if (isInst) {
        html += "<td>#" + list[i].key + "</td><td>" + v.name + "</td>";
      } else {
        html += "<td>" + v.name + "</td><td class=\"muted\">"
             + (v.opCode >= 0 ? v.opCode : "—") + "</td>";
      }
      html += "<td>" + fmt(v.last) + "</td><td>" + fmt(v.peak) + "</td>"
           + "<td>" + fmt(v.total) + "</td>"
           + "<td class=\"bar-cell\"><i class=\"barfill\" style=\"width:"
           + pct.toFixed(1) + "%\"></i></td></tr>";
    }
    tbody.innerHTML = html || "<tr><td class=\"muted\">nothing measured yet</td></tr>";
  }

  function sparkline(a) {
    var cv = $("spark"), g = cv.getContext("2d");
    var W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    var h = a.history;
    if (!h.length) return;
    var max = a.peak || 1;
    // Fixed 600-sample window so the trace scrolls at a constant rate rather than
    // rescaling horizontally as history grows — a shifting x-axis makes a steady
    // document look like it is changing.
    var n = 600, step = W / n, base = Math.max(0, h.length - n);
    g.beginPath();
    for (var i = base; i < h.length; i++) {
      var x = (i - base) * step, y = H - (h[i] / max) * (H - 4) - 2;
      i === base ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.strokeStyle = "#3ddc84"; g.lineWidth = 1.25; g.stroke();
    g.lineTo((h.length - 1 - base) * step, H); g.lineTo(0, H); g.closePath();
    g.fillStyle = "rgba(61,220,132,.12)"; g.fill();
  }

  function draw() {
    if (!acc) return;
    $("n-last").textContent = fmt(acc.last);
    $("n-peak").textContent = fmt(acc.peak);
    $("n-mean").textContent = acc.frames ? Math.round(acc.total / acc.frames) : 0;
    $("n-paint").textContent = fmt(acc.lastPaint);
    $("n-between").textContent = fmt(acc.lastBetween);
    $("n-frames").textContent = fmt(acc.frames);
    $("n-types").textContent = fmt(acc.types.size);
    $("n-inst").textContent = fmt(acc.insts.size);
    fill($("types"), rows(acc.types, false), false);
    fill($("insts"), rows(acc.insts, true), true);
    sparkline(acc);

    if (acc.badFrames) {
      check.className = "bad";
      check.textContent = "INVARIANT FAILED on " + acc.badFrames + " frame(s) — "
                        + acc.lastProblem;
    } else {
      check.className = "ok";
      check.textContent = "invariants hold over " + fmt(acc.frames) + " frame(s): "
        + "byType and byInstance sum to total, total = inPaint + betweenFrames, "
        + "inPaint = getOpsPerFrame()"
        + (acc.loadOps ? " · " + fmt(acc.loadOps) + " in the one-time load pass" : "")
        + (acc.betweenTotal ? " · " + fmt(acc.betweenTotal) + " from input between frames"
                            : "")
        + (acc.unattributed ? " · " + acc.unattributed + " unattributed" : "");
    }
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------
  function arm() {
    if (!player) return;
    if (measuring) {
      player.setMeasurementSink(function (m) {
        // getOpsPerFrame() is the number the engine already tracked and the number
        // MAX_OP_COUNT is enforced against. Cross-checking against it is what makes
        // this page evidence rather than decoration.
        accumulate(acc, m, player.getOpsPerFrame ? player.getOpsPerFrame() : null);
        schedule();
      });
    } else {
      player.setMeasurementSink(null);
    }
  }

  $("measure").addEventListener("click", function () {
    measuring = !measuring;
    this.setAttribute("aria-pressed", String(measuring));
    this.textContent = "Measurement: " + (measuring ? "on" : "off");
    arm();
    say(measuring ? "measuring" : "measurement off — the hook is gone, not idle");
  });

  // Viewport sizing. The ratios are DocPlayerActivity's, so a document can be measured
  // here at the same shape it is laid out in on the device — the aspect a document is
  // given changes its layout, so comparing across two different ones proves nothing.
  //
  // The size picks the LONG side and the ratio derives the other. Sizing by width instead
  // would make 9:16 enormous and 4:3 squat at the same nominal "size", which defeats the
  // point of being able to switch ratios and still compare.
  function viewport() {
    var spec = $("aspect").value, long = parseInt($("vsize").value, 10);
    if (spec === "fill") {
      var box = document.getElementById("stage").getBoundingClientRect();
      return { w: Math.max(64, Math.round(box.width)),
               h: Math.max(64, Math.round(box.height || long)) };
    }
    var parts = spec.split(":"), rw = parseFloat(parts[0]), rh = parseFloat(parts[1]);
    return rw >= rh
      ? { w: long, h: Math.round(long * rh / rw) }
      : { w: Math.round(long * rw / rh), h: long };
  }

  function applyViewport() {
    var v = viewport();
    canvas.width = v.w; canvas.height = v.h;
    // resize() also reloads the document's window width/height variables, so an
    // expression-driven layout re-flows instead of drawing at the old size.
    if (player) { try { player.resize(v.w, v.h); } catch (e) {} }
    return v;
  }

  function viewportChanged() {
    // Reload rather than resize in place. resize() leaves a SIZING_SCALE document at its
    // load-time size and letterboxes it into the new box, so switching the viewport would
    // not match opening the same document at that viewport — and comparing a document
    // across two viewports is the whole reason this control exists. Reloading also resets
    // the counters, which is correct: a different layout is a different workload.
    if (lastBuf) { load(lastBuf, lastName); return; }
    var v = applyViewport();
    say(v.w + "x" + v.h);
  }
  $("aspect").addEventListener("change", viewportChanged);
  $("vsize").addEventListener("change", viewportChanged);
  // "fill" tracks the window; the fixed ratios do not, so only relayout when it applies.
  window.addEventListener("resize", function () {
    if ($("aspect").value === "fill") applyViewport();
  });

  $("reset").addEventListener("click", function () { acc = freshAcc(); draw(); });
  $("rank").addEventListener("change", draw);
  $("theme").addEventListener("change", function () {
    if (player) try { player.setTheme(this.value); } catch (e) {}
  });
  $("open").addEventListener("click", function () { $("file").click(); });
  $("file").addEventListener("change", function () {
    if (this.files && this.files[0]) readFile(this.files[0]);
  });

  function load(buf, name) {
    lastName = name;
    lastBuf = buf;
    acc = freshAcc();

    // A fresh canvas per load: reusing one leaks the WebGL context between documents,
    // and a document that used a shader can poison the next one.
    if (player) { try { player.stop && player.stop(); } catch (e) {} }
    var fresh = canvas.cloneNode(false);
    var v = viewport();
    fresh.width = v.w; fresh.height = v.h;
    canvas.parentNode.replaceChild(fresh, canvas);
    canvas = fresh;
    ["touchstart", "touchmove", "gesturestart"].forEach(function (t) {
      canvas.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false });
    });

    player = new window.RC.RcdPlayer(canvas);
    try { player.setTheme($("theme").value); } catch (e) {}
    // Armed *before* load, so the very first painted frame is measured. A profiler
    // that can only attach after startup misses exactly the frames worth seeing.
    arm();
    empty.style.display = "none";
    panel.style.display = "flex";
    say("loading " + name + "…");

    player.loadFromArrayBuffer(buf).then(function () {
      say(name + " · " + buf.byteLength.toLocaleString() + " bytes · "
          + canvas.width + "x" + canvas.height
          + " · interact with the canvas to drive the counts");
      draw();
    }).catch(function (e) {
      empty.style.display = "";
      say("failed to load " + name + ": " + e, true);
    });
  }

  function readFile(f) {
    var r = new FileReader();
    r.onload = function () { load(r.result, f.name); };
    r.onerror = function () { say("could not read " + f.name, true); };
    r.readAsArrayBuffer(f);
  }

  // Drag and drop over the whole window, with a counter so that dragging across child
  // elements does not flicker the overlay off.
  var depth = 0, dropEl = $("drop");
  window.addEventListener("dragenter", function (e) {
    e.preventDefault(); depth++; dropEl.classList.add("on");
  });
  window.addEventListener("dragover", function (e) { e.preventDefault(); });
  window.addEventListener("dragleave", function (e) {
    e.preventDefault(); if (--depth <= 0) { depth = 0; dropEl.classList.remove("on"); }
  });
  window.addEventListener("drop", function (e) {
    e.preventDefault(); depth = 0; dropEl.classList.remove("on");
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) readFile(f);
  });
})();
</script>
</body>
</html>
"""


def main() -> None:
    if not BUNDLE.exists():
        raise SystemExit(
            f"missing player bundle: {BUNDLE}\n"
            f"build it with: cd {ROOT} && npm run bundle")
    OUT.write_text(PAGE.replace("__PLAYER__", BUNDLE.read_text()))
    print(f"{OUT}  {OUT.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
