// Public web pages of the example catalog, served by rc-examples (examples-server.mjs) next to
// its MCP endpoint, without auth (the catalog is public content):
//   GET <base>/                 every example as a grid of renders, filterable
//   GET <base>/components/      every library component, the same way
//   GET <base>/play/<id>/       a playground for one example or component demo: the deploy
//                               server's page (lib/web-page.mjs), built on demand; #t=light
//                               or #t=dark opens it in that theme, #t=mono or
//                               #t=mono-inverted goes to that variant's page. Its look control
//                               switches Auto / Light / Dark / Mono / Mono inverted, and its
//                               JSON buttons show doc.json and the expanded JSON
//   GET <base>/play/<id>/<name>/  the same for a render with a document of its own
//                               (meta.check.renders with a componentTheme: doc.<name>.rc)
//   GET <base>/img/<id>.png     its render.png
//   GET <base>/img/<id>/<name>.png  one of its other renders (render-<name>.png: light, dark, mono,
//                               mono-inverted)
//   GET <base>/json/<id>.json   its doc.json (and /json/<id>.expanded.json, /json/<id>.mono.expanded.json,
//                               /json/<Name>.component.json)
// <base> is wherever the reverse proxy mounts the server (/examples/ on the VPS); every link is
// relative, so the pages work under any prefix.

import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { brotliCompressSync, gzipSync, constants as zlibConstants } from "node:zlib";
import path from "node:path";
import { EXAMPLES_DIR, loadCatalog } from "./catalog.mjs";
import { buildPage, escapeHtml as esc, formatBytes } from "./web-page.mjs";
import { playerBundle } from "./web-player.mjs";

const WEB_SETTABLE = new Set(["float", "int", "color", "string"]);
const HEADERS = {
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
};

