// The stream: published pages their owners chose to show everyone, under a name and their
// account's name, with votes. Served by the examples site (lib/examples-web.mjs) at <base>/stream/:
//   GET  <base>/stream/[?sort=new|top]   the items: preview, name, poster, score; a card opens
//                                        the published page (its playground)
//   POST <base>/stream/<page id>/vote    value=1|-1|0 (0 takes the vote back); signed in, CSRF.
//                                        With Accept: application/json it answers the item's new
//                                        score instead of redirecting (the page's script uses it)
//   POST <base>/stream/<page id>/remove  admins: take an item out (owners do it from their account)
//   POST <base>/stream/<page id>/feature value=1|0: admins mark an item as a showcase, or not;
//                                        the Showcases page lists marked items (featuredSection)
// Posting, renaming and removing one's own items, and the account's name, are on the account page
// (lib/account-web.mjs). The data is in the accounts store (lib/accounts.mjs, schema 8).

import { readFileSync } from "node:fs";
import path from "node:path";
import { siteFooter } from "./privacy-web.mjs";
import { accounts, accountsEnabled, csrfFor, readCookie } from "./accounts.mjs";
import { esc, readForm, sameOrigin } from "./account-web.mjs";
import { formatBytes } from "./web-page.mjs";
import { workspaceRoot } from "./workspace.mjs";

const PAGE_ID = /^[A-Za-z0-9_-]{22}$/;

/** A published page's meta.json (pages/<id>/), or null when it is gone. */
function pageMeta(id) {
    const root = workspaceRoot();
    if (!root || !PAGE_ID.test(String(id))) return null;
    try { return JSON.parse(readFileSync(path.join(root, "pages", id, "meta.json"), "utf8")); } catch { return null; }
}

const STREAM_CSS = `
.sortbar { display:flex; gap:6px; align-items:center; margin:12px 0 4px; flex-wrap:wrap; }
.sortbar a { padding:6px 12px; border:1px solid var(--line); border-radius:999px; background:var(--card); color:var(--ink); text-decoration:none; font-size:13px; }
.sortbar a[aria-current] { background:var(--accent); border-color:var(--accent); color:#fff; }
.sortbar .note { color:var(--muted); font-size:13px; margin-left:auto; }
.sortbar .note a { padding:0; border:0; background:none; color:var(--accent); }
.sitem { display:flex; flex-direction:column; background:var(--card); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
.sitem:hover, .sitem:focus-within { border-color:var(--accent); }
.sitem > a { color:inherit; text-decoration:none; display:flex; flex-direction:column; flex:1; }
.sitem .thumb { aspect-ratio:4/3; overflow:hidden; }
.sitem .thumb img { width:100%; height:100%; object-fit:contain; display:block; }
.sitem .by { color:var(--muted); font-size:13px; }
.sitem .meta { color:var(--muted); font-size:12px; font-variant-numeric:tabular-nums; }
.votes { display:flex; align-items:center; gap:6px; padding:8px 12px; border-top:1px solid var(--line); }
.votes form { margin:0; }
.votes button { width:32px; height:28px; border:1px solid var(--line); border-radius:8px; background:var(--bg); color:var(--muted); font:inherit; font-size:14px; line-height:1; cursor:pointer; }
.votes button:hover { border-color:var(--accent); color:var(--ink); }
.votes button[aria-pressed=true].up { background:color-mix(in srgb, #2e9d57 22%, transparent); border-color:#2e9d57; color:var(--ink); }
.votes button[aria-pressed=true].down { background:color-mix(in srgb, #d0453a 22%, transparent); border-color:#d0453a; color:var(--ink); }
.votes button:disabled { cursor:default; opacity:.5; }
.votes .score { min-width:2.5em; text-align:center; font-weight:700; font-variant-numeric:tabular-nums; }
.votes .split { color:var(--muted); font-size:12px; font-variant-numeric:tabular-nums; }
.votes .admin { margin-left:auto; display:flex; gap:4px; }
.votes .admin button { width:auto; padding:0 8px; font-size:12px; color:#d0453a; }
.votes .admin button.feature { color:var(--accent); }
.sitem .star { align-self:flex-start; font-size:11px; font-weight:700; letter-spacing:.03em; text-transform:uppercase; color:#b26b00; background:color-mix(in srgb, #f6a525 22%, transparent); border-radius:6px; padding:1px 6px; }
.lead { max-width:1280px; margin:0 auto; padding:4px 16px 8px; }
.lead h2 { font-size:16px; margin:8px 0 2px; }
.lead p { color:var(--muted); margin:0 0 10px; font-size:13px; }
.lead p a { color:var(--accent); text-decoration:none; }
.lead .grid { display:grid; gap:16px; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); }
.lead + main h2.cat { grid-column:1/-1; font-size:16px; margin:12px 0 0; }
`;

