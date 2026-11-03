// Public web pages of the example catalog, served by rc-examples (examples-server.mjs) next to
// its MCP endpoint, without auth (the catalog is public content):
//   GET <base>/                 the leaf library components (placed inside a layout), as a grid
//                               of renders, filterable
//   GET <base>/layouts/         the components that arrange other components (ListDetail, NavShell...)
//   GET <base>/structures/      the screen structures, each opening its first example
//   GET <base>/showcases/       the SHW showcases
//   GET <base>/demos/           every other example (/examples/ redirects here), .rc size up front
//   GET <base>/play/<id>/       a playground for one example or component demo: the deploy
//                               server's page (lib/web-page.mjs), built on demand; #t=light
//                               or #t=dark opens it in that theme, #t=mono-dark or
//                               #t=mono-light too when the document switches to mono at
//                               run time (componentTheme "auto": theme.mono), else goes to
//                               that variant's page. Its look control
//                               switches Auto / Light / Dark / Mono / Mono light, and its
//                               JSON buttons show doc.json and the expanded JSON
//   GET <base>/play/<id>/<name>/  the same for a render with a document of its own
//                               (meta.check.renders with a componentTheme: doc.<name>.rc)
//   GET <base>/img/<id>.png     its render.png
//   GET <base>/thumb/<id>[/<name>].png?w=120|240|480|960  a render scaled down for the grids,
//                               made once and cached on disk (lib/thumbs.mjs). Grid image URLs
//                               carry ?v=<file mtime>, so they are cached for a year.
//   GET <base>/img/<id>/<name>.png  one of its other renders (render-<name>.png: light, dark, mono-dark,
//                               mono-light)
//   GET <base>/json/<id>.json   its doc.json (and /json/<id>.expanded.json, /json/<id>.mono-dark.expanded.json,
//                               /json/<Name>.component.json)
//   GET|POST <base>/account/...  accounts, tokens, usage, published pages (lib/account-web.mjs),
//                               when accounts are on (lib/accounts.mjs)
//   GET|POST <base>/oauth/...    the OAuth authorization server for every MCP server (lib/oauth.mjs)
// <base> is wherever the reverse proxy mounts the server (/examples/ on the VPS); every link is
// relative, so the pages work under any prefix.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { brotliCompressSync, gzipSync, constants as zlibConstants } from "node:zlib";
import path from "node:path";
import { EXAMPLES_DIR, loadCatalog, loadGenerated } from "./catalog.mjs";
import { buildPage, escapeHtml as esc, formatBytes } from "./web-page.mjs";
import { playerBundle } from "./web-player.mjs";
import { MONO_VAR, monoPalettes, usesComponents } from "./components.mjs";
import { compileComponents, jsonToRc } from "./json2rc.mjs";
import { STRUCTURES } from "./structures.mjs";
import { thumbnail } from "./thumbs.mjs";
import { accountRoute } from "./account-web.mjs";
import { oauthRoute } from "./oauth.mjs";
import { accountsEnabled, requestAccount } from "./accounts.mjs";

const WEB_SETTABLE = new Set(["float", "int", "color", "string", "float_array"]);
const HEADERS = {
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
};

/** An example (by id, "INT-04") or a component demo (by name, "Gauge"). */
function entry(id) {
    const C = loadCatalog();
    const g = /^GEN-\d+$/.test(id) ? loadGenerated().find((x) => x.id === id) : null;
    return C.byId.get(id) ?? C.demos.get(id) ?? (g ? { ...g, family: "GEN", summary: g.prompt } : null);
}

// Compressed bodies (brotli or gzip, as the browser accepts), cached by content hash: the
// pages are mostly text and compress to about a quarter.
const squeezed = new Map();
function send(req, res, status, type, body, extra = {}) {
    let buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const accept = String(req.headers["accept-encoding"] ?? "");
    const enc = buf.length > 1024 && !/^image\//.test(type) ? (/\bbr\b/.test(accept) ? "br" : /\bgzip\b/.test(accept) ? "gzip" : null) : null;
    if (enc) {
        const key = createHash("sha1").update(buf).digest("hex") + enc;
        let z = squeezed.get(key);
        if (!z) {
            z = enc === "br" ? brotliCompressSync(buf, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 9 } }) : gzipSync(buf, { level: 9 });
            if (squeezed.size > 300) squeezed.clear();
            squeezed.set(key, z);
        }
        buf = z;
    }
    res.writeHead(status, { "Content-Type": type, "Content-Length": buf.length, ...HEADERS, "Vary": "Accept-Encoding",
        ...(enc ? { "Content-Encoding": enc } : {}), ...extra });
    res.end(req.method === "HEAD" ? undefined : buf);
    return true;
}

// The player script, served once under its hash (/player/<hash>.js) so every playground page
// references it instead of inlining ~480 KB, and the browser caches it for good.
let playerFile = null;
async function playerScript() {
    const code = await playerBundle();
    if (!playerFile || playerFile.code !== code) playerFile = { code, name: createHash("sha256").update(code).digest("hex").slice(0, 16) + ".js" };
    return playerFile;
}

const playCache = new Map();   // id[/variant] -> {mtime, html}

/** The other renders of an example (meta.check.renders), in order: [{name, own}], where own
 *  says the render has a document of its own (doc.<name>.rc, a componentTheme). */
function renders(e) {
    const dir = path.join(EXAMPLES_DIR, e.folder);
    const listed = Object.keys(e.derived?.renders ?? {});
    const names = listed.length ? listed : ["light", "dark", "mono-dark", "mono-light"];
    return names.filter((n) => existsSync(path.join(dir, `render-${n}.png`)))
        .map((name) => ({ name, own: existsSync(path.join(dir, `doc.${name}.rc`)), theme: e.derived?.renders?.[name]?.theme ?? (["light", "dark"].includes(name) ? name : undefined) }));
}

/** The document's themed colours: name -> "light #.. / dark #..". */
function themedColors(e, variant) {
    const dir = path.join(EXAMPLES_DIR, e.folder);
    const file = [variant ? `doc.${variant}.expanded.json` : "doc.expanded.json", ...(variant ? [] : ["doc.json"])]
        .map((f) => path.join(dir, f)).find((f) => existsSync(f));
    const out = new Map();
    try {
        const colors = JSON.parse(readFileSync(file, "utf8")).resources?.colors ?? {};
        const entries = Array.isArray(colors)
            ? colors.map((c) => (!("name" in c) && Object.keys(c).length === 1 ? Object.entries(c)[0] : [c.name, c.value]))
            : Object.entries(colors);
        for (const [k, v] of entries) if (v && typeof v === "object" && "light" in v && "dark" in v) out.set(k, `light ${v.light} / dark ${v.dark}`);
    } catch { /* no themed colours */ }
    return out;
}

