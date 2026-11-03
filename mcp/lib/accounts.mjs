// Accounts, per-user tokens, web sessions, usage and page ownership, in one small SQLite file
// shared by every server process (node:sqlite, built in since Node 22.13: no npm install).
//
//   RC_DB         the database file (default <MCP_ROOT>/rc.db; none without MCP_ROOT)
//   RC_ACCOUNTS=1 turn accounts on (they are also on whenever the database file exists)
//   RC_SIGNUP=closed      the website refuses new registrations
//   RC_ADMIN_EMAILS=a,b   these accounts are admins (set on creation and on sign-in)
//   RC_EMAIL_VERIFY=off   new accounts are active at once (default: pending until the emailed
//                         link is followed; lib/mail.mjs sends it)
//   RC_MAIL_PER_HOUR      emails (verification, sign-in links) per account per hour (default 3)
//
// Secrets are never stored: a token ("rc_" + 32 random bytes, base64url) and a session id are
// kept as their SHA-256, and a token's first characters as a visible prefix for lists. A token
// is checked by looking its hash up (an index lookup: nothing to time). The one-time codes in
// emailed links likewise (32 random bytes, sha256 stored, single use, an expiry). Every query
// is parameterised.

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { deleteTraceImages } from "./trace-images.mjs";
import { assignThreads } from "./threads.mjs";

