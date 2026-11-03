// App scripts: the business logic next to a document. A RemoteCompose document is the UX; an
// app script (TypeScript) is what an app would do around it: provide host values, react to
// the document's host actions, keep state. A published page (or an example with an app.ts)
// runs it in the viewer's browser, sandboxed, against the playing document.
//
//   compileAppScript(ts)          TypeScript -> plain JS for the sandbox; throws a readable error
//   checkAppScript(js, facts)     a dry run in node:vm against the document's variables and
//                                 actions: errors, typos (a variable or action the document does
//                                 not have), what it set; facts = {variables, actions}
//   documentActions(json)         the hostNamedAction names a JSON document sends
//   APP_RUNTIME                   the sandbox side of the bridge (the global `rc`); the page side is
//                                 web-page.mjs APP_BRIDGE_JS, over the player's RC.createHostApi
//   APP_TYPES                     the API as a .d.ts, for the guide
//   scriptsAllowed(account, env)  whether app scripts are on for this caller (opt-in):
//                                 RC_SCRIPTS=off: never; with accounts, the account's own switch
//                                 (account page); without, RC_SCRIPTS=on
//
// The sandbox: an iframe with sandbox="allow-scripts" and no allow-same-origin, so the script
// has an opaque origin: no cookies, no storage of the site, no access to the page or to the
// account pages on the same host. It talks to the page by postMessage only, and the page
// lets it touch nothing but the document's named variables and its own storage.

import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MAX_SCRIPT_BYTES = 64 << 10;

/** Whether app scripts are on for this caller: RC_SCRIPTS=off never, an account's switch, else RC_SCRIPTS=on. */
export function scriptsAllowed(account, env = process.env) {
    if (env.RC_SCRIPTS === "off") return false;
    if (account) return account.id === 0 || Boolean(account.scripts);
    return env.RC_SCRIPTS === "on";
}

/** True when the server offers app scripts at all (the account switch is shown). */
export const scriptsOffered = (env = process.env) => env.RC_SCRIPTS !== "off";

function esbuild() {
    for (const from of [REPO, path.join(REPO, "players", "typescript")]) {
        try { return createRequire(path.join(from, "package.json"))("esbuild"); } catch { /* next */ }
    }
    return null;
}

/**
 * TypeScript (or plain JS) -> JS the sandbox runs. Node's own type stripping when it has it
 * (lines keep their numbers, so errors point at the TypeScript), else esbuild. A script is
 * one file: no import or export (the API is the global `rc`; fetch, timers and Math are there).
 */
