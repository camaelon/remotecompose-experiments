// End to end, the way an MCP client connects (the MCP authorization spec): real servers in HTTP
// mode, rc-examples as the authorization server, rc-render as a protected resource, one database.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN = "admin-secret-token-0123456789abcdef";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function freePort() {
    const s = createServer();
    await new Promise((r) => s.listen(0, "127.0.0.1", r));
    const { port } = s.address();
    await new Promise((r) => s.close(r));
    return port;
}

async function servers() {
    const root = mkdtempSync(path.join(tmpdir(), "rc-oauth-e2e-"));
    const [ap, rp] = [await freePort(), await freePort()];
    const auth = `http://127.0.0.1:${ap}`, render = `http://127.0.0.1:${rp}`;
    const env = { ...process.env, MCP_ROOT: root, RC_ACCOUNTS: "1", MCP_TOKEN: ADMIN, RC_EMAIL_VERIFY: "off", RESEND_API_KEY: "",
        RC_DB: "", RC_PUBLIC_ORIGIN: "", RC_MOUNT: "", RC_OAUTH: "", RC_OAUTH_ISSUER: auth, RC_AUTH_URL: auth, RC_ACCOUNT_URL: `${auth}/account/` };
    const logs = { a: "", r: "" };
    const kids = [["examples-server.mjs", ap, "a"], ["rc-render-server.mjs", rp, "r"]].map(([f, port, k]) => {
        const c = spawn(process.execPath, [path.join(DIR, f), "--http"], { env: { ...env, MCP_HTTP_PORT: String(port) }, stdio: ["ignore", "ignore", "pipe"] });
        c.stderr.on("data", (d) => { logs[k] += d; });
        return c;
    });
    for (const u of [auth, render]) for (let i = 0; i < 300; i++) { try { if ((await fetch(`${u}/healthz`)).ok) break; } catch {} await sleep(100); }
    return { auth, render, root, logs, stop: () => { kids.forEach((k) => k.kill()); rmSync(root, { recursive: true, force: true }); } };
}

/** A tiny cookie jar for the browser half of the flow. */
function browser(origin) {
    const jar = new Map();
    const keep = (res) => { for (const c of res.headers.getSetCookie()) { const [kv] = c.split(";"); const i = kv.indexOf("="); const v = kv.slice(i + 1); if (/Max-Age=0/.test(c)) jar.delete(kv.slice(0, i)); else jar.set(kv.slice(0, i), v); } };
    const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    return {
        jar,
        get: async (u) => { const r = await fetch(u, { redirect: "manual", headers: { Cookie: cookie() } }); keep(r); return r; },
        post: async (u, form) => { const r = await fetch(u, { method: "POST", redirect: "manual", body: new URLSearchParams(form),
            headers: { Cookie: cookie(), Origin: origin, "Content-Type": "application/x-www-form-urlencoded" } }); keep(r); return r; },
    };
}

