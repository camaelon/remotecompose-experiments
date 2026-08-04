// make-flappy.mjs — rebuild the standalone Flappy Droid pages.
//
//   node make-flappy.mjs
//
// Produces `web/flappy.html` (the demo) and `web/flappy-debug.html` (the same page plus
// a live variable table and `rcdump()`), each self-contained: the document and the whole
// player are inlined, so they run from file:// with no server.
//
// These are generated and are not checked in — they embed the player bundle, so they go
// stale the moment it changes. What *is* checked in is `web/flappy.rc`, the 4 KB
// document, which was built on an Android device by `DslDumpActivity` because the
// creation DSL cannot run on a plain JVM (`RcPlatformProfiles` is androidMain-only).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, 'web');
const PLAYER = join(here, '..', '..', 'players', 'typescript', 'web-player', 'bundle.js');
const RC = join(web, 'flappy.rc');

for (const [what, path] of [['player bundle', PLAYER], ['document', RC]]) {
    if (!existsSync(path)) {
        console.error(`missing ${what}: ${path}`);
        if (path === PLAYER) {
            console.error('build it with: cd ../../players/typescript && npm run bundle');
        }
        process.exit(1);
    }
}

const player = readFileSync(PLAYER, 'utf8');
const b64 = readFileSync(RC).toString('base64');

const DEBUG_OVERLAY = `
<div id="dbg" style="position:fixed;top:8px;left:8px;z-index:9;background:rgba(0,0,0,.78);
     color:#3ddc84;font:11px ui-monospace,Menlo,monospace;padding:8px 10px;border-radius:8px;
     white-space:pre;pointer-events:none;max-height:88vh;overflow:hidden"></div>
<script>
// Every document float from id 42 up, live. \`churn\` is the fraction of the last 60
// samples on which the value changed: a value written unconditionally every frame reads
// 1.00, one that only moves on a real event reads near 0. That column is what exposed a
// one-time assignment being re-run every frame.
(function () {
  var box = document.getElementById('dbg'), hist = {}, prev = {}, N = 60, last = [];
  function state() {
    var p = window.__player, ctx = p && p.remoteContext;
    var fm = ctx && ctx.mRemoteComposeState && ctx.mRemoteComposeState.mFloatMap;
    return (fm && fm.mKeys) ? fm : null;
  }
  function render(rows) {
    return '  id        value  churn\\n' + rows.map(function (r) {
      return String(r[0]).padStart(4) + '  ' +
             (Math.round(r[1] * 100) / 100 + '').padStart(11) + '  ' +
             r[2].toFixed(2) + (r[2] > 0.95 ? ' <- every frame' : '');
    }).join('\\n');
  }
  setInterval(function () {
    var fm = state();
    if (!fm) { box.textContent = 'no state yet (player not ready)'; return; }
    var rows = [];
    for (var i = 0; i < fm.mKeys.length; i++) {
      var k = fm.mKeys[i];
      if (k === -1 || k < 42) continue;
      var v = fm.mValues[i];
      if (!(k in hist)) hist[k] = [];
      hist[k].push(prev[k] !== undefined && prev[k] !== v ? 1 : 0);
      if (hist[k].length > N) hist[k].shift();
      prev[k] = v;
      rows.push([k, v, hist[k].reduce(function (a, b) { return a + b; }, 0) / hist[k].length]);
    }
    rows.sort(function (a, b) { return a[0] - b[0]; });
    last = rows;
    box.textContent = rows.length ? render(rows) : 'state found, but no floats at id >= 42';
  }, 250);
  // The overlay cannot be copied from, so the same table goes to the console.
  window.rcdump = function () {
    if (!last.length) { console.log('rcdump: no state yet'); return ''; }
    var t = render(last);
    console.log('--- rc floats (id >= 42) ---\\n' + t);
    return t;
  };
  var timer = setInterval(function () { if (last.length) window.rcdump(); }, 3000);
  window.rcdumpStop = function () { clearInterval(timer); console.log('rcdump: auto off'); };
  console.log('rcdump() prints the table; rcdumpStop() stops the 3s auto dump');
})();
</script>`;

