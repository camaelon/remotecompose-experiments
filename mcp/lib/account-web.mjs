// The account pages of the website (served by rc-examples next to its catalog pages, so at
// /examples/account/ on the VPS, and by the front door at /account/). Every link is relative.
//
//   GET  account/                    signed out: register / sign in with a token; signed in:
//                                    tokens, usage, published pages (admins: every account)
//   POST account/register            email, name -> a pending account and an emailed verification
//                                    link; the same "check your email" answer whatever the address
//                                    (pending: the link again; verified: a sign-in link instead).
//                                    With RC_EMAIL_VERIFY=off: an account, its first token (shown
//                                    once) and a session at once
//   POST account/resend              email -> the link again (per address and per account limits)
//   GET  account/verify?code=        a button that POSTs the code (mail scanners follow GET links:
//   POST account/verify              they must not spend it) -> verified, signed in, first token once
//   POST account/email-signin        email -> an emailed sign-in link (15 min, single use)
//   GET  account/signin-link?code=   a button that POSTs it ->
//   POST account/signin-link         a session, then the account page
//   POST account/signin              token -> a session
//   POST account/signout
//   POST account/tokens              label -> a new token, shown once with connection instructions
//   POST account/tokens/<id>/revoke
//   GET  account/sessions/           your MCP sessions (admins: ?account=<id> for anyone's)
//   GET  account/sessions/<client>   one session's timeline: every call, the gaps between them
//                                    (the assistant thinking), arguments and results in full;
//                                    <client>.json downloads it; <client>/img/<file> is one of
//                                    its pictures (lib/trace-images.mjs), same access rules
//   POST account/apps/<id>/revoke    disconnects an OAuth app (its grant: access and refresh tokens)
//   POST account/admin/<id>/disable | enable | resend | delete     (admins; delete: pending only)
//
// OAuth (lib/oauth.mjs) sends a visitor who is not signed in here with a cookie (rc_oauth_next)
// holding the authorization request; any sign-in then goes back to it.
//
// Sessions: a random id in an HttpOnly, SameSite=Lax cookie on Path=/ (so the deploy server's
// /pages/ index sees it too), Secure when the request came over https, 30 days, stored hashed.
// POSTs must come from this origin (Origin, else Referer), and signed-in forms carry a
// per-session token too. Register and sign-in are rate-limited per address. The MCP endpoints
// ignore cookies: they take the token.

import { siteFooter } from "./privacy-web.mjs";
import { Accounts, accounts, accountsEnabled, csrfFor, emailVerify, RateLimiter, readCookie, SESSION_COOKIE, signupOpen } from "./accounts.mjs";
import { linkEmail, sendMail } from "./mail.mjs";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { PAGE_CARD_CSS, pageCards } from "./page-cards.mjs";
import { traceImagePath } from "./trace-images.mjs";
import { workspaceRoot } from "./workspace.mjs";
import { escapeHtml } from "./web-page.mjs";
import { scriptsOffered } from "./app-script.mjs";

const esc = (s) => escapeHtml(s ?? "");
const MAX_FORM = 16 << 10;
const registerLimit = new RateLimiter(Number(process.env.RC_REGISTER_PER_HOUR ?? 5), 3600_000);
const signinLimit = new RateLimiter(Number(process.env.RC_SIGNIN_PER_15MIN ?? 20), 900_000);

const isHttps = (req) => String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim() === "https" || !!req.socket?.encrypted;
const selfOrigin = (req) => `${isHttps(req) ? "https" : "http"}://${req.headers.host ?? "localhost"}`;
const log = (...a) => console.error(new Date().toISOString(), ...a);

