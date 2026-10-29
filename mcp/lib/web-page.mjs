// A single self-contained HTML page that plays one RemoteCompose document with the
// TypeScript player: the player script and the .rc bytes are both inlined, so the file
// works from anywhere — a static host, an email attachment, or opened off the disk.

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Text placed inside a <script> element must not contain "</script" (it would end the
// element early) or "<!--" (it can switch the parser into a script-data escape state).
const scriptSafe = (s) => s.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

// JSON placed inside a script: `<` escaped so no tag can be formed, and the two line
// separators JSON allows but older JS string literals did not.
const jsonInScript = (v) => JSON.stringify(v)
    .replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/**
 * config: {
 *   title, layout: "fill" | "fixed", width, height (CSS px, fixed only),
 *   background (CSS colour), theme ("light" | "dark" | "auto"), density (number | "device"),
 *   variables: [{name, type, value}]   applied when the document loads,
 *   declared:  {name: type}            the document's host variables, for URL overrides,
 *   urlVariables: bool                 whether ?name=value in the URL overrides them,
 * }
 */
export function buildPage({ bundle, rcBase64, config }) {
    const bg = config.background ?? (config.layout === "fill" ? "#000000" : "#f0f0f0");
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="RemoteCompose deploy (mcp/deploy-server.mjs)">
<title>${escapeHtml(config.title)}</title>
<style>
  html, body { margin: 0; height: 100%; background: ${escapeHtml(bg)}; }
  body { display: flex; align-items: center; justify-content: center; overflow: hidden; }
  #rc { position: relative; flex: none; touch-action: none; }
  #rc canvas { display: block; }
  #rc-error {
    position: fixed; left: 16px; right: 16px; bottom: 16px; padding: 12px 14px;
    font: 13px/1.4 system-ui, sans-serif; color: #fff; background: #b3261e; border-radius: 8px;
    white-space: pre-wrap;
  }
  #rc-error[hidden] { display: none; }
</style>
</head>
<body>
<div id="rc" role="img" aria-label="${escapeHtml(config.title)}"></div>
<div id="rc-error" hidden></div>
<script>
${scriptSafe(bundle)}
</script>
<script>
(function () {
  var C = ${jsonInScript(config)};
  var DATA = "${rcBase64}";
  var host = document.getElementById("rc");
  var errorBox = document.getElementById("rc-error");

  function fail(e) {
    errorBox.textContent = "This document could not be played: " + (e && e.message ? e.message : e);
    errorBox.hidden = false;
    if (window.console) console.error(e);
  }
  window.addEventListener("error", function (ev) { fail(ev.error || ev.message); });

  function density() {
    return C.density === "device" ? (window.devicePixelRatio || 1) : C.density;
  }
  // The box the document is shown in, in CSS pixels.
  function box() {
    return C.layout === "fill" ? [window.innerWidth, window.innerHeight] : [C.width, C.height];
  }

  // "#RRGGBB" / "#AARRGGBB" -> the signed ARGB int the engine stores colours as.
  function parseColor(s) {
    var m = /^#?([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(s).trim());
    if (!m) return null;
    var v = parseInt(m[1], 16);
    if (m[1].length === 6) v = 0xff000000 + v;
    return v | 0;
  }

  function setVariable(ctx, name, type, value) {
    if (type === "float") { var f = Number(value); if (isFinite(f)) ctx.setNamedFloatOverride(name, f); }
    else if (type === "int") { var n = Number(value); if (isFinite(n)) ctx.setNamedIntegerOverride(name, Math.trunc(n)); }
    else if (type === "color") { var c = parseColor(value); if (c !== null) ctx.setNamedColorOverride(name, c); }
    else if (type === "string") ctx.setNamedStringOverride(name, String(value));
  }

  function applyVariables() {
    var ctx = handle.player.getRemoteContext();
    if (!ctx) return;
    (C.variables || []).forEach(function (v) { setVariable(ctx, v.name, v.type, v.value); });
    if (C.urlVariables) {
      var q = new URLSearchParams(window.location.search);
      Object.keys(C.declared || {}).forEach(function (name) {
        if (q.has(name)) setVariable(ctx, name, C.declared[name], q.get(name));
      });
    }
  }

  // The player lays the document out in physical pixels (the canvas size) at the given
  // density, and shows the canvas at size / density CSS pixels: so CSS box x density.
  function fit() {
    var b = box(), d = density();
    host.style.width = b[0] + "px";
    host.style.height = b[1] + "px";
    handle.resize(Math.max(1, Math.round(b[0] * d)), Math.max(1, Math.round(b[1] * d)));
  }

  var handle;
  try {
    handle = RC.createPlayer(host, {
      theme: C.theme,
      onLoad: function () { try { applyVariables(); } catch (e) { fail(e); } }
    });
    handle.player.setDensity(density());
    fit();   // before loading: the load lays the document out at the canvas size
    handle.loadFromBase64(DATA).catch(fail);
  } catch (e) {
    fail(e);
    return;
  }
  if (C.layout === "fill") {
    var pending = 0;
    window.addEventListener("resize", function () {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(fit);
    });
  }
})();
</script>
</body>
</html>
`;
}