// The variants the playground's look control offers next to Auto / Light / Dark: the two
// monochrome documents (componentTheme mono and mono-light), when the example has them.
const LOOK_VARIANTS = [
    ["mono-dark", "Mono dark", "Mono dark: light on black, for always-on displays and OLED (componentTheme \"mono-dark\", its own document doc.mono-dark.rc)"],
    ["mono-light", "Mono light", "Mono light: dark on white, for e-ink and other reflective displays (componentTheme \"mono-light\", doc.mono-light.rc)"],
];

/** The playground's JSON buttons: the document, its expansion, and the variant's expansion. */
function jsonButtons(e, variant, up) {
    const dir = path.join(EXAMPLES_DIR, e.folder);
    const id = encodeURIComponent(e.id), short = e.folder.split("/").pop();
    const out = [{ label: "JSON", url: `${up}json/${id}.json`, file: `${short}.json`, title: "The document as written (doc.json)" }];
    if (existsSync(path.join(dir, "doc.expanded.json"))) {
        out.push({ label: "Expanded JSON", url: `${up}json/${id}.expanded.json`, file: `${short}.expanded.json`,
            title: "The document with its components expanded (doc.expanded.json): what the converter sees" });
    }
    if (variant && existsSync(path.join(dir, `doc.${variant}.expanded.json`))) {
        out.push({ label: `Expanded JSON (${variant})`, url: `${up}json/${id}.${variant}.expanded.json`, file: `${short}.${variant}.expanded.json`,
            title: `The ${variant} document: components expanded with componentTheme "${variant}" (doc.${variant}.expanded.json)` });
    }
    return out;
}

/** meta.prefer_theme ("light" | "dark"), read from the example's meta.json (no rebuild needed). */
function preferTheme(e) {
    try { const t = JSON.parse(readFileSync(path.join(EXAMPLES_DIR, e.folder, "meta.json"), "utf8")).prefer_theme; return t === "dark" || t === "light" ? t : null; }
    catch { return null; }
}

async function playground(e, variant) {
    const rcPath = path.join(EXAMPLES_DIR, e.folder, variant ? `doc.${variant}.rc` : "doc.rc");
    const mtime = statSync(rcPath).mtimeMs;
    const key = variant ? `${e.id}/${variant}` : e.id;
    const hit = playCache.get(key);
    if (hit && hit.mtime === mtime) return hit.html;
    const rcBytes = readFileSync(rcPath);
    const { width = 400, height = 400 } = e.derived?.header ?? {};
    let vars = (variant ? e.derived?.renders?.[variant]?.host_variables : e.derived?.host_variables) ?? [];
    // A themed colour ({light, dark}) follows the theme menu: setting it from the panel would
    // pin it to one value (the report's, the dark one), so it is shown, not settable.
    const themed = themedColors(e, variant);
    if (themed.size) vars = vars.map((v) => (themed.has(v.name) ? { ...v, type: "themed color", value: themed.get(v.name), themed: true } : v));
    // Most examples are drawn in pixels; "device" density would show them at half size on a
    // 2x screen. Only a document laid out in dp (header densityBehavior) follows the device.
    let dp = false, source = null;
    try { source = JSON.parse(readFileSync(path.join(EXAMPLES_DIR, e.folder, "doc.json"), "utf8")); dp = !!source.header?.densityBehavior; } catch { /* keep 1 */ }
    // componentTheme "auto": the document switches to mono itself (MONO_VAR and its named
    // colours, with the palettes its own colours give), in place of a separate document.
    const mono = !variant && vars.some((v) => v.name === MONO_VAR) ? { variable: MONO_VAR, palettes: monoPalettes(source ?? {}) } : undefined;
    // The same JSON expanded for each mono look (the components' mono implementation, the
    // call sites unchanged): the look control swaps it in place.
    let looks = null;
    if (!variant && !mono && source && usesComponents(source) && [undefined, "auto", "light-dark"].includes(source.componentTheme)) {
        try {
            const dir = path.join(EXAMPLES_DIR, e.folder);
            looks = Object.fromEntries(["mono-dark", "mono-light"].map((look) =>
                [look, Buffer.from(jsonToRc(compileComponents(structuredClone(source), dir, { theme: look }).doc, dir)).toString("base64")]));
        } catch { looks = null; }   // the page still works: the variants' own pages, if any
    }
    const player = await playerScript();
    const html = buildPage({
        bundle: { src: `${variant ? "../../../" : "../../"}player/${player.name}` },
        rcBase64: rcBytes.toString("base64"),
        config: {
            title: `${e.id}${variant ? ` (${variant})` : ""} · ${e.title ?? e.id}`, layout: "fill", width, height, controls: true,
            // The Kobento logo, top left: back to the site's front page (the domain root).
            home: { href: "/", label: "Kobento", title: "Kobento home", logo: MARK },
            // The inspector (inspector/dist, served at <base>/inspector/) on this very document.
            inspectHref: `${variant ? "../../../" : "../../"}inspector/?url=${encodeURIComponent(`../rc/${e.id}${variant ? `/${variant}` : ""}.rc`)}`,
            rcBytes: rcBytes.length, fileName: `${e.folder.split("/").pop()}${variant ? `.${variant}` : ""}.rc`,
            start: "auto", document: { width, height },
            info: vars.map(({ name, type, value }) => ({ name, type, value })),
            // (meta.prefer_theme: "dark" opens a dark-only or dark-first document in dark, not the
            // visitor's system theme, so the playground around it matches; #t= still overrides.)
            theme: variant ? "auto" : preferTheme(e) ?? "auto", density: dp ? "device" : 1, variables: [],
            declared: Object.fromEntries(vars.filter((v) => WEB_SETTABLE.has(v.type) && !v.themed).map((v) => [v.name, v.type])),
            urlVariables: true,
            // Pages are /play/<id>/ and /play/<id>/<variant>/: links are relative to either.
            variants: renders(e).filter((r) => r.own && LOOK_VARIANTS.some(([n]) => n === r.name)).map((r) => {
                const [, label, title] = LOOK_VARIANTS.find(([n]) => n === r.name);
                return { name: r.name, label, title, href: `${variant ? "../" : ""}${encodeURIComponent(r.name)}/` };
            }),
            ...(variant ? { variant, mainHref: "../" } : {}),
            ...(mono ? { mono } : {}),
            ...(looks ? { looks } : {}),
            json: jsonButtons(e, variant, variant ? "../../../" : "../../"),
            // meta.inputs.variables: {name: {type, meaning, default, min, max, step}}
            ranges: Object.fromEntries(Object.entries(e.inputs?.variables ?? {})
                .filter(([, v]) => v && typeof v === "object")
                .map(([k, v]) => [k, Object.fromEntries(["min", "max", "step", "meaning"].filter((f) => v[f] !== undefined).map((f) => [f, v[f]]))])),
        },
    });
    playCache.set(key, { mtime, html });
    return html;
}

