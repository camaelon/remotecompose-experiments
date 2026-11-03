// OAuth 2.1 for the MCP servers, per the MCP authorization spec, so a client (claude.ai's or
// ChatGPT's custom connectors, Claude Code, the MCP Inspector) can connect by signing in here
// instead of being given a token.
//
//   every MCP server   a protected resource: a 401 carries
//                      WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource<mount>/mcp"
//                      and it serves that document (RFC 9728), plus the authorization server's
//                      (RFC 8414; also as /.well-known/openid-configuration)
//   the account pages  the authorization server (rc-examples: /examples/oauth/ on the VPS):
//     POST oauth/register    dynamic client registration (RFC 7591), open, public clients only
//     GET  oauth/authorize   sign in if needed, then a consent page; POST: Allow / Deny
//     POST oauth/token       authorization_code (PKCE S256) and refresh_token (rotating)
//     POST oauth/revoke      RFC 7009
//
// Tokens: an access token "rco_..." (1 h) and a refresh token "rcr_..." (30 days, a new one on
// every use; a used one presented again revokes the grant). Stored hashed, like everything.
// One authorization server serves every MCP server and they share the accounts, so a token is
// accepted by any of them (the `resource` a client asks for is checked and recorded, not
// enforced per server). The rc_ tokens and MCP_TOKEN work as before.
//
//   RC_PUBLIC_ORIGIN   the public origin (https://mcp.kobento.dev); without it, the request's own
//   RC_MOUNT           this server's path under it ("/examples", "/rc-render"; "" for the front door)
//   RC_AUTH_URL        where the authorization server's pages are (default <origin>/examples, or
//                      the request's origin when RC_PUBLIC_ORIGIN is unset)
//   RC_OAUTH_ISSUER    the issuer (default RC_PUBLIC_ORIGIN, else the request's origin)
//   RC_MCP_MOUNTS      the MCP servers' mounts, comma-separated ("/" for the root): the valid
//                      `resource` values (default: the Caddyfile's)
//   RC_OAUTH=0         turns it all off

import { createHash } from "node:crypto";
import { accounts, accountsEnabled, csrfFor, RateLimiter, readCookie } from "./accounts.mjs";
import { clientIp, esc, HEADERS, html, isHttps, NEXT_COOKIE, readForm, redirect, sameOrigin, selfOrigin, shell } from "./account-web.mjs";

export const oauthEnabled = (env = process.env) => accountsEnabled(env) && env.RC_OAUTH !== "0";

const DEFAULT_MOUNTS = ["", "/json2rc", "/rc-render", "/guide", "/deploy", "/inspect", "/examples"];
const trim = (u) => String(u ?? "").replace(/\/+$/, "");
const publicOrigin = () => trim(process.env.RC_PUBLIC_ORIGIN);
export const originOf = (req) => publicOrigin() || selfOrigin(req);
export const issuerOf = (req) => trim(process.env.RC_OAUTH_ISSUER) || originOf(req);
export const authBaseOf = (req) => trim(process.env.RC_AUTH_URL) || (publicOrigin() ? `${publicOrigin()}/examples` : issuerOf(req));
const mounts = () => (process.env.RC_MCP_MOUNTS ? process.env.RC_MCP_MOUNTS.split(",").map((m) => trim(m.trim())) : DEFAULT_MOUNTS);
const ownMount = () => trim(process.env.RC_MOUNT);

/** This server's MCP endpoint as clients name it (the `resource`). */
export const ownResource = (req, base = "/mcp") => `${originOf(req)}${ownMount()}${base}`;
/** Where this server's protected-resource metadata is (the 401's resource_metadata). */
export const resourceMetadataUrl = (req, base = "/mcp") => `${originOf(req)}/.well-known/oauth-protected-resource${ownMount()}${base}`;

const isLocalHost = (h) => h === "localhost" || h === "127.0.0.1" || h === "[::1]";

