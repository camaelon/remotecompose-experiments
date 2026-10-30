// A minimal MCP server, tools only, over either transport:
//
//   stdio (default)     newline-delimited JSON-RPC 2.0 on stdin/stdout
//   Streamable HTTP     `--http [PORT]` or MCP_HTTP_PORT; see serveHttp below
//
// Hand-rolled rather than built on @modelcontextprotocol/sdk so the servers run from a bare
// checkout with nothing but `node` — no npm install, same on macOS and Linux.

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { workspaceRoot } from "./workspace.mjs";
import { callDetails } from "./calllog.mjs";

const DEFAULT_PROTOCOL = "2025-06-18";
const MAX_BODY = 32 << 20;   // inline JSON documents and base64 .rc files can be large

const log = (...a) => console.error(new Date().toISOString(), ...a);

/**
 * tools: [{name, description, inputSchema, handler: async (args) => content[]}]
 * A handler returns an MCP content array; throwing reports the message as a tool error
 * (isError), which the model sees, rather than as a protocol error, which it does not.
 *
 * Returns handle(msg) -> the response object, or null for a notification.
 */
function createHandler({ name, version, instructions, tools }) {
    const byName = new Map(tools.map((t) => [t.name, t]));
    const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
    const err = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

    // ctx: {client} — who is calling (a short id per address + user agent over HTTP, "stdio"),
    // so the log lines of one session can be followed.
    return async function handle(msg, ctx = {}) {
        if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") {
            return err(msg?.id ?? null, -32600, "invalid request");
        }
        const { id, method, params } = msg;
        const isRequest = id !== undefined && id !== null;
        if (!method) return null;   // a response to something we never send
        switch (method) {
            case "initialize":
                log(`initialize ${JSON.stringify({ client: ctx.client, clientInfo: params?.clientInfo, protocol: params?.protocolVersion, ua: ctx.ua })}`);
                return ok(id, {
                    protocolVersion: params?.protocolVersion ?? DEFAULT_PROTOCOL,
                    capabilities: { tools: {} },
                    serverInfo: { name, version },
                    ...(instructions ? { instructions } : {}),
                });
            case "ping":
                return ok(id, {});
            case "tools/list":
                return ok(id, {
                    tools: tools.map(({ name, description, inputSchema, annotations }) =>
                        ({ name, description, inputSchema, ...(annotations ? { annotations } : {}) })),
                });
            case "tools/call": {
                const tool = byName.get(params?.name);
                if (!tool) return err(id, -32602, `unknown tool: ${params?.name}`);
                const started = Date.now();
                try {
                    const content = await tool.handler(params.arguments ?? {});
                    log(`${tool.name} ok ${Date.now() - started}ms` + callDetails({ client: ctx.client, args: params.arguments, content }));
                    return ok(id, { content });
                } catch (e) {
                    log(`${tool.name} error ${Date.now() - started}ms: ${String(e?.message ?? e).split("\n")[0]}` +
                        callDetails({ client: ctx.client, args: params.arguments, error: e?.message ?? e }));
                    return ok(id, {
                        content: [{ type: "text", text: String(e?.message ?? e) }],
                        isError: true,
                    });
                }
            }
            default:
                // Notifications (no id) need no answer; unknown requests get method-not-found.
                return isRequest ? err(id, -32601, `method not found: ${method}`) : null;
        }
    };
}

/**
 * True when the module at `metaUrl` is the script node was started with, so a server file
 * can also be imported (by the guide server, for its definition) without starting up.
 */
export function isMain(metaUrl) {
    try {
        return realpathSync(fileURLToPath(metaUrl)) === realpathSync(process.argv[1]);
    } catch { return false; }
}

export function serve(def) {
    const handle = createHandler(def);
    // `--http PORT`, or `--http` alone with the port from MCP_HTTP_PORT (what the systemd unit
    // does), or MCP_HTTP_PORT alone. A bare --http must not fall through to the default port:
    // every server would then try the same one and all but the first would fail to bind.
    const i = process.argv.indexOf("--http");
    const argPort = i >= 0 && /^\d+$/.test(process.argv[i + 1] ?? "") ? Number(process.argv[i + 1]) : NaN;
    const port = Number.isFinite(argPort) ? argPort : Number(process.env.MCP_HTTP_PORT ?? NaN);
    if (i >= 0 || process.env.MCP_HTTP_PORT) serveHttp(def, handle, port);
    else serveStdio(handle);
}

function serveStdio(handle) {
    const send = (msg) => msg && process.stdout.write(JSON.stringify(msg) + "\n");
    const rl = createInterface({ input: process.stdin });
    rl.on("line", (line) => {
        if (!line.trim()) return;
        let msg;
        try { msg = JSON.parse(line); } catch {
            return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
        }
        for (const m of Array.isArray(msg) ? msg : [msg]) handle(m, { client: "stdio" }).then(send);
    });
    rl.on("close", () => process.exit(0));
}

/**
 * Streamable HTTP, stateless: every POST carries complete JSON-RPC and gets a plain JSON
 * reply (the spec allows JSON in place of an SSE stream). No server-initiated messages, so
 * GET has nothing to stream and answers 405, as the spec says such a server should.
 *
 * Auth is a shared secret, accepted two ways because clients differ in what they can send:
 *   Authorization: Bearer <MCP_TOKEN>      Claude Code, curl, most SDK clients
 *   POST <MCP_HTTP_PATH>/<MCP_TOKEN>       clients that only take a URL (claude.ai's
 *                                          custom-connector form has no header field)
 *
 * Env: MCP_HTTP_PORT (default 8808), MCP_HTTP_HOST (default 127.0.0.1 — put TLS in front),
 * MCP_HTTP_PATH (default /mcp), MCP_TOKEN (required unless MCP_ALLOW_NO_AUTH=1),
 * MCP_ALLOWED_ORIGINS (comma-separated; when set, a request carrying any other Origin is
 * refused). MCP_ROOT is required: over HTTP, file paths must be confined.
 *
 * def.publicRoute(req, url, res) -> bool, if present, sees every request outside the MCP
 * path first and returns true when it answered it. It runs WITHOUT auth: it is for content
 * meant to be public (the deploy server's published pages), never for tools.
 */