/** The account pages' absolute address, for links in emails: RC_ACCOUNT_URL, else /account/ at this origin. */
const accountBase = (req) => (process.env.RC_ACCOUNT_URL || `${selfOrigin(req)}/account/`).replace(/\/*$/, "/");

/** Emails a verification link to a pending account, or a sign-in link to an active one. Not awaited by the
 *  caller (the answer must not depend on whether the address has an account); failures are logged. */
function mailLink(store, req, acct, { register = false } = {}) {
    const verify = acct.status === "pending";
    const code = store.issueCode(acct.id, verify ? "verify" : "signin");
    const link = `${accountBase(req)}${verify ? "verify" : "signin-link"}?code=${code}`;
    const mail = verify
        ? { subject: "Confirm your email for RemoteCompose", ...linkEmail({
            heading: "Confirm your email",
            lines: [`Someone (we hope you) created a RemoteCompose account with ${acct.email}.`,
                "Confirm the address to get your token for the RemoteCompose MCP servers. The link works once, for 24 hours."],
            button: "Confirm and get my token", link,
            footer: "If it was not you, ignore this email: the account is deleted after a week unless confirmed." }) }
        : { subject: "Your RemoteCompose sign-in link", ...linkEmail({
            heading: "Sign in to RemoteCompose",
            lines: [register ? `Someone asked to create an account with ${acct.email}, which already has one. Here is a sign-in link instead.`
                : `Here is your sign-in link for ${acct.email}.`,
                "It works once, for 15 minutes. From your account page you can make new tokens and revoke old ones."],
            button: "Sign in", link,
            footer: "If you did not ask for it, ignore this email: nothing happens unless the link is opened." }) };
    return sendMail({ to: acct.email, link, ...mail })
        .catch((e) => log(`account ${acct.id}: ${e.message}`));
}

/**
 * What a register / resend / email-signin request may send, decided without telling the caller:
 * a new pending account (register only), the link again, a sign-in link, or nothing (no such
 * account, disabled, or over the per-account limit). Returns the mail's promise or null.
 */
function mailFor(store, req, email, { register = false, name = "" } = {}) {
    let acct = store.findAccount(email);
    if (!acct && register) acct = store.createAccount({ email, name }, { pending: true });
    if (!acct || acct.status === "disabled" || !store.canMail(acct.id)) return null;
    return mailLink(store, req, acct, { register });
}

const clientIp = (req) => String(req.headers["x-forwarded-for"] ?? req.socket?.remoteAddress ?? "").split(",")[0].trim();

/** A POST from a page of this site: its Origin (or, without one, its Referer) is this origin. */
export function sameOrigin(req) {
    const self = selfOrigin(req);
    if (req.headers.origin) return req.headers.origin === self;
    try { return new URL(String(req.headers.referer)).origin === self; } catch { return false; }
}

async function readForm(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
        size += c.length;
        if (size > MAX_FORM) throw Object.assign(new Error("form too large"), { status: 413 });
        chunks.push(c);
    }
    return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function cookie(req, value, maxAge) {
    return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? "; Secure" : ""}`;
}

/** The authorization request to go back to after signing in (lib/oauth.mjs sets it), or null. */
export const NEXT_COOKIE = "rc_oauth_next";
function oauthNext(req) {
    const v = readCookie(req, NEXT_COOKIE);
    if (!v) return null;
    const q = new URLSearchParams(v);
    return q.get("client_id") ? q : null;
}
/** Where a sign-in goes: back to the pending authorization (and the cookie cleared), else the account page. */
function afterSignin(req, sessionCookie, to = "./") {
    const next = oauthNext(req);
    return next ? { to: `../oauth/authorize?${next}`, cookies: [sessionCookie, clearNext(req)] } : { to, cookies: [sessionCookie] };
}
const clearNext = (req) => `${NEXT_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps(req) ? "; Secure" : ""}`;

const HEADERS = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    // Not no-referrer: with it a browser sends "Origin: null" on a form POST, and the CSRF check needs the origin.
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
};

/** The CSP, letting pictures also come from these origins (the deploy server's pages, when elsewhere). */
function cspWithImages(urls) {
    const origins = [...new Set(urls.map((u) => { try { return new URL(u).origin; } catch { return null; } }).filter(Boolean))];
    return { "Content-Security-Policy": HEADERS["Content-Security-Policy"].replace("img-src 'self' data:", `img-src 'self' data:${origins.map((o) => " " + o).join("")}`) };
}

/** A published page's facts from the shared workspace (pages/<id>/meta.json), or null. */
function pageMeta(id) {
    const root = workspaceRoot();
    if (!root || !/^[A-Za-z0-9_-]{22}$/.test(String(id))) return null;
    try { return JSON.parse(readFileSync(path.join(root, "pages", id, "meta.json"), "utf8")); } catch { return null; }
}

/** The account's pages as cards: the facts and preview from each page's meta.json. */
function publishedCards(store, accountId) {
    return store.pagesOf(accountId).map((p) => {
        const m = pageMeta(p.id);
        return { ...p, rc_bytes: m?.rc_bytes, document: m?.document, preview: m?.preview && p.url ? `${p.url}preview.png` : null };
    });
}

function html(res, status, body, extra = {}) {
    const buf = Buffer.from(body);
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Content-Length": buf.length, ...HEADERS, ...extra });
    res.end(buf);
    return true;
}

function redirect(res, to, extra = {}) {
    res.writeHead(303, { Location: to, ...HEADERS, ...extra });
    res.end();
    return true;
}

const ACCOUNT_CSS = `
.tl { border:1px solid var(--line); border-radius:10px; overflow:hidden; }
.tl details { border-top:1px solid var(--line); }
.tl details:first-child { border-top:0; }
.tl summary { display:grid; grid-template-columns:42px 78px 92px minmax(0,1fr) 84px 64px; gap:8px; align-items:center; padding:7px 12px; cursor:pointer; list-style:none; font-size:13px; }
.tl summary::-webkit-details-marker { display:none; }
.th { display:inline-block; min-width:16px; padding:0 4px; margin-right:4px; border-radius:4px; color:#fff; font:700 11px/16px system-ui,sans-serif; text-align:center; }
.threads td .sw { display:inline-block; width:12px; height:12px; border-radius:3px; vertical-align:-1px; margin-right:6px; }
.threads tr.on td { background:var(--chip); }
.tl summary:hover { background:var(--chip); }
.tl .hd { display:grid; grid-template-columns:42px 78px 92px minmax(0,1fr) 84px 64px; gap:8px; padding:7px 12px; color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.05em; background:var(--chip); }
.tl .n, .tl .t { font-variant-numeric:tabular-nums; }
.tl .t { color:var(--muted); }
.tl .tool { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.gapx { color:#b26b00; font-weight:600; }
.slow { color:#d0453a; font-weight:600; }
.tl .detail { padding:4px 12px 14px 62px; }
.tl .strip { grid-column:1 / -1; display:flex; gap:8px; overflow-x:auto; padding:4px 0 2px 50px; }
.tl .strip img { height:120px; width:auto; border-radius:6px; border:1px solid var(--line); background:var(--thumb); display:block; }
.tl .full img { max-width:100%; height:auto; border-radius:8px; border:1px solid var(--line); display:block; margin:6px 0; background:var(--thumb); }
.pubbed { display:flex; gap:16px; align-items:center; flex-wrap:wrap; }
.pubbed img { height:140px; width:auto; border-radius:8px; border:1px solid var(--line); background:var(--thumb); }
${PAGE_CARD_CSS}
.tl .detail h4 { margin:10px 0 4px; font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; }
pre.body { max-height:60vh; overflow:auto; margin:0; white-space:pre-wrap; overflow-wrap:anywhere; }
.pill.err2 { color:#d0453a; }
.pill.rep { color:#b26b00; }
.kv { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin:0 0 12px; }
.kv div b { display:block; font-size:18px; }
.kv div span { color:var(--muted); font-size:12px; }
.bar2 { display:flex; height:10px; border-radius:5px; overflow:hidden; background:var(--chip); margin:4px 0 14px; }
.bar2 i { display:block; background:var(--accent); }
.bar2 i.g { background:#d08a00; }
`; const ACCOUNT_CSS_BASE = `
main.acct { display:block; }
main.acct a, p.sub a { color:var(--accent); text-decoration:none; font-weight:500; }
main.acct a:hover, p.sub a:hover { text-decoration:underline; }
.panel { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 18px; margin:0 0 16px; }
.panel h2 { font-size:16px; margin:0 0 10px; }
.panel p { margin:0 0 10px; }
.muted { color:var(--muted); }
.cols { display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); }
form.stack { display:flex; flex-direction:column; gap:10px; }
form.inline { display:inline; }
label.f { display:flex; flex-direction:column; gap:4px; font-size:13px; color:var(--muted); }
input[type=text], input[type=email], input[type=password] { padding:8px 12px; border:1px solid var(--line); border-radius:8px; background:var(--bg); color:var(--ink); font:inherit; }
button.btn { align-self:flex-start; padding:7px 14px; border:1px solid var(--accent); border-radius:8px; background:var(--accent); color:#fff; font:inherit; font-weight:600; cursor:pointer; }
button.link { padding:3px 10px; border:1px solid var(--line); border-radius:999px; background:var(--card); color:var(--ink); font:inherit; font-size:12px; cursor:pointer; }
button.link.danger { color:#d0453a; }
.pact details > summary.link { display:inline-block; list-style:none; padding:3px 10px; border:1px solid var(--line); border-radius:999px; background:var(--card); color:var(--ink); font-size:12px; cursor:pointer; }
.pact details > summary.link::-webkit-details-marker { display:none; }
.pact details > summary.link.danger { color:#d0453a; }
.pact details[open] > summary { margin-bottom:6px; }
.pact details p { margin:0 0 6px; }
.pact .row { flex-wrap:wrap; gap:6px; }
.pact .row label.f { flex:1 1 100%; }
.btn.danger { background:#d0453a; border-color:#d0453a; color:#fff; }
.row { display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap; }
.row label.f { flex:1 1 200px; }
.wrap { overflow-x:auto; }
table { width:100%; border-collapse:collapse; font-size:13px; }
th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); white-space:nowrap; }
td.w { white-space:normal; overflow-wrap:anywhere; }
th { color:var(--muted); font-weight:500; font-size:11px; text-transform:uppercase; letter-spacing:.05em; }
.n { text-align:right; font-variant-numeric:tabular-nums; }
code, pre { font:12px/1.5 ui-monospace,Menlo,monospace; }
pre { background:var(--chip); border-radius:8px; padding:10px 12px; margin:4px 0 12px; overflow-x:auto; white-space:pre-wrap; word-break:break-all; }
.fresh { border-color:var(--accent); box-shadow:0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent); }
.token { font:600 14px ui-monospace,Menlo,monospace; background:var(--chip); padding:8px 12px; border-radius:8px; word-break:break-all; display:block; margin:6px 0 12px; }
.note { background:color-mix(in srgb, #d08a00 14%, transparent); border-radius:8px; padding:8px 12px; margin:0 0 12px; }
.ok { background:color-mix(in srgb, #2e9d57 16%, transparent); border-radius:8px; padding:8px 12px; margin:0 0 16px; }
.err { background:color-mix(in srgb, #d0453a 16%, transparent); border-radius:8px; padding:8px 12px; margin:0 0 16px; }
.pill { font-size:11px; padding:1px 8px; border-radius:999px; background:var(--chip); color:var(--muted); }
.pill.off { color:#d0453a; }
.stats { display:flex; gap:24px; flex-wrap:wrap; margin:0 0 8px; }
.stats b { font-size:20px; display:block; }
svg.bars { width:100%; height:auto; display:block; margin:4px 0 12px; }
svg.bars .b { fill:var(--accent); }
svg.bars .e { fill:#d0453a; }
svg.bars text { fill:var(--muted); font:10px system-ui,sans-serif; }
svg.bars line { stroke:var(--line); }
h3 { font-size:13px; margin:14px 0 6px; color:var(--muted); font-weight:600; }
.who { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
`;

const COPY_SCRIPT = `
for (const b of document.querySelectorAll("[data-copy]")) b.addEventListener("click", () => {
  const el = document.getElementById(b.dataset.copy);
  navigator.clipboard?.writeText(el.textContent.trim()).then(() => { b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1500); });
});
`;

function shell({ css, nav, title, sub, body }) {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title><style>${css}${ACCOUNT_CSS_BASE}${ACCOUNT_CSS}</style></head>
<body>
<header>
<nav>${nav}</nav>
<h1>${esc(title)}</h1>
<p class="sub">${sub}</p>
</header>
<main class="acct">${body}</main>
${siteFooter(nav.includes('href="../../') ? "../../" : "../")}
<script>${COPY_SCRIPT}</script>
</body></html>`;
}

/** The MCP endpoint people connect to: RC_MCP_URL, else the front door at this site's root. */
const mcpUrl = (req) => (process.env.RC_MCP_URL ?? `${selfOrigin(req)}/mcp`).replace(/\/+$/, "");

let snippetId = 0;
const snippet = (text) => {
    const id = `s${++snippetId}`;
    return `<div class="row" style="align-items:center;justify-content:space-between"><span></span><button type="button" class="link" data-copy="${id}">Copy</button></div><pre id="${id}">${esc(text)}</pre>`;
};

/** The just-made token, once, with what to paste where. */
function freshToken(req, fresh) {
    const url = mcpUrl(req);
    const t = fresh.token;
    return `<section class="panel fresh">
<h2>Your new token${fresh.label ? `: ${esc(fresh.label)}` : ""}</h2>
<p class="note">Copy it now: it is shown only this once. Only a hash of it is kept, so it cannot be shown again; if you lose it, make a new one and revoke this one.</p>
<code class="token" id="tok">${esc(t)}</code>
<button type="button" class="link" data-copy="tok">Copy</button>
<h3>Claude Code</h3>
${snippet(`claude mcp add --transport http kobento ${url} --header "Authorization: Bearer ${t}"`)}
<h3>claude.ai (Settings → Connectors → Add custom connector) and ChatGPT (Settings → Apps &amp; Connectors, developer mode → Create; authentication: none)</h3>
<p class="muted">These take only a URL: the token goes in its last segment. Treat the URL like a password.</p>
${snippet(`${url}/${t}`)}
<h3>curl</h3>
${snippet(`curl -s ${url} -H "Authorization: Bearer ${t}" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`)}
<p class="muted">The single-purpose servers (…/rc-render/mcp, …/json2rc/mcp, …/examples/mcp, …) take the same token.</p>
</section>`;
}

const day = (iso) => (iso ? String(iso).replace("T", " ").slice(0, 16) : "–");

/** Calls per day as inline SVG bars (errors stacked in red), with the first and last date. */
function bars(byDay) {
    const W = 600, H = 110, top = 8, base = 92, n = byDay.length;
    const max = Math.max(1, ...byDay.map((d) => d.calls));
    const bw = W / n;
    const rects = byDay.map((d, i) => {
        const h = (d.calls / max) * (base - top), eh = (d.errors / max) * (base - top);
        const x = (i * bw + 1).toFixed(1), w = Math.max(1, bw - 2).toFixed(1);
        return `<g><title>${esc(d.day)}: ${d.calls} call${d.calls === 1 ? "" : "s"}${d.errors ? `, ${d.errors} error${d.errors === 1 ? "" : "s"}` : ""}</title>` +
            `<rect class="b" x="${x}" y="${(base - h).toFixed(1)}" width="${w}" height="${h.toFixed(1)}" rx="1.5"/>` +
            (eh ? `<rect class="e" x="${x}" y="${(base - eh).toFixed(1)}" width="${w}" height="${eh.toFixed(1)}"/>` : "") + `</g>`;
    }).join("");
    return `<svg class="bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="Calls per day over the last ${n} days, at most ${max}">
<line x1="0" y1="${base}" x2="${W}" y2="${base}"/><text x="0" y="${top + 2}">${max}</text>${rects}
<text x="0" y="${H - 2}">${esc(byDay[0]?.day)}</text><text x="${W}" y="${H - 2}" text-anchor="end">${esc(byDay[n - 1]?.day)}</text></svg>`;
}

function groupTable(rows, head) {
    if (!rows.length) return "";
    return `<div class="wrap"><table><thead><tr><th>${head}</th><th class="n">Calls</th><th class="n">Errors</th><th class="n">Avg ms</th></tr></thead><tbody>
${rows.map((r) => `<tr><td class="w">${esc(r.name)}</td><td class="n">${r.calls}</td><td class="n">${r.errors || ""}</td><td class="n">${r.avg_ms}</td></tr>`).join("\n")}
</tbody></table></div>`;
}

const fmtMs = (ms) => (ms == null ? "" : ms < 1000 ? `${Math.round(ms)} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s`
    : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);
const GAP_SLOW_MS = 20_000, CALL_SLOW_MS = 5_000;

/** The sessions table: one row per MCP session, linking to its timeline (href(client)). */
function sessionsTable(list, href) {
    const link = (x) => href(x.client) + (x.thread ? `${href(x.client).includes("?") ? "&" : "?"}thread=${encodeURIComponent(x.thread)}` : "");
    if (!list.length) return `<p class="muted">No sessions yet. Each MCP client session (one conversation, roughly) shows up here with every call it made.</p>`;
    return `<div class="wrap"><table><thead><tr><th>Started (UTC)</th><th class="n">Duration</th><th class="n">Calls</th><th class="n">Errors</th><th>Tools</th><th>Via</th></tr></thead><tbody>
${list.map((x) => `<tr><td><a href="${esc(link(x))}">${esc(day(x.started))}</a>${x.thread ? ` <span class="pill" title="split by the ${esc(x.threadHow)} id the client sent">one conversation</span>` : x.threads > 1 ? ` <span class="pill rep" title="calls from more than one conversation, told apart by their documents and timing">${x.threads} threads</span>` : ""}</td><td class="n">${esc(fmtMs(x.duration_ms))}</td><td class="n">${x.calls}</td><td class="n">${x.errors || ""}</td>
<td class="w">${Object.entries(x.tools).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${esc(t)}${n > 1 ? ` ×${n}` : ""}`).join(", ")}</td><td class="w">${esc(x.via)}</td></tr>`).join("\n")}
</tbody></table></div>`;
}

const THREAD_COLORS = ["#2f6fde", "#d0453a", "#2e9d57", "#b26b00", "#8a4fd6", "#0f8f9a", "#c2407f", "#5d6676"];
const HOW = { "session-id": "the Mcp-Session-Id the client sent back", lineage: "the documents the calls read and wrote",
    time: "timing (a call with no document joins the conversation whose last call had just finished)", first: "the first call" };
const howText = (h) => HOW[h] ?? (h?.startsWith("meta:") ? `the id in the call's _meta (${h.slice(5)})` : h?.startsWith("header:") ? `the request header ${h.slice(7)}` : h);

/** A session's threads in order of first call: [{key, letter, color, calls, ...totals, goal, how}]. */
function sessionThreads(calls) {
    const by = new Map();
    for (const c of calls) {
        let t = by.get(c.thread);
        if (!t) {
            const i = by.size;
            by.set(c.thread, (t = { key: c.thread, letter: String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : ""),
                color: THREAD_COLORS[i % THREAD_COLORS.length], calls: [], hows: {} }));
        }
        t.calls.push(c);
        t.hows[c.thread_how] = (t.hows[c.thread_how] ?? 0) + 1;
    }
    return [...by.values()].map((t) => {
        const first = t.calls[0], last = t.calls.at(-1);
        let goal = null;
        for (const c of t.calls) {
            let a = null;
            try { a = c.args ? JSON.parse(c.args) : null; } catch { /* none */ }
            goal = a?.goal ?? a?.title ?? a?.query ?? null;
            if (goal) break;
        }
        // No goal or title: the first document it worked on.
        if (!goal) for (const c of t.calls) {
            goal = c.touched?.find((x) => /\.(json|rc)$/.test(x)) ?? null;
            if (goal) break;
        }
        return { ...t, goal, wall: Date.parse(last.end) - Date.parse(first.start), inside: t.calls.reduce((n, c) => n + c.ms, 0),
            gaps: t.calls.reduce((n, c) => n + (c.thread_gap_ms ?? 0), 0), started: first.start };
    });
}

function threadsPanel(threads, selected, href) {
    const hows = {};
    for (const t of threads) for (const [h, n] of Object.entries(t.hows)) hows[h] = (hows[h] ?? 0) + n;
    return `<section class="panel"><h2>${threads.length} conversations in this session</h2>
<p class="muted">Their calls arrived under one session (the client did not send back its Mcp-Session-Id). They are told apart by ${Object.entries(hows).sort((a, b) => b[1] - a[1]).map(([h, n]) => `${esc(howText(h))} (${n} call${n === 1 ? "" : "s"})`).join(", ")}. Gaps below are measured within each conversation: the real thinking time.</p>
<div class="wrap"><table class="threads"><thead><tr><th>Thread</th><th>First goal or document</th><th>Started (UTC)</th><th class="n">Calls</th><th class="n">Wall</th><th class="n">In tools</th><th class="n">Between calls</th></tr></thead><tbody>
<tr${selected ? "" : ' class="on"'}><td colspan="7"><a href="${esc(href(null))}">All threads</a></td></tr>
${threads.map((t) => `<tr${selected === t.key ? ' class="on"' : ""}><td><a href="${esc(href(t.key))}"><span class="sw" style="background:${t.color}"></span>Thread ${t.letter}</a></td><td class="w">${esc(t.goal ?? "–")}</td><td>${esc(day(t.started))}</td>
<td class="n">${t.calls.length}</td><td class="n">${esc(fmtMs(t.wall))}</td><td class="n">${esc(fmtMs(t.inside))}</td><td class="n">${esc(fmtMs(t.gaps))}</td></tr>`).join("\n")}
</tbody></table></div></section>`;
}

/** What the client sent, over the session's calls: to find an id that names a conversation. */
function signalsPanel(calls) {
    const n = calls.length, withMeta = calls.filter((c) => c.meta);
    if (!withMeta.length) return "";
    const count = (f) => { const m = new Map(); for (const c of withMeta) for (const k of f(c) ?? []) m.set(k, (m.get(k) ?? 0) + 1); return m; };
    const distinct = (f) => { const m = new Map(); for (const c of withMeta) for (const [k, v] of Object.entries(f(c) ?? {})) { const s = m.get(k) ?? new Set(); s.add(v); m.set(k, s); } return m; };
    const headers = count((c) => c.meta.headers), headerIds = distinct((c) => c.meta.ids);
    const metaKeys = count((c) => c.meta.call_meta?.keys), metaIds = distinct((c) => c.meta.call_meta?.ids);
    const sent = withMeta.filter((c) => c.meta.mcp_session?.sent).length, known = withMeta.filter((c) => c.meta.mcp_session?.known).length;
    const infos = [...new Set(withMeta.map((c) => c.meta.client_info).filter(Boolean).map((i) => `${i.name} ${i.version}`.trim()))];
    const idRow = (k, calls, vals) => `<tr><td><code>${esc(k)}</code></td><td class="n">${calls}</td><td class="n">${vals ? vals.size : ""}</td>
<td class="w">${vals ? (vals.size === 1 ? "the same on every call: does not tell conversations apart" : vals.size >= calls ? "new on every call: a request id, not a conversation" : `<b>${vals.size} values</b>: could name conversations`) : ""}</td></tr>`;
    return `<section class="panel"><h2>Client signals</h2>
<p class="muted">What the client sent with its ${n} calls (names only; id-like values hashed, never credentials). A usable conversation id is a header or <code>_meta</code> key with one value per chat: a few values, not one for every call and not one for all.</p>
<div class="kv"><div><b>${sent}/${withMeta.length}</b><span>calls sent Mcp-Session-Id back (${known} matched one this server issued)</span></div>
<div><b>${esc(infos.join(", ") || "–")}</b><span>clientInfo at initialize</span></div></div>
<div class="cols"><div><h3>_meta keys on tools/call</h3>${metaKeys.size ? `<div class="wrap"><table><thead><tr><th>Key</th><th class="n">Calls</th><th class="n">Values</th><th></th></tr></thead><tbody>${[...metaKeys].map(([k, c]) => idRow(k, c, metaIds.get(k))).join("")}</tbody></table></div>` : `<p class="muted">None.</p>`}
<h3>Id-like headers</h3>${headerIds.size ? `<div class="wrap"><table><thead><tr><th>Header</th><th class="n">Calls</th><th class="n">Values</th><th></th></tr></thead><tbody>${[...headerIds].map(([k, v]) => idRow(k, headers.get(k) ?? 0, v)).join("")}</tbody></table></div>` : `<p class="muted">None.</p>`}</div>
<div><h3>All request headers (names)</h3><div class="wrap"><table><tbody>${[...headers].sort((a, b) => a[0].localeCompare(b[0])).map(([k, c]) => `<tr><td><code>${esc(k)}</code></td><td class="n">${c}</td></tr>`).join("")}</tbody></table></div></div></div>
</section>`;
}

/** A stored argument or result, pretty-printed when it is JSON. */
function pretty(text) {
    if (text == null) return null;
    try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return String(text); }
}

/** The pages a session published: [{url, id, preview}], newest last. */
function sessionPublishes(calls) {
    const out = [];
    for (const c of calls) {
        if (!c.ok || !/^(package_web|publish)$/.test(c.tool) || !c.result) continue;
        const m = /"url":\s*"(https?:\/\/[^"]+\/pages\/([A-Za-z0-9_-]{22})\/)"/.exec(c.result);
        if (!m) continue;
        const meta = pageMeta(m[2]);
        out.push({ url: m[1], id: m[2], title: meta?.title ?? m[2], preview: meta?.preview ? `${m[1]}preview.png` : null, live: !!meta });
    }
    return out;
}

/** Everything about one session: what it published, totals, then the timeline. imgUrl(file) -> the picture's URL. */
function sessionView(calls, imgUrl = (f) => f, tag = null) {
    const first = calls[0], last = calls.at(-1);
    const wall = Date.parse(last.end) - Date.parse(first.start);
    const inside = calls.reduce((n, c) => n + c.ms, 0);
    const gaps = calls.reduce((n, c) => n + (c.gap_ms ?? 0), 0);
    const perTool = {};
    for (const c of calls) perTool[`${c.server} · ${c.tool}`] = (perTool[`${c.server} · ${c.tool}`] ?? 0) + 1;
    // Identical calls (same tool, same arguments): a loop, or a retry that changed nothing.
    const same = new Map();
    // The files a call read count as arguments: the same path edited in between is a new document.
    calls.forEach((c, i) => { if (c.args != null) { const k = `${c.server}|${c.tool}|${c.args}|${JSON.stringify(c.files ?? null)}`; same.set(k, [...(same.get(k) ?? []), i + 1]); } });
    // Each path's versions in the session: the n-th distinct content it had when a call read it.
    const versions = new Map();   // path -> [sha, ...]
    const versionOf = (f) => {
        if (!f || f.missing) return null;
        const list = versions.get(f.path) ?? [];
        if (!list.includes(f.sha)) list.push(f.sha);
        versions.set(f.path, list);
        return list.indexOf(f.sha) + 1;
    };
    const fileTags = calls.map((c) => Object.values(c.files ?? {}).map((f) => ({ name: String(f.path).split("/").pop(), path: f.path, missing: !!f.missing, v: versionOf(f), sha: f.sha, bytes: f.bytes })));
    const repeats = [...same.entries()].filter(([, v]) => v.length > 1).map(([k, v]) => ({ tool: k.split("|").slice(0, 2).join(" · "), at: v }));
    const repeatOf = new Map();
    for (const r of repeats) r.at.forEach((n, j) => repeatOf.set(n, `${j + 1}/${r.at.length}`));
    const slowest = [...calls.map((c, i) => ({ ...c, n: i + 1 }))].sort((a, b) => b.ms - a.ms).slice(0, 5);
    const errors = calls.map((c, i) => ({ ...c, n: i + 1 })).filter((c) => !c.ok);
    // (With conversations side by side, their gaps overlap: shares of tools + gaps, not of the wall time.)
    const base = Math.max(wall, inside + gaps);
    const pct = (x) => (base > 0 ? (100 * x) / base : 0).toFixed(1);
    const jump = (n) => `<a href="#c${n}">#${n}</a>`;
    const pubs = sessionPublishes(calls);
    const published = pubs.length ? `<section class="panel"><h2>Published in this session</h2>${pubs.reverse().map((x) => `<div class="pubbed" style="margin-bottom:10px">
${x.preview ? `<a href="${esc(x.url)}"><img src="${esc(x.preview)}" alt=""></a>` : ""}<div><b>${esc(x.title)}</b><br>${x.live ? `<a href="${esc(x.url)}">${esc(x.url)}</a>` : `<span class="muted">${esc(x.url)} (unpublished since)</span>`}</div></div>`).join("")}</section>` : "";
    const imageCount = calls.reduce((n, c) => n + (c.images?.files?.length ?? 0), 0);
    const skipped = calls.reduce((n, c) => n + (c.images?.skipped ?? 0), 0);
    const totals = `<section class="panel"><h2>Totals</h2>
<div class="kv"><div><b>${esc(fmtMs(wall))}</b><span>wall time, first call to last</span></div>
<div><b>${esc(fmtMs(inside))}</b><span>inside the tools (${pct(inside)}%)</span></div>
<div><b>${esc(fmtMs(gaps))}</b><span>between calls (${pct(gaps)}%): the assistant thinking, or the user${inside + gaps > wall ? "; summed over the conversations, which overlap" : ""}</span></div>
<div><b>${calls.length}</b><span>calls, ${errors.length} error${errors.length === 1 ? "" : "s"}</span></div>
<div><b>${imageCount}</b><span>pictures the tools returned${skipped ? `, ${skipped} not kept (the session's limit of ${Number(process.env.RC_TRACE_IMAGES ?? 200)} pictures / ${Number(process.env.RC_TRACE_MB ?? 50)} MB)` : ""}</span></div></div>
<div class="bar2" title="inside the tools / between calls"><i style="width:${pct(inside)}%"></i><i class="g" style="width:${pct(gaps)}%"></i></div>
<div class="cols"><div><h3>Calls per tool</h3><div class="wrap"><table><tbody>${Object.entries(perTool).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<tr><td class="w">${esc(t)}</td><td class="n">${n}</td></tr>`).join("")}</tbody></table></div></div>
<div><h3>Slowest calls</h3><div class="wrap"><table><tbody>${slowest.map((c) => `<tr><td>${jump(c.n)}</td><td class="w">${esc(c.server)} · ${esc(c.tool)}</td><td class="n${c.ms > CALL_SLOW_MS ? " slow" : ""}">${esc(fmtMs(c.ms))}</td></tr>`).join("")}</tbody></table></div></div></div>
${repeats.length ? `<h3>Repeated identical calls (same tool, same arguments, same file contents): possible loops</h3><div class="wrap"><table><tbody>${repeats.map((r) => `<tr><td class="w">${esc(r.tool)}</td><td class="n">×${r.at.length}</td><td class="w">${r.at.map(jump).join(" ")}</td></tr>`).join("")}</tbody></table></div>` : ""}
${errors.length ? `<h3>Errors</h3><div class="wrap"><table><tbody>${errors.map((c) => `<tr><td>${jump(c.n)}</td><td>${esc(c.server)} · ${esc(c.tool)}</td><td class="w">${esc(c.error)}</td></tr>`).join("")}</tbody></table></div>` : ""}
</section>`;
    const rows = calls.map((c, i) => {
        const n = i + 1, args = pretty(c.args), result = pretty(c.result), files = c.images?.files ?? [];
        const gap = c.gap_ms == null ? "start" : `+${fmtMs(c.gap_ms)}`;
        const tg = tag ? tag(c) : null;
        return `<details id="c${n}"${tg ? ` style="box-shadow:inset 4px 0 0 ${tg.color}"` : ""}><summary><span class="n t">${tg ? `<span class="th" style="background:${tg.color}" title="thread ${tg.letter}">${tg.letter}</span>` : ""}#${n}</span><span class="t">${esc(c.start.slice(11, 19))}</span>
<span class="n${(c.gap_ms ?? 0) > GAP_SLOW_MS ? " gapx" : " t"}" title="since the previous call ended">${esc(gap)}</span>
<span class="tool">${esc(c.server)} · <b>${esc(c.tool)}</b>${fileTags[i].map((f) => ` <span class="pill" title="${esc(f.missing ? `${f.path}: not found when called` : `${f.path}: ${f.bytes} bytes, sha256 ${f.sha}`)}">${esc(f.name)}${f.missing ? " missing" : ` v${f.v}`}</span>`).join("")}${repeatOf.has(n) ? ` <span class="pill rep" title="identical to other calls in this session: same arguments, same file contents">repeat ${repeatOf.get(n)}</span>` : ""}</span>
<span class="n${c.ms > CALL_SLOW_MS ? " slow" : ""}">${esc(fmtMs(c.ms))}</span><span>${c.ok ? '<span class="pill">ok</span>' : '<span class="pill err2">error</span>'}</span>
${files.length ? `<span class="strip">${files.map((f) => `<a href="${esc(imgUrl(f))}" target="_blank" rel="noopener"><img src="${esc(imgUrl(f))}" alt="render" loading="lazy"></a>`).join("")}</span>` : ""}</summary>
<div class="detail">${c.error ? `<p class="err" style="margin:8px 0">${esc(c.error)}</p>` : ""}
<h4>Arguments</h4>${args == null ? `<p class="muted">Not kept (older than 30 days).</p>` : `<pre class="body">${esc(args)}</pre>`}
<h4>Result</h4>${result == null ? `<p class="muted">Not kept (older than 30 days).</p>` : `<pre class="body">${esc(result)}</pre>`}
${files.length ? `<h4>Pictures</h4><div class="full">${files.map((f) => `<a href="${esc(imgUrl(f))}" target="_blank" rel="noopener"><img src="${esc(imgUrl(f))}" alt="render" loading="lazy"></a>`).join("")}</div>` : ""}
${c.images?.skipped ? `<p class="muted">${c.images.skipped} picture${c.images.skipped === 1 ? "" : "s"} not kept: the session's limit was reached.</p>` : ""}</div></details>`;
    }).join("\n");
    return `${published}${totals}
<section class="panel"><h2>Timeline</h2><p class="muted">Times are UTC. The gap is the time since the previous call ended: the assistant thinking (amber above ${GAP_SLOW_MS / 1000} s). Durations above ${CALL_SLOW_MS / 1000} s are red. Click a call for its arguments and result.</p>
<div class="tl"><div class="hd"><span>#</span><span>Start</span><span>Gap</span><span>Server · tool</span><span>Took</span><span></span></div>
${rows}</div></section>`;
}

function accountPage(req, { store, acct, sid, fresh, error, notice }) {
    const csrf = `<input type="hidden" name="csrf" value="${csrfFor(sid)}">`;
    const tokens = store.listTokens(acct.id);
    const usage = store.usage(acct.id, 30);
    const pages = store.pagesOf(acct.id);
    const live = tokens.filter((t) => !t.revoked);
    const apps = store.listGrants(acct.id);
    const host = (u) => { try { return new URL(u).host; } catch { return ""; } };
    const appRows = apps.map((g) => `<tr><td class="w"><b>${esc(g.client_name || "An app")}</b> <span class="muted">${esc([...new Set(g.redirect_uris.map(host))].join(", "))}</span></td>
<td>${esc(day(g.created))}</td><td>${esc(day(g.last_used))}</td><td><code>${esc(g.scope)}</code></td>
<td><form class="inline" method="post" action="apps/${g.id}/revoke">${csrf}<button class="link danger" type="submit">Disconnect</button></form></td></tr>`).join("\n");
    const tokenRows = tokens.map((t) => `<tr><td class="w">${esc(t.label)}</td><td><code>${esc(t.prefix)}…</code></td><td>${esc(day(t.created))}</td><td>${esc(day(t.last_used))}</td>
<td>${t.revoked ? `<span class="pill off">revoked ${esc(day(t.revoked))}</span>` : `<form class="inline" method="post" action="tokens/${t.id}/revoke">${csrf}<button class="link danger" type="submit">Revoke</button></form>`}</td></tr>`).join("\n");
    const body = [
        error ? `<p class="err">${esc(error)}</p>` : "",
        notice ? `<p class="ok">${esc(notice)}</p>` : "",
        fresh ? freshToken(req, fresh) : "",
        `<section class="panel"><div class="who"><div><b>${esc(acct.name || acct.email)}</b> <span class="muted">${esc(acct.email)}</span> <a href="#name">${acct.name ? "Change name" : "Set your name"}</a>
${acct.admin ? ' <span class="pill">admin</span>' : ""}<br><span class="muted">Member since ${esc(day(acct.created).slice(0, 10))}</span></div>
<form class="inline" method="post" action="signout">${csrf}<button class="link" type="submit">Sign out</button></form></div></section>`,
        namePanel(acct, csrf),
        scriptsOffered() ? scriptsPanel(acct, csrf) : "",
        `<section class="panel"><h2>Tokens</h2>
<p class="muted">Each token connects one client (Claude Code, claude.ai, ChatGPT, a script) to the MCP servers. ${live.length} active.</p>
${tokens.length ? `<div class="wrap"><table><thead><tr><th>Label</th><th>Token</th><th>Created (UTC)</th><th>Last used</th><th></th></tr></thead><tbody>${tokenRows}</tbody></table></div>` : ""}
<form class="row" method="post" action="tokens" style="margin-top:12px">${csrf}<label class="f">New token's label<input type="text" name="label" maxlength="60" placeholder="e.g. laptop, a script" required></label><button class="btn" type="submit">Create token</button></form>
</section>`,
        `<section class="panel"><h2>Connected apps</h2>
<p class="muted">Apps you let in by signing in from them (claude.ai, ChatGPT, Claude Code, …) instead of pasting a token. Disconnecting one ends its access at once; it asks you to sign in again next time.</p>
${apps.length ? `<div class="wrap"><table><thead><tr><th>App</th><th>Connected (UTC)</th><th>Last used</th><th>Scope</th><th></th></tr></thead><tbody>${appRows}</tbody></table></div>`
            : `<p class="muted">None yet. In claude.ai or ChatGPT, add a custom connector with the server's URL and no token: it asks you to sign in here.</p>`}
</section>`,
        `<section class="panel"><h2>Usage, last ${usage.days} days</h2>
<div class="stats"><div><b>${usage.total}</b><span class="muted">tool calls</span></div><div><b>${usage.errorCount}</b><span class="muted">errors</span></div><div><b>${usage.byTool.length}</b><span class="muted">tools used</span></div></div>
${usage.total ? bars(usage.byDay) : ""}
${usage.total ? `<div class="cols"><div><h3>Per tool</h3>${groupTable(usage.byTool, "Server · tool")}</div><div><h3>Per server</h3>${groupTable(usage.byServer, "Server")}<h3>Per client</h3>${groupTable(usage.byClient, "Token or app")}</div></div>` : `<p class="muted">No calls yet. Connect a client with one of your tokens, or sign in from an app, and they show up here.</p>`}
${usage.errors.length ? `<h3>Recent errors</h3><div class="wrap"><table><thead><tr><th>When (UTC)</th><th>Tool</th><th>Error</th></tr></thead><tbody>
${usage.errors.map((e) => `<tr><td>${esc(day(e.ts))}</td><td>${esc(e.server)} · ${esc(e.tool)}</td><td class="w">${esc(e.error)}</td></tr>`).join("\n")}</tbody></table></div>` : ""}
</section>`,
        `<section class="panel"><h2>Recent sessions</h2>
<p class="muted">One row per MCP session (a conversation in claude.ai or ChatGPT, a Claude Code run), last 30 days. Open one to retrace it call by call.</p>
${sessionsTable(store.sessions(acct.id, { limit: 10 }), (c) => `sessions/${encodeURIComponent(c)}`)}
<p style="margin-top:8px"><a href="sessions/">All sessions</a></p>
</section>`,
        pagesPanel(store, acct, csrf, pages),
        acct.admin ? adminPanel(store, csrf) : "",
    ].join("\n");
    return body;
}

/** The opt-in for app scripts: business logic the assistant writes next to a published document. */
function scriptsPanel(acct, csrf) {
    return `<section class="panel" id="scripts"><h2>App scripts <span class="pill${acct.scripts ? "" : " off"}">${acct.scripts ? "on" : "off"}</span></h2>
<p class="muted">A RemoteCompose document is the UX. With app scripts on, the assistant can also write the business logic next to it: a TypeScript script, published with the page, that sets its host values, answers its actions, fetches data and keeps state. It runs in the viewer's browser, sandboxed (no access to the page or your account). The publish tool offers it only when this is on; after changing it, start a new chat (or reconnect the app) so it sees the change.</p>
<form class="row" method="post" action="scripts">${csrf}<input type="hidden" name="on" value="${acct.scripts ? 0 : 1}"><button class="btn" type="submit">${acct.scripts ? "Turn off" : "Turn on"}</button></form>
</section>`;
}

/** The account's name: shown with what it posts to the stream. */
function namePanel(acct, csrf) {
    return `<section class="panel" id="name"><h2>Name</h2>
<p class="muted">Shown with the items you post to the <a href="../stream/">stream</a> (your email never is). ${acct.name ? "" : "You have none yet: set one to post."}</p>
<form class="row" method="post" action="name">${csrf}<label class="f">Your name<input type="text" name="name" maxlength="40" value="${esc(acct.name ?? "")}" placeholder="e.g. Ada, studio-k" ${acct.name ? "" : "required"}></label><button class="btn" type="submit">${acct.name ? "Change" : "Set"}</button></form>
</section>`;
}

/**
 * The account's published pages as cards, each with its actions: post it to the stream under a
 * name (or rename it there), take it out of the stream, delete it (behind a confirmation).
 */
function pagesPanel(store, acct, csrf, pages) {
    if (!pages.length) {
        return `<section class="panel" id="pages"><h2>Your published pages</h2>
<p class="muted">None yet. Pages you publish with the publish (or package_web) tool are listed here.</p></section>`;
    }
    const posted = new Map(store.streamOf(acct.id).map((i) => [i.page_id, i]));
    const actions = (pg) => {
        const it = posted.get(pg.id);
        const id = esc(pg.id);
        const nameForm = (label) => `<form class="row" method="post" action="stream" style="margin:0">${csrf}<input type="hidden" name="page_id" value="${id}">
<label class="f">Name in the stream<input type="text" name="title" maxlength="80" value="${esc(it?.title ?? pg.title ?? "")}" required></label>
<button class="btn" type="submit"${acct.name ? "" : " disabled"}>${label}</button></form>`;
        const stream = it
            ? `<div><span class="pill">in the stream</span> <span class="muted">score ${it.score} (+${it.ups} / −${it.downs}) · since ${esc(day(it.created).slice(0, 10))}</span></div>
<details><summary class="link">Rename in the stream</summary>${nameForm("Rename")}</details>
<form class="inline" method="post" action="stream/${id}/remove">${csrf}<button class="link danger" type="submit">Remove from the stream</button></form>`
            : `<details><summary class="link">Post to the stream</summary>${nameForm("Post")}${acct.name ? "" : '<p class="muted">Set your <a href="#name">name</a> first: it is shown with what you post.</p>'}</details>`;
        const del = `<details class="confirm"><summary class="link danger">Delete…</summary>
<p class="muted">The page is deleted and its link stops working${it ? "; it leaves the stream with its votes" : ""}. This cannot be undone.</p>
<form class="inline" method="post" action="pages/${id}/delete">${csrf}<button class="btn danger" type="submit">Delete permanently</button></form></details>`;
        return stream + del;
    };
    return `<section class="panel" id="pages"><h2>Your published pages</h2>
<p class="muted">Anyone with a page's link can open it; the links are unguessable and listed only here, until you post a page to the <a href="../stream/">stream</a>, where anyone can open it and signed-in people vote on it.${acct.name ? "" : ' To post, set your <a href="#name">name</a> first.'}</p>
${pageCards(publishedCards(store, acct.id), { actions })}
</section>`;
}

function adminPanel(store, csrf) {
    const act = (a, what, label, danger) => `<form class="inline" method="post" action="admin/${a.id}/${what}">${csrf}<button class="link${danger ? " danger" : ""}" type="submit">${label}</button></form>`;
    const rows = store.listAccounts(7).map((a) => `<tr><td class="w">${esc(a.email)}${a.admin ? ' <span class="pill">admin</span>' : ""}</td><td class="w">${esc(a.name)}</td><td>${esc(day(a.created))}</td>
<td>${a.verified_at ? esc(day(a.verified_at).slice(0, 10)) : `<span class="pill${a.stale ? " off" : ""}">pending${a.stale ? ", over 7 days" : ""}</span>`}</td>
<td class="n">${a.tokens}</td><td class="n">${a.calls}</td><td>${a.status === "disabled" ? '<span class="pill off">disabled</span>' : `<span class="pill">${esc(a.status)}</span>`}</td>
<td><a href="sessions/?account=${a.id}">Sessions</a></td>
<td>${a.status === "pending" ? act(a, "resend", "Resend link") + " " + act(a, "delete", "Delete", true)
        : act(a, a.status === "active" ? "disable" : "enable", a.status === "active" ? "Disable" : "Enable", a.status === "active")}</td></tr>`).join("\n");
    return `<section class="panel"><h2>Accounts (admin)</h2>
<div class="wrap"><table><thead><tr><th>Email</th><th>Name</th><th>Created (UTC)</th><th>Verified</th><th class="n">Tokens</th><th class="n">Calls, 7 days</th><th>Status</th><th></th><th></th></tr></thead><tbody>
${rows}</tbody></table></div><p class="muted" style="margin-top:8px">Disabling an account refuses its tokens and ends its sessions; enabling it restores them. Pending accounts (email not confirmed) are deleted after 7 days on their own.</p></section>`;
}

/** "Check your email": what register, resend and email-signin answer, whatever the address. */
function checkEmailPage({ email, error }) {
    return [
        error ? `<p class="err">${esc(error)}</p>` : "",
        `<section class="panel"><h2>A link is on its way to ${esc(email)}</h2>
<p>If that address can receive mail, it gets a link from us in a minute or two. Open it in this browser to go on.</p>
<p class="muted">A confirmation link works once for 24 hours, a sign-in link once for 15 minutes. Nothing there? Check the spam folder, then ask again: at most ${Number(process.env.RC_MAIL_PER_HOUR ?? 3)} links an hour go to one address.</p>
<form class="row" method="post" action="resend" style="margin-top:12px"><input type="hidden" name="email" value="${esc(email)}"><button class="link" type="submit">Send the link again</button></form>
</section>`,
        `<p class="muted"><a href="./">Back to sign in</a></p>`,
    ].join("\n");
}

/** The page an emailed link opens: one button that POSTs the code (a mail scanner's GET spends nothing). */
function confirmPage({ action, code, heading, text, button }) {
    return `<section class="panel"><h2>${esc(heading)}</h2><p class="muted">${esc(text)}</p>
<form class="stack" method="post" action="${esc(action)}"><input type="hidden" name="code" value="${esc(code)}"><button class="btn" type="submit">${esc(button)}</button></form></section>`;
}

/** A link that no longer works, with the way to get a new one. */
function deadLinkPage({ what }) {
    return `<section class="panel"><h2>This ${esc(what)} link has expired or was already used</h2>
<p class="muted">Each link works once (confirmation: 24 hours, sign-in: 15 minutes). Ask for a new one:</p>
<form class="row" method="post" action="email-signin"><label class="f">Email<input type="email" name="email" maxlength="254" required autocomplete="email"></label><button class="btn" type="submit">Email me a new link</button></form>
</section>`;
}

function signedOutPage({ error, values = {}, connecting = null }) {
    const open = signupOpen();
    const verify = emailVerify();
    return [
        error ? `<p class="err">${esc(error)}</p>` : "",
        connecting ? `<p class="note"><b>${esc(connecting)}</b> wants to connect to your RemoteCompose account. Sign in (or create an account) and you come back to approve it.</p>` : "",
        `<div class="cols">`,
        `<section class="panel"><h2>Create an account</h2>
${open ? `<p class="muted">${verify ? "We email you a link to confirm the address; following it signs you in and gives you your token for the MCP servers."
                : "You get a token for the MCP servers right away. Your email is not verified: it is how you are known here."}</p>
<form class="stack" method="post" action="register">
<label class="f">Email<input type="email" name="email" maxlength="254" required autocomplete="email" value="${esc(values.email)}"></label>
<label class="f">Name<input type="text" name="name" maxlength="80" autocomplete="name" value="${esc(values.name)}"></label>
<p class="muted">By creating an account you accept the <a href="../privacy/">privacy notice</a>.</p>
<button class="btn" type="submit">Create account</button></form>`
            : `<p class="note">Registration is closed on this server for now. If you already have a token, sign in with it.</p>`}
</section>`,
        `<section class="panel"><h2>Email me a sign-in link</h2>
<p class="muted">Lost your token, or on a new browser? We email you a link that signs you in (once, for 15 minutes). From your account page you can make a new token.</p>
<form class="stack" method="post" action="email-signin">
<label class="f">Email<input type="email" name="email" maxlength="254" required autocomplete="email"></label>
<button class="btn" type="submit">Email me a link</button></form>
</section>`,
        `<section class="panel"><h2>Sign in with your token</h2>
<p class="muted">Paste any active token of your account (it starts with <code>rc_</code>). The site then remembers you in this browser for 30 days.</p>
<form class="stack" method="post" action="signin">
<label class="f">Token<input type="password" name="token" maxlength="100" required autocomplete="off" spellcheck="false"></label>
<button class="btn" type="submit">Sign in</button></form>
</section>`,
        `</div>`,
    ].join("\n");
}

/**
 * Handles <base>/account and below; false for anything else. site: {css, nav(current)} from
 * the examples pages, so the account pages look like the rest of the site.
 */
export async function accountRoute(req, url, res, site) {
    const p = url.pathname;
    if (!/^\/account(\/|$)/.test(p)) return false;
    if (!accountsEnabled()) return false;
    if (p === "/account") return redirect(res, `account/${url.search}`);
    const store = await accounts();
    const render = (status, opts, extra) => html(res, status, shell({
        css: site.css, nav: site.nav("account"),
        title: opts.title ?? (opts.acct ? "Your account" : "Account"),
        sub: opts.sub ?? (opts.acct ? "Your tokens for the RemoteCompose MCP servers, what you used them for, and the pages you published."
            : "An account gives you your own token for the RemoteCompose MCP servers, and shows what you used it for and the pages you published."),
        body: opts.body ?? (opts.acct ? accountPage(req, { store, ...opts })
            : signedOutPage({ connecting: oauthNext(req) ? (store.getClient(oauthNext(req).get("client_id"))?.name || "An app") : null, ...opts })),
    }), extra);
    const checkEmail = (email, status = 200) => render(status, { title: "Check your email",
        sub: "One step left: the link we email you.", body: checkEmailPage({ email }) });

    const sid = readCookie(req);
    const acct = sid ? store.sessionAccount(sid) : null;

    // The links in emails open a confirmation button (GET spends nothing).
    if ((p === "/account/verify" || p === "/account/signin-link") && req.method === "GET") {
        const code = url.searchParams.get("code") ?? "";
        const verify = p === "/account/verify";
        return render(200, verify
            ? { title: "Confirm your email", sub: "One click and you are in.", body: confirmPage({ action: "verify", code,
                heading: "Confirm your email address", text: "This confirms the address, signs you in in this browser and shows your first token.", button: "Confirm and get my token" }) }
            : { title: "Sign in", sub: "One click and you are in.", body: confirmPage({ action: "signin-link", code,
                heading: "Sign in to your account", text: "This signs you in in this browser for 30 days.", button: "Sign in" }) });
    }
    // Sessions: signed in; your own, or (admins) any account's with ?account=<id>.
    const im = /^\/account\/sessions\/([^/]+)\/img\/([\w.-]+)$/.exec(p);
    if (im && (req.method === "GET" || req.method === "HEAD")) {
        const asked = url.searchParams.get("account");
        const who = !acct ? null : asked == null || Number(asked) === acct.id ? acct : acct.admin ? store.getAccount(Number(asked)) : null;
        let client = null;
        try { client = decodeURIComponent(im[1]); } catch { /* bad */ }
        const file = who && client && store.sessionHasImage(who.id, client, im[2]) ? traceImagePath(who.id, client, im[2]) : null;
        if (!file || !existsSync(file)) { res.writeHead(404, { ...HEADERS, "Content-Type": "text/plain" }); res.end("not found\n"); return true; }
        const buf = readFileSync(file);
        res.writeHead(200, { ...HEADERS, "Content-Type": "image/png", "Content-Length": buf.length, "Cache-Control": "private, max-age=3600" });
        res.end(req.method === "HEAD" ? undefined : buf);
        return true;
    }
    const sm = /^\/account\/sessions\/(?:([^/]+?)(\.json)?)?$/.exec(p);
    if (sm && (req.method === "GET" || req.method === "HEAD")) {
        if (!acct) return redirect(res, "../");
        const asked = url.searchParams.get("account");
        const who = asked == null || Number(asked) === acct.id ? acct : acct.admin ? store.getAccount(Number(asked)) : null;
        const notFound = () => html(res, 404, shell({ css: site.css, nav: site.nav("account").replaceAll('href="../', 'href="../../'),
            title: "Not found", sub: "", body: `<p class="err">No such session.</p><p><a href="../">Back to your account</a></p>` }));
        if (!who) return notFound();
        const q = who.id === acct.id ? "" : `?account=${who.id}`;
        const nav = site.nav("account").replaceAll('href="../', 'href="../../');
        const page = (title, sub, body, extra = {}) => html(res, 200, shell({ css: site.css, nav, title, sub, body }), extra);
        if (!sm[1]) {
            return page(who.id === acct.id ? "Your sessions" : `Sessions of ${who.email}`, "Every MCP session of the last 30 days, most recent first.",
                `<section class="panel">${sessionsTable(store.sessions(who.id, { limit: 500 }), (c) => `${encodeURIComponent(c)}${q}`)}</section><p><a href="../">Back to the account page</a></p>`);
        }
        let client;
        try { client = decodeURIComponent(sm[1]); } catch { return notFound(); }
        const calls = store.sessionCalls(who.id, client);
        if (!calls.length) return notFound();
        if (sm[2]) {
            const body = Buffer.from(JSON.stringify({
                account: who.email, session: client, via: calls[0].via, started: calls[0].start, ended: calls.at(-1).end,
                calls: calls.map(({ id: _, args, result, ...c }) => {
                    let a = args;
                    try { a = args == null ? null : JSON.parse(args); } catch { /* as text */ }
                    return { ...c, args: a, result };
                }),
            }, null, 1));
            res.writeHead(200, { ...HEADERS, "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length,
                "Content-Disposition": `attachment; filename="session-${client.replace(/[^\w-]/g, "_")}.json"` });
            res.end(req.method === "HEAD" ? undefined : body);
            return true;
        }
        // More than one conversation in the session: each its own colour; ?thread= shows one; gaps within each.
        const threads = sessionThreads(calls);
        const multi = threads.length > 1;
        const selected = multi ? threads.find((t) => t.key === url.searchParams.get("thread"))?.key ?? null : null;
        const tagOf = new Map(threads.map((t) => [t.key, t]));
        const shown = (selected ? calls.filter((c) => c.thread === selected) : calls).map((c) => (multi ? { ...c, gap_ms: c.thread_gap_ms } : c));
        const self = `${encodeURIComponent(client)}`;
        const threadHref = (k) => `${self}${q}${k ? `${q ? "&" : "?"}thread=${encodeURIComponent(k)}` : ""}`;
        return page(`Session ${client}${selected ? ` · thread ${tagOf.get(selected).letter}` : ""}`,
            `${esc(calls[0].via)}${who.id === acct.id ? "" : ` · ${esc(who.email)}`} · started ${esc(day(calls[0].start))} UTC · <a href="${esc(encodeURIComponent(client))}.json${q}">Download JSON</a> · <a href="./${q}">All sessions</a>`,
            (multi ? threadsPanel(threads, selected, threadHref) : "") +
            sessionView(shown, (f) => `${encodeURIComponent(client)}/img/${encodeURIComponent(f)}${q}`, multi ? (c) => tagOf.get(c.thread) : null) +
            signalsPanel(calls),
            cspWithImages(sessionPublishes(calls).map((x) => x.url)));
    }
    if (p === "/account/") {
        if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD" }); res.end(); return true; }
        // A stale cookie (expired, signed out elsewhere, account disabled) is cleared.
        return render(200, { acct, sid }, sid && !acct ? { "Set-Cookie": cookie(req, "", 0) } : acct ? cspWithImages(store.pagesOf(acct.id).map((x) => x.url ?? "")) : {});
    }
    if (req.method !== "POST") { res.writeHead(405, { Allow: "POST" }); res.end(); return true; }
    if (!sameOrigin(req)) return html(res, 403, "<!doctype html><p>Refused: this form must be sent from this site's own pages.</p>");
    let form;
    try { form = await readForm(req); } catch (e) { return html(res, e.status ?? 400, "<!doctype html><p>Bad request.</p>"); }

    if (p === "/account/register" && emailVerify()) {
        const values = { email: form.get("email") ?? "", name: form.get("name") ?? "" };
        if (!signupOpen()) return render(403, { error: "Registration is closed on this server." });
        const email = Accounts.normalizeEmail(values.email);
        if (!email) return render(400, { error: "That does not look like an email address.", values });
        if (!registerLimit.hit(clientIp(req))) return render(429, { error: "Too many requests from your address: try again in an hour.", values });
        mailFor(store, req, email, { register: true, name: values.name });
        return checkEmail(email);
    }
    if (p === "/account/resend" || p === "/account/email-signin") {
        const email = Accounts.normalizeEmail(form.get("email"));
        if (!email) return render(400, { error: "That does not look like an email address." });
        const limiter = p === "/account/resend" ? registerLimit : signinLimit;
        if (!limiter.hit(clientIp(req))) return render(429, { error: "Too many requests from your address: try again later." });
        mailFor(store, req, email);
        return checkEmail(email);
    }
    if (p === "/account/verify" || p === "/account/signin-link") {
        if (!signinLimit.hit(clientIp(req))) return render(429, { error: "Too many sign-in attempts from your address: try again in a few minutes." });
        const verify = p === "/account/verify";
        let a = store.redeemCode(String(form.get("code") ?? ""), verify ? "verify" : "signin");
        if (!a) return render(400, { title: "Link expired", sub: "Ask for a new one below.", body: deadLinkPage({ what: verify ? "confirmation" : "sign-in" }) });
        a = store.refreshAdmin(a);
        const newSid = store.createSession(a.id);
        const after = afterSignin(req, cookie(req, newSid, 30 * 86400));
        if (!verify) return redirect(res, after.to, { "Set-Cookie": after.cookies });
        // Verified: the first token, shown once (none is made before), unless it has one already.
        // Coming from an app's sign-in: straight back to its consent page, no token needed.
        if (oauthNext(req)) return redirect(res, after.to, { "Set-Cookie": after.cookies });
        const fresh = store.listTokens(a.id).length ? null : store.issueToken(a.id, "first token");
        return render(200, { acct: a, sid: newSid, fresh, notice: "Your email is confirmed and you are signed in." }, { "Set-Cookie": after.cookies });
    }
    if (p === "/account/register") {
        const values = { email: form.get("email") ?? "", name: form.get("name") ?? "" };
        if (!signupOpen()) return render(403, { error: "Registration is closed on this server." });
        if (!registerLimit.hit(clientIp(req))) return render(429, { error: "Too many new accounts from your address: try again in an hour.", values });
        let created;
        try { created = store.createAccount(values); } catch (e) { return render(400, { error: e.message, values }); }
        const fresh = store.issueToken(created.id, "first token");
        const newSid = store.createSession(created.id);
        return render(200, { acct: created, sid: newSid, fresh }, { "Set-Cookie": cookie(req, newSid, 30 * 86400) });
    }
    if (p === "/account/signin") {
        if (!signinLimit.hit(clientIp(req))) return render(429, { error: "Too many sign-in attempts from your address: try again in a few minutes." });
        const found = store.authenticate(String(form.get("token") ?? "").trim());
        if (!found?.account) return render(401, { error: found?.pending ? "This account's email is not confirmed yet: follow the link we sent, or ask for a new one."
            : found?.disabled ? "This account is disabled." : "That token is not valid (wrong, or revoked). Lost it? Use \"Email me a sign-in link\"." });
        const a = store.refreshAdmin(found.account);
        const newSid = store.createSession(a.id);
        const after = afterSignin(req, cookie(req, newSid, 30 * 86400));
        return redirect(res, after.to, { "Set-Cookie": after.cookies });
    }
    // Everything below needs the session, and the form's token tied to it.
    if (!acct) return redirect(res, p.split("/").length > 3 ? "../../" : "./", sid ? { "Set-Cookie": cookie(req, "", 0) } : {});
    if (form.get("csrf") !== csrfFor(sid)) return html(res, 403, "<!doctype html><p>Refused: the form is stale. Go back, reload the page and try again.</p>");
    if (p === "/account/signout") {
        store.deleteSession(sid);
        return redirect(res, "./", { "Set-Cookie": cookie(req, "", 0) });
    }
    if (p === "/account/tokens") {
        const label = String(form.get("label") ?? "").trim();
        if (store.listTokens(acct.id).filter((t) => !t.revoked).length >= 20) return render(400, { acct, sid, error: "You have 20 active tokens: revoke one first." });
        const fresh = store.issueToken(acct.id, label);
        return render(200, { acct, sid, fresh });
    }
    if (p === "/account/scripts") {
        if (!scriptsOffered()) return html(res, 404, "<!doctype html><p>Not found.</p>");
        store.setScripts(acct.id, form.get("on") === "1");
        return redirect(res, "./#scripts");
    }
    if (p === "/account/name") {
        try { store.setName(acct.id, form.get("name")); } catch (e) { return render(400, { acct, sid, error: e.message }); }
        return redirect(res, "./#name");
    }
    if (p === "/account/stream") {
        try { store.streamPost({ pageId: form.get("page_id"), account: acct, title: form.get("title") }); } catch (e) { return render(400, { acct, sid, error: e.message }); }
        return redirect(res, "./#pages");
    }
    let m = /^\/account\/stream\/([A-Za-z0-9_-]{22})\/remove$/.exec(p);
    if (m) {
        const it = store.streamItem(m[1]);
        if (it && (it.account_id === acct.id || acct.admin)) store.streamRemove(m[1]);
        return redirect(res, "../../#pages");
    }
    // Delete a page of yours (an admin, anyone's): its folder and its record, stream entry and all.
    m = /^\/account\/pages\/([A-Za-z0-9_-]{22})\/delete$/.exec(p);
    if (m) {
        const owner = store.pageOwner(m[1]);
        const root = workspaceRoot();
        if (owner != null && (owner === acct.id || acct.admin) && root) {
            rmSync(path.join(root, "pages", m[1]), { recursive: true, force: true });
            store.deletePage(m[1]);
        }
        return redirect(res, "../../#pages");
    }
    m = /^\/account\/apps\/(\d+)\/revoke$/.exec(p);
    if (m) {
        store.revokeGrant(Number(m[1]), acct.id);
        return redirect(res, "../../");
    }
    m = /^\/account\/tokens\/(\d+)\/revoke$/.exec(p);
    if (m) {
        store.revokeToken(acct.id, Number(m[1]));
        return redirect(res, "../../");
    }
    m = /^\/account\/admin\/(\d+)\/(disable|enable|resend|delete)$/.exec(p);
    if (m) {
        if (!acct.admin) return html(res, 403, "<!doctype html><p>Admins only.</p>");
        const target = store.getAccount(Number(m[1]));
        if (!target) return redirect(res, "../../");
        if (m[2] === "delete") { store.deletePending(target.id); return redirect(res, "../../"); }
        if (m[2] === "resend") {
            if (target.status !== "pending") return redirect(res, "../../");
            if (!store.canMail(target.id)) return render(429, { acct, sid, error: `${target.email} already had ${Number(process.env.RC_MAIL_PER_HOUR ?? 3)} links this hour.` });
            await mailLink(store, req, target);
            return redirect(res, "../../");
        }
        if (Number(m[1]) === acct.id && m[2] === "disable") return render(400, { acct, sid, error: "You cannot disable your own account." });
        store.setStatus(Number(m[1]), m[2] === "disable" ? "disabled" : "active");
        return redirect(res, "../../");
    }
    return html(res, 404, "<!doctype html><p>Not found.</p>");
}

// For lib/oauth.mjs: its consent page is one of these pages.
export { ACCOUNT_CSS, clientIp, cookie, esc, HEADERS, html, isHttps, readForm, redirect, selfOrigin, shell };