const CSS = `
/* The Kobento palette (kobento-web): paper, ink, muted, line; the tiles' blue for links. */
:root { --bg:#f8f7f3; --card:#fff; --ink:#161c29; --muted:#687182; --line:#e6e6e2; --chip:#efede6; --accent:#2b7fd9; --thumb:#efede6;
  --lav:#a27be5; --blue:#409bf0; --green:#36c495; --orange:#f6a525; --pink:#d86f99; --red:#ef5c59; --cream:#f3e9d6; }
@media (prefers-color-scheme: dark) { :root { --bg:#10141d; --card:#181e2b; --ink:#f1efe9; --muted:#9aa2b1; --line:#283041; --chip:#212838; --accent:#6db1f7; --thumb:#0c1017; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.45 'DM Sans',system-ui,-apple-system,Segoe UI,Roboto,sans-serif; -webkit-font-smoothing:antialiased; }
h1, h2, .title, nav a.brand { font-family:Manrope,'DM Sans',system-ui,sans-serif; }
h1 { letter-spacing:-0.5px; font-weight:800; }
header { padding:24px 16px 8px; max-width:1280px; margin:0 auto; }
h1 { margin:0 0 4px; font-size:22px; }
nav { display:flex; flex-wrap:wrap; align-items:center; gap:6px 18px; font-size:14px; line-height:20px; }
nav a { color:var(--accent); text-decoration:none; display:inline-flex; align-items:center; height:24px; }
nav a.brand { color:var(--ink); font-weight:700; gap:6px; }
nav a.end { margin-left:auto; }
nav .mark { width:18px; height:18px; flex:none; }
nav a[aria-current] { color:var(--ink); font-weight:600; }
.sub { color:var(--muted); margin:4px 0 12px; }
.bar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin:12px 0 4px; }
.bar input { flex:1 1 240px; padding:8px 12px; border:1px solid var(--line); border-radius:8px; background:var(--card); color:var(--ink); font:inherit; }
.bar button { padding:6px 10px; border:1px solid var(--line); border-radius:999px; background:var(--card); color:var(--ink); font:inherit; font-size:12px; cursor:pointer; }
.bar select { padding:6px 10px; border:1px solid var(--line); border-radius:8px; background:var(--card); color:var(--ink); font:inherit; font-size:12px; }
.bar button[aria-pressed=true] { background:var(--accent); border-color:var(--accent); color:#fff; }
main { max-width:1280px; margin:0 auto; padding:8px 16px 48px; display:grid; gap:16px; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); }
.card { display:flex; flex-direction:column; background:var(--card); border:1px solid var(--line); border-radius:12px; overflow:hidden; color:inherit; text-decoration:none; }
.card:hover { border-color:var(--accent); }
.thumb { aspect-ratio:4/3; background:var(--thumb); display:flex; align-items:center; justify-content:center; }
.thumb img { max-width:100%; max-height:100%; object-fit:contain; }
.thumb span { color:var(--muted); font-size:12px; }
.body { padding:10px 12px 12px; display:flex; flex-direction:column; gap:4px; }
.id { font:600 12px ui-monospace,Menlo,monospace; color:var(--accent); }
.head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.size { font:700 13px ui-monospace,Menlo,monospace; padding:2px 8px; border-radius:999px; background:var(--chip); color:var(--ink); white-space:nowrap; }
.size.s { background:color-mix(in srgb, #2e9d57 18%, transparent); }
.size.m { background:color-mix(in srgb, #d08a00 18%, transparent); }
.size.l { background:color-mix(in srgb, #d0453a 18%, transparent); }
.title { font-weight:600; }
.desc { color:var(--muted); font-size:13px; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
.tags { display:flex; flex-wrap:wrap; gap:4px; margin-top:4px; }
.bar label.gen { display:flex; align-items:center; gap:4px; font-size:13px; color:var(--muted); }
.tags span { background:var(--chip); border-radius:6px; padding:1px 6px; font-size:11px; color:var(--muted); }
[hidden] { display:none !important; }
.tags span.lib { background:color-mix(in srgb, var(--accent) 16%, transparent); color:var(--accent); }
.tags span.own { border:1px dashed var(--muted); background:none; }
.kind { font-size:11px; font-weight:600; letter-spacing:.02em; text-transform:uppercase; color:var(--muted); }
.kind.library, .kind.mixed { color:var(--accent); }
.links { display:flex; gap:12px; font-size:12px; margin-top:6px; }
.links a { color:var(--accent); text-decoration:none; }
.modes { display:flex; gap:4px; padding:4px; background:var(--thumb); border-top:1px solid var(--line); }
.modes button { flex:1 1 0; min-width:0; padding:0; border:2px solid transparent; border-radius:6px; background:none; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:2px; color:var(--muted); font:inherit; font-size:10px; }
.modes button[aria-pressed=true] { border-color:var(--accent); color:var(--ink); }
.modes img { width:100%; height:44px; object-fit:contain; display:block; }
.empty { grid-column:1/-1; color:var(--muted); text-align:center; padding:48px 0; }
`;

const SCRIPT = `
const q = document.getElementById("q"), cards = [...document.querySelectorAll(".card")];
const chips = [...document.querySelectorAll(".bar button")]; let fam = "";
// The generated corpus (documents the eval runs built from one prompt each) is off by default.
const genOn = document.getElementById("gen") || { checked: false };
try { genOn.checked = localStorage.getItem("rc-gen") === "1"; } catch (e) {}
if (genOn.addEventListener) genOn.addEventListener("change", () => { try { localStorage.setItem("rc-gen", genOn.checked ? "1" : "0"); } catch (e) {} apply(); });
function apply() {
  const words = q.value.toLowerCase().split(/\\s+/).filter(Boolean); let n = 0;
  for (const c of cards) {
    const gen = c.dataset.family === "GEN";
    const kind = document.getElementById("kind");
    const show = (!gen || genOn.checked) && (!fam || c.dataset.family === fam) && (!kind || !kind.value || (c.dataset.kind || "").split(" ").includes(kind.value)) && words.every((w) => c.dataset.text.includes(w));
    c.hidden = !show; if (show) n++;
  }
  document.getElementById("none").hidden = n > 0;
}
q.addEventListener("input", apply);
const kindSel = document.getElementById("kind"); if (kindSel) kindSel.addEventListener("change", apply);
apply();
// The light / dark / mono strip under a thumbnail: show that render in the card, and open the
// playground in that mode. The page-wide toggle does it for every card.
function show(card, mode) {
  const img = card.querySelector(".thumb img"); if (!img) return;
  const b = card.querySelector('.modes button[data-mode="' + mode + '"]');
  img.src = b ? b.dataset.src : img.dataset.main;
  card.href = b ? b.dataset.play : card.dataset.play;
  for (const x of card.querySelectorAll(".modes button")) x.setAttribute("aria-pressed", String(x === b));
}
for (const b of document.querySelectorAll(".modes button")) b.addEventListener("click", (ev) => {
  ev.preventDefault(); ev.stopPropagation();
  const card = b.closest(".card"); show(card, b.getAttribute("aria-pressed") === "true" ? "" : b.dataset.mode);
});
const modeSel = document.getElementById("mode");
if (modeSel) {
  let saved = ""; try { saved = localStorage.getItem("rc-mode") || ""; } catch (e) {}
  modeSel.value = saved;
  const all = () => { for (const c of cards) show(c, modeSel.value); try { localStorage.setItem("rc-mode", modeSel.value); } catch (e) {} };
  modeSel.addEventListener("change", all); if (saved) all();
}
// Order by .rc size: the cards carry their bytes.
const sortSel = document.getElementById("sort");
if (sortSel) {
  // The page comes smallest first; "id" is the order of ids (or names), "large" the reverse of size.
  const main = document.querySelector("main"), none = document.getElementById("none"), smallest = cards.slice();
  const order = () => {
    const v = sortSel.value, list = smallest.slice();
    if (v === "large") list.reverse();
    else if (v === "id") list.sort((a, b) => a.dataset.key.localeCompare(b.dataset.key, "en", { numeric: true }));
    for (const c of list) main.insertBefore(c, none);
    try { localStorage.setItem("rc-sort", v); } catch (e) {}
  };
  try { const saved = localStorage.getItem("rc-sort") || ""; sortSel.value = saved === "small" ? "" : saved; } catch (e) {}
  sortSel.addEventListener("change", order); if (sortSel.value) order();
}
for (const b of chips) b.addEventListener("click", () => {
  fam = fam === b.dataset.family ? "" : b.dataset.family;
  for (const x of chips) x.setAttribute("aria-pressed", String(x.dataset.family === fam));
  apply();
});
`;

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@600;700;800&display=swap" rel="stylesheet">`;