export function compileAppScript(ts) {
    ts = String(ts ?? "");
    if (!ts.trim()) throw new Error("the script is empty");
    if (Buffer.byteLength(ts) > MAX_SCRIPT_BYTES) throw new Error(`the script is ${Buffer.byteLength(ts)} bytes; ${MAX_SCRIPT_BYTES} at most`);
    if (/^\s*(import|export)\b(?!\s*\()/m.test(ts)) {
        throw new Error("an app script is one file: no import or export. The API is the global `rc` " +
            "(rc.get, rc.set, rc.onAction, rc.onChange, rc.storage, rc.log); fetch, timers and Math are there too");
    }
    const mod = createRequire(import.meta.url)("node:module");
    let js = null, lastError = null;
    if (typeof mod.stripTypeScriptTypes === "function") {
        for (const mode of ["strip", "transform"]) {
            try { js = quiet(() => mod.stripTypeScriptTypes(ts, { mode })); break; } catch (e) { lastError = e; }
        }
    }
    if (js === null) {
        const eb = esbuild();
        if (!eb) throw lastError ?? new Error("cannot compile TypeScript here: no esbuild, and Node is too old to strip types");
        try { js = eb.transformSync(ts, { loader: "ts", target: "es2020" }).code; } catch (e) {
            throw new Error(String(e.message).replace(/^Transform failed with \d+ errors?:\s*/, "").replace(/<stdin>:(\d+):(\d+):\s*ERROR:/g, "line $1, column $2:"));
        }
    }
    // Syntax, as the browser will parse it (inside the async function the runtime wraps it in).
    try { new vm.Script(wrap(js), { filename: "app.ts" }); } catch (e) {
        const line = /app\.ts:(\d+)/.exec(String(e.stack))?.[1];
        throw new Error(`syntax error${line ? ` at line ${Number(line) - WRAP_LINES}` : ""}: ${e.message}`);
    }
    return js;
}

/** Node prints an ExperimentalWarning the first time types are stripped: not for our logs. */
function quiet(fn) {
    const emit = process.emitWarning;
    process.emitWarning = (w, ...rest) => { if (!/stripTypeScriptTypes|Type Stripping/i.test(String(w?.message ?? w))) emit.call(process, w, ...rest); };
    try { return fn(); } finally { process.emitWarning = emit; }
}

// The user's code runs inside an async function (top-level await works; its declarations
// stay its own). One line before it, so line N of the script is line N + 1 of the wrapper.
const WRAP_LINES = 1;
const wrap = (js) => `self.__rcMain = async function () {\n${js}\n};`;

/** The script as the sandbox's second <script>: wrapped, and safe inside the element. */
export const appScriptTag = (js) => wrap(js).replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");

/** The hostNamedAction names (and literal values) a JSON document sends: {name: [values]}. */
export function documentActions(json) {
    const out = {};
    const walk = (v) => {
        if (Array.isArray(v)) { v.forEach(walk); return; }
        if (!v || typeof v !== "object") return;
        const t = String(v.type ?? "").toLowerCase();
        if ((t === "hostnamedaction" || t === "hostaction") && typeof v.name === "string") {
            (out[v.name] ??= []);
            if (v.value !== undefined && !out[v.name].includes(v.value)) out[v.name].push(v.value);
        }
        for (const x of Object.values(v)) walk(x);
    };
    try { walk(typeof json === "string" ? JSON.parse(json) : json); } catch { /* not JSON */ }
    return out;
}

const TYPE_OF = { float: "number", int: "number", long: "number", color: "colour (\"#RRGGBB\" or \"#AARRGGBB\")", string: "string", float_array: "number array" };
function fits(type, value) {
    if (type === "float" || type === "int" || type === "long") return typeof value === "number" ? Number.isFinite(value) : Number.isFinite(Number(value)) && String(value).trim() !== "";
    if (type === "color") return (typeof value === "number" && Number.isFinite(value)) || /^#?([0-9a-f]{6}|[0-9a-f]{8})$/i.test(String(value).trim());
    if (type === "float_array") return Array.isArray(value) ? value.every((x) => Number.isFinite(Number(x))) : false;
    return true;
}

/**
 * A dry run: the script's top level, then each of its timers once and each action handler
 * once (with the document's literal value when it has one), in node:vm with a stand-in `rc`,
 * no network (fetch rejects) and a time limit. facts: {variables: {name: type},
 * actions: {name: [values]} | null (unknown: a document given as .rc)}. Returns
 * {errors: [], warnings: [], sets: {name: value}, listens: [names], uses: [fetch, timers, storage]}.
 */
export function checkAppScript(js, facts = {}) {
    // In a worker thread: a stray rejection or an endless loop stays there, and a worker that
    // does not answer in time is ended.
    return new Promise((resolve) => {
        const w = new Worker(new URL(import.meta.url), { workerData: { appCheck: { js, facts } }, resourceLimits: { maxOldGenerationSizeMb: 128 } });
        const done = (r) => { clearTimeout(timer); w.terminate(); resolve(r); };
        const timer = setTimeout(() => done({ errors: ["the dry run did not finish in 5 s: an endless loop, or too much work at start?"], warnings: [], sets: {}, listens: [], uses: [] }), 5000);
        w.once("message", done);
        w.once("error", (e) => done({ errors: [`the dry run failed: ${e?.message ?? e}`], warnings: [], sets: {}, listens: [], uses: [] }));
    });
}

if (!isMainThread && workerData?.appCheck) {
    const stray = [];
    process.on("unhandledRejection", (reason) => stray.push(reason));
    const { js, facts } = workerData.appCheck;
    dryRun(js, facts).then(async (r) => {
        await new Promise((res) => setTimeout(res, 10));   // let stray rejections surface
        for (const e of stray) if (!/no network in the check/.test(e?.message)) r.errors.push(`a promise was rejected and not caught: ${e?.message ?? e}${/app\.ts:(\d+)/.test(String(e?.stack)) ? ` (line ${Number(/app\.ts:(\d+)/.exec(String(e.stack))[1]) - WRAP_LINES})` : ""}`);
        parentPort.postMessage(r);
    });
}

async function dryRun(js, { variables = {}, actions = null } = {}) {
    const errors = [], warnings = [], sets = {}, uses = new Set();
    const handlers = { action: [], change: [] };
    const timers = [];
    const values = {};
    for (const [n, t] of Object.entries(variables)) values[n] = t === "string" ? "" : t === "color" ? "#FF000000" : t === "float_array" ? [] : 0;
    const where = (e) => {
        const line = /app\.ts:(\d+)/.exec(String(e?.stack ?? ""))?.[1];
        return line ? ` (line ${Number(line) - WRAP_LINES})` : "";
    };
    const unknownVar = new Set();
    const rc = {
        get variables() { return { ...variables }; },
        get(name) {
            if (!(name in variables) && !unknownVar.has(name)) { unknownVar.add(name); warnings.push(`rc.get("${name}"): the document has no variable "${name}"${suggest(name, Object.keys(variables))}`); }
            return values[name];
        },
        set(name, value) {
            if (name && typeof name === "object") { for (const [k, v] of Object.entries(name)) rc.set(k, v); return; }
            if (!(name in variables)) {
                if (!unknownVar.has(name)) { unknownVar.add(name); warnings.push(`rc.set("${name}"): the document has no variable "${name}"${suggest(name, Object.keys(variables))}`); }
                return;
            }
            if (!fits(variables[name], value)) warnings.push(`rc.set("${name}", ${JSON.stringify(value)}): "${name}" is ${/^[aeiou]/.test(variables[name]) ? "an" : "a"} ${variables[name]} and takes a ${TYPE_OF[variables[name]] ?? variables[name]}`);
            sets[name] = value;
            values[name] = value;
        },
        onAction(name, fn) { handlers.action.push({ name: String(name), fn }); return () => {}; },
        onChange(name, fn) {
            if (name !== "*" && !(name in variables)) warnings.push(`rc.onChange("${name}"): the document has no variable "${name}"${suggest(name, Object.keys(variables))}`);
            handlers.change.push({ name: String(name), fn }); return () => {};
        },
        storage: { get() { uses.add("storage"); return undefined; }, set() { uses.add("storage"); }, remove() { uses.add("storage"); } },
        log() {},
    };
    // The context has its own intrinsics (Promise, Math, Date, JSON...) and its own microtask
    // queue, drained inside each evaluation: the time limit covers a loop after an await too.
    const context = vm.createContext({}, { codeGeneration: { strings: false, wasm: false }, microtaskMode: "afterEvaluate" });
    const inside = (code) => vm.runInContext(code, context, { timeout: 1000 });
    inside(`var self = globalThis; var __err;
        self.__run = function (fn, args) {
            __err = undefined;
            try { var r = fn.apply(null, args || []); if (r && typeof r.then === "function") r.then(null, function (e) { __err = e; }); }
            catch (e) { __err = e; }
        };
        self.__noNetwork = function () { return new Promise(function () {}); };`);

    Object.assign(context, {
        rc, console: { log() {}, info() {}, warn() {}, error() {}, debug() {} },
        setTimeout: (fn, ms) => { uses.add("timers"); timers.push({ fn, ms: Number(ms) || 0 }); return timers.length; },
        setInterval: (fn, ms) => { uses.add("timers"); timers.push({ fn, ms: Number(ms) || 0, every: true }); return timers.length; },
        clearTimeout() {}, clearInterval() {},
        fetch: () => { uses.add("fetch"); return context.__noNetwork(); },
        URL, URLSearchParams, TextEncoder, TextDecoder, structuredClone,
    });
    // localStorage / sessionStorage, as the sandbox has them (over rc.storage): strings, in memory here.
    for (const name of ["localStorage", "sessionStorage"]) {
        const data = new Map();
        context[name] = {
            getItem: (k) => { uses.add("storage"); return data.has(String(k)) ? data.get(String(k)) : null; },
            setItem: (k, v) => { uses.add("storage"); data.set(String(k), String(v)); },
            removeItem: (k) => { uses.add("storage"); data.delete(String(k)); },
            clear: () => { uses.add("storage"); data.clear(); },
            key: (i) => [...data.keys()][i] ?? null,
            get length() { return data.size; },
        };
    }
    const run = (label, fn, args = []) => {
        context.__fn = fn; context.__args = args;
        let e;
        try { inside("__run(__fn, __args)"); e = context.__err; } catch (err) { e = err; }
        if (e === undefined || /no network in the check/.test(e?.message)) return;
        const msg = /timed out/i.test(e?.message) ? "runs too long (over 1 s without returning): an endless loop?" : `${e?.name === "Error" || !e?.name ? "" : e.name + ": "}${e?.message ?? e}`;
        errors.push(`${label}: ${msg}${where(e)}`);
    };
    try {
        new vm.Script(wrap(js), { filename: "app.ts" }).runInContext(context, { timeout: 1000 });
    } catch (e) {
        errors.push(`${/timed out/i.test(e?.message) ? "the top level runs too long (over 1 s): an endless loop?" : e?.message}${where(e)}`);
        return { errors, warnings, sets, listens: [], uses: [...uses] };
    }
    run("top level", context.__rcMain);
    for (const t of timers.slice(0, 20)) run(`a ${t.every ? "setInterval" : "setTimeout"} callback`, t.fn);
    const listens = [...new Set(handlers.action.map((h) => h.name))];
    for (const h of handlers.action) {
        if (h.name === "*") continue;
        if (actions && !(h.name in actions)) {
            warnings.push(`rc.onAction("${h.name}"): the document sends no action "${h.name}"${Object.keys(actions).length ? ` (it sends ${Object.keys(actions).map((a) => `"${a}"`).join(", ")})` : " (it sends none)"}${suggest(h.name, Object.keys(actions))}`);
        }
        const sample = actions?.[h.name]?.[0] ?? "";
        run(`the "${h.name}" action handler`, h.fn, [sample, h.name]);
    }
    for (const h of handlers.change) run(`the onChange("${h.name}") handler`, h.fn, [values[h.name], h.name]);
    if (actions) {
        const unheard = Object.keys(actions).filter((a) => !listens.includes(a) && !listens.includes("*"));
        if (unheard.length) warnings.push(`the document sends ${unheard.map((a) => `"${a}"`).join(", ")}, which the script does not handle (fine if they are for the app itself)`);
    }
    return { errors, warnings, sets, listens, uses: [...uses] };
}

/** " (did you mean "x"?)" for a near miss. */
function suggest(name, names) {
    const d = (a, b) => {
        const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
        for (let j = 1; j <= b.length; j++) m[0][j] = j;
        for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
            m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1));
        return m[a.length][b.length];
    };
    const best = names.map((n) => [n, d(String(name), n)]).sort((x, y) => x[1] - y[1])[0];
    return best && best[1] <= Math.max(1, Math.floor(String(name).length / 3)) ? ` (did you mean "${best[0]}"?)` : "";
}

