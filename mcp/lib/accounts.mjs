// Accounts, per-user tokens, web sessions, usage and page ownership, in one small SQLite file
// shared by every server process (node:sqlite, built in since Node 22.13: no npm install).
//
//   RC_DB         the database file (default <MCP_ROOT>/rc.db; none without MCP_ROOT)
//   RC_ACCOUNTS=1 turn accounts on (they are also on whenever the database file exists)
//   RC_SIGNUP=closed      the website refuses new registrations
//   RC_ADMIN_EMAILS=a,b   these accounts are admins (set on creation and on sign-in)
//
// Secrets are never stored: a token ("rc_" + 32 random bytes, base64url) and a session id are
// kept as their SHA-256, and a token's first characters as a visible prefix for lists. A token
// is checked by looking its hash up (an index lookup: nothing to time). Every query is
// parameterised.

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const SCHEMA_VERSION = 1;
const SESSION_DAYS = 30;
const LAST_USED_EVERY_MS = 60_000;

const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");
const now = () => new Date().toISOString();
const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[^\s@<>"]{2,}$/;

/** The database file the environment names, or null (accounts are then off). */
export function dbPath(env = process.env) {
    if (env.RC_DB) return path.resolve(env.RC_DB);
    return env.MCP_ROOT ? path.join(path.resolve(env.MCP_ROOT), "rc.db") : null;
}

/** Accounts are on with RC_ACCOUNTS=1 (and a place for the database), or when the database exists. */
export function accountsEnabled(env = process.env) {
    const file = dbPath(env);
    if (!file || env.RC_ACCOUNTS === "0") return false;
    return env.RC_ACCOUNTS === "1" || existsSync(file);
}

export const signupOpen = (env = process.env) => env.RC_SIGNUP !== "closed";

const adminEmails = (env) => new Set(String(env.RC_ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));

/** The MCP_TOKEN holder: an admin with no row of its own (account id 0). */
export const ADMIN_KEY_ACCOUNT = Object.freeze({ id: 0, email: "admin key (MCP_TOKEN)", name: "Admin key", admin: true, tokenId: null });

export class Accounts {
    /** file: a path, or ":memory:" (tests). env: where RC_ADMIN_EMAILS is read from. */
    constructor(file, { env = process.env, DatabaseSync } = {}) {
        if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
        this.env = env;
        this.db = new DatabaseSync(file);
        // (busy_timeout first: every server process opens the file at start, at the same moment.)
        this.db.exec("PRAGMA busy_timeout = 5000;");
        if (file !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL;");
        this.db.exec("PRAGMA synchronous = NORMAL;");
        this.migrate();
        this.lastUsed = new Map();   // token id -> when this process last wrote last_used
    }

    /** Brings the schema up to SCHEMA_VERSION (PRAGMA user_version), in one write transaction. */
    migrate() {
        if (this.db.prepare("PRAGMA user_version").get().user_version >= SCHEMA_VERSION) return;
        this.db.exec("BEGIN IMMEDIATE");
        try { this.#migrate(); this.db.exec("COMMIT"); } catch (e) { this.db.exec("ROLLBACK"); throw e; }
    }

    #migrate() {
        const v = this.db.prepare("PRAGMA user_version").get().user_version;
        if (v < 1) {
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS accounts (
                    id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL DEFAULT '',
                    created TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
                    is_admin INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS tokens (
                    id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, label TEXT NOT NULL DEFAULT '',
                    hash TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL, created TEXT NOT NULL, last_used TEXT, revoked TEXT);
                CREATE INDEX IF NOT EXISTS tokens_account ON tokens(account_id);
                CREATE TABLE IF NOT EXISTS sessions (
                    hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL, created TEXT NOT NULL, expires TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS calls (
                    id INTEGER PRIMARY KEY, ts TEXT NOT NULL, account_id INTEGER NOT NULL, token_id INTEGER,
                    server TEXT NOT NULL, tool TEXT NOT NULL, ms INTEGER NOT NULL, ok INTEGER NOT NULL, error TEXT, summary TEXT);
                CREATE INDEX IF NOT EXISTS calls_account_ts ON calls(account_id, ts);
                CREATE TABLE IF NOT EXISTS pages (
                    id TEXT PRIMARY KEY, account_id INTEGER NOT NULL, created TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', url TEXT);
                CREATE INDEX IF NOT EXISTS pages_account ON pages(account_id);
            `);
        }
        // (Later migrations: `if (v < 2) { ALTER TABLE ... }`, then bump SCHEMA_VERSION.)
        if (v < SCHEMA_VERSION) this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }

    close() { this.db.close(); }

    // --- accounts

    #row(r) {
        return r ? { id: r.id, email: r.email, name: r.name, created: r.created, status: r.status, admin: !!r.is_admin } : null;
    }

    getAccount(id) { return this.#row(this.db.prepare("SELECT * FROM accounts WHERE id = ?").get(id)); }
    findAccount(email) { return this.#row(this.db.prepare("SELECT * FROM accounts WHERE email = ?").get(String(email ?? "").trim())); }

    /** A new account; throws a message meant for the person registering. */
    createAccount({ email, name = "" }) {
        email = String(email ?? "").trim().toLowerCase();
        name = String(name ?? "").trim().slice(0, 80);
        if (!EMAIL.test(email) || email.length > 254) throw new Error("That does not look like an email address.");
        if (this.findAccount(email)) throw new Error("An account with that email already exists: sign in with one of its tokens.");
        const admin = adminEmails(this.env).has(email) ? 1 : 0;
        const r = this.db.prepare("INSERT INTO accounts (email, name, created, is_admin) VALUES (?, ?, ?, ?)").run(email, name, now(), admin);
        return this.getAccount(Number(r.lastInsertRowid));
    }

    /** Re-reads RC_ADMIN_EMAILS for an account (on sign-in): promotes, never demotes. */
    refreshAdmin(account) {
        if (account && !account.admin && adminEmails(this.env).has(account.email.toLowerCase())) {
            this.db.prepare("UPDATE accounts SET is_admin = 1 WHERE id = ?").run(account.id);
            return this.getAccount(account.id);
        }
        return account;
    }

    setStatus(id, status) {
        if (status !== "active" && status !== "disabled") throw new Error("status is active or disabled");
        this.db.prepare("UPDATE accounts SET status = ? WHERE id = ?").run(status, id);
        if (status === "disabled") this.db.prepare("DELETE FROM sessions WHERE account_id = ?").run(id);
    }

    /** Every account with its active tokens and its calls over the last `days` days. */
    listAccounts(days = 7) {
        const since = new Date(Date.now() - days * 86400_000).toISOString();
        return this.db.prepare(`
            SELECT a.*, (SELECT COUNT(*) FROM tokens t WHERE t.account_id = a.id AND t.revoked IS NULL) AS tokens,
                   (SELECT COUNT(*) FROM calls c WHERE c.account_id = a.id AND c.ts >= ?) AS calls
            FROM accounts a ORDER BY a.created DESC`).all(since)
            .map((r) => ({ ...this.#row(r), tokens: r.tokens, calls: r.calls }));
    }

    // --- tokens

    /** A new token for the account: {id, token, prefix}. The token itself is returned once, never stored. */
    issueToken(accountId, label = "") {
        const token = "rc_" + randomBytes(32).toString("base64url");
        const prefix = token.slice(0, 10);
        label = String(label ?? "").trim().slice(0, 60) || "token";
        const r = this.db.prepare("INSERT INTO tokens (account_id, label, hash, prefix, created) VALUES (?, ?, ?, ?, ?)")
            .run(accountId, label, sha256(token), prefix, now());
        return { id: Number(r.lastInsertRowid), token, prefix, label };
    }

    listTokens(accountId) {
        return this.db.prepare("SELECT id, label, prefix, created, last_used, revoked FROM tokens WHERE account_id = ? ORDER BY created DESC, id DESC")
            .all(accountId).map((r) => ({ ...r }));
    }

    /** Revokes one of the account's tokens; false when it has no such (unrevoked) token. */
    revokeToken(accountId, tokenId) {
        return this.db.prepare("UPDATE tokens SET revoked = ? WHERE id = ? AND account_id = ? AND revoked IS NULL")
            .run(now(), Number(tokenId), accountId).changes > 0;
    }

    /**
     * Who a token belongs to: {account, tokenId}, {disabled: true} for a disabled account's
     * token, or null (unknown or revoked). Marks the token used, at most once a minute.
     */
    authenticate(token) {
        if (typeof token !== "string" || !token.startsWith("rc_") || token.length > 100) return null;
        const r = this.db.prepare(`SELECT t.id AS token_id, t.revoked, a.* FROM tokens t JOIN accounts a ON a.id = t.account_id WHERE t.hash = ?`)
            .get(sha256(token));
        if (!r || r.revoked) return null;
        if (r.status !== "active") return { disabled: true };
        this.touchToken(r.token_id);
        return { account: this.#row(r), tokenId: r.token_id };
    }

    touchToken(tokenId) {
        const t = Date.now();
        if (t - (this.lastUsed.get(tokenId) ?? 0) < LAST_USED_EVERY_MS) return;
        this.lastUsed.set(tokenId, t);
        const cutoff = new Date(t - LAST_USED_EVERY_MS).toISOString();
        try {
            this.db.prepare("UPDATE tokens SET last_used = ? WHERE id = ? AND (last_used IS NULL OR last_used < ?)")
                .run(new Date(t).toISOString(), tokenId, cutoff);
        } catch { /* busy: the next call will do */ }
    }

    // --- web sessions

    /** A new session id for the account (the cookie value; stored hashed). */
    createSession(accountId, days = SESSION_DAYS) {
        const sid = randomBytes(32).toString("base64url");
        const t = Date.now();
        this.db.prepare("DELETE FROM sessions WHERE expires < ?").run(new Date(t).toISOString());
        this.db.prepare("INSERT INTO sessions (hash, account_id, created, expires) VALUES (?, ?, ?, ?)")
            .run(sha256(sid), accountId, new Date(t).toISOString(), new Date(t + days * 86400_000).toISOString());
        return sid;
    }

    /** The active account a session id belongs to, or null (unknown, expired, disabled). */
    sessionAccount(sid) {
        if (typeof sid !== "string" || !sid || sid.length > 100) return null;
        const r = this.db.prepare("SELECT s.expires, a.* FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.hash = ?").get(sha256(sid));
        if (!r || r.expires < now() || r.status !== "active") return null;
        return this.#row(r);
    }

    deleteSession(sid) {
        if (typeof sid === "string" && sid) this.db.prepare("DELETE FROM sessions WHERE hash = ?").run(sha256(sid));
    }

    // --- usage

    recordCall({ accountId, tokenId = null, server, tool, ms, ok, error = null, summary = null }) {
        this.db.prepare("INSERT INTO calls (ts, account_id, token_id, server, tool, ms, ok, error, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run(now(), accountId, tokenId, String(server), String(tool), Math.round(ms), ok ? 1 : 0,
                error == null ? null : String(error).split("\n")[0].slice(0, 300),
                summary == null ? null : String(summary).slice(0, 1000));
    }

    /** The account's calls over the last `days` days: per day (oldest first, every day), per tool, per server, recent errors. */
    usage(accountId, days = 30) {
        const sinceDate = new Date(Date.now() - (days - 1) * 86400_000).toISOString().slice(0, 10);
        const q = (sql) => this.db.prepare(sql).all(accountId, sinceDate).map((r) => ({ ...r }));
        const perDay = new Map(q(`SELECT substr(ts, 1, 10) AS day, COUNT(*) AS calls, SUM(1 - ok) AS errors
            FROM calls WHERE account_id = ? AND ts >= ? GROUP BY day`).map((r) => [r.day, r]));
        const byDay = [];
        for (let i = days - 1; i >= 0; i--) {
            const day = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
            byDay.push(perDay.get(day) ?? { day, calls: 0, errors: 0 });
        }
        const group = (col) => q(`SELECT ${col} AS name, COUNT(*) AS calls, SUM(1 - ok) AS errors, CAST(AVG(ms) AS INTEGER) AS avg_ms
            FROM calls WHERE account_id = ? AND ts >= ? GROUP BY ${col} ORDER BY calls DESC, name`);
        const byTool = group("server || ' · ' || tool");
        const byServer = group("server");
        const errors = this.db.prepare(`SELECT ts, server, tool, error FROM calls WHERE account_id = ? AND ts >= ? AND ok = 0 ORDER BY ts DESC LIMIT 10`)
            .all(accountId, sinceDate).map((r) => ({ ...r }));
        const total = byDay.reduce((n, d) => n + d.calls, 0);
        return { days, total, errorCount: byDay.reduce((n, d) => n + d.errors, 0), byDay, byTool, byServer, errors };
    }

    // --- published pages

    recordPage({ id, accountId, title = "", url = null }) {
        this.db.prepare("INSERT OR REPLACE INTO pages (id, account_id, created, title, url) VALUES (?, ?, ?, ?, ?)")
            .run(String(id), accountId, now(), String(title).slice(0, 200), url);
    }

    /** The account's pages, newest first (all pages with `all`). */
    pagesOf(accountId, { all = false } = {}) {
        const rows = all ? this.db.prepare("SELECT * FROM pages ORDER BY created DESC").all()
            : this.db.prepare("SELECT * FROM pages WHERE account_id = ? ORDER BY created DESC").all(accountId);
        return rows.map((r) => ({ ...r }));
    }

    /** The owner's account id, or null when the page is not recorded. */
    pageOwner(id) {
        const r = this.db.prepare("SELECT account_id FROM pages WHERE id = ?").get(String(id));
        return r ? r.account_id : null;
    }

    deletePage(id) { this.db.prepare("DELETE FROM pages WHERE id = ?").run(String(id)); }
}

let shared;   // undefined: not opened yet; null: accounts are off

/**
 * The process's store, opened on first use (so importing a server for its definition opens
 * nothing), or null when accounts are off. Throws when they are on but node:sqlite is missing.
 */
export async function accounts() {
    if (shared !== undefined) return shared;
    if (!accountsEnabled()) return (shared = null);
    let sqlite;
    try { sqlite = await import("node:sqlite"); } catch {
        throw new Error(`accounts need node:sqlite (Node 22.13 or later); this is Node ${process.versions.node}`);
    }
    return (shared = new Accounts(dbPath(), { DatabaseSync: sqlite.DatabaseSync }));
}

/** For tests: a store on an in-memory (or given) database. */
export async function openAccounts(file = ":memory:", env = {}) {
    const { DatabaseSync } = await import("node:sqlite");
    return new Accounts(file, { env, DatabaseSync });
}

// --- the web side's helpers, shared by the account pages and the deploy server's index

export const SESSION_COOKIE = "rc_session";

export function readCookie(req, name = SESSION_COOKIE) {
    for (const part of String(req.headers.cookie ?? "").split(";")) {
        const i = part.indexOf("=");
        if (i > 0 && part.slice(0, i).trim() === name) {
            try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
        }
    }
    return null;
}

/** The signed-in account of a web request (its session cookie), or null. */
export async function requestAccount(req) {
    const store = await accounts();
    const sid = readCookie(req);
    return store && sid ? store.sessionAccount(sid) : null;
}

/** A form's anti-CSRF value, tied to the session (unguessable without the cookie). */
export const csrfFor = (sid) => sha256("csrf|" + sid).slice(0, 32);

/** Fixed-window counter per key (an IP): hit() is false once `limit` is reached in the window. */
export class RateLimiter {
    constructor(limit, windowMs) { this.limit = limit; this.windowMs = windowMs; this.hits = new Map(); }
    hit(key, t = Date.now()) {
        if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (t - v.start >= this.windowMs) this.hits.delete(k);
        let e = this.hits.get(key);
        if (!e || t - e.start >= this.windowMs) this.hits.set(key, (e = { start: t, n: 0 }));
        return ++e.n <= this.limit;
    }
}