function serveHttp(def, handle, port) {
    const name = def.name;
    if (!Number.isFinite(port)) port = 8808;
    const host = process.env.MCP_HTTP_HOST ?? "127.0.0.1";
    const base = (process.env.MCP_HTTP_PATH ?? "/mcp").replace(/\/+$/, "");
    const token = process.env.MCP_TOKEN ?? "";
    const origins = (process.env.MCP_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

    if (!token && process.env.MCP_ALLOW_NO_AUTH !== "1") {
        log("refusing to start: set MCP_TOKEN (or MCP_ALLOW_NO_AUTH=1 for a trusted network)");
        process.exit(1);
    }
    if (token && token.length < 24) {
        log("refusing to start: MCP_TOKEN is shorter than 24 characters");
        process.exit(1);
    }
    if (!workspaceRoot()) {
        log("refusing to start: set MCP_ROOT — over HTTP, tool file paths must be confined to a folder");
        process.exit(1);
    }

    const digest = (s) => createHash("sha256").update(s).digest();
    const tokenDigest = digest(token);
    const matches = (s) => timingSafeEqual(digest(s), tokenDigest);

    const reply = (res, status, body, headers = {}) => {
        const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
        res.writeHead(status, {
            ...(body !== undefined && typeof body !== "string" ? { "Content-Type": "application/json" } : {}),
            ...headers,
        });
        res.end(text);
    };

    const server = createServer(async (req, res) => {
        const url = new URL(req.url, "http://x");
        if (url.pathname === "/healthz") return reply(res, 200, "ok\n");
        if (def.publicRoute && url.pathname !== base && !url.pathname.startsWith(base + "/")) {
            try {
                if (await def.publicRoute(req, url, res)) return;
            } catch (e) {
                log(`public route ${url.pathname}: ${e?.message ?? e}`);
                if (!res.headersSent) return reply(res, 500, "error\n");
                return;
            }
        }

        let authed = !token;
        let given = "";
        if (url.pathname === base) {
            const m = /^Bearer\s+(.*)$/i.exec(req.headers.authorization ?? "");
            given = m ? m[1].trim() : "";
        } else if (url.pathname.startsWith(base + "/")) {
            given = decodeURIComponent(url.pathname.slice(base.length + 1));
        } else {
            return reply(res, 404, "not found\n");
        }
        if (token && given && matches(given)) authed = true;
        if (!authed) {
            // Say which of the two went wrong: an empty token is nearly always an unset shell
            // variable or a missing header, not a wrong secret.
            const why = given ? "wrong token"
                : `no token: send "Authorization: Bearer <token>" or put it after ${base}/`;
            return reply(res, 401, { error: `unauthorized: ${why}` }, { "WWW-Authenticate": 'Bearer realm="mcp"' });
        }
        const origin = req.headers.origin;
        if (origin && origins.length && !origins.includes(origin)) {
            log(`refused Origin ${origin} (not in MCP_ALLOWED_ORIGINS)`);
            return reply(res, 403, { error: "origin not allowed" });
        }
        if (req.method !== "POST") return reply(res, 405, "method not allowed\n", { Allow: "POST" });

        const chunks = [];
        let size = 0;
        for await (const c of req) {
            size += c.length;
            if (size > MAX_BODY) return reply(res, 413, { error: "request too large" });
            chunks.push(c);
        }
        let msg;
        try { msg = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {
            return reply(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
        }
        const batch = Array.isArray(msg);
        // Who is calling: the client's address (behind the proxy, X-Forwarded-For) and user agent,
        // hashed to a short id that groups one client's calls in the log. Never the token.
        // The session: an initialize gets a new Mcp-Session-Id (Streamable HTTP), which clients
        // send back on every later request, so one client's calls share an id in the log even
        // when they arrive from different addresses (ChatGPT's do). The server keeps no state
        // for it. Without one (an older client), the hash of address + user agent stands in.
        const msgs = batch ? msg : [msg];
        const isInit = msgs.some((m) => m?.method === "initialize");
        const sent = String(req.headers["mcp-session-id"] ?? "");
        const session = isInit ? randomUUID() : sent;
        const addr = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();
        const ua = String(req.headers["user-agent"] ?? "").slice(0, 80);
        const ctx = { client: session ? session.slice(0, 8) : "~" + createHash("sha1").update(addr + "|" + ua).digest("hex").slice(0, 6), ua };
        const out = (await Promise.all(msgs.map((m) => handle(m, ctx)))).filter(Boolean);
        const headers = isInit ? { "Mcp-Session-Id": session } : {};
        if (!out.length) return reply(res, 202, undefined, headers);   // only notifications / responses
        reply(res, 200, batch ? out : out[0], headers);
    });
    server.on("error", (e) => {
        log(e.code === "EADDRINUSE"
            ? `refusing to start: port ${port} on ${host} is already in use (set MCP_HTTP_PORT)`
            : `cannot listen on ${host}:${port}: ${e.message}`);
        process.exit(1);
    });
    server.requestTimeout = 300_000;
    server.listen(port, host, () =>
        log(`${name}: MCP over HTTP on http://${host}:${port}${base} (root ${workspaceRoot()})`));
}
