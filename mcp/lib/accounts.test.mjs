import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { accountsEnabled, csrfFor, dbPath, openAccounts, RateLimiter, readCookie, signupOpen } from "./accounts.mjs";
import { sameOrigin } from "./account-web.mjs";

const fresh = (env = {}) => openAccounts(":memory:", env);

test("create an account; email checked, unique, admin from RC_ADMIN_EMAILS", async () => {
    const s = await fresh({ RC_ADMIN_EMAILS: "boss@example.com" });
    const a = s.createAccount({ email: " Ann@Example.com ", name: "Ann" });
    assert.equal(a.email, "ann@example.com");
    assert.equal(a.name, "Ann");
    assert.equal(a.status, "active");
    assert.equal(a.admin, false);
    assert.throws(() => s.createAccount({ email: "ann@example.com" }), /already exists/);
    assert.throws(() => s.createAccount({ email: "ANN@example.com" }), /already exists/);
    assert.throws(() => s.createAccount({ email: "not an email" }), /email/);
    assert.equal(s.createAccount({ email: "boss@example.com" }).admin, true);
    assert.equal(s.findAccount("ann@example.com").id, a.id);
});

test("tokens: issued once, stored hashed, authenticate, revoke", async () => {
    const s = await fresh();
    const a = s.createAccount({ email: "t@example.com" });
    const t = s.issueToken(a.id, "laptop");
    assert.match(t.token, /^rc_[A-Za-z0-9_-]{43}$/);
    assert.equal(t.prefix, t.token.slice(0, 10));
    // Only the hash and the prefix are stored.
    const raw = JSON.stringify(s.db.prepare("SELECT * FROM tokens").all());
    assert.ok(!raw.includes(t.token));
    const found = s.authenticate(t.token);
    assert.equal(found.account.id, a.id);
    assert.equal(found.tokenId, t.id);
    assert.ok(s.listTokens(a.id)[0].last_used, "last_used set on first use");
    assert.equal(s.authenticate(t.token + "x"), null);
    assert.equal(s.authenticate("nope"), null);
    assert.equal(s.authenticate(undefined), null);
    // Another account cannot revoke it.
    const b = s.createAccount({ email: "b@example.com" });
    assert.equal(s.revokeToken(b.id, t.id), false);
    assert.equal(s.revokeToken(a.id, t.id), true);
    assert.equal(s.revokeToken(a.id, t.id), false);
    assert.equal(s.authenticate(t.token), null);
    assert.ok(s.listTokens(a.id)[0].revoked);
});

test("a disabled account's tokens and sessions stop working", async () => {
    const s = await fresh();
    const a = s.createAccount({ email: "d@example.com" });
    const t = s.issueToken(a.id);
    const sid = s.createSession(a.id);
    s.setStatus(a.id, "disabled");
    assert.deepEqual(s.authenticate(t.token), { disabled: true });
    assert.equal(s.sessionAccount(sid), null);
    s.setStatus(a.id, "active");
    assert.equal(s.authenticate(t.token).account.id, a.id);
    assert.throws(() => s.setStatus(a.id, "gone"));
});

test("last_used is written at most once a minute per token", async () => {
    const s = await fresh();
    const a = s.createAccount({ email: "l@example.com" });
    const t = s.issueToken(a.id);
    s.authenticate(t.token);
    const first = s.listTokens(a.id)[0].last_used;
    s.db.prepare("UPDATE tokens SET last_used = '2000-01-01T00:00:00.000Z'").run();
    s.authenticate(t.token);   // within the minute: not written again
    assert.equal(s.listTokens(a.id)[0].last_used, "2000-01-01T00:00:00.000Z");
    assert.ok(first);
});

test("sessions: create, look up, expire, delete; stored hashed", async () => {
    const s = await fresh();
    const a = s.createAccount({ email: "s@example.com" });
    const sid = s.createSession(a.id);
    assert.equal(s.sessionAccount(sid).id, a.id);
    assert.ok(!JSON.stringify(s.db.prepare("SELECT * FROM sessions").all()).includes(sid));
    assert.equal(s.sessionAccount("other"), null);
    s.deleteSession(sid);
    assert.equal(s.sessionAccount(sid), null);
    const old = s.createSession(a.id, -1);   // expired yesterday
    assert.equal(s.sessionAccount(old), null);
    s.createSession(a.id);                   // and creating one prunes expired rows
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 1);
    assert.notEqual(csrfFor("a"), csrfFor("b"));
});