/** The check as text for a tool result. */
export function describeCheck(r) {
    const lines = [];
    if (r.errors.length) lines.push("Script errors (the page still publishes; fix them):", ...r.errors.map((e) => `- ${e}`));
    if (r.warnings.length) lines.push("Script warnings:", ...r.warnings.map((w) => `- ${w}`));
    const sets = Object.entries(r.sets);
    lines.push(`Script dry run: ${sets.length ? `sets ${sets.map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(", ")}` : "sets nothing at start"}` +
        `; ${r.listens.length ? `handles ${r.listens.map((a) => `"${a}"`).join(", ")}` : "handles no action"}` +
        (r.uses.length ? `; uses ${r.uses.join(", ")} (not exercised here: check the page)` : "") + ".");
    return lines.join("\n");
}

/** The sandbox side: the global `rc`, mirrored from the page, and the messages to it. */
export const APP_RUNTIME = `(function () {
  "use strict";
  var vars = {}, values = {}, store = {}, actionH = [], changeH = [], started = false;
  function send(m) { m.rcApp = 1; try { parent.postMessage(m, "*"); } catch (e) {} }
  function show(v) {
    if (v instanceof Error) return v.stack || String(v);
    if (typeof v === "string") return v;
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }
  function report(e, where) { send({ op: "error", message: (where ? where + ": " : "") + (e && e.message ? e.message : String(e)), stack: e && e.stack ? String(e.stack) : "" }); }
  function fire(list, name, value) {
    list.slice().forEach(function (h) {
      if (h.name !== "*" && h.name !== name) return;
      try { var r = h.fn(value, name); if (r && r.catch) r.catch(function (e) { report(e, name); }); } catch (e) { report(e, name); }
    });
  }
  var rc = {
    get variables() { var o = {}; for (var k in vars) o[k] = vars[k]; return o; },
    get: function (name) { return values[name]; },
    set: function (name, value) {
      if (name && typeof name === "object") { for (var k in name) rc.set(k, name[k]); return; }
      if (!(name in vars)) { send({ op: "log", level: "warn", text: 'rc.set("' + name + '"): the document has no such variable' }); return; }
      if (value && typeof value === "object" && typeof value.length === "number") value = Array.prototype.slice.call(value);
      values[name] = value;
      send({ op: "set", name: String(name), value: value });
    },
    onAction: function (name, fn) { var h = { name: String(name), fn: fn }; actionH.push(h); return function () { var i = actionH.indexOf(h); if (i >= 0) actionH.splice(i, 1); }; },
    onChange: function (name, fn) { var h = { name: String(name), fn: fn }; changeH.push(h); return function () { var i = changeH.indexOf(h); if (i >= 0) changeH.splice(i, 1); }; },
    storage: {
      get: function (k) { return store[k]; },
      set: function (k, v) { store[k] = v; send({ op: "store", key: String(k), value: v }); },
      remove: function (k) { delete store[k]; send({ op: "store", key: String(k), remove: true }); }
    },
    log: function () { send({ op: "log", level: "log", text: Array.prototype.map.call(arguments, show).join(" ") }); }
  };
  self.rc = rc;
  // localStorage, as scripts tend to use it: the sandbox has none of its own (an opaque origin),
  // so a stand-in over rc.storage, in this page's space. Values are strings, as in a browser.
  function storageLike(backend) {
    var api = {
      getItem: function (k) { var v = backend.get(String(k)); return v === undefined ? null : typeof v === "string" ? v : JSON.stringify(v); },
      setItem: function (k, v) { backend.set(String(k), String(v)); },
      removeItem: function (k) { backend.remove(String(k)); },
      clear: function () { backend.keys().forEach(function (k) { backend.remove(k); }); },
      key: function (i) { var ks = backend.keys(); return i >= 0 && i < ks.length ? ks[i] : null; },
      get length() { return backend.keys().length; }
    };
    return new Proxy(api, {
      get: function (t, k) { return k in t || typeof k === "symbol" ? t[k] : t.getItem(k); },
      set: function (t, k, v) { if (k in t) return false; t.setItem(k, v); return true; },
      deleteProperty: function (t, k) { t.removeItem(k); return true; },
      has: function (t, k) { return k in t || backend.get(String(k)) !== undefined; },
      ownKeys: function () { return backend.keys(); },
      getOwnPropertyDescriptor: function (t, k) { var v = t.getItem(k); return v === null ? undefined : { value: v, enumerable: true, configurable: true, writable: true }; }
    });
  }
  var local = storageLike({ get: rc.storage.get, set: rc.storage.set, remove: rc.storage.remove, keys: function () { return Object.keys(store); } });
  var sessionData = {};
  var session = storageLike({ get: function (k) { return sessionData[k]; }, set: function (k, v) { sessionData[k] = v; },
    remove: function (k) { delete sessionData[k]; }, keys: function () { return Object.keys(sessionData); } });
  [["localStorage", local], ["sessionStorage", session]].forEach(function (p) {
    try { Object.defineProperty(self, p[0], { value: p[1], configurable: true, enumerable: true, writable: false }); } catch (e) {}
  });
  ["log", "info", "warn", "error"].forEach(function (level) {
    console[level] = function () { send({ op: "log", level: level === "info" ? "log" : level, text: Array.prototype.map.call(arguments, show).join(" ") }); };
  });
  self.addEventListener("error", function (ev) { report(ev.error || ev.message); });
  self.addEventListener("unhandledrejection", function (ev) { report(ev.reason); });
  self.addEventListener("message", function (ev) {
    if (ev.source !== parent) return;
    var m = ev.data;
    if (!m || m.rcHost !== 1) return;
    if (m.op === "init") {
      vars = m.variables || {}; values = m.values || {}; store = m.storage || {};
      if (started) return;
      started = true;
      try { var r = self.__rcMain && self.__rcMain(); if (r && r.catch) r.catch(function (e) { report(e); }); } catch (e) { report(e); }
      send({ op: "started" });
    } else if (m.op === "action") fire(actionH, m.name, m.value);
    else if (m.op === "change") { values[m.name] = m.value; fire(changeH, m.name, m.value); }
    else if (m.op === "variables") { vars = m.variables || vars; }
  });
  send({ op: "hello" });
})();`;