// Votes without a reload: the form posts as it would, asking for JSON back. (The forms work
// without the script too: the server then redirects back to the stream.)
const STREAM_SCRIPT = `
for (const form of document.querySelectorAll("form.vote")) form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const item = form.closest(".sitem");
  const body = new URLSearchParams(new FormData(form, ev.submitter));
  try {
    const r = await fetch(form.action, { method: "POST", body, headers: { Accept: "application/json" }, credentials: "same-origin" });
    if (!r.ok) { location.reload(); return; }
    const s = await r.json();
    item.querySelector(".score").textContent = s.score;
    item.querySelector(".split").textContent = "+" + s.ups + " / −" + s.downs;
    for (const b of item.querySelectorAll("button[name=value]")) {
      const v = Number(b.dataset.v);
      b.setAttribute("aria-pressed", String(s.my_vote === v));
      b.value = s.my_vote === v ? "0" : String(v);
    }
  } catch { location.reload(); }
});
`;

const day = (iso) => String(iso ?? "").slice(0, 10);

function itemCard(it, { csrf, signedIn, admin, sort }) {
    const m = it.meta;
    const preview = m.preview && it.url ? `<img src="${esc(it.url)}preview.png" alt="" loading="lazy">` : "<span>no preview</span>";
    const size = m.rc_bytes ? `${formatBytes(m.rc_bytes)} .rc` : "";
    const docSize = m.document?.width > 0 ? `${m.document.width}×${m.document.height}` : "";
    const btn = (v, cls, label, sign) => `<button class="${cls}" type="submit" name="value" data-v="${v}" value="${it.my_vote === v ? 0 : v}" aria-pressed="${it.my_vote === v}" aria-label="${label}"${signedIn ? "" : " disabled"}>${sign}</button>`;
    const vote = signedIn
        ? `<form class="vote" method="post" action="${esc(it.page_id)}/vote${sort === "top" ? "?sort=top" : ""}">${csrf}${btn(1, "up", "Vote up", "▲")}</form>
<span class="score">${it.score}</span>
<form class="vote" method="post" action="${esc(it.page_id)}/vote${sort === "top" ? "?sort=top" : ""}">${csrf}${btn(-1, "down", "Vote down", "▼")}</form>`
        : `${btn(1, "up", "Vote up (sign in to vote)", "▲")}<span class="score">${it.score}</span>${btn(-1, "down", "Vote down (sign in to vote)", "▼")}`;
    return `<article class="sitem" id="s-${esc(it.page_id)}">
<a href="${esc(it.url)}"><div class="thumb">${preview}</div>
<div class="body">${it.featured ? '<span class="star">Showcase</span>' : ""}<span class="title">${esc(it.title)}</span><span class="by">by ${esc(it.author)}</span>
<span class="meta">${[size, docSize, day(it.created)].filter(Boolean).map(esc).join(" · ")}</span></div></a>
<div class="votes">${vote}<span class="split">+${it.ups} / −${it.downs}</span>
${admin ? `<div class="admin"><form method="post" action="${esc(it.page_id)}/feature${sort === "top" ? "?sort=top" : ""}">${csrf}<input type="hidden" name="value" value="${it.featured ? 0 : 1}"><button class="feature" type="submit" title="${it.featured ? "Take it off the Showcases page" : "Show it on the Showcases page"}">${it.featured ? "Unshowcase" : "Make showcase"}</button></form>
<form method="post" action="${esc(it.page_id)}/remove">${csrf}<button type="submit">Remove</button></form></div>` : ""}</div>
</article>`;
}