/** An example (by id, "INT-04") or a component demo (by name, "Gauge"). */
function entry(id) {
    const C = loadCatalog();
    return C.byId.get(id) ?? C.demos.get(id) ?? null;
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
    const names = listed.length ? listed : ["light", "dark", "mono", "mono-inverted"];
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
// monochrome documents (componentTheme mono and mono-inverted), when the example has them.
const LOOK_VARIANTS = [
    ["mono", "Mono", "Mono: light on black, for always-on displays and OLED (componentTheme \"mono\", its own document doc.mono.rc)"],
    ["mono-inverted", "Mono inverted", "Mono inverted: dark on white, for e-ink and other reflective displays (componentTheme \"mono-inverted\", doc.mono-inverted.rc)"],
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
    let dp = false;
    try { dp = !!JSON.parse(readFileSync(path.join(EXAMPLES_DIR, e.folder, "doc.json"), "utf8")).header?.densityBehavior; } catch { /* keep 1 */ }
    const player = await playerScript();
    const html = buildPage({
        bundle: { src: `${variant ? "../../../" : "../../"}player/${player.name}` },
        rcBase64: rcBytes.toString("base64"),
        config: {
            title: `${e.id}${variant ? ` (${variant})` : ""} · ${e.title ?? e.id}`, layout: "fill", width, height, controls: true,
            rcBytes: rcBytes.length, fileName: `${e.folder.split("/").pop()}${variant ? `.${variant}` : ""}.rc`,
            start: "auto", document: { width, height },
            info: vars.map(({ name, type, value }) => ({ name, type, value })),
            theme: "auto", density: dp ? "device" : 1, variables: [],
            declared: Object.fromEntries(vars.filter((v) => WEB_SETTABLE.has(v.type) && !v.themed).map((v) => [v.name, v.type])),
            urlVariables: true,
            // Pages are /play/<id>/ and /play/<id>/<variant>/: links are relative to either.
            variants: renders(e).filter((r) => r.own && LOOK_VARIANTS.some(([n]) => n === r.name)).map((r) => {
                const [, label, title] = LOOK_VARIANTS.find(([n]) => n === r.name);
                return { name: r.name, label, title, href: `${variant ? "../" : ""}${encodeURIComponent(r.name)}/` };
            }),
            ...(variant ? { variant, mainHref: "../" } : {}),
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
:root { --bg:#f6f7f9; --card:#fff; --ink:#1b1f27; --muted:#5d6676; --line:#e2e5ea; --chip:#eef1f5; --accent:#2f6fde; --thumb:#e9ecf0; }
@media (prefers-color-scheme: dark) { :root { --bg:#0d1118; --card:#161c26; --ink:#e6eaf2; --muted:#8a94a6; --line:#263042; --chip:#1f2734; --accent:#6aaeff; --thumb:#0a0e14; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
header { padding:24px 16px 8px; max-width:1280px; margin:0 auto; }
h1 { margin:0 0 4px; font-size:22px; }
nav a { color:var(--accent); text-decoration:none; margin-right:16px; }
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
.title { font-weight:600; }
.desc { color:var(--muted); font-size:13px; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; }
.tags { display:flex; flex-wrap:wrap; gap:4px; margin-top:4px; }
.tags span { background:var(--chip); border-radius:6px; padding:1px 6px; font-size:11px; color:var(--muted); }
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
function apply() {
  const words = q.value.toLowerCase().split(/\\s+/).filter(Boolean); let n = 0;
  for (const c of cards) {
    const show = (!fam || c.dataset.family === fam) && words.every((w) => c.dataset.text.includes(w));
    c.hidden = !show; if (show) n++;
  }
  document.getElementById("none").hidden = n > 0;
}
q.addEventListener("input", apply);
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
for (const b of chips) b.addEventListener("click", () => {
  fam = fam === b.dataset.family ? "" : b.dataset.family;
  for (const x of chips) x.setAttribute("aria-pressed", String(x.dataset.family === fam));
  apply();
});
`;

function page({ title, sub, current, families, cards, modes = false }) {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head>
<body>
<header>
<nav><a href="${current === "examples" ? "./" : "../"}"${current === "examples" ? ' aria-current="page"' : ""}>Examples</a><a href="${current === "examples" ? "components/" : "./"}"${current === "components" ? ' aria-current="page"' : ""}>Components</a></nav>
<h1>${esc(title)}</h1>
<p class="sub">${sub}</p>
<div class="bar"><input id="q" type="search" placeholder="Filter by name, tag or keyword" aria-label="Filter">
${families.map((f) => `<button type="button" data-family="${esc(f)}" aria-pressed="false">${esc(f)}</button>`).join("")}
${modes ? `<select id="mode" aria-label="Render"><option value="">Default render</option><option value="light">Light</option><option value="dark">Dark</option><option value="mono">Mono (always-on, OLED)</option><option value="mono-inverted">Mono inverted (e-ink)</option></select>` : ""}</div>
</header>
<main>${cards.join("\n")}<p id="none" class="empty" hidden>Nothing matches.</p></main>
<script>${SCRIPT}</script>
</body></html>`;
}

function card({ e, base, text, desc, tags, links }) {
    const id = encodeURIComponent(e.id);
    const main = `${base}img/${id}.png`, play = `${base}play/${id}/`;
    const img = existsSync(path.join(EXAMPLES_DIR, e.folder, "render.png"))
        ? `<img src="${main}" data-main="${main}" alt="" loading="lazy">` : `<span>no render</span>`;
    const modes = e.folder && existsSync(path.join(EXAMPLES_DIR, e.folder)) ? renders(e) : [];
    const strip = modes.length ? `<div class="modes">${modes.map((m) => {
        const src = `${base}img/${id}/${encodeURIComponent(m.name)}.png`;
        const href = m.own ? `${play}${encodeURIComponent(m.name)}/` : m.theme ? `${play}#t=${m.theme}` : play;
        return `<button type="button" data-mode="${esc(m.name)}" data-src="${src}" data-play="${href}" aria-pressed="false" title="Show the ${esc(m.name)} render"><img src="${src}" alt="" loading="lazy">${esc(m.name)}</button>`;
    }).join("")}</div>` : "";
    return `<a class="card" href="${play}" data-play="${play}" data-family="${esc(e.family ?? "")}" data-text="${esc(text.toLowerCase())}">
<div class="thumb">${img}</div>${strip}
<div class="body"><span class="id">${esc(e.id)}</span><span class="title">${esc(e.title ?? e.id)}</span>
<span class="desc">${esc(desc ?? "")}</span>
<span class="tags">${tags.map((t) => `<span>${esc(t)}</span>`).join("")}</span>
<span class="links">${links}</span></div></a>`;
}

function examplesPage() {
    const C = loadCatalog();
    const list = [...C.examples].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
    const families = [...new Set(list.map((e) => e.family))].sort();
    const cards = list.map((e) => card({
        e, base: "",
        text: [e.id, e.title, e.summary, e.prompt, ...(e.keywords ?? []), ...(e.capabilities?.primary ?? []), ...(e.capabilities?.secondary ?? []), ...(e.derived?.components ?? [])].join(" "),
        desc: e.summary,
        tags: [...(e.capabilities?.primary ?? []), ...(e.derived?.components ?? [])],
        links: `<span>${formatBytes(e.derived?.bytes ?? 0)}</span>`,
    }));
    return page({
        title: "RemoteCompose examples", current: "examples", families, cards, modes: list.some((e) => e.derived?.renders),
        sub: `${list.length} verified examples, each byte-identical to the Java parser's output. Click one to open it in the playground.`,
    });
}

function componentsPage() {
    const C = loadCatalog();
    const names = [...C.library.components.keys()].sort();
    const cards = names.map((name) => {
        const def = C.library.components.get(name);
        const demo = C.demos.get(name);
        const e = demo ?? { id: name, title: name, family: "COMP", folder: `components/${name}` };
        const gallery = C.examples.find((x) => x.kind === "gallery" && (x.derived?.components ?? []).includes(name));
        return card({
            e, base: "../",
            text: [name, def.summary, demo?.prompt, ...(demo?.keywords ?? []), ...(C.vocab.components?.[name]?.synonyms ?? []), ...(def.capabilities ?? [])].join(" "),
            desc: def.summary,
            tags: Object.keys(def.params ?? {}).slice(0, 6),
            links: (gallery ? `<span>in ${esc(gallery.id)}</span>` : "") + (demo ? `<span>${formatBytes(demo.derived?.bytes ?? 0)}</span>` : "<span>no demo yet</span>"),
        });
    });
    return page({
        title: "RemoteCompose components", current: "components", families: [], cards, modes: true,
        sub: `${names.length} reusable components, each in a light, dark and two monochrome versions: mono (light on black, for always-on displays) and mono inverted (dark on white, for e-ink). Call one by name in any document ({"Gauge": {"value": "@cpu"}}); every tool expands it. Click one to open its demo in the playground.`,
    });
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
    const known = p === "/" || p === "" || /^\/(components|play|img|json)(\/|$)/.test(p);
    if (!known) return false;
    if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD" });
        res.end();
        return true;
    }
    if (p === "/" || p === "") return send(req, res, 200, "text/html; charset=utf-8", examplesPage());
    if (p === "/components") { res.writeHead(301, { Location: `components/${url.search}` }); res.end(); return true; }
    if (p === "/components/") return send(req, res, 200, "text/html; charset=utf-8", componentsPage());
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
    m = /^\/img\/([^/]+)(?:\/([a-z][\w-]*))?\.png$/.exec(p);
    if (m) {
        const e = entry(decodeURIComponent(m[1]));
        const file = e && path.join(EXAMPLES_DIR, e.folder, m[2] ? `render-${m[2]}.png` : "render.png");
        if (!file || !existsSync(file)) return send(req, res, 404, "text/plain", "not found\n");
        return send(req, res, 200, "image/png", readFileSync(file));
    }
    m = /^\/json\/([^/.]+?)(\.expanded|\.component|\.[a-z][\w-]*\.expanded)?\.json$/.exec(p);
    if (m) {
        const e = entry(decodeURIComponent(m[1]));
        const name = { ".expanded": "doc.expanded.json", ".component": "component.json" }[m[2]]
            ?? (m[2] ? `doc${m[2]}.json` : "doc.json");   // .mono.expanded: doc.mono.expanded.json
        const file = e && path.join(EXAMPLES_DIR, e.folder, name);
        if (!file || !existsSync(file)) return send(req, res, 404, "text/plain", "not found\n");
        return send(req, res, 200, "application/json; charset=utf-8", readFileSync(file));
    }
    return send(req, res, 404, "text/plain", "not found\n");
}
