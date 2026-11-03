import test from "node:test";
import assert from "node:assert/strict";
import { appScriptTag, checkAppScript, compileAppScript, describeCheck, documentActions, scriptsAllowed } from "./app-script.mjs";

test("compile: TypeScript to JS, one file, syntax errors with their line", () => {
    const js = compileAppScript("type P = { n: number };\nconst p: P = { n: 2 };\nrc.set('x', p.n as number);");
    assert.ok(!/type P|: P|as number/.test(js), js);
    assert.match(js, /rc\.set\('x', p\.n/);
    assert.throws(() => compileAppScript('import { x } from "y";\nrc.set("a", x);'), /no import or export/);
    assert.throws(() => compileAppScript("export const a = 1;"), /no import or export/);
    assert.throws(() => compileAppScript("   "), /empty/);
    assert.throws(() => compileAppScript("const a = 1;\nconst b: number = ;"), /line 2/);
    assert.throws(() => compileAppScript("x".repeat(70_000)), /bytes/);
    // Dynamic import() is a call, not an import statement: it compiles (and fails at run time in the sandbox).
    assert.doesNotThrow(() => compileAppScript("const m = import('x');"));
    // Top-level await works (the runtime wraps it in an async function).
    assert.doesNotThrow(() => compileAppScript("const r = await Promise.resolve(1);\nrc.set('x', r);"));
});

test("the script tag cannot end its element early", () => {
    const tag = appScriptTag(compileAppScript('rc.log("</script><script>alert(1)</script>");'));
    assert.ok(!/<\/script/i.test(tag));
    assert.match(tag, /^self\.__rcMain = async function/);
});

test("documentActions: the hostNamedAction names and literal values a document sends", () => {
    const doc = { root: { column: { children: [
        { box: { modifiers: [{ onClick: { type: "hostNamedAction", name: "add", value: "apple" } }] } },
        { box: { modifiers: [{ onClick: [{ type: "hostNamedAction", name: "add", value: "pear" }, { type: "valueFloatChange", target: "@x", value: 1 }] }] } },
        { Button: { onClick: [{ type: "hostNamedAction", name: "clear" }] } },
    ] } } };
    assert.deepEqual(documentActions(doc), { add: ["apple", "pear"], clear: [] });
    assert.deepEqual(documentActions(JSON.stringify(doc)).add, ["apple", "pear"]);
    assert.deepEqual(documentActions("not json"), {});
});

test("dry run: what it sets, typos with the nearest name, wrong types, unknown and unhandled actions", async () => {
    const js = compileAppScript(`
const cart: string[] = rc.storage.get("cart") ?? [];
rc.set({ total: 0, labl: "x" });
rc.set("count", "three");
rc.onAction("add", (v) => { cart.push(String(v)); rc.set("total", cart.length * 0.5); });
rc.onAction("chekout", () => rc.set("status", "paid"));
rc.onChange("qty", (v) => rc.set("label", "qty " + v));
setInterval(() => rc.set("clock", "now"), 1000);
fetch("https://example.com").then(() => rc.set("status", "online"));
`);
    const r = await checkAppScript(js, { variables: { total: "float", count: "int", label: "string", status: "string", qty: "float" }, actions: { add: ["apple"], checkout: [] } });
    assert.deepEqual(r.errors, []);
    const w = r.warnings.join("\n");
    assert.match(w, /rc\.set\("labl"\): the document has no variable "labl" \(did you mean "label"\?\)/);
    assert.match(w, /"count" is an int and takes a number/);
    assert.match(w, /rc\.set\("clock"\)/, "found inside a timer");
    assert.match(w, /no action "chekout" \(it sends "add", "checkout"\) \(did you mean "checkout"\?\)/);
    assert.match(w, /sends "checkout", which the script does not handle/);
    assert.equal(r.sets.total, 0.5, "the add handler ran with the document's value");
    assert.equal(r.sets.label, "qty 0", "the onChange handler ran");
    assert.deepEqual(r.listens.sort(), ["add", "chekout"]);
    assert.deepEqual(r.uses.sort(), ["fetch", "storage", "timers"]);
    assert.match(describeCheck(r), /Script warnings:[\s\S]*Script dry run: sets total = /);
});

test("dry run: errors with their TypeScript line, endless loops, no actions known for a .rc", async () => {
    let r = await checkAppScript(compileAppScript("const a = 1;\nnull.x;"), {});
    assert.match(r.errors[0], /top level: TypeError: .*\(line 2\)/);
    r = await checkAppScript(compileAppScript("rc.onAction('go', () => { throw new Error('boom'); });"), { actions: null });
    assert.match(r.errors[0], /the "go" action handler: boom/);
    assert.ok(!r.warnings.some((x) => /sends no action/.test(x)), "actions unknown: no claim about them");
    r = await checkAppScript(compileAppScript("while (true) {}"), {});
    assert.match(r.errors[0], /too long|endless/);
    r = await checkAppScript(compileAppScript("setTimeout(() => { for (;;) {} }, 10);"), {});
    assert.match(r.errors.join(" "), /endless loop/);
    // A rejection the script never catches is its error, not the server's.
    r = await checkAppScript(compileAppScript("Promise.reject(new Error('stray'));"), {});
    assert.match(r.errors.join(" "), /rejected and not caught: stray/);
    // Async work that never ends is cut off; the server goes on.
    r = await checkAppScript(compileAppScript("(async () => { for (;;) await null; })();"), {});
    assert.match(r.errors.join(" "), /endless loop|did not finish/);
    // No code generation from strings in the check.
    r = await checkAppScript(compileAppScript("eval('1 + 1');"), {});
    assert.match(r.errors[0], /Code generation from strings disallowed|EvalError/);
});

test("scriptsAllowed: off everywhere with RC_SCRIPTS=off, per account, else RC_SCRIPTS=on", () => {
    assert.equal(scriptsAllowed({ id: 3, scripts: true }, {}), true);
    assert.equal(scriptsAllowed({ id: 3, scripts: false }, {}), false);
    assert.equal(scriptsAllowed({ id: 0 }, {}), true, "the admin key");
    assert.equal(scriptsAllowed({ id: 3, scripts: true }, { RC_SCRIPTS: "off" }), false);
    assert.equal(scriptsAllowed(null, {}), false);
    assert.equal(scriptsAllowed(null, { RC_SCRIPTS: "on" }), true);
});

test("dry run: localStorage and sessionStorage are there, as strings", async () => {
    const r = await checkAppScript(compileAppScript(`
const n = Number(localStorage.getItem("n") ?? "0") + 1;
localStorage.setItem("n", n);
sessionStorage.setItem("seen", "yes");
rc.set("label", localStorage.getItem("n") + " " + typeof localStorage.getItem("n") + " " + localStorage.length);
`), { variables: { label: "string" } });
    assert.deepEqual(r.errors, []);
    assert.equal(r.sets.label, "1 string 1");
    assert.ok(r.uses.includes("storage"));
});