function streamPage({ site, items, sort, acct, sid, total }) {
    const csrf = sid ? `<input type="hidden" name="csrf" value="${csrfFor(sid)}">` : "";
    const sortLink = (k, label) => `<a href="./${k === "new" ? "" : "?sort=" + k}"${sort === k ? ' aria-current="page"' : ""}>${label}</a>`;
    const note = acct
        ? (acct.name ? `You are <b>${esc(acct.name)}</b> (<a href="../account/#name">change</a>) · <a href="../account/#stream">Post your pages</a>`
            : `<a href="../account/#name">Set your name</a> to post your pages`)
        : `<a href="../account/">Sign in</a> to vote and to post your pages`;
    const cards = items.map((it) => itemCard(it, { csrf, signedIn: !!acct, admin: !!acct?.admin, sort })).join("\n");
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stream</title>${site.fonts ?? ""}<style>${site.css}${STREAM_CSS}</style></head>
<body>
<header>
<nav>${site.nav("stream")}</nav>
<h1>Stream</h1>
<p class="sub">Documents people made with Kobento and chose to share. Open one to play with it in the playground.${total ? ` ${total} item${total === 1 ? "" : "s"}.` : ""}</p>
<div class="sortbar">${sortLink("new", "Newest")}${sortLink("top", "Top")}<span class="note">${note}</span></div>
</header>
<main>${cards || `<p class="empty">Nothing in the stream yet. Publish a document with the publish tool, then post it from your account page.</p>`}</main>
${siteFooter("../")}
<script>${STREAM_SCRIPT}</script>
</body></html>`;
}

const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" };

function reply(res, status, type, body, extra = {}) {
    const buf = Buffer.from(body);
    res.writeHead(status, { "Content-Type": type, "Content-Length": buf.length, ...HEADERS, ...extra });
    res.end(buf);
    return true;
}

/** True when it answered the request. site: {css, nav(current), fonts?}. */
export async function streamRoute(req, url, res, site) {
    const p = url.pathname;
    if (!/^\/stream(\/|$)/.test(p)) return false;
    if (!accountsEnabled()) return reply(res, 404, "text/plain", "The stream needs accounts, which are off on this server.\n");
    if (p === "/stream") { res.writeHead(301, { Location: `stream/${url.search}` }); res.end(); return true; }
    const store = await accounts();
    const sid = readCookie(req);
    const acct = sid ? store.sessionAccount(sid) : null;
    const sort = url.searchParams.get("sort") === "top" ? "top" : "new";
    if (p === "/stream/") {
        if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD" }); res.end(); return true; }
        const items = store.streamItems({ sort, viewerId: acct?.id ?? null })
            .map((it) => ({ ...it, meta: pageMeta(it.page_id) })).filter((it) => it.meta && it.url);
        return reply(res, 200, "text/html; charset=utf-8", streamPage({ site, items, sort, acct, sid, total: items.length }));
    }
    const m = /^\/stream\/([A-Za-z0-9_-]{22})\/(vote|remove|feature)$/.exec(p);
    if (!m) return reply(res, 404, "text/plain", "not found\n");
    if (req.method !== "POST") { res.writeHead(405, { Allow: "POST" }); res.end(); return true; }
    const wantsJson = /application\/json/.test(String(req.headers.accept ?? ""));
    const back = (status = 303) => {
        res.writeHead(status, { Location: `../${sort === "top" ? "?sort=top" : ""}#s-${m[1]}`, ...HEADERS });
        res.end();
        return true;
    };
    if (!sameOrigin(req)) return reply(res, 403, "text/plain", "Refused: this form must be sent from this site's own pages.\n");
    if (!acct) return wantsJson ? reply(res, 401, "application/json", JSON.stringify({ error: "sign in to vote" })) : back();
    let form;
    try { form = await readForm(req); } catch (e) { return reply(res, e.status ?? 400, "text/plain", "Bad request.\n"); }
    if (form.get("csrf") !== csrfFor(sid)) return reply(res, 403, "text/plain", "Refused: the page is stale. Reload it and try again.\n");
    if (m[2] === "remove" || m[2] === "feature") {
        if (!acct.admin) return reply(res, 403, "text/plain", "Admins only.\n");
        if (m[2] === "remove") store.streamRemove(m[1]);
        else store.streamFeature(m[1], form.get("value") !== "0");
        return back();
    }
    let ok;
    try { ok = store.vote(m[1], acct.id, form.get("value")); } catch (e) { return reply(res, 400, "text/plain", e.message + "\n"); }
    if (!ok) return wantsJson ? reply(res, 404, "application/json", JSON.stringify({ error: "not in the stream" })) : back();
    if (wantsJson) {
        const it = store.streamItem(m[1], acct.id);
        return reply(res, 200, "application/json", JSON.stringify({ score: it.score, ups: it.ups, downs: it.downs, my_vote: it.my_vote }));
    }
    return back();
}

/**
 * The Showcases page's "From the stream" section: the items an admin marked, as stream cards
 * without votes (a card opens the page's playground). Empty when there are none or accounts
 * are off. `base` is the way from the page to the site's root ("../").
 */
export async function featuredSection(base = "../") {
    if (!accountsEnabled()) return "";
    const store = await accounts();
    const items = store.featuredItems().map((it) => ({ ...it, meta: pageMeta(it.page_id) })).filter((it) => it.meta && it.url);
    if (!items.length) return "";
    const cards = items.map((it) => {
        const m = it.meta;
        const preview = m.preview ? `<img src="${esc(it.url)}preview.png" alt="" loading="lazy">` : "<span>no preview</span>";
        const facts = [m.rc_bytes ? `${formatBytes(m.rc_bytes)} .rc` : "", m.document?.width > 0 ? `${m.document.width}×${m.document.height}` : ""].filter(Boolean);
        return `<article class="sitem"><a href="${esc(it.url)}"><div class="thumb">${preview}</div>
<div class="body"><span class="title">${esc(it.title)}</span><span class="by">by ${esc(it.author)}</span>
<span class="meta">${facts.map(esc).join(" · ")}</span></div></a></article>`;
    }).join("\n");
    return `<section class="lead"><h2>From the stream</h2>
<p>Made by people with Kobento and chosen for the showcases. More in the <a href="${base}stream/">stream</a>.</p>
<div class="grid">${cards}</div></section>`;
}

export { STREAM_CSS };