function page(debug) {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>Flappy Droid — RemoteCompose${debug ? ' (debug)' : ''}</title>
<style>
  :root{--bg:#0b0f14;--panel:#141b24;--fg:#d7dee8;--muted:#8b95a5;--accent:#3ddc84;
        --mono:ui-monospace,SFMono-Regular,Menlo,monospace}
  *{box-sizing:border-box}
  html,body{height:100%}
  body{margin:0;background:var(--bg);color:var(--fg);display:flex;flex-direction:column;
       align-items:center;justify-content:center;gap:14px;
       font:14px/1.5 system-ui,-apple-system,sans-serif;
       -webkit-user-select:none;user-select:none;touch-action:none;overscroll-behavior:none}
  h1{margin:0;font-size:17px;font-weight:600;letter-spacing:.2px}
  h1 b{color:var(--accent);font-weight:600}
  p.sub{margin:0;color:var(--muted);font-size:13px;text-align:center;max-width:44ch}
  #frame{background:var(--panel);border-radius:14px;padding:10px;
         box-shadow:0 10px 40px rgba(0,0,0,.55);line-height:0}
  canvas{display:block;border-radius:8px;touch-action:none;cursor:pointer}
  footer{color:var(--muted);font-family:var(--mono);font-size:11.5px;text-align:center}
  button{background:#1b2330;color:var(--fg);border:1px solid #2a3644;border-radius:8px;
         padding:7px 16px;font:inherit;cursor:pointer}
  button:hover{border-color:var(--accent);color:var(--accent)}
</style>
</head>
<body>
  <h1>Flappy <b>Droid</b></h1>
  <p class="sub">Touch and <em>hold</em> anywhere on the canvas for jetpack thrust.
     Let go and the droid falls. Fly through the gaps to score.</p>
  <div id="frame"><canvas id="c" width="400" height="800"></canvas></div>
  <button id="restart">Restart</button>
  <footer id="status">loading…</footer>

<script>${player}</script>
<script>
(function () {
  var B64 = "${b64}";
  function bytes(s){var b=atob(s),a=new Uint8Array(b.length);
    for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a.buffer}
  var status = document.getElementById("status");
  var canvas = document.getElementById("c");
  if (!window.RC || !window.RC.RcdPlayer) { status.textContent = "player failed to load"; return; }

  var player = null;
  function start() {
    if (player) { try { player.destroy ? player.destroy() : player.stop && player.stop(); } catch (e) {} }
    var fresh = canvas.cloneNode(false);
    canvas.parentNode.replaceChild(fresh, canvas);
    canvas = fresh;
    player = new window.RC.RcdPlayer(canvas);
    ${debug ? 'window.__player = player;' : ''}
    try { player.setTheme("dark"); } catch (e) {}
    var buf = bytes(B64);
    player.loadFromArrayBuffer(buf).then(function () {
      status.textContent = buf.byteLength + " bytes · built by DslGameFlappyDroid.kt · played in the browser";
    }).catch(function (e) { status.textContent = "failed to play: " + e; });
    // The page itself must not scroll or select while playing.
    ["touchstart","touchmove","gesturestart"].forEach(function (t) {
      canvas.addEventListener(t, function (e) { e.preventDefault(); }, {passive:false});
    });
  }
  // The document carries no reset of its own, so restarting means loading it again into
  // a fresh player; the old one is torn down first so its WebGL context goes back.
  document.getElementById("restart").addEventListener("click", start);
  start();
})();
</script>${debug ? DEBUG_OVERLAY : ''}
</body>
</html>
`;
}

for (const [name, debug] of [['flappy.html', false], ['flappy-debug.html', true]]) {
    const out = join(web, name);
    writeFileSync(out, page(debug));
    console.log(`${name}  ${(readFileSync(out).length / 1024).toFixed(0)} KB`);
}