/** Is `r` one of our MCP endpoints (RFC 8707 resource)? Locally, any loopback /mcp endpoint. */
export function knownResource(r, req) {
    let u;
    try { u = new URL(r); } catch { return false; }
    if (u.hash || u.search) return false;
    const norm = trim(u.href);
    if (mounts().some((m) => norm === `${originOf(req)}${m}/mcp`)) return true;
    return !publicOrigin() && isLocalHost(u.hostname) && /\/mcp$/.test(u.pathname);
}

/** RFC 7591 redirect URIs: https, or http on the loopback host (native apps, Claude Code, the Inspector); no fragment. */
export function validRedirectUri(uri) {
    if (typeof uri !== "string" || uri.length > 2000) return false;
    let u;
    try { u = new URL(uri); } catch { return false; }
    if (u.hash || u.username || u.password) return false;
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && isLocalHost(u.hostname);
}

/** PKCE S256: BASE64URL(SHA256(verifier)) == challenge; the verifier is 43-128 unreserved characters. */
export function verifyPkce(verifier, challenge) {
    if (typeof verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || typeof challenge !== "string") return false;
    return createHash("sha256").update(verifier).digest("base64url") === challenge;
}

// --- discovery

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version", "Access-Control-Max-Age": "86400" };

function json(res, status, body, extra = {}) {
    const buf = Buffer.from(JSON.stringify(body));
    res.writeHead(status, { "Content-Type": "application/json", "Content-Length": buf.length, "Cache-Control": "no-store", "Pragma": "no-cache", ...CORS, ...extra });
    res.end(buf);
    return true;
}
const oauthError = (res, status, error, description, extra) => json(res, status, { error, ...(description ? { error_description: description } : {}) }, extra);

export function authServerMetadata(req) {
    const a = authBaseOf(req);
    return {
        issuer: issuerOf(req),
        authorization_endpoint: `${a}/oauth/authorize`,
        token_endpoint: `${a}/oauth/token`,
        registration_endpoint: `${a}/oauth/register`,
        revocation_endpoint: `${a}/oauth/revoke`,
        response_types_supported: ["code"],
        response_modes_supported: ["query"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        revocation_endpoint_auth_methods_supported: ["none"],
        scopes_supported: ["mcp"],
        authorization_response_iss_parameter_supported: true,
        service_documentation: `${a}/account/`,
    };
}

/**
 * GET /.well-known/oauth-protected-resource[<mount>/mcp], /.well-known/oauth-authorization-server[...]
 * and /.well-known/openid-configuration, on every server (lib/mcp-server.mjs calls it before
 * anything else). True when it answered.
 */
export function wellKnown(req, url, res, { base = "/mcp", name = "" } = {}) {
    const p = url.pathname;
    if (!p.startsWith("/.well-known/")) return false;
    const prm = /^\/\.well-known\/oauth-protected-resource(\/.*)?$/.exec(p);
    const asm = /^\/\.well-known\/(oauth-authorization-server|openid-configuration)(\/.*)?$/.test(p);
    if (!prm && !asm) return false;
    if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return true; }
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "method not allowed" }, { Allow: "GET, HEAD, OPTIONS" });
    if (asm) return json(res, 200, authServerMetadata(req), { "Cache-Control": "public, max-age=300" });
    // The bare form is this server's own; the suffixed form names the endpoint (any of ours).
    const resource = prm[1] && prm[1] !== "/" ? `${originOf(req)}${trim(prm[1])}` : ownResource(req, base);
    if (resource !== ownResource(req, base) && !knownResource(resource, req)) return json(res, 404, { error: "no such protected resource" });
    return json(res, 200, {
        resource,
        authorization_servers: [issuerOf(req)],
        scopes_supported: ["mcp"],
        bearer_methods_supported: ["header"],
        resource_name: `RemoteCompose${name ? ` (${name})` : ""}`,
        resource_documentation: `${authBaseOf(req)}/account/`,
    }, { "Cache-Control": "public, max-age=300" });
}

// --- the authorization server's endpoints

const registerLimit = new RateLimiter(Number(process.env.RC_OAUTH_REGISTER_PER_HOUR ?? 20), 3600_000);
const tokenLimit = new RateLimiter(Number(process.env.RC_OAUTH_TOKEN_PER_MIN ?? 60), 60_000);