/** The API as TypeScript declarations: what a script can use (the guide shows it). */
export const APP_TYPES = `/** Values by variable type: float, int -> number; color -> "#AARRGGBB" (set also takes "#RRGGBB"); string -> string; float_array -> number[]. */
type Value = number | string | number[];

declare const rc: {
  /** The document's named variables and their types ("float", "int", "color", "string", "float_array"). */
  readonly variables: Readonly<Record<string, string>>;
  /** A variable's current value: one the app set, or one the document changed (a slider writing an exported variable). */
  get(name: string): Value | undefined;
  /** Sets host variables; the document shows them at once. rc.set("price", 12.5) or rc.set({ price: 12.5, label: "Total" }). */
  set(name: string, value: Value): void;
  set(values: Record<string, Value>): void;
  /** Runs handler(value, name) when the document sends this hostNamedAction ("*": any). Returns a function that stops it. */
  onAction(name: string, handler: (value: unknown, name: string) => void | Promise<void>): () => void;
  /** Runs handler(value, name) when this variable changes, whoever changed it ("*": any). */
  onChange(name: string, handler: (value: Value | undefined, name: string) => void | Promise<void>): () => void;
  /** Kept in the viewer's browser for this page, across visits (JSON values). localStorage is the same space, as strings. */
  storage: { get(key: string): any; set(key: string, value: any): void; remove(key: string): void };
  /** Shows in the playground's App panel (console.log does too). */
  log(...args: unknown[]): void;
};
// Also there: localStorage (getItem/setItem/removeItem/clear/key/length, string values: the same per-page
// space as rc.storage), sessionStorage (this visit only), fetch (public APIs that allow any origin: the
// script's origin is opaque), setTimeout, setInterval, Date, Math, JSON, Intl.
// Not there: import/export, the page's DOM, cookies, indexedDB.`;

