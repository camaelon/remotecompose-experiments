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

import { Accounts, accounts, accountsEnabled, csrfFor, emailVerify, RateLimiter, readCookie, SESSION_COOKIE, signupOpen } from "./accounts.mjs";
import { linkEmail, sendMail } from "./mail.mjs";
import { escapeHtml } from "./web-page.mjs";

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
main.acct { display:block; }
main.acct a { color:var(--accent); text-decoration:none; font-weight:500; }
main.acct a:hover { text-decoration:underline; }
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
<meta name="robots" content="noindex"><title>${esc(title)}</title><style>${css}${ACCOUNT_CSS}</style></head>
<body>
<header>
<nav>${nav}</nav>
<h1>${esc(title)}</h1>
<p class="sub">${sub}</p>
</header>
<main class="acct">${body}</main>
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
${snippet(`claude mcp add --transport http remotecompose ${url} --header "Authorization: Bearer ${t}"`)}
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
        `<section class="panel"><div class="who"><div><b>${esc(acct.name || acct.email)}</b> <span class="muted">${esc(acct.email)}</span>
${acct.admin ? ' <span class="pill">admin</span>' : ""}<br><span class="muted">Member since ${esc(day(acct.created).slice(0, 10))}</span></div>
<form class="inline" method="post" action="signout">${csrf}<button class="link" type="submit">Sign out</button></form></div></section>`,
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
        `<section class="panel"><h2>Your published pages</h2>
${pages.length ? `<div class="wrap"><table><thead><tr><th>Title</th><th>Id</th><th>Published (UTC)</th></tr></thead><tbody>
${pages.map((p) => `<tr><td class="w">${p.url ? `<a href="${esc(p.url)}">${esc(p.title || p.id)}</a>` : esc(p.title || p.id)}</td><td><code>${esc(p.id)}</code></td><td>${esc(day(p.created))}</td></tr>`).join("\n")}
</tbody></table></div><p class="muted" style="margin-top:8px">Anyone with a page's link can open it; the links are unguessable and listed only here. Take one down with the pages / unpublish_page tool.</p>`
            : `<p class="muted">None yet. Pages you publish with the publish (or package_web) tool are listed here.</p>`}
</section>`,
        acct.admin ? adminPanel(store, csrf) : "",
    ].join("\n");
    return body;
}

function adminPanel(store, csrf) {
    const act = (a, what, label, danger) => `<form class="inline" method="post" action="admin/${a.id}/${what}">${csrf}<button class="link${danger ? " danger" : ""}" type="submit">${label}</button></form>`;
    const rows = store.listAccounts(7).map((a) => `<tr><td class="w">${esc(a.email)}${a.admin ? ' <span class="pill">admin</span>' : ""}</td><td class="w">${esc(a.name)}</td><td>${esc(day(a.created))}</td>
<td>${a.verified_at ? esc(day(a.verified_at).slice(0, 10)) : `<span class="pill${a.stale ? " off" : ""}">pending${a.stale ? ", over 7 days" : ""}</span>`}</td>
<td class="n">${a.tokens}</td><td class="n">${a.calls}</td><td>${a.status === "disabled" ? '<span class="pill off">disabled</span>' : `<span class="pill">${esc(a.status)}</span>`}</td>
<td>${a.status === "pending" ? act(a, "resend", "Resend link") + " " + act(a, "delete", "Delete", true)
        : act(a, a.status === "active" ? "disable" : "enable", a.status === "active" ? "Disable" : "Enable", a.status === "active")}</td></tr>`).join("\n");
    return `<section class="panel"><h2>Accounts (admin)</h2>
<div class="wrap"><table><thead><tr><th>Email</th><th>Name</th><th>Created (UTC)</th><th>Verified</th><th class="n">Tokens</th><th class="n">Calls, 7 days</th><th>Status</th><th></th></tr></thead><tbody>
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
    if (p === "/account/") {
        if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD" }); res.end(); return true; }
        // A stale cookie (expired, signed out elsewhere, account disabled) is cleared.
        return render(200, { acct, sid }, sid && !acct ? { "Set-Cookie": cookie(req, "", 0) } : {});
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
    let m = /^\/account\/apps\/(\d+)\/revoke$/.exec(p);
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
