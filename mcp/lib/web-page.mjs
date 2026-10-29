// A single self-contained HTML page that plays one RemoteCompose document with the
// TypeScript player: the player script and the .rc bytes are both inlined, so the file
// works from anywhere — a static host, an email attachment, or opened off the disk.
//
// Two kinds of page:
//   - the bare player (controls: false): just the document, filling the window or a box;
//   - the playground (controls: true): the document in a frame that can be resized freely
//     (drag handles, typed sizes, presets), with an editor for each host variable, density,
//     theme and play/pause — to see how a document behaves, not only how it looks. Its
//     state lives in the URL, so a link reproduces what is on screen.

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Text placed inside a <script> element must not contain "</script" (it would end the
// element early) or "<!--" (it can switch the parser into a script-data escape state).
const scriptSafe = (s) => s.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

// JSON placed inside a script: `<` escaped so no tag can be formed, and the two line
// separators JSON allows but older JS string literals did not.
const jsonInScript = (v) => JSON.stringify(v)
    .replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

// Shared by both pages: error reporting and host-variable plumbing.
const COMMON_JS = `
  var errorBox = document.getElementById("rc-error");
  function fail(e) {
    errorBox.textContent = "This document could not be played: " + (e && e.message ? e.message : e);
    errorBox.hidden = false;
    if (window.console) console.error(e);
  }
  window.addEventListener("error", function (ev) { fail(ev.error || ev.message); });

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
`;

/**
 * config: {
 *   title, layout: "fill" | "fixed", width, height (CSS px; fixed, or the playground's
 *   starting size), start: "fill" | "size" | "auto" (playground: begin filling the stage,
 *   at width x height, or at the document's size if it fits and filling otherwise),
 *   background (CSS colour), theme ("light" | "dark" | "auto"), density (number | "device"),
 *   variables: [{name, type, value}]   applied when the document loads,
 *   declared:  {name: type}            the document's settable host variables, for URL overrides,
 *   urlVariables: bool                 whether ?name=value in the URL overrides them,
 *   controls: bool                     the playground instead of the bare player,
 *   info: [{name, type, value}]        every declared variable with its document default
 *                                      (playground only; includes ones the page cannot set),
 *   document: {width, height}          the size the document declares (playground only),
 * }
 */
export function buildPage({ bundle, rcBase64, config }) {
    return config.controls ? playgroundPage(bundle, rcBase64, config) : barePage(bundle, rcBase64, config);
}

function barePage(bundle, rcBase64, config) {
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
${COMMON_JS}
  function density() {
    return C.density === "device" ? (window.devicePixelRatio || 1) : C.density;
  }
  // The box the document is shown in, in CSS pixels.
  function box() {
    return C.layout === "fill" ? [window.innerWidth, window.innerHeight] : [C.width, C.height];
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

// ── The playground ───────────────────────────────────────────────────

const PLAYGROUND_CSS = `
  :root {
    color-scheme: light dark;
    --bg: #f3f3f5; --panel: #ffffff; --line: #dcdce2; --text: #1d1d22; --muted: #6b6b76;
    --accent: #3a63e0; --field: #ffffff; --chip: #ececf1;
    --check-a: #e6e6ea; --check-b: #f6f6f8;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #17171b; --panel: #202026; --line: #34343c; --text: #ececf0; --muted: #9a9aa6;
      --accent: #7c9cff; --field: #15151a; --chip: #2c2c34;
      --check-a: #222228; --check-b: #1b1b20;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body {
    background: var(--bg); color: var(--text); font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
    display: grid; grid-template-rows: auto minmax(0, 1fr); grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: "bar bar" "stage panel";
  }
  button, input, select, textarea { font: inherit; color: inherit; }
  #bar {
    grid-area: bar; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px;
    padding: 8px 12px; background: var(--panel); border-bottom: 1px solid var(--line);
  }
  #bar h1 { font-size: 14px; font-weight: 600; margin: 0 6px 0 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 28ch; }
  .group { display: flex; align-items: center; gap: 4px; }
  .group > .lbl { color: var(--muted); margin-right: 2px; }
  .sep { width: 1px; align-self: stretch; background: var(--line); }
  .num { width: 62px; padding: 4px 6px; border: 1px solid var(--line); border-radius: 6px; background: var(--field); }
  select { padding: 4px 6px; border: 1px solid var(--line); border-radius: 6px; background: var(--field); }
  .btn {
    padding: 4px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--chip); cursor: pointer;
    white-space: nowrap;
  }
  .btn:hover { border-color: var(--accent); }
  .btn[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
  .spacer { flex: 1; }
  #stage {
    grid-area: stage; overflow: auto; position: relative;
    background-color: var(--check-b);
    background-image: linear-gradient(45deg, var(--check-a) 25%, transparent 25%, transparent 75%, var(--check-a) 75%),
                      linear-gradient(45deg, var(--check-a) 25%, transparent 25%, transparent 75%, var(--check-a) 75%);
    background-size: 20px 20px; background-position: 0 0, 10px 10px;
  }
  #stage.custom-bg { background-image: none; }
  #wrap { display: flex; min-width: 100%; min-height: 100%; width: max-content; padding: 28px 36px 44px; }
  #frame { position: relative; margin: 0 auto; align-self: flex-start; box-shadow: 0 0 0 1px var(--line), 0 6px 24px rgba(0,0,0,.18); }
  #frame.center { align-self: center; }
  #rc { position: relative; touch-action: none; overflow: hidden; }
  #rc canvas { display: block; }
  .handle { position: absolute; z-index: 2; touch-action: none; }
  .handle::after { content: ""; position: absolute; background: var(--muted); border-radius: 2px; opacity: .55; }
  .handle:hover::after, .handle.active::after { background: var(--accent); opacity: 1; }
  #h-r { top: 0; right: -14px; width: 14px; height: 100%; cursor: ew-resize; }
  #h-r::after { left: 5px; top: 50%; width: 4px; height: 36px; margin-top: -18px; }
  #h-b { left: 0; bottom: -14px; height: 14px; width: 100%; cursor: ns-resize; }
  #h-b::after { top: 5px; left: 50%; height: 4px; width: 36px; margin-left: -18px; }
  #h-c { right: -16px; bottom: -16px; width: 18px; height: 18px; cursor: nwse-resize; }
  #h-c::after { right: 4px; bottom: 4px; width: 10px; height: 10px; border-radius: 0 0 4px 0;
    background: none; border-right: 3px solid var(--muted); border-bottom: 3px solid var(--muted); }
  #h-c:hover::after, #h-c.active::after { background: none; border-color: var(--accent); }
  #size-tag {
    position: absolute; left: 0; top: 100%; margin-top: 18px; color: var(--muted); white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  #panel {
    grid-area: panel; width: 320px; overflow: auto; background: var(--panel); border-left: 1px solid var(--line);
    padding: 12px 14px 24px;
  }
  #panel[hidden] { display: none; }
  #panel h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 14px 0 8px; display: flex; align-items: center; }
  #panel h2:first-child { margin-top: 2px; }
  #panel h2 .btn { margin-left: auto; text-transform: none; letter-spacing: 0; font-size: 12px; padding: 2px 8px; color: var(--text); }
  #vars { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
  .empty { color: var(--muted); margin: 0; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; }
  dt { color: var(--muted); }
  dd { margin: 0; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  #rc-error {
    position: fixed; left: 16px; right: 16px; bottom: 16px; padding: 12px 14px; z-index: 10;
    color: #fff; background: #b3261e; border-radius: 8px; white-space: pre-wrap;
  }
  #rc-error[hidden] { display: none; }
  #toast {
    position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); padding: 6px 12px; border-radius: 6px;
    background: var(--text); color: var(--bg); opacity: 0; transition: opacity .2s; pointer-events: none; z-index: 11;
  }
  #toast.show { opacity: 1; }
  @media (max-width: 760px) {
    body { grid-template-rows: auto minmax(55vh, 1fr) auto; grid-template-columns: minmax(0, 1fr);
           grid-template-areas: "bar" "stage" "panel"; height: auto; min-height: 100%; }
    #panel { width: auto; border-left: 0; border-top: 1px solid var(--line); }
    #wrap { padding: 16px 28px 40px 16px; }
  }
`;

// <rc-variable name type value default>: an editor for one host variable. Fires a bubbling
// "rc-change" event {name, type, value} as it is edited; "reset" puts the default back.
// Float/int: a slider and a number field (the slider's range grows to fit what is typed);
// colour: a picker, an alpha slider and the #AARRGGBB text; string: a text field. Types the
// web player cannot set (long, float array) are shown read-only.
const VARIABLE_ELEMENT_JS = `
  var VAR_CSS =
    "*{box-sizing:border-box}" +
    ":host{display:block;min-width:0;border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--bg)}" +
    ".top{display:flex;align-items:center;gap:6px;margin-bottom:6px}" +
    ".name{font-weight:600;overflow-wrap:anywhere}" +
    ".type{font-size:11px;color:var(--muted);background:var(--chip);border-radius:4px;padding:0 5px}" +
    ".reset{margin-left:auto;border:0;background:none;color:var(--accent);cursor:pointer;font:inherit;font-size:12px;padding:0}" +
    ".reset[disabled]{color:var(--muted);opacity:.5;cursor:default}" +
    ".row{display:flex;align-items:center;gap:8px}" +
    "input,textarea{font:inherit;color:inherit}" +
    "input[type=range]{flex:1;min-width:0;accent-color:var(--accent)}" +
    "input[type=number],input[type=text],textarea{border:1px solid var(--line);border-radius:6px;background:var(--field);padding:4px 6px}" +
    "input[type=number]{width:84px}" +
    "input[type=text],textarea{flex:1;min-width:0;width:100%}" +
    "textarea{resize:vertical;min-height:52px}" +
    "input[type=color]{width:36px;height:28px;padding:0;border:1px solid var(--line);border-radius:6px;background:none}" +
    ".hex{font-family:ui-monospace,Menlo,monospace;width:100px!important;flex:none!important}" +
    ".alpha{display:flex;align-items:center;gap:6px;flex:1;min-width:0;color:var(--muted);font-size:11px}" +
    ".bounds{display:flex;justify-content:space-between;color:var(--muted);font-size:11px;margin-top:2px;font-variant-numeric:tabular-nums}" +
    ".ro{color:var(--muted);font-family:ui-monospace,Menlo,monospace;overflow-wrap:anywhere}" +
    ".bad{border-color:#d93025!important}";

  function niceRange(v, isInt) {
    if (!isInt && v >= 0 && v <= 1) return [0, 1];
    var m = Math.max(Math.abs(v) * 2, isInt ? 10 : 1);
    var p = Math.pow(10, Math.floor(Math.log10(m)));
    m = Math.ceil(m / p) * p;
    return v < 0 ? [-m, m] : [0, m];
  }
  function fmt(v, isInt) {
    return isInt ? String(Math.trunc(v)) : String(Math.round(v * 1e4) / 1e4);
  }
  function hex2(n) { return (n < 16 ? "0" : "") + n.toString(16).toUpperCase(); }
  function normColor(s) {
    var m = /^#?([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(s).trim());
    if (!m) return null;
    return "#" + (m[1].length === 6 ? "FF" + m[1] : m[1]).toUpperCase();
  }

  class RcVariable extends HTMLElement {
    connectedCallback() {
      if (this._root) return;
      this._root = this.attachShadow({ mode: "open" });
      this._type = this.getAttribute("type");
      this._name = this.getAttribute("name");
      this._default = this.getAttribute("default");
      var style = document.createElement("style");
      style.textContent = VAR_CSS;
      this._root.appendChild(style);
      var top = el("div", "top");
      top.appendChild(el("span", "name", this._name));
      top.appendChild(el("span", "type", this._type));
      this._reset = el("button", "reset", "reset");
      this._reset.title = "Back to " + this._default;
      this._reset.onclick = () => { this.value = this._default; this._emit(); };
      this._root.appendChild(top);
      var body = el("div");
      this._root.appendChild(body);
      if (this.hasAttribute("readonly")) {
        body.appendChild(el("div", "ro", this.getAttribute("value")));
        body.appendChild(el("div", "bounds", "the web player cannot set " + this._type + " variables"));
        return;
      }
      top.appendChild(this._reset);
      var build = { float: this._number, int: this._number, color: this._color, string: this._string }[this._type];
      build.call(this, body);
      this.value = this.getAttribute("value");
    }

    get value() { return this._value; }
    set value(v) { this._value = String(v); this._show(); this._reset.disabled = this._value === String(this._default); }

    _emit() {
      this._reset.disabled = this._value === String(this._default);
      this.dispatchEvent(new CustomEvent("rc-change", { bubbles: true, composed: true,
        detail: { name: this._name, type: this._type, value: this._value } }));
    }

    _number(body) {
      var isInt = this._type === "int";
      var row = el("div", "row");
      var range = el("input"); range.type = "range";
      var num = el("input"); num.type = "number"; num.step = isInt ? "1" : "any";
      row.appendChild(range); row.appendChild(num);
      var bounds = el("div", "bounds"), lo = el("span"), hi = el("span");
      bounds.appendChild(lo); bounds.appendChild(hi);
      body.appendChild(row); body.appendChild(bounds);
      var self = this;
      var r = niceRange(Number(this.getAttribute("default")) || 0, isInt);
      function setRange(a, b) {
        r = [a, b];
        range.min = a; range.max = b;
        range.step = isInt ? 1 : (b - a) / 500;
        lo.textContent = fmt(a, isInt); hi.textContent = fmt(b, isInt);
      }
      function widen(v) {   // grow the slider to include v, keeping round bounds
        if (v >= r[0] && v <= r[1]) return;
        var n = niceRange(v, isInt);
        setRange(Math.min(r[0], n[0]), Math.max(r[1], n[1]));
      }
      setRange(r[0], r[1]);
      this._show = function () {
        var v = Number(self._value);
        if (!isFinite(v)) return;
        widen(v);
        range.value = v;
        if (self._root.activeElement !== num) num.value = fmt(v, isInt);
      };
      range.oninput = function () {
        self._value = fmt(Number(range.value), isInt);
        num.value = self._value;
        self._emit();
      };
      num.oninput = function () {
        var v = Number(num.value);
        var ok = num.value.trim() !== "" && isFinite(v);
        num.classList.toggle("bad", !ok);
        if (!ok) return;
        if (isInt) v = Math.trunc(v);
        self._value = String(v);
        widen(v); range.value = v;
        self._emit();
      };
      num.onblur = function () { num.classList.remove("bad"); num.value = fmt(Number(self._value), isInt); };
    }

    _color(body) {
      var row = el("div", "row");
      var pick = el("input"); pick.type = "color";
      var hex = el("input", "hex"); hex.type = "text"; hex.spellcheck = false;
      var alphaBox = el("label", "alpha", "α");
      var alpha = el("input"); alpha.type = "range"; alpha.min = 0; alpha.max = 255; alpha.step = 1;
      alphaBox.appendChild(alpha);
      row.appendChild(pick); row.appendChild(hex); row.appendChild(alphaBox);
      body.appendChild(row);
      var self = this;
      this._show = function () {
        var c = normColor(self._value);
        if (!c) return;
        pick.value = "#" + c.slice(3).toLowerCase();
        alpha.value = parseInt(c.slice(1, 3), 16);
        if (self._root.activeElement !== hex) hex.value = c;
      };
      function fromParts() {
        self._value = "#" + hex2(Number(alpha.value)) + pick.value.slice(1).toUpperCase();
        hex.value = self._value;
        hex.classList.remove("bad");
        self._emit();
      }
      pick.oninput = fromParts;
      alpha.oninput = fromParts;
      hex.oninput = function () {
        var c = normColor(hex.value);
        hex.classList.toggle("bad", !c);
        if (!c) return;
        self._value = c;
        pick.value = "#" + c.slice(3).toLowerCase();
        alpha.value = parseInt(c.slice(1, 3), 16);
        self._emit();
      };
      hex.onblur = function () { hex.classList.remove("bad"); hex.value = self._value; };
    }

    _string(body) {
      var v = this.getAttribute("value") || "";
      var multi = v.indexOf("\\n") >= 0 || v.length > 40;
      var input = el(multi ? "textarea" : "input");
      if (!multi) input.type = "text";
      body.appendChild(input);
      var self = this;
      this._show = function () { if (input.value !== self._value) input.value = self._value; };
      input.oninput = function () { self._value = input.value; self._emit(); };
    }
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  if (!customElements.get("rc-variable")) customElements.define("rc-variable", RcVariable);
`;

function playgroundPage(bundle, rcBase64, config) {
    const t = escapeHtml(config.title);
    const bgStyle = config.background ? ` style="background-color:${escapeHtml(config.background)}"` : "";
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="RemoteCompose deploy (mcp/deploy-server.mjs)">
<title>${t}</title>
<style>${PLAYGROUND_CSS}</style>
</head>
<body>
<header id="bar">
  <h1 title="${t}">${t}</h1>
  <div class="group" title="Size of the box the document is laid out in, in CSS pixels">
    <span class="lbl">Size</span>
    <input id="w" class="num" type="number" min="16" max="4096" step="1" aria-label="Width">
    <span>×</span>
    <input id="h" class="num" type="number" min="16" max="4096" step="1" aria-label="Height">
    <button id="swap" class="btn" title="Swap width and height">⇄</button>
    <select id="preset" aria-label="Size preset"></select>
    <button id="fit" class="btn" aria-pressed="false" title="Follow the window: the document fills the area and re-lays out as it changes">Fill</button>
  </div>
  <span class="sep"></span>
  <div class="group">
    <span class="lbl">Density</span>
    <select id="density" aria-label="Density"></select>
  </div>
  <div class="group">
    <span class="lbl">Theme</span>
    <select id="theme" aria-label="Theme">
      <option value="auto">auto</option><option value="light">light</option><option value="dark">dark</option>
    </select>
  </div>
  <span class="sep"></span>
  <div class="group">
    <button id="play" class="btn" title="Pause or resume animation">Pause</button>
    <button id="restart" class="btn" title="Reload the document: animations start over, touch state is reset">Restart</button>
  </div>
  <span class="spacer"></span>
  <div class="group">
    <button id="copy" class="btn" title="Copy a link to exactly this: size, density, theme and variable values">Copy link</button>
    <button id="toggle" class="btn" aria-pressed="true" title="Show or hide the side panel">Panel</button>
  </div>
</header>
<main id="stage"${bgStyle}${config.background ? ' class="custom-bg"' : ""}>
  <div id="wrap">
    <div id="frame">
      <div id="rc" role="img" aria-label="${t}"></div>
      <div id="h-r" class="handle" title="Drag to resize"></div>
      <div id="h-b" class="handle" title="Drag to resize"></div>
      <div id="h-c" class="handle" title="Drag to resize"></div>
      <div id="size-tag"></div>
    </div>
  </div>
</main>
<aside id="panel">
  <h2>Host variables <button id="reset-all" class="btn" hidden>Reset all</button></h2>
  <div id="vars"></div>
  <h2>Document</h2>
  <dl id="info"></dl>
</aside>
<div id="rc-error" hidden></div>
<div id="toast"></div>
<script>
${scriptSafe(bundle)}
</script>
<script>
(function () {
  var C = ${jsonInScript(config)};
  var DATA = "${rcBase64}";
  var $ = function (id) { return document.getElementById(id); };
  var host = $("rc"), stage = $("stage"), frame = $("frame");
${COMMON_JS}
${VARIABLE_ELEMENT_JS}
  var MIN = 16, MAX = 4096;
  var clampSize = function (v) { return Math.max(MIN, Math.min(MAX, Math.round(v))); };
  var DOC = C.document || {};
  var PRESETS = [
    ["Watch", 192, 192], ["Small phone", 320, 568], ["Phone", 360, 780], ["Large phone", 412, 915],
    ["Tablet", 800, 1280], ["Laptop", 1280, 800], ["Desktop", 1920, 1080],
    ["Widget 2×2", 180, 180], ["Widget 4×2", 360, 180], ["Widget 4×1", 360, 90]
  ];
  if (DOC.width > 0 && DOC.height > 0) PRESETS.unshift(["Document", DOC.width, DOC.height]);

  // ── State, and its reflection in the URL: ?var=value for variables (as the bare page
  // reads them), #w=&h=&d=&t=&fill= for the view. ──
  var hash = new URLSearchParams(location.hash.slice(1));
  var query = new URLSearchParams(location.search);
  var S = {
    w: C.width, h: C.height, fill: false,
    density: C.density, theme: C.theme,
    values: {}, defaults: {}, playing: true
  };
  (C.info || []).forEach(function (v) {
    if (C.declared[v.name]) S.defaults[v.name] = String(v.value);
  });
  (C.variables || []).forEach(function (v) { S.defaults[v.name] = String(v.value); });
  Object.keys(S.defaults).forEach(function (n) {
    S.values[n] = C.urlVariables && query.has(n) ? query.get(n) : S.defaults[n];
  });
  if (hash.has("w") && hash.has("h")) { S.w = clampSize(+hash.get("w") || S.w); S.h = clampSize(+hash.get("h") || S.h); }
  else if (hash.get("fill") === "1") S.fill = true;
  else if (C.start === "fill") S.fill = true;
  else if (C.start === "auto") S.fill = null;   // decided once the stage can be measured
  if (hash.has("d")) S.density = hash.get("d") === "device" ? "device" : (+hash.get("d") > 0 ? +hash.get("d") : S.density);
  if (/^(auto|light|dark)$/.test(hash.get("t") || "")) S.theme = hash.get("t");

  var urlTimer = 0;
  function syncUrl() {
    clearTimeout(urlTimer);
    urlTimer = setTimeout(function () {
      try { history.replaceState(null, "", currentUrl()); } catch (e) { /* file:// in some browsers */ }
    }, 150);
  }
  function currentUrl() {
    var q = new URLSearchParams(location.search);
    Object.keys(S.values).forEach(function (n) {
      if (S.values[n] !== S.defaults[n]) q.set(n, S.values[n]); else q.delete(n);
    });
    var h = new URLSearchParams();
    if (S.fill) h.set("fill", "1"); else { h.set("w", S.w); h.set("h", S.h); }
    h.set("d", S.density); h.set("t", S.theme);
    var qs = q.toString();
    return location.pathname + (qs ? "?" + qs : "") + "#" + h.toString();
  }

  // ── The player ──
  function density() { return S.density === "device" ? (window.devicePixelRatio || 1) : S.density; }
  function stageBox() {
    var cs = getComputedStyle($("wrap"));
    return [stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
            stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)];
  }

  var handle, fitFrame = 0;
  function fit() {
    cancelAnimationFrame(fitFrame);
    fitFrame = 0;
    if (S.fill) { var b = stageBox(); S.w = clampSize(b[0]); S.h = clampSize(b[1]); }
    var d = density();
    host.style.width = S.w + "px";
    host.style.height = S.h + "px";
    frame.classList.toggle("center", S.h < stageBox()[1]);
    if (handle) handle.resize(Math.max(1, Math.round(S.w * d)), Math.max(1, Math.round(S.h * d)));
    showSize();
  }
  function fitSoon() { if (!fitFrame) fitFrame = requestAnimationFrame(fit); }

  function applyVariables() {
    var ctx = handle && handle.player.getRemoteContext();
    if (!ctx) return;
    Object.keys(S.values).forEach(function (n) { setVariable(ctx, n, C.declared[n], S.values[n]); });
  }

  function load() {
    return handle.loadFromBase64(DATA).then(function () {
      if (!S.playing) handle.player.pause();
      fit();
      showInfo();
    }).catch(fail);
  }

  // ── Toolbar ──
  var wIn = $("w"), hIn = $("h"), preset = $("preset"), fitBtn = $("fit"), dens = $("density"), theme = $("theme");
  PRESETS.forEach(function (p, i) {
    var o = document.createElement("option");
    o.value = i; o.textContent = p[0] + " · " + p[1] + "×" + p[2];
    preset.appendChild(o);
  });
  var custom = document.createElement("option");
  custom.value = ""; custom.textContent = "Custom"; custom.hidden = true;
  preset.insertBefore(custom, preset.firstChild);
  ["device", 1, 1.5, 2, 2.625, 3, 4].concat(typeof S.density === "number" ? [S.density] : [])
    .filter(function (v, i, a) { return a.indexOf(v) === i; })
    .forEach(function (v) {
      var o = document.createElement("option");
      o.value = v;
      o.textContent = v === "device" ? "device (" + (window.devicePixelRatio || 1) + "×)" : v + "×";
      dens.appendChild(o);
    });

  function showSize() {
    if (document.activeElement !== wIn) wIn.value = S.w;
    if (document.activeElement !== hIn) hIn.value = S.h;
    var i = PRESETS.findIndex(function (p) { return p[1] === S.w && p[2] === S.h; });
    preset.value = S.fill || i < 0 ? "" : String(i);
    custom.textContent = S.fill ? "Window" : "Custom";
    fitBtn.setAttribute("aria-pressed", String(S.fill));
    var d = density();
    $("size-tag").textContent = S.w + " × " + S.h + " px  ·  " + d + "×  =  " +
      Math.round(S.w * d) + " × " + Math.round(S.h * d) + " device px";
    syncUrl();
  }
  function setSize(w, h) { S.fill = false; S.w = clampSize(w); S.h = clampSize(h); fitSoon(); }

  function onSizeInput() {
    var w = +wIn.value, h = +hIn.value;
    if (w >= MIN && h >= MIN) setSize(w, h);
  }
  wIn.addEventListener("input", onSizeInput);
  hIn.addEventListener("input", onSizeInput);
  wIn.addEventListener("blur", showSize);
  hIn.addEventListener("blur", showSize);
  $("swap").onclick = function () { setSize(S.h, S.w); };
  preset.onchange = function () { var p = PRESETS[+preset.value]; if (p) setSize(p[1], p[2]); };
  fitBtn.onclick = function () { S.fill = !S.fill; fit(); };
  dens.onchange = function () {
    S.density = dens.value === "device" ? "device" : +dens.value;
    handle.player.setDensity(density());
    fit();
  };
  theme.onchange = function () { S.theme = theme.value; handle.player.setTheme(S.theme); syncUrl(); };
  $("play").onclick = function () {
    S.playing = !S.playing;
    if (S.playing) handle.player.play(); else handle.player.pause();
    this.textContent = S.playing ? "Pause" : "Play";
  };
  $("restart").onclick = function () { load(); };
  var panel = $("panel");
  $("toggle").onclick = function () {
    panel.hidden = !panel.hidden;
    this.setAttribute("aria-pressed", String(!panel.hidden));
    if (S.fill) fitSoon();
  };
  var toastTimer = 0;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1600);
  }
  $("copy").onclick = function () {
    var url = location.href.split(/[?#]/)[0] + currentUrl().slice(location.pathname.length);
    var done = function () { toast("Link copied"); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { fallbackCopy(url); });
    } else fallbackCopy(url);
  };
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast("Link copied"); } catch (e) { toast(text); }
    ta.remove();
  }

  // ── Drag handles. The frame is centred horizontally, so while it is narrower than the
  // stage both edges move: the width changes by twice the pointer travel to keep the
  // handle under the pointer. ──
  ["h-r", "h-b", "h-c"].forEach(function (id) {
    var el = $(id), axisX = id !== "h-b", axisY = id !== "h-r";
    el.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add("active");
      var x0 = e.clientX, y0 = e.clientY, w0 = S.w, h0 = S.h;
      var centred = S.w < stageBox()[0];
      var centredY = frame.classList.contains("center");
      function move(ev) {
        var w = axisX ? w0 + (ev.clientX - x0) * (centred ? 2 : 1) : S.w;
        var h = axisY ? h0 + (ev.clientY - y0) * (centredY ? 2 : 1) : S.h;
        setSize(w, h);
      }
      function up() {
        el.classList.remove("active");
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
      }
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    });
  });

  // ── Variables panel ──
  var vars = $("vars");
  var editors = {};
  if (!(C.info || []).length) {
    var p = document.createElement("p");
    p.className = "empty";
    p.textContent = "This document declares no host variables.";
    vars.appendChild(p);
  }
  (C.info || []).forEach(function (v) {
    var e = document.createElement("rc-variable");
    e.setAttribute("name", v.name);
    e.setAttribute("type", v.type);
    if (C.declared[v.name]) {
      e.setAttribute("default", S.defaults[v.name]);
      e.setAttribute("value", S.values[v.name]);
      editors[v.name] = e;
    } else {
      e.setAttribute("readonly", "");
      e.setAttribute("value", typeof v.value === "string" ? v.value : JSON.stringify(v.value));
    }
    vars.appendChild(e);
  });
  var resetAll = $("reset-all");
  resetAll.hidden = !Object.keys(editors).length;
  resetAll.onclick = function () {
    Object.keys(editors).forEach(function (n) { S.values[n] = S.defaults[n]; editors[n].value = S.defaults[n]; });
    applyVariables(); relayout(); syncUrl();
  };
  // A changed variable can change the layout (a longer string, a size), not only the
  // paint: re-run the layout pass, which resize does, on the next frame.
  var relayoutFrame = 0;
  function relayout() {
    if (relayoutFrame) return;
    relayoutFrame = requestAnimationFrame(function () { relayoutFrame = 0; fit(); });
  }
  vars.addEventListener("rc-change", function (ev) {
    var d = ev.detail;
    S.values[d.name] = d.value;
    var ctx = handle && handle.player.getRemoteContext();
    if (ctx) setVariable(ctx, d.name, d.type, d.value);
    relayout();
    syncUrl();
  });

  function showInfo() {
    var rows = [
      ["Declared size", DOC.width > 0 ? DOC.width + " × " + DOC.height : "none"],
      ["Host variables", (C.info || []).length + (Object.keys(editors).length !== (C.info || []).length
        ? " (" + Object.keys(editors).length + " editable here)" : "")],
      ["Ops / frame", handle ? String(handle.player.getOpsPerFrame() || "–") : "–"],
      ["Engine", "TypeScript player"]
    ];
    var dl = $("info");
    dl.textContent = "";
    rows.forEach(function (r) {
      var dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = r[0]; dd.textContent = r[1];
      dl.appendChild(dt); dl.appendChild(dd);
    });
  }

  // ── Start ──
  if (S.fill === null) {
    // No size asked for: the document's own size when it fits the stage, else fill it.
    var b = stageBox();
    S.fill = !(DOC.width > 0 && DOC.width <= b[0] && DOC.height <= b[1]);
    if (!S.fill) { S.w = DOC.width; S.h = DOC.height; }
  }
  dens.value = String(S.density);
  theme.value = S.theme;
  try {
    handle = RC.createPlayer(host, {
      theme: S.theme,
      onLoad: function () { try { applyVariables(); } catch (e) { fail(e); } }
    });
    handle.player.setDensity(density());
    fit();   // before loading: the load lays the document out at the canvas size
    load();
  } catch (e) {
    fail(e);
    return;
  }
  new ResizeObserver(function () { if (S.fill) fitSoon(); else frame.classList.toggle("center", S.h < stageBox()[1]); })
    .observe(stage);
  setInterval(showInfo, 1000);
})();
</script>
</body>
</html>
`;
}