async function readBody(req, max = 64 << 10) {
    const chunks = [];
    let size = 0;
    for await (const c of req) { size += c.length; if (size > max) throw Object.assign(new Error("too large"), { status: 413 }); chunks.push(c); }
    return Buffer.concat(chunks).toString("utf8");
}

/** A token request's parameters: form-encoded (the standard) or JSON; client_id also from HTTP Basic. */
async function tokenParams(req) {
    const text = await readBody(req);
    let params;
    if (/json/i.test(String(req.headers["content-type"] ?? ""))) {
        let j = {};
        try { j = JSON.parse(text || "{}"); } catch { /* empty */ }
        params = new URLSearchParams(Object.entries(j).filter(([, v]) => typeof v === "string"));
    } else params = new URLSearchParams(text);
    const basic = /^Basic\s+(.+)$/i.exec(String(req.headers.authorization ?? ""));
    if (basic && !params.get("client_id")) {
        try { params.set("client_id", decodeURIComponent(Buffer.from(basic[1], "base64").toString("utf8").split(":")[0])); } catch { /* none */ }
    }
    return params;
}

async function register(req, res, store) {
    if (!registerLimit.hit(clientIp(req))) return oauthError(res, 429, "too_many_requests", "too many registrations from this address");
    let meta;
    try { meta = JSON.parse(await readBody(req, 16 << 10)); } catch { return oauthError(res, 400, "invalid_client_metadata", "the body must be JSON client metadata"); }
    if (!meta || typeof meta !== "object") return oauthError(res, 400, "invalid_client_metadata", "the body must be a JSON object");
    const uris = meta.redirect_uris;
    if (!Array.isArray(uris) || !uris.length || uris.length > 10) return oauthError(res, 400, "invalid_redirect_uri", "redirect_uris: one to ten URIs");
    const bad = uris.find((u) => !validRedirectUri(u));
    if (bad !== undefined) return oauthError(res, 400, "invalid_redirect_uri", `not allowed: ${String(bad).slice(0, 200)} (https, or http on localhost / 127.0.0.1)`);
    const grants = meta.grant_types ?? ["authorization_code", "refresh_token"];
    if (!Array.isArray(grants) || grants.some((g) => !["authorization_code", "refresh_token"].includes(g))) {
        return oauthError(res, 400, "invalid_client_metadata", "grant_types: authorization_code and refresh_token only");
    }
    if (meta.response_types && (!Array.isArray(meta.response_types) || meta.response_types.some((t) => t !== "code"))) {
        return oauthError(res, 400, "invalid_client_metadata", "response_types: code only");
    }
    const name = typeof meta.client_name === "string" ? meta.client_name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 100) : "";
    const c = store.registerClient({ name, redirectUris: uris });
    // Public clients only: whatever auth method was asked for, it is "none" (RFC 7591 3.2.1 lets the server say so).
    return json(res, 201, {
        client_id: c.id, client_id_issued_at: Math.floor(Date.parse(c.created) / 1000),
        client_name: c.name, redirect_uris: uris, grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"], token_endpoint_auth_method: "none", scope: "mcp",
    });
}

/**
 * The checks every authorization request goes through, GET or POST. Returns
 * {page: message} when the client or redirect URI is wrong (never redirect then),
 * {redirect: url} for an error the client should hear about, or {ok: {...}}.
 */
function checkAuthorize(q, store, req) {
    const client = store.getClient(q.get("client_id") ?? "");
    if (!client) return { page: "This app is not registered here (unknown client_id). Try connecting again from the app." };
    let redirectUri = q.get("redirect_uri");
    if (!redirectUri && client.redirect_uris.length === 1) redirectUri = client.redirect_uris[0];
    if (!redirectUri || !client.redirect_uris.includes(redirectUri)) return { page: "The app sent a redirect address it did not register. Nothing was shared." };
    const state = q.get("state");
    const fail = (error, description) => {
        const u = new URL(redirectUri);
        u.searchParams.set("error", error);
        if (description) u.searchParams.set("error_description", description);
        if (state != null) u.searchParams.set("state", state);
        u.searchParams.set("iss", issuerOf(req));
        return { redirect: u.href };
    };
    if (q.get("response_type") !== "code") return fail("unsupported_response_type", "response_type must be code");
    const challenge = q.get("code_challenge");
    if (!challenge || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return fail("invalid_request", "PKCE is required: code_challenge (S256)");
    if ((q.get("code_challenge_method") ?? "plain") !== "S256") return fail("invalid_request", "code_challenge_method must be S256");
    const resource = q.get("resource");
    if (resource && !knownResource(resource, req)) return fail("invalid_target", "resource is not one of this server's MCP endpoints");
    // The one scope there is; whatever else is asked for is not granted (and the token response says so).
    return { ok: { client, redirectUri, state, challenge, resource: resource ? trim(resource) : null, scope: "mcp" } };
}

const PARAMS = ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "state", "scope", "resource"];