const rpc = (url, tokenOrNull, method = "tools/list", params) => fetch(url, { method: "POST",
    headers: { "Content-Type": "application/json", ...(tokenOrNull ? { Authorization: `Bearer ${tokenOrNull}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }) });
const form = (u, f) => fetch(u, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(f) });

test("OAuth: discover, register, sign in, consent, code, token, call, refresh, reuse, revoke", async (t) => {
    const S = await servers();
    t.after(() => S.stop());
    const mcp = `${S.render}/mcp`;

    // 1. 401 names the protected-resource metadata.
    const r401 = await rpc(mcp, null);
    assert.equal(r401.status, 401);
    const www = r401.headers.get("www-authenticate");
    const prmUrl = /resource_metadata="([^"]+)"/.exec(www)[1];
    assert.equal(prmUrl, `${S.render}/.well-known/oauth-protected-resource/mcp`);

    // 2. Both metadata documents.
    const prm = await (await fetch(prmUrl)).json();
    assert.equal(prm.resource, mcp);
    assert.deepEqual(prm.authorization_servers, [S.auth]);
    assert.deepEqual(prm.scopes_supported, ["mcp"]);
    assert.deepEqual(prm.bearer_methods_supported, ["header"]);
    assert.deepEqual(await (await fetch(`${S.render}/.well-known/oauth-protected-resource`)).json(), prm, "the bare form too");
    const as = await (await fetch(`${prm.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json();
    assert.equal(as.issuer, S.auth);
    assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
    assert.deepEqual(as.grant_types_supported, ["authorization_code", "refresh_token"]);
    assert.deepEqual(as.token_endpoint_auth_methods_supported, ["none"]);
    assert.deepEqual(await (await fetch(`${S.auth}/.well-known/openid-configuration`)).json(), as);

    // 3. Dynamic client registration (bad redirect URIs refused).
    const bad = await fetch(as.registration_endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_name: "Bad", redirect_uris: ["http://evil.example/cb"] }) });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, "invalid_redirect_uri");
    const redirectUri = "http://127.0.0.1:9/callback";
    const reg = await fetch(as.registration_endpoint, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_name: "E2E <Client>", redirect_uris: [redirectUri], token_endpoint_auth_method: "none" }) });
    assert.equal(reg.status, 201);
    const client = await reg.json();
    assert.match(client.client_id, /^rcc_/);
    assert.equal(client.token_endpoint_auth_method, "none");

    // 4. Authorize, not signed in: off to sign in, then back to the request.
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authz = (extra = {}) => `${as.authorization_endpoint}?${new URLSearchParams({ response_type: "code", client_id: client.client_id,
        redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256", state: "st-123", scope: "mcp", resource: mcp, ...extra })}`;
    const B = browser(S.auth);
    const r1 = await B.get(authz());
    assert.equal(r1.status, 303);
    assert.equal(r1.headers.get("location"), "../account/");
    assert.ok(B.jar.has("rc_oauth_next"));
    const signinPage = await (await B.get(`${S.auth}/account/`)).text();
    assert.match(signinPage, /E2E &lt;Client&gt;<\/b> wants to connect/);
    // Create an account here (RC_EMAIL_VERIFY=off: a token at once), sign out, sign back in with the token.
    const regPage = await (await B.post(`${S.auth}/account/register`, { email: "oauth@example.com", name: "O" })).text();
    const rcToken = /id="tok">(rc_[A-Za-z0-9_-]{43})/.exec(regPage)[1];
    B.jar.delete("rc_session");
    const si = await B.post(`${S.auth}/account/signin`, { token: rcToken });
    assert.equal(si.status, 303);
    assert.match(si.headers.get("location"), /^\.\.\/oauth\/authorize\?/, "sign-in goes back to the authorization request");
    assert.ok(!B.jar.has("rc_oauth_next"));

    // 5. Consent page, then Allow -> code.
    const consent = await B.get(new URL(si.headers.get("location"), `${S.auth}/account/signin`).href);
    assert.equal(consent.status, 200);
    assert.match(consent.headers.get("content-security-policy"), /form-action 'self' http:\/\/127\.0\.0\.1:9/);
    const cpage = await consent.text();
    assert.match(cpage, /E2E &lt;Client&gt; wants to use your RemoteCompose account/);
    assert.match(cpage, /oauth@example\.com/);
    const fields = Object.fromEntries([...cpage.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map((m) => [m[1], m[2].replaceAll("&amp;", "&")]));
    assert.equal((await B.post(as.authorization_endpoint, { ...fields, csrf: "wrong", decision: "allow" })).status, 403, "CSRF");
    const allow = await B.post(as.authorization_endpoint, { ...fields, decision: "allow" });
    assert.equal(allow.status, 303);
    const back = new URL(allow.headers.get("location"));
    assert.equal(back.origin + back.pathname, redirectUri);
    assert.equal(back.searchParams.get("state"), "st-123");
    assert.equal(back.searchParams.get("iss"), S.auth);
    const code = back.searchParams.get("code");

    // 6. Token: a wrong verifier fails (and spends the code), so get another code for the real exchange.
    const tk = (f) => form(as.token_endpoint, { client_id: client.client_id, ...f });
    const wrong = await tk({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: "x".repeat(43) });
    assert.equal(wrong.status, 400);
    assert.equal((await wrong.json()).error, "invalid_grant");
    assert.equal(wrong.headers.get("cache-control"), "no-store");
    const code2 = new URL((await B.post(as.authorization_endpoint, { ...fields, decision: "allow" })).headers.get("location")).searchParams.get("code");
    const tok = await tk({ grant_type: "authorization_code", code: code2, redirect_uri: redirectUri, code_verifier: verifier, resource: mcp });
    assert.equal(tok.status, 200);
    const t1 = await tok.json();
    assert.match(t1.access_token, /^rco_/);
    assert.equal(t1.token_type, "Bearer");
    assert.equal(t1.expires_in, 3600);
    assert.equal(t1.scope, "mcp");
    const again = await tk({ grant_type: "authorization_code", code: code2, redirect_uri: redirectUri, code_verifier: verifier });
    assert.equal((await again.json()).error, "invalid_grant", "a code works once");
    // (Reusing it revoked the grant it made, per RFC 6749 10.5: authorize once more.)
    assert.equal((await rpc(mcp, t1.access_token)).status, 401);
    const code3 = new URL((await B.post(as.authorization_endpoint, { ...fields, decision: "allow" })).headers.get("location")).searchParams.get("code");
    const t2 = await (await tk({ grant_type: "authorization_code", code: code3, redirect_uri: redirectUri, code_verifier: verifier })).json();

    // 7. The access token works on the MCP server (another process, same database).
    const list = await rpc(mcp, t2.access_token);
    assert.equal(list.status, 200);
    assert.ok((await list.json()).result.tools.some((x) => x.name === "render_rc"));
    const call = await rpc(mcp, t2.access_token, "tools/call", { name: "validate", arguments: { json: { header: { width: 10, height: 10 }, root: { Box: {} } }, render: false } });
    assert.equal(call.status, 200);

    // 8. Refresh rotates; the old refresh token then fails, and its reuse revokes the grant.
    const r2 = await (await tk({ grant_type: "refresh_token", refresh_token: t2.refresh_token })).json();
    assert.match(r2.access_token, /^rco_/);
    assert.notEqual(r2.refresh_token, t2.refresh_token);
    assert.equal((await rpc(mcp, r2.access_token)).status, 200);
    const old = await tk({ grant_type: "refresh_token", refresh_token: t2.refresh_token });
    assert.equal((await old.json()).error, "invalid_grant");
    assert.equal((await rpc(mcp, r2.access_token)).status, 401, "reuse revoked the whole grant");

    // 9. Revocation endpoint: a fresh grant, revoked by its refresh token -> 401.
    const code4 = new URL((await B.post(as.authorization_endpoint, { ...fields, decision: "allow" })).headers.get("location")).searchParams.get("code");
    const t4 = await (await tk({ grant_type: "authorization_code", code: code4, redirect_uri: redirectUri, code_verifier: verifier })).json();
    assert.equal((await rpc(mcp, t4.access_token)).status, 200);
    assert.equal((await form(as.revocation_endpoint, { token: t4.refresh_token, client_id: client.client_id })).status, 200);
    const after = await rpc(mcp, t4.access_token);
    assert.equal(after.status, 401);
    assert.match(after.headers.get("www-authenticate"), /error="invalid_token"/);

    // 10. Deny, a wrong redirect URI (an error page, no redirect), no PKCE (an error redirect).
    const deny = await B.post(as.authorization_endpoint, { ...fields, decision: "deny" });
    assert.equal(new URL(deny.headers.get("location")).searchParams.get("error"), "access_denied");
    const wrongUri = await B.get(authz({ redirect_uri: "https://evil.example/cb" }));
    assert.equal(wrongUri.status, 400);
    assert.equal(wrongUri.headers.get("location"), null);
    const noPkce = await B.get(authz({ code_challenge: "" }));
    assert.equal(new URL(noPkce.headers.get("location")).searchParams.get("error"), "invalid_request");
    const foreign = await B.get(authz({ resource: "https://evil.example/mcp" }));
    assert.equal(new URL(foreign.headers.get("location")).searchParams.get("error"), "invalid_target");

    // 11. The old ways still work.
    assert.equal((await rpc(mcp, rcToken)).status, 200);
    assert.equal((await rpc(`${mcp}/${rcToken}`, null)).status, 200);
    assert.equal((await rpc(mcp, ADMIN)).status, 200);

    // 12. The account page: the connected app (one live grant: code4's was revoked, the others too)
    // and the calls attributed to it.
    const code5 = new URL((await B.post(as.authorization_endpoint, { ...fields, decision: "allow" })).headers.get("location")).searchParams.get("code");
    const t5 = await (await tk({ grant_type: "authorization_code", code: code5, redirect_uri: redirectUri, code_verifier: verifier })).json();
    await rpc(mcp, t5.access_token, "tools/call", { name: "validate", arguments: { json: { header: { width: 10, height: 10 }, root: { Box: {} } }, render: false } });
    const acct = await (await B.get(`${S.auth}/account/`)).text();
    assert.match(acct, /<h2>Connected apps<\/h2>/);
    assert.match(acct, /<b>E2E &lt;Client&gt;<\/b> <span class="muted">127\.0\.0\.1:9<\/span>/);
    assert.match(acct, /via E2E &lt;Client&gt;<\/td><td class="n">2</);
    const appId = /action="apps\/(\d+)\/revoke"/.exec(acct)[1];
    const csrf = /name="csrf" value="([^"]+)"/.exec(acct)[1];
    assert.equal((await B.post(`${S.auth}/account/apps/${appId}/revoke`, { csrf })).status, 303);
    assert.equal((await rpc(mcp, t5.access_token)).status, 401, "disconnected from the account page");

    // Nothing secret in the logs.
    for (const s of [t2.access_token, t2.refresh_token, code3, verifier, rcToken]) assert.ok(!S.logs.a.includes(s) && !S.logs.r.includes(s));
});