// The Kobento mark: four rounded tiles (the logo's colours), inline so it needs no file.
const MARK = `<svg class="mark" viewBox="0 0 40 40" aria-hidden="true"><rect x="2" y="2" width="16.5" height="16.5" rx="5" fill="#a27be5"/><rect x="21.5" y="2" width="16.5" height="16.5" rx="5" fill="#409bf0"/><rect x="2" y="21.5" width="16.5" height="16.5" rx="5" fill="#36c495"/><rect x="21.5" y="21.5" width="16.5" height="16.5" rx="5" fill="#f6a525"/></svg>`;

/** The site's sections: the landing page is at the root, every other one a folder below it. */
function siteNav(current) {
    const items = [["home", `${MARK}Kobento`, ""], ["showcases", "Showcases", "showcases/"], ["components", "Components", "components/"],
        ["advanced", "Advanced", "advanced/"], ["layouts", "Layouts", "layouts/"], ["structures", "Structures", "structures/"],
        ["demos", "Demos", "demos/"], ...(accountsEnabled() ? [["account", "Account", "account/"]] : [])];
    return items.map(([k, label, href]) =>
        `<a href="${current === "home" ? (href || "./") : "../" + (href || "")}"${current === k ? ' aria-current="page"' : ""}${k === "home" ? ' class="brand"' : ""}${k === "account" ? ' class="end"' : ""}>${label}</a>`).join("");
}