function consentPage({ client, redirectUri, acct, q, sid }) {
    const host = new URL(redirectUri).host;
    const hidden = PARAMS.filter((k) => q.get(k) != null).map((k) => `<input type="hidden" name="${k}" value="${esc(q.get(k))}">`).join("");
    return `<section class="panel consent">
<h2>${esc(client.name || "An app")} wants to use your RemoteCompose account</h2>
<p>It will be able to call the RemoteCompose MCP tools (build, render, inspect, publish pages, …) as <b>${esc(acct.email)}</b>. Its calls count in your usage and the pages it publishes are yours.</p>
<p class="muted">After you allow it you go back to <b>${esc(host)}</b>. You can disconnect it at any time under Connected apps on your account page.</p>
<form class="row" method="post" action="authorize" style="margin-top:14px">${hidden}<input type="hidden" name="csrf" value="${csrfFor(sid)}">
<button class="btn" type="submit" name="decision" value="allow">Allow</button>
<button class="link" type="submit" name="decision" value="deny" style="padding:7px 14px">Deny</button></form>
</section>`;
}

async function authorize(req, url, res, store, site) {
    const render = (status, title, sub, body, extra) => html(res, status, shell({ css: site.css, nav: site.nav("account"), title, sub, body }), extra);
    const errorPage = (msg) => render(400, "Cannot connect", "The request from the app is not valid.", `<p class="err">${esc(msg)}</p>`);
    if (req.method === "GET" || req.method === "HEAD") {
        const q = url.searchParams;
        const c = checkAuthorize(q, store, req);
        if (c.page) return errorPage(c.page);
        if (c.redirect) return redirect(res, c.redirect);
        const sid = readCookie(req);
        const acct = sid ? store.sessionAccount(sid) : null;
        if (!acct) {
            // Sign in first (token, emailed link or a new account), then back here.
            const next = new URLSearchParams(PARAMS.filter((k) => q.get(k) != null).map((k) => [k, q.get(k)])).toString();
            return redirect(res, "../account/", { "Set-Cookie": `${NEXT_COOKIE}=${encodeURIComponent(next)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=1800${isHttps(req) ? "; Secure" : ""}` });
        }
        // The form posts here, and the answer redirects to the app: the CSP must allow that target.
        const target = new URL(c.ok.redirectUri).origin;
        return render(200, "Connect an app", "Allow it to use the RemoteCompose MCP servers as you?", consentPage({ ...c.ok, acct, q, sid }),
            { "Content-Security-Policy": HEADERS["Content-Security-Policy"].replace("form-action 'self'", `form-action 'self' ${target}`) });
    }
    if (req.method !== "POST") { res.writeHead(405, { Allow: "GET, POST" }); res.end(); return true; }
    if (!sameOrigin(req)) return html(res, 403, "<!doctype html><p>Refused: this form must be sent from this site's own pages.</p>");
    let form;
    try { form = await readForm(req); } catch { return html(res, 400, "<!doctype html><p>Bad request.</p>"); }
    const sid = readCookie(req);
    const acct = sid ? store.sessionAccount(sid) : null;
    if (!acct) return redirect(res, "../account/");
    if (form.get("csrf") !== csrfFor(sid)) return html(res, 403, "<!doctype html><p>Refused: the form is stale. Go back, reload the page and try again.</p>");
    const c = checkAuthorize(form, store, req);
    if (c.page) return errorPage(c.page);
    if (c.redirect) return redirect(res, c.redirect);
    const back = new URL(c.ok.redirectUri);
    if (form.get("decision") === "allow") {
        back.searchParams.set("code", store.createAuthCode({ clientId: c.ok.client.id, accountId: acct.id, redirectUri: c.ok.redirectUri,
            challenge: c.ok.challenge, resource: c.ok.resource, scope: c.ok.scope }));
    } else {
        back.searchParams.set("error", "access_denied");
        back.searchParams.set("error_description", "the user denied access");
    }
    if (c.ok.state != null) back.searchParams.set("state", c.ok.state);
    back.searchParams.set("iss", issuerOf(req));
    return redirect(res, back.href);
}