const SCHEMA_VERSION = 10;
// Session traces (calls.args / calls.result) are kept this long; the rows themselves stay.
export const TRACE_DAYS = 30;
// OAuth (lib/oauth.mjs): authorization codes, access and refresh tokens.
export const OAUTH_CODE_TTL_MS = 60_000;
export const ACCESS_TTL_MS = 3600_000;
export const REFRESH_TTL_MS = 30 * 86400_000;
export const VERIFY_TTL_MS = 24 * 3600_000;
export const SIGNIN_TTL_MS = 15 * 60_000;
const PENDING_DAYS = 7;
const SESSION_DAYS = 30;
const LAST_USED_EVERY_MS = 60_000;
/** Items an account may post to the stream in a day (RC_STREAM_PER_DAY). */
const STREAM_PER_DAY = Number(process.env.RC_STREAM_PER_DAY ?? 10);

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
export const emailVerify = (env = process.env) => env.RC_EMAIL_VERIFY !== "off";

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
        if (v < 2) {
            // A 'pending' status (registered, email not yet verified) and verified_at. SQLite
            // cannot change a CHECK in place: the table is rebuilt. Accounts made before
            // verification existed count as verified (at their creation).
            this.db.exec(`
                CREATE TABLE accounts_v2 (
                    id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL DEFAULT '',
                    created TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'disabled')),
                    is_admin INTEGER NOT NULL DEFAULT 0, verified_at TEXT);
                INSERT INTO accounts_v2 (id, email, name, created, status, is_admin, verified_at)
                    SELECT id, email, name, created, status, is_admin, created FROM accounts;
                DROP TABLE accounts;
                ALTER TABLE accounts_v2 RENAME TO accounts;
                CREATE TABLE IF NOT EXISTS codes (
                    hash TEXT PRIMARY KEY, account_id INTEGER NOT NULL, purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'signin')),
                    created TEXT NOT NULL, expires TEXT NOT NULL, used TEXT);
                CREATE INDEX IF NOT EXISTS codes_account ON codes(account_id, created);
            `);
        }
        if (v < 3) {
            // OAuth 2.1 (the MCP authorization spec): clients registered dynamically, one-time
            // authorization codes, a grant per (account, client) consent, and its tokens. A call
            // made with an OAuth token is attributed to its grant (calls.grant_id).
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS oauth_clients (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', redirect_uris TEXT NOT NULL, created TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS oauth_codes (
                    hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, account_id INTEGER NOT NULL, redirect_uri TEXT NOT NULL,
                    challenge TEXT NOT NULL, resource TEXT, scope TEXT NOT NULL DEFAULT 'mcp',
                    created TEXT NOT NULL, expires TEXT NOT NULL, used TEXT, grant_id INTEGER);
                CREATE TABLE IF NOT EXISTS oauth_grants (
                    id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, client_id TEXT NOT NULL, resource TEXT,
                    scope TEXT NOT NULL DEFAULT 'mcp', created TEXT NOT NULL, revoked TEXT, last_used TEXT);
                CREATE INDEX IF NOT EXISTS oauth_grants_account ON oauth_grants(account_id);
                CREATE TABLE IF NOT EXISTS oauth_tokens (
                    hash TEXT PRIMARY KEY, grant_id INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
                    created TEXT NOT NULL, expires TEXT NOT NULL, revoked TEXT);
                CREATE INDEX IF NOT EXISTS oauth_tokens_grant ON oauth_tokens(grant_id);
                ALTER TABLE calls ADD COLUMN grant_id INTEGER;
            `);
        }
        if (v < 4) {
            // The session trace: the MCP session a call belongs to (ctx.client) and the call in
            // full (arguments as JSON, the result's text), each capped at 20 KB (lib/calllog.mjs).
            this.db.exec(`
                ALTER TABLE calls ADD COLUMN client TEXT;
                ALTER TABLE calls ADD COLUMN args TEXT;
                ALTER TABLE calls ADD COLUMN result TEXT;
                CREATE INDEX IF NOT EXISTS calls_account_client ON calls(account_id, client, ts);
            `);
        }
        if (v < 5) {
            // The pictures a call returned, kept as files (lib/trace-images.mjs): {files, skipped}.
            this.db.exec("ALTER TABLE calls ADD COLUMN images TEXT;");
        }
        if (v < 6) {
            // The input files a call read, as they were then (lib/calllog.mjs traceFiles): {arg: {path, sha, bytes}}.
            this.db.exec("ALTER TABLE calls ADD COLUMN files TEXT;");
        }
        if (v < 7) {
            // Telling conversations apart (lib/threads.mjs): what the client sent (header names,
            // hashed id-like values, _meta keys, clientInfo), the thread when an id decided it,
            // and the files the call touched (for lineage, decided when the session is shown).
            this.db.exec(`
                ALTER TABLE calls ADD COLUMN meta TEXT;
                ALTER TABLE calls ADD COLUMN thread TEXT;
                ALTER TABLE calls ADD COLUMN thread_how TEXT;
                ALTER TABLE calls ADD COLUMN touched TEXT;
            `);
        }
        if (v < 8) {
            // The stream (lib/stream-web.mjs): the pages posted to it under a name (shown with the
            // account's name), and one vote (+1 or -1) per account per item.
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS stream (
                    page_id TEXT PRIMARY KEY, account_id INTEGER NOT NULL, title TEXT NOT NULL, created TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS stream_created ON stream(created);
                CREATE INDEX IF NOT EXISTS stream_account ON stream(account_id);
                CREATE TABLE IF NOT EXISTS votes (
                    page_id TEXT NOT NULL, account_id INTEGER NOT NULL, value INTEGER NOT NULL CHECK (value IN (-1, 1)),
                    created TEXT NOT NULL, PRIMARY KEY (page_id, account_id));
            `);
        }
        if (v < 9) {
            // An admin's mark on a stream item: shown on the Showcases page (when, so the newest first).
            // (Only if missing: a database put back to an older version still has it.)
            if (!this.db.prepare("PRAGMA table_info(stream)").all().some((c) => c.name === "featured")) {
                this.db.exec("ALTER TABLE stream ADD COLUMN featured TEXT;");
            }
        }
        if (v < 10) {
            // App scripts (lib/app-script.mjs) are opt-in per account: the MCP tools offer them
            // only to accounts that turned them on.
            if (!this.db.prepare("PRAGMA table_info(accounts)").all().some((c) => c.name === "scripts")) {
                this.db.exec("ALTER TABLE accounts ADD COLUMN scripts INTEGER NOT NULL DEFAULT 0;");
            }
        }
        // (Later migrations: `if (v < 11) { ... }`, then bump SCHEMA_VERSION.)
        if (v < SCHEMA_VERSION) this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }

    close() { this.db.close(); }

    // --- accounts

    #row(r) {
        return r ? { id: r.id, email: r.email, name: r.name, created: r.created, status: r.status, admin: !!r.is_admin,
            verified_at: r.verified_at ?? null, scripts: !!r.scripts } : null;
    }

    getAccount(id) { return this.#row(this.db.prepare("SELECT * FROM accounts WHERE id = ?").get(id)); }
    findAccount(email) { return this.#row(this.db.prepare("SELECT * FROM accounts WHERE email = ?").get(String(email ?? "").trim())); }

    /** The address as accounts store it, or null when it does not look like one. */
    static normalizeEmail(email) {
        email = String(email ?? "").trim().toLowerCase();
        return EMAIL.test(email) && email.length <= 254 ? email : null;
    }

    /**
     * A new account; throws a message meant for the person registering. pending: created
     * 'pending' (it can do nothing until verifyAccount), else active and verified now.
     */
    createAccount({ email, name = "" }, { pending = false } = {}) {
        email = String(email ?? "").trim().toLowerCase();
        name = String(name ?? "").trim().slice(0, 80);
        if (!EMAIL.test(email) || email.length > 254) throw new Error("That does not look like an email address.");
        if (this.findAccount(email)) throw new Error("An account with that email already exists: sign in with one of its tokens.");
        const admin = adminEmails(this.env).has(email) ? 1 : 0;
        const t = now();
        const r = this.db.prepare("INSERT INTO accounts (email, name, created, status, is_admin, verified_at) VALUES (?, ?, ?, ?, ?, ?)")
            .run(email, name, t, pending ? "pending" : "active", admin, pending ? null : t);
        return this.getAccount(Number(r.lastInsertRowid));
    }

    /** A pending account becomes active (verified now); true when it was pending. */
    verifyAccount(id) {
        return this.db.prepare("UPDATE accounts SET status = 'active', verified_at = ? WHERE id = ? AND status = 'pending'").run(now(), id).changes > 0;
    }

    /** Deletes a pending account (never a verified one) and its codes; true when it did. */
    deletePending(id) {
        const ok = this.db.prepare("DELETE FROM accounts WHERE id = ? AND status = 'pending'").run(id).changes > 0;
        if (ok) this.db.prepare("DELETE FROM codes WHERE account_id = ?").run(id);
        return ok;
    }

    /** Deletes the accounts still pending after `days` days, and every code expired a day ago. */
    cleanup(days = PENDING_DAYS) {
        const before = new Date(Date.now() - days * 86400_000).toISOString();
        const ids = this.db.prepare("SELECT id FROM accounts WHERE status = 'pending' AND created < ?").all(before).map((r) => r.id);
        for (const id of ids) this.deletePending(id);
        const dayAgo = new Date(Date.now() - 86400_000).toISOString();
        this.db.prepare("DELETE FROM codes WHERE expires < ?").run(dayAgo);
        this.db.prepare("DELETE FROM oauth_codes WHERE expires < ?").run(dayAgo);
        this.db.prepare("DELETE FROM oauth_tokens WHERE expires < ?").run(dayAgo);
        // Clients registered a month ago that never got a grant (registration is open).
        this.db.prepare("DELETE FROM oauth_clients WHERE created < ? AND id NOT IN (SELECT client_id FROM oauth_grants)")
            .run(new Date(Date.now() - 30 * 86400_000).toISOString());
        // Session traces older than TRACE_DAYS: the bodies and pictures go, the usage rows (and summaries) stay.
        const traceBefore = new Date(Date.now() - TRACE_DAYS * 86400_000).toISOString();
        for (const r of this.db.prepare("SELECT account_id, client, images FROM calls WHERE ts < ? AND images IS NOT NULL").all(traceBefore)) {
            try { deleteTraceImages(r.account_id, r.client, JSON.parse(r.images).files, this.env.MCP_ROOT || this.env.RC_TRACE_DIR ? this.env : process.env); } catch { /* unreadable list */ }
        }
        this.db.prepare("UPDATE calls SET args = NULL, result = NULL, images = NULL WHERE ts < ? AND (args IS NOT NULL OR result IS NOT NULL OR images IS NOT NULL)")
            .run(traceBefore);
        return ids.length;
    }

    // --- one-time codes (the links in emails)

    /** How many codes were made for the account in the last hour (the mail limit counts them). */
    codesLastHour(accountId) {
        return this.db.prepare("SELECT COUNT(*) AS n FROM codes WHERE account_id = ? AND created >= ?")
            .get(accountId, new Date(Date.now() - 3600_000).toISOString()).n;
    }

    /** May another email go to the account this hour? (RC_MAIL_PER_HOUR, default 3.) */
    canMail(accountId) { return this.codesLastHour(accountId) < Number(this.env.RC_MAIL_PER_HOUR ?? 3); }

    /** A new one-time code: 'verify' (24 h) or 'signin' (15 min). Returned once; only its hash is kept. */
    issueCode(accountId, purpose, ttlMs = purpose === "verify" ? VERIFY_TTL_MS : SIGNIN_TTL_MS) {
        if (purpose !== "verify" && purpose !== "signin") throw new Error("purpose is verify or signin");
        const code = randomBytes(32).toString("base64url");
        const t = Date.now();
        this.db.prepare("INSERT INTO codes (hash, account_id, purpose, created, expires) VALUES (?, ?, ?, ?, ?)")
            .run(sha256(code), accountId, purpose, new Date(t).toISOString(), new Date(t + ttlMs).toISOString());
        return code;
    }

    /**
     * Uses a code up: the account it was for, or null (unknown, expired, used, other purpose,
     * or the account cannot take it: disabled; for 'signin', not active). Single use even when
     * two requests race: the UPDATE claims it.
     */
    redeemCode(code, purpose) {
        if (typeof code !== "string" || !code || code.length > 100) return null;
        const t = now();
        const r = this.db.prepare("SELECT account_id FROM codes WHERE hash = ? AND purpose = ? AND used IS NULL AND expires > ?").get(sha256(code), purpose, t);
        if (!r) return null;
        if (this.db.prepare("UPDATE codes SET used = ? WHERE hash = ? AND used IS NULL").run(t, sha256(code)).changes !== 1) return null;
        const a = this.getAccount(r.account_id);
        if (!a || a.status === "disabled" || (purpose === "signin" && a.status !== "active")) return null;
        if (purpose === "verify") {
            this.verifyAccount(a.id);
            // The other verification links of the account are spent with it.
            this.db.prepare("UPDATE codes SET used = ? WHERE account_id = ? AND purpose = 'verify' AND used IS NULL").run(t, a.id);
            return this.getAccount(a.id);
        }
        return a;
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
            .map((r) => ({ ...this.#row(r), tokens: r.tokens, calls: r.calls,
                stale: r.status === "pending" && r.created < new Date(Date.now() - PENDING_DAYS * 86400_000).toISOString() }));
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
        if (r.status !== "active") return { disabled: true, pending: r.status === "pending" };
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

    recordCall({ accountId, tokenId = null, grantId = null, server, tool, ms, ok, error = null, summary = null,
                 client = null, args = null, result = null, files = null, meta = null, thread = null, threadHow = null,
                 touched = null, ts = now() }) {
        const cap = (v) => (v == null ? null : String(v).slice(0, 20 << 10));
        const js = (v, n) => (v == null ? null : (typeof v === "string" ? v : JSON.stringify(v)).slice(0, n));
        return Number(this.db.prepare(`INSERT INTO calls (ts, account_id, token_id, grant_id, server, tool, ms, ok, error, summary, client, args, result, files,
                meta, thread, thread_how, touched)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(ts, accountId, tokenId, grantId, String(server), String(tool), Math.round(ms), ok ? 1 : 0,
                error == null ? null : String(error).split("\n")[0].slice(0, 300),
                summary == null ? null : String(summary).slice(0, 1000),
                client == null ? null : String(client).slice(0, 40), cap(args), cap(result),
                files == null ? null : String(files).slice(0, 4000),
                js(meta, 8000), thread == null ? null : String(thread).slice(0, 80), threadHow == null ? null : String(threadHow).slice(0, 80),
                js(touched, 4000)).lastInsertRowid);
    }

    /** The pictures a call returned ({files, skipped}, lib/trace-images.mjs). */
    setCallImages(callId, images) {
        this.db.prepare("UPDATE calls SET images = ? WHERE id = ?").run(images ? JSON.stringify(images) : null, Number(callId));
    }

    /** Is `file` one of the pictures of a call in this account's session? (The image route's check.) */
    sessionHasImage(accountId, client, file) {
        const m = /^(\d+)-\d+\.png$/.exec(String(file));
        if (!m) return false;
        const r = this.db.prepare("SELECT images FROM calls WHERE id = ? AND account_id = ? AND client = ?").get(Number(m[1]), accountId, String(client));
        try { return Boolean(r && JSON.parse(r.images ?? "{}")?.files?.includes(file)); } catch { return false; }
    }

    // --- sessions (one MCP session = the calls sharing calls.client)

    /** What a call came through: an app ("via Claude"), a token ("token: laptop") or the admin key. */
    #viaSql() {
        return `CASE WHEN c.grant_id IS NOT NULL THEN 'via ' || COALESCE(NULLIF(k.name, ''), 'an app')
                     WHEN c.token_id IS NOT NULL THEN 'token: ' || COALESCE(t.label, '?') ELSE 'admin key' END`;
    }

    /** The account's sessions over the last `days` days, most recent first: started, ended, calls, errors, tools, via. */
    sessions(accountId, { days = TRACE_DAYS, limit = 50 } = {}) {
        const since = new Date(Date.now() - days * 86400_000).toISOString();
        const rows = this.db.prepare(`SELECT c.id, c.client, c.ts, c.ms, c.ok, c.tool, c.thread, c.thread_how, c.touched, ${this.#viaSql()} AS via
            FROM calls c LEFT JOIN tokens t ON t.id = c.token_id LEFT JOIN oauth_grants g ON g.id = c.grant_id
                LEFT JOIN oauth_clients k ON k.id = g.client_id
            WHERE c.account_id = ? AND c.ts >= ? AND c.client IS NOT NULL ORDER BY c.ts`).all(accountId, since);
        // A session split by an id the client sent (_meta, a header) lists each conversation as its own
        // row (linking to ?thread=); a split by lineage or time stays one row that says how many threads.
        const byClient = new Map();
        for (const r of rows) byClient.set(r.client, [...(byClient.get(r.client) ?? []), r]);
        const by = new Map();
        for (const [client, list] of byClient) {
            const calls = list.map((r) => { const end = Date.parse(r.ts); return { ...r, end, start: end - r.ms, how: r.thread_how, touched: parseJson(r.touched) ?? [] }; })
                .sort((a, b) => a.start - b.start || a.id - b.id);
            const threads = assignThreads(calls);
            calls.forEach((r, i) => {
                const byId = /^(meta|header):/.test(threads[i].how);
                const key = byId ? `${client}#${threads[i].thread}` : client;
                let s = by.get(key);
                if (!s) by.set(key, (s = { client, thread: byId ? threads[i].thread : null, threadHow: byId ? threads[i].how : null,
                    start: r.start, end: r.end, calls: 0, errors: 0, tools: {}, via: r.via, threadSet: new Set() }));
                s.start = Math.min(s.start, r.start); s.end = Math.max(s.end, r.end);
                s.calls++; s.errors += r.ok ? 0 : 1;
                s.tools[r.tool] = (s.tools[r.tool] ?? 0) + 1;
                s.threadSet.add(threads[i].thread);
            });
        }
        return [...by.values()].sort((a, b) => b.end - a.end).slice(0, limit)
            .map(({ threadSet, ...s }) => ({ ...s, threads: threadSet.size, started: new Date(s.start).toISOString(), ended: new Date(s.end).toISOString(), duration_ms: s.end - s.start }));
    }

    /** One session's calls in order (at most `limit`), with start times and the gap since the previous call ended. */
    sessionCalls(accountId, client, { limit = 1000 } = {}) {
        const rows = this.db.prepare(`SELECT c.id, c.ts, c.server, c.tool, c.ms, c.ok, c.error, c.args, c.result, c.images, c.files,
                c.meta, c.thread, c.thread_how, c.touched, ${this.#viaSql()} AS via
            FROM calls c LEFT JOIN tokens t ON t.id = c.token_id LEFT JOIN oauth_grants g ON g.id = c.grant_id
                LEFT JOIN oauth_clients k ON k.id = g.client_id
            WHERE c.account_id = ? AND c.client = ? ORDER BY c.ts, c.id LIMIT ?`).all(accountId, String(client), limit);
        // In start order; each call's thread (lib/threads.mjs) and the gaps: since the previous call
        // of the session ended, and since the previous call of its own thread ended (the thinking).
        const calls = rows.map((r) => {
            const end = Date.parse(r.ts);
            return { ...r, endMs: end, startMs: end - r.ms, images: parseJson(r.images), files: parseJson(r.files), meta: parseJson(r.meta),
                touched: parseJson(r.touched) ?? [], ok: !!r.ok };
        }).sort((a, b) => a.startMs - b.startMs || a.id - b.id);
        const threads = assignThreads(calls.map((c) => ({ id: c.id, start: c.startMs, end: c.endMs, thread: c.thread, how: c.thread_how, touched: c.touched })));
        let prevEnd = null;
        const threadEnd = new Map();
        return calls.map(({ endMs, startMs, ...c }, i) => {
            const t = threads[i];
            const gap = prevEnd == null ? null : Math.max(0, startMs - prevEnd);
            prevEnd = prevEnd == null ? endMs : Math.max(prevEnd, endMs);
            const te = threadEnd.get(t.thread);
            threadEnd.set(t.thread, Math.max(te ?? -Infinity, endMs));
            return { ...c, thread: t.thread, thread_how: t.how, start: new Date(startMs).toISOString(), end: c.ts, gap_ms: gap,
                thread_gap_ms: te == null ? null : Math.max(0, startMs - te) };
        });
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
        // Which client made them: a token (by its label) or a connected app (via its name).
        const byClient = q(`SELECT CASE WHEN c.grant_id IS NOT NULL THEN 'via ' || COALESCE(NULLIF(k.name, ''), 'an app')
                                        WHEN c.token_id IS NOT NULL THEN 'token: ' || COALESCE(t.label, '?') ELSE 'admin key' END AS name,
                COUNT(*) AS calls, SUM(1 - c.ok) AS errors, CAST(AVG(c.ms) AS INTEGER) AS avg_ms
            FROM calls c LEFT JOIN tokens t ON t.id = c.token_id LEFT JOIN oauth_grants g ON g.id = c.grant_id
                LEFT JOIN oauth_clients k ON k.id = g.client_id
            WHERE c.account_id = ? AND c.ts >= ? GROUP BY name ORDER BY calls DESC, name`);
        const total = byDay.reduce((n, d) => n + d.calls, 0);
        return { days, total, errorCount: byDay.reduce((n, d) => n + d.errors, 0), byDay, byTool, byServer, byClient, errors };
    }

    // --- OAuth: clients, codes, grants, tokens (the protocol checks are in lib/oauth.mjs)

    /** A dynamically registered public client (no secret): {id, name, redirect_uris, created}. */
    registerClient({ name = "", redirectUris }) {
        const id = "rcc_" + randomBytes(16).toString("base64url");
        const t = now();
        this.db.prepare("INSERT INTO oauth_clients (id, name, redirect_uris, created) VALUES (?, ?, ?, ?)")
            .run(id, String(name).slice(0, 100), JSON.stringify(redirectUris), t);
        return { id, name: String(name).slice(0, 100), redirect_uris: redirectUris, created: t };
    }

    getClient(id) {
        if (typeof id !== "string" || id.length > 100) return null;
        const r = this.db.prepare("SELECT * FROM oauth_clients WHERE id = ?").get(id);
        return r ? { id: r.id, name: r.name, redirect_uris: JSON.parse(r.redirect_uris), created: r.created } : null;
    }

    /** A one-time authorization code (60 s; only its hash kept) for a consent just given. */
    createAuthCode({ clientId, accountId, redirectUri, challenge, resource = null, scope = "mcp" }, ttlMs = OAUTH_CODE_TTL_MS) {
        const code = randomBytes(32).toString("base64url");
        const t = Date.now();
        this.db.prepare(`INSERT INTO oauth_codes (hash, client_id, account_id, redirect_uri, challenge, resource, scope, created, expires)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(sha256(code), clientId, accountId, redirectUri, challenge, resource, scope,
            new Date(t).toISOString(), new Date(t + ttlMs).toISOString());
        return code;
    }

    /**
     * Claims a code: its row once ({...row}), then never again. A second use of a code that
     * already produced tokens revokes that grant (RFC 6749 10.5: the code may have leaked).
     * Returns null for an unknown code, {reused: true} for a used one, {expired: true}.
     */
    claimAuthCode(code) {
        if (typeof code !== "string" || !code || code.length > 100) return null;
        const h = sha256(code);
        const r = this.db.prepare("SELECT * FROM oauth_codes WHERE hash = ?").get(h);
        if (!r) return null;
        if (r.used || this.db.prepare("UPDATE oauth_codes SET used = ? WHERE hash = ? AND used IS NULL").run(now(), h).changes !== 1) {
            if (r.grant_id) this.revokeGrant(r.grant_id);
            return { reused: true };
        }
        if (r.expires < now()) return { expired: true };
        return { ...r, hash: h };
    }

    /** A grant for a code just exchanged, and its first tokens: {grantId, access, refresh, expiresIn}. */
    grantFromCode(row, { accessTtlMs = ACCESS_TTL_MS, refreshTtlMs = REFRESH_TTL_MS } = {}) {
        const r = this.db.prepare("INSERT INTO oauth_grants (account_id, client_id, resource, scope, created) VALUES (?, ?, ?, ?, ?)")
            .run(row.account_id, row.client_id, row.resource, row.scope, now());
        const grantId = Number(r.lastInsertRowid);
        this.db.prepare("UPDATE oauth_codes SET grant_id = ? WHERE hash = ?").run(grantId, row.hash);
        return { grantId, scope: row.scope, ...this.#grantTokens(grantId, accessTtlMs, refreshTtlMs) };
    }

    #grantTokens(grantId, accessTtlMs, refreshTtlMs) {
        const access = "rco_" + randomBytes(32).toString("base64url");
        const refresh = "rcr_" + randomBytes(32).toString("base64url");
        const t = Date.now(), ins = this.db.prepare("INSERT INTO oauth_tokens (hash, grant_id, kind, created, expires) VALUES (?, ?, ?, ?, ?)");
        ins.run(sha256(access), grantId, "access", new Date(t).toISOString(), new Date(t + accessTtlMs).toISOString());
        ins.run(sha256(refresh), grantId, "refresh", new Date(t).toISOString(), new Date(t + refreshTtlMs).toISOString());
        return { access, refresh, expiresIn: Math.round(accessTtlMs / 1000) };
    }

    /**
     * The refresh_token grant, rotating: the old refresh token is revoked and a new pair issued.
     * A refresh token used twice revokes its whole grant (someone else has a copy).
     * Returns {grantId, access, refresh, expiresIn, scope} or {error: "invalid_grant", why}.
     */
    refreshGrant(refresh, clientId, { accessTtlMs = ACCESS_TTL_MS, refreshTtlMs = REFRESH_TTL_MS } = {}) {
        if (typeof refresh !== "string" || !refresh.startsWith("rcr_") || refresh.length > 100) return { error: "invalid_grant", why: "unknown refresh token" };
        const h = sha256(refresh);
        const r = this.db.prepare(`SELECT t.*, g.client_id, g.revoked AS grant_revoked, g.scope, a.status
            FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id JOIN accounts a ON a.id = g.account_id
            WHERE t.hash = ? AND t.kind = 'refresh'`).get(h);
        if (!r) return { error: "invalid_grant", why: "unknown refresh token" };
        if (r.client_id !== clientId) return { error: "invalid_grant", why: "the refresh token was issued to another client" };
        if (r.grant_revoked) return { error: "invalid_grant", why: "the grant was revoked" };
        if (r.revoked) { this.revokeGrant(r.grant_id); return { error: "invalid_grant", why: "refresh token reused: the grant is revoked" }; }
        if (r.expires < now()) return { error: "invalid_grant", why: "the refresh token expired" };
        if (r.status !== "active") return { error: "invalid_grant", why: "the account is not active" };
        if (this.db.prepare("UPDATE oauth_tokens SET revoked = ? WHERE hash = ? AND revoked IS NULL").run(now(), h).changes !== 1) {
            this.revokeGrant(r.grant_id);
            return { error: "invalid_grant", why: "refresh token reused: the grant is revoked" };
        }
        return { grantId: r.grant_id, scope: r.scope, ...this.#grantTokens(r.grant_id, accessTtlMs, refreshTtlMs) };
    }

    /**
     * Who an OAuth access token ("rco_...") acts for: {account, grantId, clientName}, {disabled},
     * or null (unknown, expired, revoked, grant revoked). Marks the grant used, once a minute.
     */
    authenticateAccess(token) {
        if (typeof token !== "string" || !token.startsWith("rco_") || token.length > 100) return null;
        const r = this.db.prepare(`SELECT t.expires, t.revoked AS token_revoked, g.id AS grant_id, g.revoked AS grant_revoked,
                k.name AS client_name, a.*
            FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id JOIN accounts a ON a.id = g.account_id
                LEFT JOIN oauth_clients k ON k.id = g.client_id
            WHERE t.hash = ? AND t.kind = 'access'`).get(sha256(token));
        if (!r || r.token_revoked || r.grant_revoked || r.expires < now()) return null;
        if (r.status !== "active") return { disabled: true, pending: r.status === "pending" };
        const key = "g" + r.grant_id, t = Date.now();
        if (t - (this.lastUsed.get(key) ?? 0) >= LAST_USED_EVERY_MS) {
            this.lastUsed.set(key, t);
            try { this.db.prepare("UPDATE oauth_grants SET last_used = ? WHERE id = ?").run(new Date(t).toISOString(), r.grant_id); } catch { /* busy */ }
        }
        return { account: this.#row(r), grantId: r.grant_id, clientName: r.client_name ?? "" };
    }

    /** Revokes a grant and every token of it; with accountId, only that account's. True when it did. */
    revokeGrant(grantId, accountId = null) {
        const t = now();
        const ok = this.db.prepare(`UPDATE oauth_grants SET revoked = ? WHERE id = ? AND revoked IS NULL${accountId == null ? "" : " AND account_id = ?"}`)
            .run(...[t, Number(grantId), ...(accountId == null ? [] : [accountId])]).changes > 0;
        if (ok) this.db.prepare("UPDATE oauth_tokens SET revoked = ? WHERE grant_id = ? AND revoked IS NULL").run(t, Number(grantId));
        return ok;
    }

    /** RFC 7009: revoking either token of a grant revokes the grant. Unknown tokens are no error. */
    revokeOAuthToken(token, clientId = null) {
        if (typeof token !== "string" || token.length > 100) return false;
        const r = this.db.prepare("SELECT t.grant_id, g.client_id FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id WHERE t.hash = ?").get(sha256(token));
        if (!r || (clientId && r.client_id !== clientId)) return false;
        return this.revokeGrant(r.grant_id);
    }

    /** The account's connected apps: its live grants, newest first. */
    listGrants(accountId) {
        return this.db.prepare(`SELECT g.id, g.client_id, g.resource, g.scope, g.created, g.last_used, k.name AS client_name, k.redirect_uris
            FROM oauth_grants g LEFT JOIN oauth_clients k ON k.id = g.client_id
            WHERE g.account_id = ? AND g.revoked IS NULL ORDER BY g.created DESC, g.id DESC`).all(accountId)
            .map((r) => ({ ...r, redirect_uris: r.redirect_uris ? JSON.parse(r.redirect_uris) : [] }));
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

    deletePage(id) {
        this.db.prepare("DELETE FROM pages WHERE id = ?").run(String(id));
        this.streamRemove(id);
    }

    /** Turns app scripts on or off for the account (the MCP tools then offer them, or not). */
    setScripts(accountId, on) {
        this.db.prepare("UPDATE accounts SET scripts = ? WHERE id = ?").run(on ? 1 : 0, accountId);
    }

    // --- public name and the stream

    /**
     * The account's name: a label shown with what it posts to the stream (the account itself is
     * its id, tied to its email, so names may repeat). Throws a message meant for the person.
     * Spaces are collapsed; 1-40 characters, no control characters. Empty clears it, only while
     * nothing is in the stream.
     */
    setName(accountId, name) {
        name = String(name ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
        if (!name) {
            if (this.streamOf(accountId).length) throw new Error("Your items in the stream show your name: remove them first, or choose another name.");
            this.db.prepare("UPDATE accounts SET name = '' WHERE id = ?").run(accountId);
            return "";
        }
        if (name.length > 40) throw new Error("A name is at most 40 characters.");
        if (/[\p{Cc}\p{Cf}]/u.test(name)) throw new Error("A name cannot contain control or invisible characters.");
        this.db.prepare("UPDATE accounts SET name = ? WHERE id = ?").run(name, accountId);
        return name;
    }

    /**
     * Posts a page to the stream under `title` (or renames it there). The page must be the
     * account's (admins may post any) and the account needs a public name; throws a message.
     */
    streamPost({ pageId, account, title }) {
        pageId = String(pageId ?? "");
        const owner = this.pageOwner(pageId);
        if (owner == null) throw new Error("That page is not published (or was unpublished).");
        if (owner !== account.id && !account.admin) throw new Error("You can only post your own pages.");
        if (!this.getAccount(account.id)?.name) throw new Error("Set your name first: it is shown with what you post.");
        title = String(title ?? "").normalize("NFC").replace(/\s+/g, " ").trim().slice(0, 80);
        if (!title) throw new Error("Give the item a name.");
        const existing = this.db.prepare("SELECT page_id FROM stream WHERE page_id = ?").get(pageId);
        if (existing) {
            this.db.prepare("UPDATE stream SET title = ? WHERE page_id = ?").run(title, pageId);
            return;
        }
        const recent = this.db.prepare("SELECT COUNT(*) AS n FROM stream WHERE account_id = ? AND created > ?")
            .get(owner, new Date(Date.now() - 86400_000).toISOString()).n;
        if (recent >= STREAM_PER_DAY && !account.admin) throw new Error(`You posted ${STREAM_PER_DAY} items in the last day: try again tomorrow.`);
        this.db.prepare("INSERT INTO stream (page_id, account_id, title, created) VALUES (?, ?, ?, ?)").run(pageId, owner, title, now());
    }

    /** Takes a page out of the stream, with its votes. */
    streamRemove(pageId) {
        this.db.prepare("DELETE FROM stream WHERE page_id = ?").run(String(pageId));
        this.db.prepare("DELETE FROM votes WHERE page_id = ?").run(String(pageId));
    }

    /** One stream item (with its poster's name as `author`, and its score), or null. */
    streamItem(pageId, viewerId = null) {
        return this.#streamRows("WHERE s.page_id = ?", [String(pageId)], viewerId, "s.created DESC", 1)[0] ?? null;
    }

    /** The stream: sort "new" (newest first) or "top" (score, then newest); `viewerId` adds each item's my_vote. */
    streamItems({ sort = "new", viewerId = null, limit = 200, offset = 0 } = {}) {
        const order = sort === "top" ? "score DESC, s.created DESC" : "s.created DESC";
        return this.#streamRows("", [], viewerId, order, limit, offset);
    }

    streamCount() { return this.db.prepare("SELECT COUNT(*) AS n FROM stream").get().n; }

    /** The account's items in the stream, newest first. */
    streamOf(accountId) {
        return this.#streamRows("WHERE s.account_id = ?", [accountId], null, "s.created DESC", 1000);
    }

    #streamRows(where, args, viewerId, order, limit, offset = 0) {
        return this.db.prepare(`
            SELECT s.page_id, s.account_id, s.title, s.created, s.featured, a.name AS author, p.url,
                COALESCE(SUM(v.value), 0) AS score, COALESCE(SUM(v.value = 1), 0) AS ups, COALESCE(SUM(v.value = -1), 0) AS downs,
                (SELECT value FROM votes WHERE page_id = s.page_id AND account_id = ?) AS my_vote
            FROM stream s JOIN accounts a ON a.id = s.account_id LEFT JOIN pages p ON p.id = s.page_id
            LEFT JOIN votes v ON v.page_id = s.page_id
            ${where} GROUP BY s.page_id ORDER BY ${order} LIMIT ? OFFSET ?`)
            .all(viewerId ?? -1, ...args, Math.max(1, Math.min(1000, limit)), Math.max(0, offset))
            .map((r) => ({ ...r, my_vote: r.my_vote ?? 0 }));
    }

    /**
     * Marks a stream item as a showcase (on) or not: the Showcases page shows marked items.
     * Admins only (the caller checks). False when the item is not in the stream.
     */
    streamFeature(pageId, on) {
        const r = this.db.prepare(`UPDATE stream SET featured = ${on ? "?" : "NULL"} WHERE page_id = ?`)
            .run(...(on ? [now(), String(pageId)] : [String(pageId)]));
        return r.changes > 0;
    }

    /** The items marked as showcases, the most recently marked first. */
    featuredItems() {
        return this.#streamRows("WHERE s.featured IS NOT NULL", [], null, "s.featured DESC", 100);
    }

    /** The account's vote on an item: 1, -1, or 0 to take it back. False when the item is not in the stream. */
    vote(pageId, accountId, value) {
        pageId = String(pageId ?? "");
        value = Number(value);
        if (![1, -1, 0].includes(value)) throw new Error("A vote is +1 or -1 (0 takes it back).");
        if (!this.db.prepare("SELECT 1 FROM stream WHERE page_id = ?").get(pageId)) return false;
        if (value === 0) this.db.prepare("DELETE FROM votes WHERE page_id = ? AND account_id = ?").run(pageId, accountId);
        else this.db.prepare(`INSERT INTO votes (page_id, account_id, value, created) VALUES (?, ?, ?, ?)
            ON CONFLICT (page_id, account_id) DO UPDATE SET value = excluded.value, created = excluded.created`).run(pageId, accountId, value, now());
        return true;
    }
}

function parseJson(s) {
    if (s == null) return null;
    try { return JSON.parse(s); } catch { return null; }
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
    shared = new Accounts(dbPath(), { DatabaseSync: sqlite.DatabaseSync });
    try { shared.cleanup(); } catch { /* busy at start: the next start will do */ }
    return shared;
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
