// createHostApi against the real player core, headless: a document with a host string, a host
// float and a hostNamedAction; set, get, onAction, onChange, and a reload keeping what was set.
//
//   node tests/host_api_test.mjs      (after building build-node/node-entry.js and build-json2rc)

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const { createCanvas } = createRequire(path.join(root, "package.json"))("canvas");
globalThis.Path2D = class { moveTo() {} lineTo() {} quadraticCurveTo() {} bezierCurveTo() {} arc() {} rect() {} closePath() {} addPath() {} };
const { RemoteComposeBuffer, CoreDocument, CanvasPaintContext, WebRemoteContext, createHostApi } =
    await import(pathToFileURL(path.join(root, "build-node", "node-entry.js")).href);
const { convert } = createRequire(import.meta.url)(path.join(root, "build-json2rc", "Parser.js"));

const DOC = { header: { apiLevel: 7, width: 200, height: 120, profiles: 513 },
    resources: { variables: { price: { value: 2, export: true } }, colors: { accent: "#FF2B7FD9" } },
    root: [
        { variable: { name: "label", vtype: "string", value: "Start", export: true } },
        { column: { modifiers: ["fillMaxSize"], children: [
            { text: { text: "@label" } },
            { box: { modifiers: [{ size: [200, 60] }, { onClick: { type: "hostNamedAction", name: "buy", value: "apple" } }] } },
        ] } }] };
const bytes = convert(DOC);

/** A minimal stand-in for RcdPlayer: what createHostApi uses (getDocument, getRemoteContext, repaint). */
function player() {
    let doc = null, ctx = null;
    const load = () => {
        doc = new CoreDocument();
        doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
        doc.setWidth(200); doc.setHeight(120);
        const c = createCanvas(200, 120);
        const paint = new CanvasPaintContext(null, c.getContext("2d"));
        ctx = new WebRemoteContext(paint);
        ctx.mWidth = 200; ctx.mHeight = 120;
        doc.initializeContext(ctx);
        ctx.setPaintContext(paint); paint.setContext(ctx);
        doc.applyDataOperations(ctx);
        p.repaint();
    };
    const p = {
        load,
        getDocument: () => doc,
        getRemoteContext: () => ctx,
        repaint: () => { if (doc) { doc.paint(ctx, -1); } },
        click: (x, y) => { doc.onClick(ctx, x, y); p.repaint(); },
    };
    load();
    return p;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const p = player();
const host = createHostApi(p);
await sleep(60);

const vars = host.variables();
assert.equal(vars.label, "string");
assert.equal(vars.price, "float");
assert.equal(vars.accent, "color");
assert.equal(host.get("label"), "Start");
assert.equal(host.get("price"), 2);
assert.equal(host.get("accent"), "#FF2B7FD9");
assert.equal(host.get("nope"), undefined);

// set: by type; refused when it does not fit or the name is unknown.
assert.equal(host.set("label", "Hello"), true);
assert.equal(host.get("label"), "Hello");
assert.equal(host.set("price", 3.5), true);
assert.equal(host.get("price"), 3.5);
assert.equal(host.set("accent", "#00FF00"), true);
assert.equal(host.get("accent"), "#FF00FF00");
assert.equal(host.set("price", "lots"), false);
assert.equal(host.set("nope", 1), false);

// onAction: the document's hostNamedAction, with its value; "*" too; removable.
const got = [];
const off = host.onAction("buy", (v, n) => got.push([n, v]));
host.onAction("*", (v, n) => got.push(["*", n]));
p.click(100, 60);
assert.deepEqual(got, [["buy", "apple"], ["*", "buy"]]);
off();
p.click(100, 60);
assert.deepEqual(got.slice(2), [["*", "buy"]]);

// onChange: a value changed by someone else (here the context directly), seen on the next tick.
const changes = [];
host.onChange("price", (v) => changes.push(v));
await sleep(60);
p.getRemoteContext().setNamedFloatOverride("price", 9);
await sleep(80);
assert.deepEqual(changes, [9]);

// A reload (restart, theme switch): the values set are applied to the new document, listeners follow.
p.load();
await sleep(80);
assert.equal(host.get("label"), "Hello");
assert.equal(host.get("accent"), "#FF00FF00");
p.click(100, 60);
assert.equal(got.at(-1)[0], "*");

host.dispose();
console.log("host_api_test: ok");