async function token(req, res, store) {
    if (!tokenLimit.hit(clientIp(req))) return oauthError(res, 429, "too_many_requests", "slow down");
    let q;
    try { q = await tokenParams(req); } catch { return oauthError(res, 400, "invalid_request", "bad body"); }
    const clientId = q.get("client_id") ?? "";
    const client = store.getClient(clientId);
    if (!client) return oauthError(res, 401, "invalid_client", "unknown client_id", { "WWW-Authenticate": 'Basic realm="oauth"' });
    const grantType = q.get("grant_type");
    let out;
    if (grantType === "authorization_code") {
        const row = store.claimAuthCode(q.get("code") ?? "");
        if (!row || row.reused || row.expired) return oauthError(res, 400, "invalid_grant", row?.reused ? "the code was already used" : row?.expired ? "the code expired" : "unknown code");
        if (row.client_id !== client.id) return oauthError(res, 400, "invalid_grant", "the code was issued to another client");
        if (q.get("redirect_uri") && q.get("redirect_uri") !== row.redirect_uri) return oauthError(res, 400, "invalid_grant", "redirect_uri does not match");
        if (!verifyPkce(q.get("code_verifier"), row.challenge)) return oauthError(res, 400, "invalid_grant", "PKCE verification failed");
        const resource = q.get("resource");
        if (resource && row.resource && trim(resource) !== row.resource) return oauthError(res, 400, "invalid_target", "resource differs from the authorization request");
        const a = store.getAccount(row.account_id);
        if (!a || a.status !== "active") return oauthError(res, 400, "invalid_grant", "the account is not active");
        out = store.grantFromCode(row);
    } else if (grantType === "refresh_token") {
        out = store.refreshGrant(q.get("refresh_token") ?? "", client.id);
        if (out.error) return oauthError(res, 400, out.error, out.why);
    } else return oauthError(res, 400, "unsupported_grant_type", "authorization_code or refresh_token");
    return json(res, 200, { access_token: out.access, token_type: "Bearer", expires_in: out.expiresIn, refresh_token: out.refresh, scope: out.scope });
}

async function revoke(req, res, store) {
    if (!tokenLimit.hit(clientIp(req))) return oauthError(res, 429, "too_many_requests", "slow down");
    let q;
    try { q = await tokenParams(req); } catch { return oauthError(res, 400, "invalid_request", "bad body"); }
    store.revokeOAuthToken(q.get("token") ?? "", q.get("client_id") || null);
    res.writeHead(200, { "Cache-Control": "no-store", ...CORS });   // RFC 7009: 200 whether or not the token was known
    res.end();
    return true;
}

/** <base>/oauth/... on the account pages' server; false for anything else. */
export async function oauthRoute(req, url, res, site) {
    const p = url.pathname;
    if (!/^\/oauth\//.test(p) || !oauthEnabled()) return false;
    if (req.method === "OPTIONS" && p !== "/oauth/authorize") { res.writeHead(204, CORS); res.end(); return true; }
    const store = await accounts();
    if (p === "/oauth/authorize") return authorize(req, url, res, store, site);
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" }, { Allow: "POST, OPTIONS" });
    if (p === "/oauth/register") return register(req, res, store);
    if (p === "/oauth/token") return token(req, res, store);
    if (p === "/oauth/revoke") return revoke(req, res, store);
    return json(res, 404, { error: "not found" });
}
