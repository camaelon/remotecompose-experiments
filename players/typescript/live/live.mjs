// live.mjs — browse a directory of JSON documents, then edit one and watch it redraw.
//
//     node live/live.mjs live/               --open     a directory: opens the browser
//     node live/live.mjs live/demo.json      --open     one file: opens straight into it
//     node live/live.mjs ../../../rcJson/iot-panels/src
//
// Every .json under the target is compiled with the TypeScript converter (`json2rc`) on
// startup, so the browse list can show what each one costs before you open it. After that
// the directory is watched: any file that changes is recompiled and pushed to the page over
// Server-Sent Events, which redraws it without a reload.
//
// Two behaviours matter when a human — or an agent — is editing a file live:
//
//   * A broken document does not blank the screen. The last version that compiled keeps
//     playing and the error appears beside its source, so a typo mid-edit is a red line
//     rather than an empty panel that looks like a crash.
//   * A save caught mid-write is retried once before it is called an error. Editors write
//     in two steps and `fs.watch` happily fires between them, which shows up as a JSON
//     syntax error that fixes itself — noise otherwise indistinguishable from a mistake.
//
// Dependency-free beyond the converter: node's http/fs/zlib, and esbuild only if the
// browser bundle needs building.

import { createServer } from 'http';
import { readFileSync, existsSync, watch, statSync, readdirSync } from 'fs';
import { gzipSync } from 'zlib';
import { createRequire } from 'module';
import { spawnSync } from 'child_process';
import { dirname, join, basename, resolve, relative, sep } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const require = createRequire(import.meta.url);

// ── arguments ────────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const positional = argv.filter((a) => !a.startsWith('--'));
const TARGET = resolve(positional[0] ?? HERE);
const PORT = Number((argv.find((a) => a.startsWith('--port=')) ?? '').split('=')[1] || 7654);

if (!existsSync(TARGET)) {
    console.error(`no such path: ${TARGET}`);
    process.exit(2);
}

const SINGLE = statSync(TARGET).isFile();
const BASE = SINGLE ? dirname(TARGET) : TARGET;

// ── the converter ────────────────────────────────────────────────────────────────────────
//
// json2rc is TypeScript compiled to CommonJS in build-json2rc/. A stale build would demo a
// converter that is not the one in src/, silently, so the mtimes are compared and the build
// re-run rather than trusted.

function newestMtime(dir, ext) {
    let newest = 0;
    for (const name of readdirSync(dir)) {
        if (!name.endsWith(ext)) continue;
        newest = Math.max(newest, statSync(join(dir, name)).mtimeMs);
    }
    return newest;
}

const BUILD = join(ROOT, 'build-json2rc', 'Parser.js');
if (!existsSync(BUILD) || statSync(BUILD).mtimeMs < newestMtime(join(ROOT, 'src', 'json2rc'), '.ts')) {
    process.stderr.write('converter is stale, rebuilding… ');
    const r = spawnSync('bash', [join(ROOT, 'src', 'json2rc', 'build.sh')], { encoding: 'utf8' });
    if (r.status !== 0) {
        console.error(`\nbuild.sh failed:\n${r.stderr || r.stdout}`);
        process.exit(1);
    }
    process.stderr.write('ok\n');
}
const { convert } = require(BUILD);

const BUNDLE = join(ROOT, 'web-player', 'bundle.js');
if (!existsSync(BUNDLE)) {
    process.stderr.write('player bundle missing, building… ');
    const r = spawnSync('npm', ['run', 'bundle'], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) {
        console.error(`\nnpm run bundle failed:\n${r.stderr || r.stdout}`);
        process.exit(1);
    }
    process.stderr.write('ok\n');
}

// ── finding documents ────────────────────────────────────────────────────────────────────

const SKIP = new Set(['node_modules', '.git', 'build', 'out', 'dist', 'preview']);

function findJson(dir, depth = 0) {
    if (depth > 4) return [];
    const found = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP.has(entry.name)) continue;
            found.push(...findJson(full, depth + 1));
        } else if (entry.name.endsWith('.json')) {
            // package.json and friends are not documents; they would each cost a compile
            // and then sit in the list as permanent red rows.
            if (entry.name === 'package.json' || entry.name === 'package-lock.json') continue;
            found.push(full);
        }
    }
    return found;
}

/** Relative path from BASE, always with forward slashes so it is safe in a URL. */
const relOf = (p) => relative(BASE, p).split(sep).join('/');

// ── compiling ────────────────────────────────────────────────────────────────────────────

const records = new Map();     // rel -> record (stats only; source/bytes live alongside)
const payloads = new Map();    // rel -> { source, b64 } for the newest *successful* compile

function stamp() {
    return new Date().toTimeString().slice(0, 8);
}

/**
 * Compile one file and update its record.
 *
 * On failure the record is marked broken but `payloads` is left alone, so a page showing
 * the file keeps playing the last version that worked while displaying the error.
 */