function page({ title, sub, current, families, cards, modes = false, generated = 0, kinds = false, sizes = false }) {
    // Smallest first by default: the .rc size is what a device downloads. (Cards with no size last.)
    if (sizes) {
        const bytesOf = (c) => Number(/data-bytes="(\d+)"/.exec(c)?.[1] ?? 0) || Infinity;
        cards = cards.map((c, i) => [c, i]).sort((a, b) => bytesOf(a[0]) - bytesOf(b[0]) || a[1] - b[1]).map(([c]) => c);
    }
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>${FONTS}<style>${CSS}</style></head>
<body>
<header>
<nav>${siteNav(current)}</nav>
<h1>${esc(title)}</h1>
<p class="sub">${sub}</p>
<div class="bar"><input id="q" type="search" placeholder="Filter by name, tag or keyword" aria-label="Filter">
${families.map((f) => `<button type="button" data-family="${esc(f)}" aria-pressed="false">${esc(f)}</button>`).join("")}
${kinds ? `<select id="kind" aria-label="How it is built"><option value="">Any build</option><option value="library">Uses library components</option><option value="own">Defines its own components</option><option value="plain">Plain JSON, no components</option></select>` : ""}
${generated ? `<label class="gen"><input id="gen" type="checkbox"> ${generated} generated (eval runs)</label>` : ""}
${sizes ? `<select id="sort" aria-label="Order"><option value="">Smallest first</option><option value="large">Largest first</option><option value="id">${current === "demos" || current === "showcases" ? "By id" : "By name"}</option></select>` : ""}
${modes ? `<select id="mode" aria-label="Render"><option value="">Default render</option><option value="light">Light</option><option value="dark">Dark</option><option value="mono-dark">Mono dark (always-on, OLED)</option><option value="mono-light">Mono light (e-ink)</option></select>` : ""}</div>
</header>
<main>${cards.join("\n")}<p id="none" class="empty" hidden>Nothing matches.</p></main>
<script>${SCRIPT}</script>
</body></html>`;
}

/** A document's .rc size, always in KB (the unit to compare documents by), and its band. */
function sizeBadge(bytes) {
    if (!bytes) return "";
    const kb = bytes / 1024;
    const band = kb < 8 ? "s" : kb < 24 ? "m" : "l";
    return `<span class="size ${band}" title="${bytes.toLocaleString("en-US")} bytes of .rc">${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB</span>`;
}

function card({ e, base, text, desc, tags, links, build, bytes = 0 }) {
    const id = encodeURIComponent(e.id);
    // Thumbnails, versioned by the render's mtime so the browser keeps them until a rebuild.
    const ver = (name) => { try { return statSync(path.join(EXAMPLES_DIR, e.folder, name ? `render-${name}.png` : "render.png")).mtimeMs.toString(36).replace(".", ""); } catch { return "0"; } };
    const thumb = (name, w) => `${base}thumb/${id}${name ? "/" + encodeURIComponent(name) : ""}.png?w=${w}&amp;v=${ver(name)}`;
    const main = thumb("", 480), play = `${base}play/${id}/`;
    const img = existsSync(path.join(EXAMPLES_DIR, e.folder, "render.png"))
        ? `<img src="${main}" data-main="${main}" alt="" loading="lazy">` : `<span>no render</span>`;
    // The strip under a card: the four looks when the document has them all (other sizes and
    // states are in the playground), otherwise its first six renders.
    const all = e.folder && existsSync(path.join(EXAMPLES_DIR, e.folder)) ? renders(e) : [];
    const LOOKS = ["light", "dark", "mono-dark", "mono-light"];
    const modes = LOOKS.every((n) => all.some((m) => m.name === n)) ? LOOKS.map((n) => all.find((m) => m.name === n)) : all.slice(0, 6);
    const strip = modes.length ? `<div class="modes">${modes.map((m) => {
        const src = thumb(m.name, 480), small = thumb(m.name, 120);
        const href = m.own ? `${play}${encodeURIComponent(m.name)}/` : m.theme ? `${play}#t=${m.theme}` : play;
        return `<button type="button" data-mode="${esc(m.name)}" data-src="${src}" data-play="${href}" aria-pressed="false" title="Show the ${esc(m.name)} render"><img src="${small}" alt="" loading="lazy">${esc(m.name)}</button>`;
    }).join("")}</div>` : "";
    const tag = (t) => typeof t === "object" ? `<span class="${t.cls}" title="${esc(t.title)}">${esc(t.text)}</span>` : `<span>${esc(t)}</span>`;
    return `<a class="card" href="${play}" data-play="${play}" data-family="${esc(e.family ?? "")}" data-kind="${esc(build?.kinds ?? "")}" data-bytes="${bytes}" data-key="${esc(e.id)}" data-text="${esc(text.toLowerCase())}">
<div class="thumb">${img}</div>${strip}
<div class="body"><span class="head"><span class="id">${esc(e.id)}</span>${sizeBadge(bytes)}</span>${build ? `<span class="kind ${build.cls}" title="${esc(build.title)}">${esc(build.label)}</span>` : ""}<span class="title">${esc(e.title ?? e.id)}</span>
<span class="desc">${esc(desc ?? "")}</span>
<span class="tags">${tags.map(tag).join("")}</span>
<span class="links">${links}</span></div></a>`;
}

/** How an example is built: calls to library components, components it defines itself, or plain JSON. */
function buildKind(e, lib) {
    const used = e.derived?.components ?? [];
    let own = [];
    try { own = Object.keys(JSON.parse(readFileSync(path.join(EXAMPLES_DIR, e.folder, "doc.json"), "utf8")).components ?? {}); } catch {}
    const fromLib = used.filter((n) => lib.has(n));
    if (fromLib.length && own.length) return { kinds: "library own", cls: "mixed", label: "Library + own", title: `Calls library components (${fromLib.join(", ")}) and defines its own (${own.join(", ")})` };
    if (fromLib.length) return { kinds: "library", cls: "library", label: "Library", title: `Built from library components: ${fromLib.join(", ")}` };
    if (own.length) return { kinds: "own", cls: "own", label: "Own components", title: `Defines its own components: ${own.join(", ")}` };
    // (meta.hand_built: why it is written by hand when a library component exists.)
    if (e.hand_built) return { kinds: "plain", cls: "plain", label: "Hand-built on purpose", title: e.hand_built };
    return { kinds: "plain", cls: "plain", label: "Plain JSON", title: "Written directly in RemoteCompose JSON: no components, even where it looks like one" };
}

/** The showcases (SHW) or every other example (the demos), by id. */
function examplesPage(showcases = false, { generated: withGenerated = true } = {}) {
    const C = loadCatalog();
    const list = C.examples.filter((e) => (e.family === "SHW") === showcases).sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
    const families = showcases ? [] : [...new Set(list.map((e) => e.family))].sort();
    const lib = new Set(C.library.components.keys());
    const cards = list.map((e) => { const b = buildKind(e, lib); return card({
        e, base: "../", build: b, bytes: e.derived?.bytes ?? 0,
        text: [e.id, e.title, e.summary, e.prompt, ...(e.keywords ?? []), ...(e.capabilities?.primary ?? []), ...(e.capabilities?.secondary ?? []), ...(e.derived?.components ?? [])].join(" "),
        desc: e.summary,
        tags: [...(e.capabilities?.primary ?? []), ...(e.derived?.components ?? []).map((n) => lib.has(n)
            ? { text: n, cls: "lib", title: `${n}: a library component` }
            : { text: n, cls: "own", title: `${n}: defined in this document` })],
        links: "",
    }); });
    // The generated corpus, behind its toggle: one document per eval prompt, built with the tools.
    const gen = showcases || !withGenerated ? [] : loadGenerated().filter((g) => existsSync(path.join(EXAMPLES_DIR, g.folder, "doc.json")));
    for (const g of gen) cards.push(card({
        e: { ...g, family: "GEN" }, base: "../", bytes: g.bytes ?? 0,
        text: [g.id, g.title, g.prompt, ...(g.keywords ?? []), ...(g.components ?? []), "generated"].join(" "),
        desc: g.prompt,
        tags: ["generated", ...(g.components ?? []).slice(0, 4)],
        links: g.run ? `<span>${g.run.calls} calls</span>` : "",
    }));
    if (gen.length && !families.includes("GEN")) families.push("GEN");
    const badge = "The badge is the size of the .rc document a device downloads (green under 8 KB, amber under 24 KB, red above). Click one to open it in the playground.";
    return page({
        title: showcases ? "RemoteCompose showcases" : "RemoteCompose demos", current: showcases ? "showcases" : "demos", families, cards,
        modes: list.some((e) => e.derived?.renders), generated: gen.length, kinds: !showcases, sizes: true,
        sub: showcases
            ? `${list.length} showcases: what the format can do (3D, shaders, particles, physics, morphing, live data), each in light, dark and both monochrome looks. ${badge}`
            : `${list.length} focused demos, one technique or screen each, every one byte-identical to the Java parser's output. ${badge}`,
    });
}

// Components that arrange other components (a screen or a section, content through slots):
// the structure templates, plus these. A component.json can say "layout": true as well.
const LAYOUT_EXTRAS = ["StepExplainer", "InputsResult", "AdaptiveSplit", "TwoColumns", "Pager", "Walkthrough", "SwipeStack"];
function isLayout(name, def) {
    return def?.layout === true || LAYOUT_EXTRAS.includes(name) || STRUCTURES.some((s) => s.template === name);
}

// The basic components: the common parts any UI framework ships with (buttons, toggles,
// sliders, chips, tabs, list items, cards, app bar, progress, avatars, badges...). Every other
// leaf component (charts, clocks, maps, 3D, data rows, formatted numbers...) is advanced. A
// component.json can say "tier": "basic" or "advanced".
const BASIC = ["Button", "IconButton", "Checkbox", "Switch", "Slider", "Chip", "ChoiceChips", "Stepper", "Tabs",
    "ListItem", "Card", "Divider", "Icon", "Avatar", "Badge", "Banner", "ProgressBar", "ProgressRing", "TopBar",
    "ExpandableRow", "Skeleton", "Rating", "PagerDots", "Steps"];
function tierOf(name, def) {
    if (isLayout(name, def)) return "layout";
    return def?.tier ?? (BASIC.includes(name) ? "basic" : "advanced");
}

