import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { openAccounts } from "./accounts.mjs";
import { knownResource, validRedirectUri, verifyPkce } from "./oauth.mjs";

const pair = () => { const v = randomBytes(32).toString("base64url"); return { verifier: v, challenge: createHash("sha256").update(v).digest("base64url") }; };

async function setup() {
    const s = await openAccounts(":memory:");
    const a = s.createAccount({ email: "o@example.com" });
    const c = s.registerClient({ name: "Claude", redirectUris: ["https://claude.ai/api/mcp/auth_callback"] });
    return { s, a, c };
}

test("PKCE S256: the RFC 7636 example, and what fails", () => {
    assert.equal(verifyPkce("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"), true);
    assert.equal(verifyPkce("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXX", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"), false);
    assert.equal(verifyPkce("short", "x"), false);
    assert.equal(verifyPkce(undefined, "x"), false);
    const { verifier, challenge } = pair();
    assert.equal(verifyPkce(verifier, challenge), true);
});

test("redirect URI rules: https, or http on loopback; no fragments or credentials", () => {
    for (const ok of ["https://claude.ai/api/mcp/auth_callback", "https://chatgpt.com/connector_platform_oauth_redirect",
        "http://localhost:6274/oauth/callback", "http://127.0.0.1:33418/callback", "http://[::1]:8080/cb"]) assert.ok(validRedirectUri(ok), ok);
    for (const bad of ["http://example.com/cb", "https://x/cb#frag", "javascript:alert(1)", "ftp://x/", "cursor://cb",
        "https://user:pw@x/cb", "not a url", "", 42]) assert.ok(!validRedirectUri(bad), String(bad));
});

test("resources: ours only (with RC_PUBLIC_ORIGIN, the mounts)", () => {
    const req = { headers: { host: "127.0.0.1:8913" }, socket: {} };
    assert.ok(knownResource("http://127.0.0.1:8909/mcp", req));
    assert.ok(!knownResource("https://evil.example/mcp", req));
    assert.ok(!knownResource("http://127.0.0.1:8909/mcp?x=1", req));
    const saved = process.env.RC_PUBLIC_ORIGIN;
    process.env.RC_PUBLIC_ORIGIN = "https://mcp.kobento.dev";
    try {
        assert.ok(knownResource("https://mcp.kobento.dev/mcp", req));
        assert.ok(knownResource("https://mcp.kobento.dev/rc-render/mcp", req));
        assert.ok(knownResource("https://mcp.kobento.dev/examples/mcp/", req));
        assert.ok(!knownResource("https://mcp.kobento.dev/other/mcp", req));
        assert.ok(!knownResource("http://127.0.0.1:8909/mcp", req), "loopback only without a public origin");
    } finally { if (saved === undefined) delete process.env.RC_PUBLIC_ORIGIN; else process.env.RC_PUBLIC_ORIGIN = saved; }
});

test("authorization codes: hashed, single use, expiry; a reused code revokes its grant", async () => {
    const { s, a, c } = await setup();
    const { challenge } = pair();
    const code = s.createAuthCode({ clientId: c.id, accountId: a.id, redirectUri: c.redirect_uris[0], challenge, resource: "https://x/mcp" });
    assert.ok(!JSON.stringify(s.db.prepare("SELECT * FROM oauth_codes").all()).includes(code));
    const row = s.claimAuthCode(code);
    assert.equal(row.account_id, a.id);
    assert.equal(row.resource, "https://x/mcp");
    const g = s.grantFromCode(row);
    assert.ok(s.authenticateAccess(g.access));
    assert.deepEqual(s.claimAuthCode(code), { reused: true });
    assert.equal(s.authenticateAccess(g.access), null, "the grant made from a reused code is revoked");
    const late = s.createAuthCode({ clientId: c.id, accountId: a.id, redirectUri: c.redirect_uris[0], challenge }, -1);
    assert.deepEqual(s.claimAuthCode(late), { expired: true });
    assert.equal(s.claimAuthCode("nope"), null);
});

test("access tokens: account, grant, expiry, disabled account", async () => {
    const { s, a, c } = await setup();
    const row = s.claimAuthCode(s.createAuthCode({ clientId: c.id, accountId: a.id, redirectUri: c.redirect_uris[0], challenge: pair().challenge }));
    const g = s.grantFromCode(row);
    assert.match(g.access, /^rco_[A-Za-z0-9_-]{43}$/);
    assert.match(g.refresh, /^rcr_[A-Za-z0-9_-]{43}$/);
    assert.equal(g.expiresIn, 3600);
    const found = s.authenticateAccess(g.access);
    assert.equal(found.account.id, a.id);
    assert.equal(found.grantId, g.grantId);
    assert.equal(found.clientName, "Claude");
    assert.equal(s.authenticateAccess(g.refresh), null, "a refresh token is no access token");
    assert.ok(!JSON.stringify(s.db.prepare("SELECT * FROM oauth_tokens").all()).includes(g.access));
    s.setStatus(a.id, "disabled");
    assert.equal(s.authenticateAccess(g.access).disabled, true);
    s.setStatus(a.id, "active");
    const short = s.grantFromCode(s.claimAuthCode(s.createAuthCode({ clientId: c.id, accountId: a.id, redirectUri: c.redirect_uris[0], challenge: "x" })), { accessTtlMs: -1 });
    assert.equal(s.authenticateAccess(short.access), null, "expired");
});

test("refresh: rotates; the old one fails and its reuse revokes the grant; other client refused", async () => {
    const { s, a, c } = await setup();
    const other = s.registerClient({ name: "Other", redirectUris: ["https://o/cb"] });
    const g = s.grantFromCode(s.claimAuthCode(s.createAuthCode({ clientId: c.id, accountId: a.id, redirectUri: c.redirect_uris[0], challenge: "x" })));
    assert.equal(s.refreshGrant(g.refresh, other.id).error, "invalid_grant");
    const r1 = s.refreshGrant(g.refresh, c.id);
    assert.ok(r1.access && r1.refresh && r1.refresh !== g.refresh);
    assert.equal(r1.grantId, g.grantId);
    assert.ok(s.authenticateAccess(r1.access));
    const reuse = s.refreshGrant(g.refresh, c.id);
    assert.equal(reuse.error, "invalid_grant");
    assert.match(reuse.why, /reused/);
    assert.equal(s.authenticateAccess(r1.access), null, "the whole grant is revoked");
    assert.equal(s.refreshGrant(r1.refresh, c.id).error, "invalid_grant");
    const g2 = s.grantFromCode(s.claimAuthCode(s.createAuthCode({ clientId: c.id, accountId: a.id, redirectUri: c.redirect_uris[0], challenge: "x" })), { refreshTtlMs: -1 });
    assert.match(s.refreshGrant(g2.refresh, c.id).why, /expired/);
});

test("revocation: by token (RFC 7009) or from the account page; connected apps list", async () => {
    const { s, a, c } = await setup();
    const mk = () => s.grantFromCode(s.claimAuthCode(s.createAuthCode({ clientId: c.id, accountId: a.id, redirectUri: c.redirect_uris[0], challenge: "x" })));
    const g1 = mk(), g2 = mk();
    assert.equal(s.listGrants(a.id).length, 2);
    assert.equal(s.listGrants(a.id)[0].client_name, "Claude");
    assert.equal(s.revokeOAuthToken(g1.refresh), true);
    assert.equal(s.authenticateAccess(g1.access), null, "revoking the refresh token ends the access token");
    assert.equal(s.revokeOAuthToken("rco_unknown"), false);
    const b = s.createAccount({ email: "b@example.com" });
    assert.equal(s.revokeGrant(g2.grantId, b.id), false, "not another account's");
    assert.equal(s.revokeGrant(g2.grantId, a.id), true);
    assert.equal(s.authenticateAccess(g2.access), null);
    assert.equal(s.listGrants(a.id).length, 0);
});

test("usage attributes OAuth calls to the app", async () => {
    const { s, a, c } = await setup();
    const g = s.grantFromCode(s.claimAuthCode(s.createAuthCode({ clientId: c.id, accountId: a.id, redirectUri: c.redirect_uris[0], challenge: "x" })));
    const t = s.issueToken(a.id, "laptop");
    s.recordCall({ accountId: a.id, grantId: g.grantId, server: "remotecompose", tool: "render", ms: 5, ok: true });
    s.recordCall({ accountId: a.id, grantId: g.grantId, server: "remotecompose", tool: "render", ms: 5, ok: true });
    s.recordCall({ accountId: a.id, tokenId: t.id, server: "rc-render", tool: "render_rc", ms: 5, ok: true });
    assert.deepEqual(s.usage(a.id).byClient.map((r) => [r.name, r.calls]), [["via Claude", 2], ["token: laptop", 1]]);
});