/** The tool options for a script, offered only to callers with scripts on (a tool's view). */
export const SCRIPT_PROPS = {
    script: {
        type: "string",
        description: "An app script (TypeScript, one file, no imports): the business logic next to the document. It runs " +
            "in the viewer's browser, sandboxed, and drives the document through the global `rc`: rc.set(name, value) " +
            "for host variables, rc.onAction(name, fn) for the document's hostNamedActions, rc.get / rc.onChange for " +
            "values the document changes, rc.storage for state kept in the browser, fetch for public APIs. The document " +
            "stays the UX; the script computes, fetches and remembers. Before writing one, read reference topic \"app\". " +
            "The result has a dry run of it (errors, unknown variables or actions).",
    },
    script_path: { type: "string", description: "The app script from a file (.ts or .js), instead of script." },
};

/** What a tool's description adds when scripts are on. */
export const SCRIPT_NOTE = " With script (TypeScript), the page also runs an app script next to the document: host values, " +
    "answers to its actions, state (reference topic \"app\"); the playground shows it (Script button) and its log (App panel).";

/** Why a script was refused: scripts are off for this caller. */
export function scriptsOffMessage(account, accountUrl = "") {
    if (process.env.RC_SCRIPTS === "off") return "app scripts are off on this server";
    return account
        ? `app scripts are off for your account: turn on "App scripts" on your account page${accountUrl ? ` (${accountUrl})` : ""}, then start a new chat so the tools list them`
        : "app scripts are off: start the server with RC_SCRIPTS=on";
}