/** One kind of component: "basic", "advanced" or "layout" (the ones that arrange others). */
function componentsPage(kind = "basic") {
    const layouts = kind === "layout";
    const C = loadCatalog();
    const names = [...C.library.components.keys()].filter((n) => tierOf(n, C.library.components.get(n)) === kind).sort();
    const base = "../";
    const cards = names.map((name) => {
        const def = C.library.components.get(name);
        const demo = C.demos.get(name);
        const e = demo ?? { id: name, title: name, family: "COMP", folder: `components/${name}` };
        const gallery = C.examples.find((x) => x.kind === "gallery" && (x.derived?.components ?? []).includes(name));
        return card({
            e, base, bytes: demo?.derived?.bytes ?? 0,
            text: [name, def.summary, demo?.prompt, ...(demo?.keywords ?? []), ...(C.vocab.components?.[name]?.synonyms ?? []), ...(def.capabilities ?? [])].join(" "),
            desc: def.summary,
            tags: Object.keys(def.params ?? {}).slice(0, 6),
            links: (gallery ? `<span>in ${esc(gallery.id)}</span>` : "") + (demo ? "" : "<span>no demo yet</span>"),
        });
    });
    const structuresOf = (n) => STRUCTURES.filter((s) => s.template === n).map((s) => s.id);
    if (layouts) cards.forEach((c, i) => { const st = structuresOf(names[i]); if (st.length) cards[i] = c.replace('<span class="links">', `<span class="links"><span>structure: ${esc(st.join(", "))}</span>`); });
    return page({
        title: layouts ? "Layouts" : kind === "advanced" ? "Advanced components" : "Components", current: layouts ? "layouts" : kind === "advanced" ? "advanced" : "components", families: [], cards, modes: true, sizes: true,
        sub: kind === "advanced"
            ? `${names.length} richer components: charts, clocks, maps, media, diagrams, 3D and more. Each is in light, dark and both monochrome looks, and adapts to its box. Click one to open its demo in the playground.`
            : layouts
            ? `${names.length} layout components: they arrange other components into a screen or a section and own its adaptation (phone, tablet, wide, short), taking your content through slots and data. Each is in light, dark and both monochrome looks. Click one to open its demo in the playground.`
            : `${names.length} basic components, the common parts of any screen (buttons, switches, sliders, tabs, list items, cards...), each in a light, dark and two monochrome versions: mono dark (light on black, for always-on displays) and mono light (dark on white, for e-ink). Call one by name in any document ({"Gauge": {"value": "@cpu"}}); every tool expands it. Click one to open its demo in the playground.`,
    });
}

/** An example's folder: from the catalog, else by its id on disk (one built since the catalog). */
function folderOf(id) {
    const e = entry(id);
    if (e?.folder) return e.folder;
    try { return readdirSync(EXAMPLES_DIR).find((d) => d.startsWith(`${id}-`)) ?? null; } catch { return null; }
}

const INSPECTOR_DIR = path.resolve(EXAMPLES_DIR, "..", "inspector", "dist");

// The landing page's header plays this document (the animated logo) in the web player.
const LOGO_DOC = "SHW-32";