function compileOne(path, attempt = 0) {
    const rel = relOf(path);
    const t0 = performance.now();
    let text;
    try {
        text = readFileSync(path, 'utf8');
    } catch (e) {
        return fail(rel, `unreadable: ${e.message}`, undefined);
    }
    let bytes;
    try {
        bytes = convert(text, { baseDir: dirname(path) });
    } catch (e) {
        const transient = e instanceof SyntaxError || /JSON/i.test(e.message ?? '');
        if (transient && attempt === 0) return setTimeout(() => compileOne(path, 1), 90);
        return fail(rel, `${e.name}: ${e.message}`, text);
    }

    let w = null, h = null;
    try {
        const header = JSON.parse(text).header ?? {};
        w = header.width ?? null;
        h = header.height ?? null;
    } catch { /* the converter already accepted it; a header read is a nicety */ }

    const prev = records.get(rel);
    const rec = {
        rel,
        name: basename(path),
        ok: true,
        w, h,
        json: Buffer.byteLength(text),
        size: bytes.length,
        gzip: gzipSync(bytes, { level: 9 }).length,
        ms: Math.round(performance.now() - t0),
        at: stamp(),
        error: null,
    };
    records.set(rel, rec);
    payloads.set(rel, { source: text, b64: Buffer.from(bytes).toString('base64') });

    const delta = prev && prev.ok ? bytes.length - prev.size : 0;
    const sign = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '·';
    console.log(`${rec.at}  ${rel}  ${bytes.length.toLocaleString()} B  ${sign.padStart(6)}  ${rec.ms} ms`);
    broadcast({ type: 'update', record: rec, ...payloads.get(rel) });
    return rec;
}

function fail(rel, message, text) {
    const prev = records.get(rel) ?? {};
    const rec = { ...prev, rel, name: basename(rel), ok: false, error: message, at: stamp() };
    records.set(rel, rec);
    console.log(`${rec.at}  ${rel}  ✗ ${message}`);
    // The source still goes to the page: the point of showing the JSON is to see the edit
    // that broke it, which is exactly when it must not disappear.
    broadcast({ type: 'update', record: rec, source: text });
    return rec;
}

// ── watching ─────────────────────────────────────────────────────────────────────────────
//
// The *directory* is watched, not individual files. An editor that saves by writing a
// temporary file and renaming it over the original replaces the inode, and a watch on the
// file follows the old one into the void — the first save works and nothing after it does.

const timers = new Map();
watch(BASE, { recursive: !SINGLE }, (_event, name) => {
    if (!name) return;
    const rel = name.split(sep).join('/');
    if (!rel.endsWith('.json')) return;
    if (SINGLE && resolve(BASE, name) !== TARGET) return;
    clearTimeout(timers.get(rel));
    timers.set(rel, setTimeout(() => {
        const full = resolve(BASE, name);
        if (existsSync(full)) compileOne(full);
    }, 60));
});

// ── serving ──────────────────────────────────────────────────────────────────────────────

const clients = new Set();

function broadcast(payload) {
    const line = `data: ${JSON.stringify(payload)}\n\n`;
    for (const c of clients) {
        try {
            c.write(line);
        } catch {
            clients.delete(c);
        }
    }
}

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
};

const server = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname === '/events') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        });
        res.write('retry: 500\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
    }

    if (url.pathname === '/list') {
        return json(res, {
            base: BASE,
            single: SINGLE ? relOf(TARGET) : null,
            files: [...records.values()].sort((a, b) => a.rel.localeCompare(b.rel)),
        });
    }

    if (url.pathname === '/doc') {
        const rel = url.searchParams.get('p') ?? '';
        const rec = records.get(rel);
        if (!rec) return json(res, { error: 'unknown document' }, 404);
        return json(res, { record: rec, ...(payloads.get(rel) ?? {}) });
    }

    const file =
        url.pathname === '/' ? join(HERE, 'index.html')
        : url.pathname === '/bundle.js' ? BUNDLE
        : url.pathname === '/view.mjs' ? join(HERE, 'view.mjs')
        : null;
    if (!file || !existsSync(file)) {
        res.writeHead(404).end('not found');
        return;
    }
    res.writeHead(200, { 'Content-Type': MIME[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
});

function json(res, body, code = 200) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
}

// ── go ───────────────────────────────────────────────────────────────────────────────────

const found = SINGLE ? [TARGET] : findJson(BASE);
if (found.length === 0) {
    console.error(`no .json documents under ${BASE}`);
    process.exit(2);
}

console.log(`compiling ${found.length} document${found.length === 1 ? '' : 's'} from ${BASE}`);
const t0 = performance.now();
let ok = 0;
for (const f of found) {
    // Startup is quiet: one line per file would bury the summary under eighty of them.
    const rel = relOf(f);
    try {
        const text = readFileSync(f, 'utf8');
        const bytes = convert(text, { baseDir: dirname(f) });
        let w = null, h = null;
        try {
            const header = JSON.parse(text).header ?? {};
            w = header.width ?? null;
            h = header.height ?? null;
        } catch { /* nicety */ }
        records.set(rel, {
            rel, name: basename(f), ok: true, w, h,
            json: Buffer.byteLength(text),
            size: bytes.length,
            gzip: gzipSync(bytes, { level: 9 }).length,
            ms: 0, at: stamp(), error: null,
        });
        payloads.set(rel, { source: text, b64: Buffer.from(bytes).toString('base64') });
        ok++;
    } catch (e) {
        records.set(rel, {
            rel, name: basename(f), ok: false, w: null, h: null,
            json: existsSync(f) ? statSync(f).size : 0,
            size: null, gzip: null, ms: 0, at: stamp(),
            error: `${e.name}: ${e.message}`,
        });
    }
}
console.log(`  ${ok}/${found.length} compiled in ${Math.round(performance.now() - t0)} ms`);

server.listen(PORT, () => {
    const url = `http://localhost:${PORT}/`;
    console.log(`watching ${BASE}`);
    console.log(`serving  ${url}`);
    if (flags.has('--open')) {
        // --app gives a window with no tab strip or address bar.
        spawnSync('open', ['-na', 'Google Chrome', '--args',
                           `--app=${url}`, '--window-size=1180,900'], { stdio: 'ignore' });
    }
});