/** The guide's topic "app": how to write an app script, the API, and an example. */
export const APP_GUIDE = `App scripts: the business logic next to a document

A RemoteCompose document is the UX: what is shown, how it lays out, animates and reacts to touch. An app script
is what the app around it would do: compute values, fetch data, keep state, and answer the document's actions.
publish takes it as script (TypeScript, one file, no import/export). The page runs it in the viewer's browser,
in a sandbox (an opaque origin: no cookies, no page access), against the playing document.

How they meet: through the document's named host variables and its host actions, nothing else.
- Values the script provides: declare them in the document as host variables, exported, with a sensible
  default so the document renders before the script runs (resources.variables {"total": {"value": 0, "export":
  true}}; a host string as a root variable command {"variable": {"name": "status", "vtype": "string", "value":
  "", "export": true}}). The script sets them: rc.set("total", 42.5), rc.set({ status: "Paid", count: 3 }).
- Things the document asks for: a tap sends a hostNamedAction ({"type": "hostNamedAction", "name": "add", "value":
  "apple"}, or a variable's value with "valueType"). The script answers: rc.onAction("add", (value) => { ... }).
- Values the document changes (a slider writing an exported variable): rc.get("level") reads it now,
  rc.onChange("level", (value) => { ... }) follows it.
Keep the split: the document never computes business rules (prices, validation, what is next); the script never
draws (no DOM: it only sets variables). A document with a script should still render sensibly without it.

The API (the global rc):
${APP_TYPES}

Rules that bite:
- Set only variables the document declares, with the right type: numbers for float/int, "#RRGGBB" or
  "#AARRGGBB" for colours, strings, number arrays for float arrays. Strings are how to show text the script
  computes (a formatted price, a list joined by newlines). A list of items is several variables or float arrays.
- Action names are case-sensitive and must match the document's hostNamedAction names.
- The script starts after the document loads; top-level await works. Errors and console.log show in the
  playground's App panel; ?app=off in the page's URL runs the document without the script.
- fetch reaches public APIs that allow any origin (CORS "*"), e.g. https://api.open-meteo.com; no keys or secrets:
  anyone can read the script (the playground's Script button shows it).
- rc.storage keeps JSON values in the viewer's browser for this page, across visits. localStorage works too
  (strings; the same space, so localStorage.clear() empties rc.storage as well); sessionStorage lasts one visit.

publish checks the script with a dry run: its top level, each timer once, each action handler once with the
document's own value, with a stand-in rc and no network. It reports errors, rc.set / rc.get / rc.onChange of a
variable the document lacks (with the nearest name), handlers for actions the document never sends, and actions
nobody handles. Fix the warnings, then publish again.

Example: a cart. The document has buttons sending hostNamedAction "add" (value "apple", "pear") and "clear", a text
showing @summary (host string) and a total (host float). The script:

type Line = { name: string; price: number };
const PRICES: Record<string, number> = { apple: 0.5, pear: 0.8 };
let cart: Line[] = rc.storage.get("cart") ?? [];
function show() {
  const total = cart.reduce((s, l) => s + l.price, 0);
  rc.set({ total, summary: cart.length ? cart.map((l) => l.name).join(", ") : "Empty" });
  rc.storage.set("cart", cart);
}
rc.onAction("add", (name) => { cart.push({ name: String(name), price: PRICES[String(name)] ?? 0 }); show(); });
rc.onAction("clear", () => { cart = []; show(); });
show();`;