test("usage rows: per day, per tool, per server, errors; other accounts apart", async () => {
    const s = await fresh();
    const a = s.createAccount({ email: "u@example.com" });
    const b = s.createAccount({ email: "v@example.com" });
    s.recordCall({ accountId: a.id, tokenId: 1, server: "rc-render", tool: "render_rc", ms: 120, ok: true, summary: "{}" });
    s.recordCall({ accountId: a.id, tokenId: 1, server: "rc-render", tool: "render_rc", ms: 80, ok: false, error: "boom\nstack" });
    s.recordCall({ accountId: a.id, tokenId: 1, server: "rc-examples", tool: "build_kit", ms: 10, ok: true, summary: "x".repeat(5000) });
    s.recordCall({ accountId: b.id, server: "rc-render", tool: "validate", ms: 5, ok: true });
    const u = s.usage(a.id, 30);
    assert.equal(u.total, 3);
    assert.equal(u.errorCount, 1);
    assert.equal(u.byDay.length, 30);
    assert.equal(u.byDay.at(-1).calls, 3);
    assert.deepEqual(u.byServer.map((r) => [r.name, r.calls]), [["rc-render", 2], ["rc-examples", 1]]);
    assert.equal(u.byTool[0].name, "rc-render · render_rc");
    assert.equal(u.byTool[0].avg_ms, 100);
    assert.equal(u.errors[0].error, "boom");
    assert.equal(s.db.prepare("SELECT MAX(LENGTH(summary)) AS n FROM calls").get().n, 1000);
    assert.equal(s.listAccounts(7).find((x) => x.id === a.id).calls, 3);
});

test("page ownership", async () => {
    const s = await fresh();
    const a = s.createAccount({ email: "p@example.com" });
    const b = s.createAccount({ email: "q@example.com" });
    s.recordPage({ id: "AAAAAAAAAAAAAAAAAAAAAA", accountId: a.id, title: "Mine", url: "https://x/pages/A/" });
    s.recordPage({ id: "BBBBBBBBBBBBBBBBBBBBBB", accountId: b.id, title: "Theirs" });
    assert.deepEqual(s.pagesOf(a.id).map((p) => p.title), ["Mine"]);
    assert.equal(s.pagesOf(a.id, { all: true }).length, 2);
    assert.equal(s.pageOwner("BBBBBBBBBBBBBBBBBBBBBB"), b.id);
    assert.equal(s.pageOwner("nope"), null);
    s.deletePage("AAAAAAAAAAAAAAAAAAAAAA");
    assert.equal(s.pagesOf(a.id).length, 0);
});

test("enabled / signup closed / db path", () => {
    assert.equal(dbPath({}), null);
    assert.equal(accountsEnabled({}), false);
    assert.equal(accountsEnabled({ RC_ACCOUNTS: "1" }), false, "no place for the db without MCP_ROOT or RC_DB");
    assert.equal(dbPath({ MCP_ROOT: "/srv/w" }), path.join("/srv/w", "rc.db"));
    assert.equal(accountsEnabled({ MCP_ROOT: "/nonexistent-root" }), false, "off until asked for or present");
    assert.equal(accountsEnabled({ MCP_ROOT: "/nonexistent-root", RC_ACCOUNTS: "1" }), true);
    assert.equal(signupOpen({}), true);
    assert.equal(signupOpen({ RC_SIGNUP: "closed" }), false);
});

test("a database file: created, migrated once, shared by two handles", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rc-acc-"));
    try {
        const file = path.join(dir, "sub", "rc.db");
        const one = await openAccounts(file);
        const a = one.createAccount({ email: "f@example.com" });
        const t = one.issueToken(a.id);
        const two = await openAccounts(file);   // another process, in effect
        assert.equal(two.authenticate(t.token).account.email, "f@example.com");
        assert.equal(two.db.prepare("PRAGMA user_version").get().user_version, 1);
        assert.equal(two.db.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
        assert.ok(existsSync(file));
        assert.equal(accountsEnabled({ RC_DB: file }), true, "on when the database exists");
        one.close(); two.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("rate limit: per key, per window", () => {
    const r = new RateLimiter(3, 1000);
    assert.deepEqual([1, 2, 3, 4].map(() => r.hit("ip", 0)), [true, true, true, false]);
    assert.equal(r.hit("other", 0), true);
    assert.equal(r.hit("ip", 999), false);
    assert.equal(r.hit("ip", 1000), true, "a new window");
});

test("cookies and same-origin POSTs", () => {
    const req = (h) => ({ headers: { host: "mcp.example.com", ...h }, socket: {} });
    assert.equal(readCookie(req({ cookie: "a=1; rc_session=abc%3D; b=2" })), "abc=");
    assert.equal(readCookie(req({})), null);
    assert.equal(sameOrigin(req({ origin: "http://mcp.example.com" })), true);
    assert.equal(sameOrigin(req({ origin: "https://mcp.example.com", "x-forwarded-proto": "https" })), true);
    assert.equal(sameOrigin(req({ origin: "https://evil.example" })), false);
    assert.equal(sameOrigin(req({ origin: "null" })), false);
    assert.equal(sameOrigin(req({ referer: "http://mcp.example.com/examples/account/" })), true);
    assert.equal(sameOrigin(req({ referer: "http://evil.example/x" })), false);
    assert.equal(sameOrigin(req({})), false);
});