/** The landing page: what Kobento is, in plain words, under its animated logo. */
async function landingPage() {
    const C = loadCatalog();
    const logoFolder = folderOf(LOGO_DOC);
    const logoRc = logoFolder && path.join(EXAMPLES_DIR, logoFolder, "doc.rc");
    const player = logoRc && existsSync(logoRc) ? await playerScript() : null;
    const v = logoRc && existsSync(logoRc) ? statSync(logoRc).mtimeMs.toString(36).replace(".", "") : "";
    const count = (k) => [...C.library.components.keys()].filter((n) => tierOf(n, C.library.components.get(n)) === k).length;
    const showcases = C.examples.filter((e) => e.family === "SHW").length;
    const hero = player
        ? `<div class="hero-logo" id="logo"><rc-player src="rc/${LOGO_DOC}.rc?v=${v}" theme="auto"></rc-player></div>
<script src="player/${player.name}"></script>
<script>
// Size the player to the page: the logo document is laid out at the width it is given.
(function () {
  var box = document.getElementById("logo"), p = box.querySelector("rc-player");
  function fit() { var w = Math.min(box.clientWidth, 1100), h = Math.round(Math.max(150, w / 3.6));
    p.setAttribute("width", String(w)); p.setAttribute("height", String(h)); }
  fit(); var t; window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(fit, 150); });
})();
</script>`
        : `<div class="hero-logo static">${MARK}<span>Kobento</span></div>`;
    const link = (href, text) => `<a href="${href}" rel="noopener">${text}</a>`;
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kobento</title><meta name="description" content="Kobento: components and AI tools for building RemoteCompose interfaces.">
${FONTS}<style>${CSS}
.landing { max-width:880px; margin:0 auto; padding:8px 16px 64px; }
.hero-logo { margin:8px 0 8px; display:flex; justify-content:center; min-height:150px; }
.hero-logo.static { align-items:center; gap:16px; font:800 56px Manrope,'DM Sans',sans-serif; letter-spacing:-2px; }
.hero-logo.static .mark { width:64px; height:64px; }
.landing h1 { font-size:clamp(30px,4.6vw,46px); line-height:1.1; letter-spacing:-1.5px; margin:24px 0 12px; }
.landing h2 { font-size:22px; letter-spacing:-0.5px; margin:40px 0 8px; }
.landing p, .landing li { font-size:17px; line-height:1.65; color:var(--ink); }
.landing .lead { font-size:19px; color:var(--muted); }
.landing ul, .landing ol { padding-left:22px; }
.landing a { color:var(--accent); }
.go { display:flex; flex-wrap:wrap; gap:10px; margin:20px 0 4px; }
.go a { padding:10px 16px; border-radius:999px; border:1px solid var(--line); background:var(--card); color:var(--ink); text-decoration:none; font-weight:600; }
.go a.primary { background:var(--ink); color:var(--bg); border-color:var(--ink); }
code { font:13px ui-monospace,Menlo,monospace; background:var(--chip); padding:2px 6px; border-radius:6px; }
</style></head>
<body>
<header><nav>${siteNav("home")}</nav></header>
<main class="landing" style="display:block">
${hero}
<h1>Interfaces for RemoteCompose, built with AI.</h1>
<p class="lead">Kobento is an implementation of RemoteCompose. It gives you ready-made components and AI tools to build RemoteCompose screens.</p>
<div class="go">
  <a class="primary" href="showcases/">See the showcases</a>
  <a href="components/">Browse the components</a>
  <a href="account/">Create an account</a>
</div>

<h2>What is RemoteCompose?</h2>
<p>RemoteCompose is an Android format for user interfaces. A server sends a small document, and the device draws it: layout, text, animation, touch, light and dark themes. The screen can change without an app update. It runs in apps, widgets and watch faces.</p>
<p>Read more: ${link("https://developer.android.com/develop/ui/compose/system/remote-compose", "RemoteCompose on Android Developers")} and the ${link("https://developer.android.com/jetpack/androidx/releases/compose-remote", "androidx release notes")}.</p>

<h2>What Kobento gives you</h2>
<ul>
  <li><strong>Components.</strong> ${count("basic")} basic parts (buttons, switches, sliders, tabs, cards) and ${count("advanced")} advanced ones (charts, clocks, maps, 3D). Each works in light, dark and two monochrome looks.</li>
  <li><strong>Layouts.</strong> ${count("layout")} layouts, such as a list with its detail or a dashboard grid. They adapt from a phone to a tablet.</li>
  <li><strong>AI tools.</strong> MCP servers that let Claude, ChatGPT or another assistant find the right parts, write the document, check it and show you the result.</li>
  <li><strong>Players.</strong> A web player and a desktop player that draw the same documents, and an ${link("https://camaelon.github.io/remotecompose-experiments/inspector/", "inspector")} that shows what is inside one.</li>
</ul>
<p>The ${showcases} showcases show what the format can do: 3D, physics, live data, morphing shapes.</p>

<h2>How to use it</h2>
<ol>
  <li><a href="account/">Create an account</a>. We email you a link to confirm your address, and you get access to the MCP servers.</li>
  <li>Add Kobento to your assistant. In claude.ai or ChatGPT, add a custom connector with the URL <code>${esc(process.env.RC_MCP_URL || "https://mcp.kobento.dev/mcp")}</code>, then sign in when asked. In Claude Code, run <code>claude mcp add --transport http kobento ${esc(process.env.RC_MCP_URL || "https://mcp.kobento.dev/mcp")}</code>. In the Gemini CLI, run <code>gemini mcp add --transport http kobento ${esc(process.env.RC_MCP_URL || "https://mcp.kobento.dev/mcp")}</code>, then <code>/mcp auth kobento</code> to sign in.</li>
  <li>Describe the screen you want. The assistant builds it from the components, checks it and shows you a picture of it.</li>
</ol>
<div class="go"><a class="primary" href="account/">Create an account</a></div>

<h2>Open source</h2>
<p>The code is on ${link("https://github.com/camaelon/remotecompose-experiments", "GitHub")}: the players, the components, the MCP servers and this site.</p>
</main>
</body></html>`;
}

/** The screen structures (structures.mjs): what a request is shaped like, how each adapts, and where to start. */
function structuresPage() {
    const C = loadCatalog();
    const byId = (id) => C.examples.find((e) => e.id === id);
    const cards = STRUCTURES.map((st) => {
        const starts = st.examples.map(byId).filter(Boolean);
        const first = starts[0];
        const e = first ? { ...first, id: st.id, title: st.id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()) }
            : { id: st.id, title: st.id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()), family: "STRUCT", folder: "" };
        const comps = [...new Set([...(st.template ? [st.template] : []), ...(st.core ?? []), ...(st.components ?? [])])];
        const c = card({
            e: { ...e, folder: first?.folder ?? "" }, base: "",
            text: [st.id, st.is, st.adapts, ...comps, ...starts.map((x) => `${x.id} ${x.title}`)].join(" "),
            desc: `${st.is}. Adapts: ${st.adapts}.`,
            tags: comps.map((n) => ({ text: n, cls: "lib", title: `${n}: a library component this structure uses` })),
            links: starts.length ? `<span>Start from ${starts.map((x) => `${esc(x.id)} <b>${esc(formatBytes(x.derived?.bytes ?? 0))}</b>`).join(", ")}</span>` : "<span>no example yet</span>",
        });
        // (The card links to its first example's playground; its id and image are that example's.)
        return first ? c.replaceAll(`play/${encodeURIComponent(st.id)}/`, `play/${encodeURIComponent(first.id)}/`).replaceAll(`img/${encodeURIComponent(st.id)}`, `img/${encodeURIComponent(first.id)}`).replaceAll(`thumb/${encodeURIComponent(st.id)}`, `thumb/${encodeURIComponent(first.id)}`) : c;
    });
    return page({
        title: "Screen structures", current: "structures", families: [], cards,
        sub: `${STRUCTURES.length} recurring screen shapes, whatever their subject. build_kit guesses one from a request (or takes it as its structure parameter) and starts from its examples. Each card opens the structure's first example in the playground.`,
    }).replaceAll('href="play/', 'href="../play/').replaceAll('data-play="play/', 'data-play="../play/').replaceAll('src="img/', 'src="../img/').replaceAll('data-main="img/', 'data-main="../img/').replaceAll('data-src="img/', 'data-src="../img/')
        .replaceAll('src="thumb/', 'src="../thumb/').replaceAll('data-main="thumb/', 'data-main="../thumb/').replaceAll('data-src="thumb/', 'data-src="../thumb/');
}

// The grid thumbnails, made in the background after the first page request (one render per
// tick, so requests are not held up), so later visitors get them from the disk cache.
let warming = false;
function warmThumbs() {
    if (warming) return;
    warming = true;
    const C = loadCatalog();
    const folders = [...C.examples.map((e) => e.folder), ...[...C.demos.values()].map((e) => e.folder)].filter(Boolean);
    const jobs = [];
    for (const f of folders) {
        const dir = path.join(EXAMPLES_DIR, f);
        let names = [];
        try { names = readdirSync(dir).filter((n) => /^render(-[a-z0-9-]+)?\.png$/.test(n)); } catch {}
        for (const n of names) { jobs.push([path.join(dir, n), 480]); if (n !== "render.png") jobs.push([path.join(dir, n), 120]); }
    }
    const step = () => {
        const j = jobs.shift();
        if (!j) return;
        try { thumbnail(j[0], j[1]); } catch {}
        setImmediate(step);
    };
    setImmediate(step);
}

