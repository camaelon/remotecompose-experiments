import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Accounts, accountsEnabled, csrfFor, dbPath, emailVerify, openAccounts, RateLimiter, readCookie, signupOpen } from "./accounts.mjs";
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
    assert.deepEqual(s.authenticate(t.token), { disabled: true, pending: false });
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
        assert.equal(two.db.prepare("PRAGMA user_version").get().user_version, 10);
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

test("one-time codes: hash only, single use, expiry, purpose", async () => {
    const s = await fresh();
    const a = s.createAccount({ email: "c@example.com" }, { pending: true });
    const code = s.issueCode(a.id, "verify");
    assert.match(code, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(!JSON.stringify(s.db.prepare("SELECT * FROM codes").all()).includes(code), "only the hash is stored");
    assert.equal(s.redeemCode(code, "signin"), null, "wrong purpose");
    const v = s.redeemCode(code, "verify");
    assert.equal(v.status, "active");
    assert.ok(v.verified_at);
    assert.equal(s.redeemCode(code, "verify"), null, "single use");
    const late = s.issueCode(a.id, "signin", -1000);
    assert.equal(s.redeemCode(late, "signin"), null, "expired");
    const ok = s.issueCode(a.id, "signin");
    assert.equal(s.redeemCode(ok, "signin").id, a.id);
    assert.equal(s.redeemCode(ok, "signin"), null);
    assert.equal(s.redeemCode("x".repeat(43), "signin"), null);
    assert.throws(() => s.issueCode(a.id, "other"));
    // A disabled account's codes do nothing.
    const d = s.issueCode(a.id, "signin");
    s.setStatus(a.id, "disabled");
    assert.equal(s.redeemCode(d, "signin"), null);
});

test("verifying spends the account's other verification links", async () => {
    const s = await fresh();
    const a = s.createAccount({ email: "two@example.com" }, { pending: true });
    const first = s.issueCode(a.id, "verify"), second = s.issueCode(a.id, "verify");
    assert.ok(s.redeemCode(second, "verify"));
    assert.equal(s.redeemCode(first, "verify"), null);
});

test("a pending account cannot authenticate, sign in by link, or keep a session", async () => {
    const s = await fresh();
    const a = s.createAccount({ email: "pend@example.com" }, { pending: true });
    assert.equal(a.status, "pending");
    assert.equal(a.verified_at, null);
    const t = s.issueToken(a.id);   // (none is issued before verification; even if one were)
    assert.deepEqual(s.authenticate(t.token), { disabled: true, pending: true });
    assert.equal(s.redeemCode(s.issueCode(a.id, "signin"), "signin"), null);
    assert.equal(s.sessionAccount(s.createSession(a.id)), null);
    s.verifyAccount(a.id);
    assert.equal(s.authenticate(t.token).account.id, a.id);
    assert.equal(s.verifyAccount(a.id), false, "only once");
});

test("mail limit: at most RC_MAIL_PER_HOUR codes per account per hour", async () => {
    const s = await fresh();
    const a = s.createAccount({ email: "lim@example.com" }, { pending: true });
    for (let i = 0; i < 3; i++) { assert.ok(s.canMail(a.id)); s.issueCode(a.id, "verify"); }
    assert.equal(s.canMail(a.id), false);
    s.db.prepare("UPDATE codes SET created = '2000-01-01T00:00:00.000Z'").run();
    assert.ok(s.canMail(a.id), "an hour later");
    const s5 = await fresh({ RC_MAIL_PER_HOUR: "5" });
    const b = s5.createAccount({ email: "five@example.com" });
    for (let i = 0; i < 4; i++) s5.issueCode(b.id, "signin");
    assert.ok(s5.canMail(b.id));
});

test("pending accounts: deleted after 7 days (never a verified one), admin delete", async () => {
    const s = await fresh();
    const old = s.createAccount({ email: "old@example.com" }, { pending: true });
    const recent = s.createAccount({ email: "new@example.com" }, { pending: true });
    const real = s.createAccount({ email: "real@example.com" });
    s.issueCode(old.id, "verify");
    s.db.prepare("UPDATE accounts SET created = '2000-01-01T00:00:00.000Z' WHERE id IN (?, ?)").run(old.id, real.id);
    assert.equal(s.listAccounts().find((x) => x.id === old.id).stale, true);
    assert.equal(s.cleanup(), 1);
    assert.equal(s.getAccount(old.id), null);
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM codes WHERE account_id = ?").get(old.id).n, 0);
    assert.ok(s.getAccount(real.id));
    assert.equal(s.deletePending(real.id), false);
    assert.equal(s.deletePending(recent.id), true);
});

test("migration from schema 1: existing accounts are grandfathered as verified", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rc-mig-"));
    try {
        const file = path.join(dir, "rc.db");
        const { DatabaseSync } = await import("node:sqlite");
        const v1 = new DatabaseSync(file);
        v1.exec(`CREATE TABLE accounts (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL DEFAULT '',
                    created TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')), is_admin INTEGER NOT NULL DEFAULT 0);
                 CREATE TABLE tokens (id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, label TEXT NOT NULL DEFAULT '',
                    hash TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL, created TEXT NOT NULL, last_used TEXT, revoked TEXT);
                 CREATE TABLE sessions (hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL, created TEXT NOT NULL, expires TEXT NOT NULL);
                 CREATE TABLE calls (id INTEGER PRIMARY KEY, ts TEXT NOT NULL, account_id INTEGER NOT NULL, token_id INTEGER,
                    server TEXT NOT NULL, tool TEXT NOT NULL, ms INTEGER NOT NULL, ok INTEGER NOT NULL, error TEXT, summary TEXT);
                 CREATE TABLE pages (id TEXT PRIMARY KEY, account_id INTEGER NOT NULL, created TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', url TEXT);
                 INSERT INTO accounts (email, name, created, status) VALUES ('early@example.com', 'E', '2026-01-01T00:00:00.000Z', 'active'),
                    ('off@example.com', '', '2026-01-02T00:00:00.000Z', 'disabled');
                 PRAGMA user_version = 1;`);
        v1.close();
        const s = await openAccounts(file);
        assert.equal(s.db.prepare("PRAGMA user_version").get().user_version, 10);
        const e = s.findAccount("early@example.com");
        assert.equal(e.status, "active");
        assert.equal(e.verified_at, "2026-01-01T00:00:00.000Z");
        assert.equal(s.findAccount("off@example.com").status, "disabled");
        assert.equal(s.createAccount({ email: "later@example.com" }, { pending: true }).status, "pending");
        s.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("email verify switch and address normalising", () => {
    assert.equal(emailVerify({}), true);
    assert.equal(emailVerify({ RC_EMAIL_VERIFY: "off" }), false);
    assert.equal(Accounts.normalizeEmail(" A@B.co "), "a@b.co");
    assert.equal(Accounts.normalizeEmail("nope"), null);
});

test("name: a label (names may repeat), cleared only when nothing is posted", async () => {
    const s = await fresh();
    const a = s.createAccount({ email: "pa@example.com" });
    const b = s.createAccount({ email: "pb@example.com" });
    assert.equal(s.setName(a.id, "  Ada   Lovelace "), "Ada Lovelace");
    assert.equal(s.getAccount(a.id).name, "Ada Lovelace");
    assert.equal(s.setName(b.id, "ada lovelace"), "ada lovelace", "another account may have the same name");
    assert.throws(() => s.setName(b.id, "x".repeat(41)), /at most 40/);
    assert.throws(() => s.setName(b.id, "a\u200bb"), /invisible/);
    assert.equal(s.setName(b.id, "<b>Émile</b>"), "<b>Émile</b>", "stored as typed; pages escape it");
    s.recordPage({ id: "p".repeat(22), accountId: a.id, title: "Clock", url: "https://x/pages/p/" });
    s.streamPost({ pageId: "p".repeat(22), account: s.getAccount(a.id), title: "My clock" });
    assert.throws(() => s.setName(a.id, ""), /remove them first/);
    assert.equal(s.setName(b.id, ""), "");
});

test("stream: post own pages under a name, sort by new or top, one vote per account", async () => {
    const s = await fresh();
    const a = s.createAccount({ email: "sa@example.com" });
    const b = s.createAccount({ email: "sb@example.com" });
    const c = s.createAccount({ email: "sc@example.com" });
    const [p1, p2, p3] = ["1", "2", "3"].map((d) => d.repeat(22));
    s.recordPage({ id: p1, accountId: a.id, title: "One", url: "https://x/pages/1/" });
    s.recordPage({ id: p2, accountId: a.id, title: "Two", url: "https://x/pages/2/" });
    s.recordPage({ id: p3, accountId: b.id, title: "Three", url: "https://x/pages/3/" });
    assert.throws(() => s.streamPost({ pageId: p1, account: a, title: "One" }), /Set your name/);
    s.setName(a.id, "Ann");
    s.setName(b.id, "Bob");
    assert.throws(() => s.streamPost({ pageId: p3, account: s.getAccount(a.id), title: "Not mine" }), /own pages/);
    assert.throws(() => s.streamPost({ pageId: "9".repeat(22), account: s.getAccount(a.id), title: "x" }), /not published/);
    assert.throws(() => s.streamPost({ pageId: p1, account: s.getAccount(a.id), title: "   " }), /name/);
    s.streamPost({ pageId: p1, account: s.getAccount(a.id), title: "First" });
    s.db.prepare("UPDATE stream SET created = ? WHERE page_id = ?").run("2026-01-01T00:00:00.000Z", p1);
    s.streamPost({ pageId: p2, account: s.getAccount(a.id), title: "Second" });
    s.db.prepare("UPDATE stream SET created = ? WHERE page_id = ?").run("2026-01-02T00:00:00.000Z", p2);
    s.streamPost({ pageId: p3, account: s.getAccount(b.id), title: "Third" });
    assert.deepEqual(s.streamItems().map((i) => i.title), ["Third", "Second", "First"]);
    // Votes: +1 / -1, a second vote replaces the first, 0 takes it back.
    assert.equal(s.vote(p1, b.id, 1), true);
    assert.equal(s.vote(p1, c.id, 1), true);
    assert.equal(s.vote(p2, b.id, -1), true);
    assert.equal(s.vote(p2, b.id, 1), true);
    assert.equal(s.vote(p3, c.id, -1), true);
    assert.equal(s.vote("9".repeat(22), b.id, 1), false, "not in the stream");
    assert.throws(() => s.vote(p1, b.id, 2), /\+1 or -1/);
    const top = s.streamItems({ sort: "top", viewerId: b.id });
    assert.deepEqual(top.map((i) => [i.title, i.score, i.ups, i.downs, i.my_vote]),
        [["First", 2, 2, 0, 1], ["Second", 1, 1, 0, 1], ["Third", -1, 0, 1, 0]]);
    assert.equal(top[0].author, "Ann");
    assert.equal(top[0].url, "https://x/pages/1/");
    s.vote(p1, c.id, 0);
    assert.equal(s.streamItem(p1, c.id).score, 1);
    assert.equal(s.streamItem(p1, c.id).my_vote, 0);
    // Renaming keeps the votes; unpublishing a page takes it (and its votes) out.
    s.streamPost({ pageId: p1, account: s.getAccount(a.id), title: "First, renamed" });
    assert.equal(s.streamItem(p1).title, "First, renamed");
    assert.equal(s.streamItem(p1).score, 1);
    s.deletePage(p1);
    assert.equal(s.streamItem(p1), null);
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM votes WHERE page_id = ?").get(p1).n, 0);
    assert.deepEqual(s.streamOf(a.id).map((i) => i.title), ["Second"]);
    // The public name follows a rename.
    s.setName(a.id, "Annie");
    assert.equal(s.streamItem(p2).author, "Annie");
});

test("stream: a daily limit per account (admins exempt)", async () => {
    const s = await fresh();
    const a = s.createAccount({ email: "lim@example.com" });
    s.setName(a.id, "Lim");
    for (let i = 0; i < 11; i++) s.recordPage({ id: String(i).padStart(22, "x"), accountId: a.id, title: `P${i}` });
    for (let i = 0; i < 10; i++) s.streamPost({ pageId: String(i).padStart(22, "x"), account: s.getAccount(a.id), title: `P${i}` });
    assert.throws(() => s.streamPost({ pageId: "10".padStart(22, "x"), account: s.getAccount(a.id), title: "P10" }), /last day/);
    s.streamPost({ pageId: "10".padStart(22, "x"), account: { ...s.getAccount(a.id), admin: true }, title: "P10" });
    assert.equal(s.streamCount(), 11);
});

test("schema 10 migrates a version 7 database", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rc-acc-"));
    const file = path.join(dir, "rc.db");
    try {
        let s = await openAccounts(file);
        const a = s.createAccount({ email: "old@example.com" });
        // Back to 7: drop what 8 added.
        s.db.exec("DROP TABLE stream; DROP TABLE votes; PRAGMA user_version = 7;");
        s.close();
        s = await openAccounts(file);
        assert.equal(s.db.prepare("PRAGMA user_version").get().user_version, 10);
        assert.equal(s.setName(a.id, "Old"), "Old");
        assert.equal(s.getAccount(a.id).name, "Old");
        assert.equal(s.streamCount(), 0);
        s.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("showcases: an admin's mark on a stream item, newest mark first; gone with the item", async () => {
    const s = await fresh();
    const a = s.createAccount({ email: "f@example.com", name: "F" });
    const [p1, p2] = ["d", "e"].map((c) => c.repeat(22));
    for (const id of [p1, p2]) { s.recordPage({ id, accountId: a.id, title: id, url: `https://x/pages/${id}/` }); s.streamPost({ pageId: id, account: a, title: id }); }
    assert.deepEqual(s.featuredItems(), []);
    assert.equal(s.streamFeature(p1, true), true);
    s.db.prepare("UPDATE stream SET featured = ? WHERE page_id = ?").run("2026-01-01T00:00:00.000Z", p1);
    assert.equal(s.streamFeature(p2, true), true);
    assert.deepEqual(s.featuredItems().map((i) => i.page_id), [p2, p1]);
    assert.ok(s.streamItem(p1).featured);
    assert.equal(s.streamFeature("9".repeat(22), true), false, "not in the stream");
    assert.equal(s.streamFeature(p2, false), true);
    assert.equal(s.streamItem(p2).featured, null);
    s.streamRemove(p1);
    assert.deepEqual(s.featuredItems(), []);
});

test("app scripts: off by default, per account", async () => {
    const s = await fresh();
    const a = s.createAccount({ email: "sc@example.com" });
    assert.equal(s.getAccount(a.id).scripts, false);
    s.setScripts(a.id, true);
    assert.equal(s.getAccount(a.id).scripts, true);
    const t = s.issueToken(a.id);
    assert.equal(s.authenticate(t.token).account.scripts, true, "the token's account carries it");
    s.setScripts(a.id, false);
    assert.equal(s.getAccount(a.id).scripts, false);
});