/** lib/mcp-server.mjs publicRoute: true when it answered the request. */
export async function publicRoute(req, url, res) {
    const p = url.pathname;
    const pm = /^\/player\/([0-9a-f]{16}\.js)$/.exec(p);
    if (pm) {
        const player = await playerScript();
        if (pm[1] !== player.name) return send(req, res, 404, "text/plain", "not found\n");
        return send(req, res, 200, "text/javascript; charset=utf-8", player.code, { "Cache-Control": "public, max-age=31536000, immutable" });
    }
    if (await accountRoute(req, url, res, { css: CSS, nav: siteNav })) return true;
    // The generated corpus (eval runs: unreviewed screens built by assistants) is for admins
    // when accounts are on; without accounts (local use) everyone sees it.
    const seesGenerated = async () => !accountsEnabled() || Boolean((await requestAccount(req).catch(() => null))?.admin);
    if (/^\/(play|img|thumb|json|rc)\/GEN-/.test(url.pathname) && !(await seesGenerated())) return send(req, res, 404, "text/plain", "not found\n");
    if (await oauthRoute(req, url, res, { css: CSS, nav: siteNav })) return true;
    const known = p === "/" || p === "" || /^\/(components|advanced|layouts|structures|showcases|demos|examples|play|img|thumb|json|rc|inspector)(\/|$)/.test(p);
    if (!known) return false;
    if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD" });
        res.end();
        return true;
    }
    if (/^\/(|components\/|advanced\/|layouts\/|structures\/|showcases\/|demos\/)$/.test(p)) warmThumbs();
    // The inspector (inspector/dist), as it is published on GitHub Pages: ?url=<rc> loads one.
    if (p === "/inspector") { res.writeHead(301, { Location: `inspector/${url.search}` }); res.end(); return true; }
    const im = /^\/inspector\/(.*)$/.exec(p);
    if (im) {
        const rel = im[1] || "index.html";
        const file = path.resolve(INSPECTOR_DIR, rel);
        if (!file.startsWith(INSPECTOR_DIR + path.sep) || !existsSync(file) || !statSync(file).isFile()) return send(req, res, 404, "text/plain", "not found\n");
        const type = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".rc": "application/octet-stream", ".png": "image/png", ".svg": "image/svg+xml" }[path.extname(file)] ?? "application/octet-stream";
        return send(req, res, 200, type, readFileSync(file));
    }
    // The landing page: what Kobento is, under its animated logo.
    if (p === "/" || p === "") return send(req, res, 200, "text/html; charset=utf-8", await landingPage());
    // A document's .rc, for the players embedded in the pages.
    // (rc/<id>.rc the document, rc/<id>/<look>.rc a look with a document of its own.)
    const rm = /^\/rc\/([^/.]+)(?:\/([a-z][\w-]*))?\.rc$/.exec(p);
    if (rm) {
        const folder = folderOf(decodeURIComponent(rm[1]));
        const file = folder && path.join(EXAMPLES_DIR, folder, rm[2] ? `doc.${rm[2]}.rc` : "doc.rc");
        if (!file || !existsSync(file)) return send(req, res, 404, "text/plain", "not found\n");
        return send(req, res, 200, "application/octet-stream", readFileSync(file), url.searchParams.has("v") ? { "Cache-Control": "public, max-age=31536000, immutable" } : {});
    }
    // (/examples/ was the demos' address: it redirects.)
    if (p === "/examples" || p === "/examples/") { res.writeHead(301, { Location: `${p.endsWith("/") ? "../" : ""}demos/${url.search}` }); res.end(); return true; }
    for (const [route, render] of [["components", () => componentsPage("basic")], ["advanced", () => componentsPage("advanced")], ["layouts", () => componentsPage("layout")],
        ["showcases", () => examplesPage(true)], ["demos", async () => examplesPage(false, { generated: await seesGenerated() })]]) {
        if (p === `/${route}`) { res.writeHead(301, { Location: `${route}/${url.search}` }); res.end(); return true; }
        if (p === `/${route}/`) return send(req, res, 200, "text/html; charset=utf-8", await render(), { "Cache-Control": "private, no-cache" });
    }
    if (p === "/structures") { res.writeHead(301, { Location: `structures/${url.search}` }); res.end(); return true; }
    if (p === "/structures/") return send(req, res, 200, "text/html; charset=utf-8", structuresPage());
    // The looks' old names (mono, mono-inverted) in links made before the rename.
    const renamed = p.replace(/^(\/play\/[^/]+\/)mono-inverted(\/|$)/, "$1mono-light$2").replace(/^(\/play\/[^/]+\/)mono(\/|$)/, "$1mono-dark$2")
        .replace(/^(\/img\/[^/]+\/)mono-inverted\.png$/, "$1mono-light.png").replace(/^(\/img\/[^/]+\/)mono\.png$/, "$1mono-dark.png")
        .replace(/^(\/json\/[^/.]+)\.mono-inverted\./, "$1.mono-light.").replace(/^(\/json\/[^/.]+)\.mono\./, "$1.mono-dark.");
    if (renamed !== p) {
        // Relative, so it holds under whatever prefix the site is mounted at.
        const from = p.endsWith("/") ? p : path.posix.dirname(p) + "/";
        const rel = path.posix.relative(from, renamed) + (renamed.endsWith("/") ? "/" : "");
        res.writeHead(301, { Location: `${rel || "./"}${url.search}` }); res.end(); return true;
    }
    let m = /^\/play\/([^/]+)(\/)?$/.exec(p);
    if (m) {
        const e = entry(decodeURIComponent(m[1]));
        if (!e) return send(req, res, 404, "text/plain", "not found\n");
        if (!m[2]) { res.writeHead(301, { Location: `${m[1]}/${url.search}` }); res.end(); return true; }
        return send(req, res, 200, "text/html; charset=utf-8", await playground(e));
    }
    m = /^\/play\/([^/]+)\/([a-z][\w-]*)(\/)?$/.exec(p);
    if (m) {
        const e = entry(decodeURIComponent(m[1]));
        const own = e && renders(e).find((r) => r.name === m[2] && r.own);
        if (!own) return send(req, res, 404, "text/plain", "not found\n");
        if (!m[3]) { res.writeHead(301, { Location: `${m[2]}/${url.search}` }); res.end(); return true; }
        return send(req, res, 200, "text/html; charset=utf-8", await playground(e, m[2]));
    }
    m = /^\/(img|thumb)\/([^/]+)(?:\/([a-z][\w-]*))?\.png$/.exec(p);
    if (m) {
        const e = entry(decodeURIComponent(m[2]));
        const file = e && path.join(EXAMPLES_DIR, e.folder, m[3] ? `render-${m[3]}.png` : "render.png");
        if (!file || !existsSync(file)) return send(req, res, 404, "text/plain", "not found\n");
        // A versioned URL (?v=<mtime>) names one exact file: cache it for a year.
        const cache = url.searchParams.has("v") ? { "Cache-Control": "public, max-age=31536000, immutable" } : {};
        if (m[1] === "thumb") {
            const w = [120, 240, 480, 960].find((x) => x >= Number(url.searchParams.get("w") ?? 480)) ?? 960;
            return send(req, res, 200, "image/png", thumbnail(file, w), cache);
        }
        return send(req, res, 200, "image/png", readFileSync(file), cache);
    }
    m = /^\/json\/([^/.]+?)(\.expanded|\.component|\.[a-z][\w-]*\.expanded)?\.json$/.exec(p);
    if (m) {
        const e = entry(decodeURIComponent(m[1]));
        const name = { ".expanded": "doc.expanded.json", ".component": "component.json" }[m[2]]
            ?? (m[2] ? `doc${m[2]}.json` : "doc.json");   // .mono-dark.expanded: doc.mono-dark.expanded.json
        const file = e && path.join(EXAMPLES_DIR, e.folder, name);
        if (!file || !existsSync(file)) return send(req, res, 404, "text/plain", "not found\n");
        return send(req, res, 200, "application/json; charset=utf-8", readFileSync(file));
    }
    return send(req, res, 404, "text/plain", "not found\n");
}
