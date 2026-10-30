#!/usr/bin/env node
// Build and verify the example catalog (docs/EXAMPLES_TAXONOMY.md).
//
//   node examples/tools/build.mjs [ID-or-folder...] [--strict] [--java] [--catalog]
//   (--catalog: rewrite catalog.json even for a partial build, from what this run built)
//
// For each examples/<ID>-<name>/ folder holding doc.json and meta.json (the authored fields):
//   1. convert doc.json with json2rc            -> doc.rc
//   2. check it with rc2image (--check --report) -> parse result, header, op counts, host variables
//   3. render it at the example's canonical inputs (meta.check.render), through rc-render's own
//      render_rc handler, so an example is checked exactly as the MCP tool will show it
//                                               -> render.png, findings
//   4. audit it with rc-inspect                  -> findings, repaint verdict, interaction targets
//   5. derive the fields nothing should hand-write (json keys, operations, evidence for each
//      claimed capability, sizes) and check the authored ones (capabilities exist and have
//      evidence, snippets resolve, related ids exist)
//   6. with --java, convert doc.json with the Java reference parser too
//      (players/conformance/java-json.sh) and require identical bytes
// then writes meta.json's `derived` block and examples/catalog.json, the index rc-examples
// serves. An example that fails a check is reported and left out of the catalog.
//
// Library components (examples/components/<Name>/) are built the same way: next to their
// definition (component.json) each has a demo document (doc.json, calling the component) and
// a meta.json, and gets doc.rc, doc.expanded.json and render.png. Their meta inherits summary,
// capabilities and pitfalls from component.json (meta adds demo-specific ones), and they go
// into catalog.json's `components` list. Name one ("Gauge") or "components" to build them.
//
// meta.check.render gives the canonical render (render.png). meta.check.renders adds more
// (an entry with its own width/height is also a resize check: audited at that size),
// each written to render-<name>.png: [{"name": "light", "theme": "light"}, {"name": "mono",
// "componentTheme": "mono"}, ...]. An entry's keys are render_rc arguments over
// check.render's; `componentTheme` (auto, light, dark, mono) expands the document's components
// in that mode instead, into a document of its own (doc.<name>.expanded.json, doc.<name>.rc),
// which is converted, checked against the Java parser and rendered like the main one.

import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileComponents, jsonToRc } from "../../mcp/lib/json2rc.mjs";
import { checkReport } from "../../mcp/lib/rc2image.mjs";
import { inspect } from "../../mcp/lib/inspector.mjs";
import { usesComponents } from "../../mcp/lib/components.mjs";
import { definition as renderServer } from "../../mcp/rc-render-server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const VOCAB = JSON.parse(readFileSync(path.join(ROOT, "..", "docs", "examples-vocabulary.json"), "utf8"));
const args = process.argv.slice(2);
const STRICT = args.includes("--strict");
const JAVA = args.includes("--java");
const WRITE_CATALOG = args.includes("--catalog");   // rewrite catalog.json from a partial build too
const JAVA_JSON = path.join(ROOT, "..", "players", "conformance", "java-json.sh");
const TMP = JAVA ? mkdtempSync(path.join(os.tmpdir(), "rc-examples-")) : null;
const only = args.filter((a) => !a.startsWith("--"));
const renderRc = renderServer.tools.find((t) => t.name === "render_rc").handler;

/** render_rc on an .rc file: { png, findings: [{level, code, message}] }. */
async function renderFile(rcPath, args) {
    const out = await renderRc({ rc_path: rcPath, public_link: false, ...args });
    const img = out.find((c) => c.type === "image");
    const text = out.filter((c) => c.type === "text").map((c) => c.text).join("\n");
    // render_rc lists them as "level: [code] message" (analysis.mjs formatFindings).
    const findings = [...text.matchAll(/^(error|warning|info): \[([\w-]+)\] (.*)$/gm)]
        .map(([, level, code, message]) => ({ level, code, message }));
    return { png: img ? Buffer.from(img.data, "base64") : null, findings, text };
}

/** The Java reference converter's verdict on plainPath against json2rc's bytes: null when they
 *  match, else the message. */
function javaCheck(plainPath, bytes, tag) {
    const out = path.join(TMP, `${tag.replaceAll("/", "_")}.rc`);
    try {
        execFileSync(JAVA_JSON, [plainPath, out], { stdio: ["ignore", "ignore", "pipe"] });
        const ref = readFileSync(out);
        return Buffer.compare(ref, Buffer.from(bytes)) === 0 ? null
            : `java: the reference converter writes ${ref.length} B, json2rc ${bytes.length} B`;
    } catch (e) {
        const lines = String(e.stderr ?? e.message).trim().split("\n");
        return `java: ${(lines.find((l) => /Exception|Error/.test(l)) ?? lines.pop()).trim()}`;
    }
}

function jsonKeys(node, out = new Set()) {
    if (Array.isArray(node)) node.forEach((x) => jsonKeys(x, out));
    else if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) { out.add(k); jsonKeys(v, out); }
    }
    return out;
}
function jsonStrings(node, out = []) {
    if (typeof node === "string") out.push(node);
    else if (Array.isArray(node)) node.forEach((x) => jsonStrings(x, out));
    else if (node && typeof node === "object") Object.values(node).forEach((v) => jsonStrings(v, out));
    return out;
}
function pointer(doc, p) {
    let cur = doc;
    for (const part of p.split("/").slice(1).map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))) {
        if (cur === undefined || cur === null) return undefined;
        cur = cur[Array.isArray(cur) ? Number(part) : part];
    }
    return cur;
}

/** A capability's evidence is present when one of its tokens is a key of the document, a JSON
 *  pointer that resolves in it, or appears in its strings (expressions such as "animationTime()", names such as "color.system_"). */
function evidenceFor(cap, keys, text, doc) {
    const entry = VOCAB.capabilities[cap];
    if (!entry) return null;
    const lowerKeys = new Set([...keys].map((k) => k.toLowerCase()));
    const found = [];
    for (const tok of entry.evidence) {
        // A JSON pointer ("/header/contentDescription") must resolve in the document.
        if (tok.startsWith("/")) { if (pointer(doc, tok) !== undefined) found.push(tok); continue; }
        if (tok === "<arithmetic>") {
            // An expression written inline as a value: a variable or function with an operator.
            if (/(@[\w.]+|\w+\(\))\s*[-+*/%]|[-+*/%]\s*(@[\w.]+|\w+\()/.test(text)) found.push(tok);
            continue;
        }
        const t = tok.toLowerCase().replace(/\(\)$/, "").split(".").pop();
        const raw = tok.toLowerCase().replace(/\(\)$/, "");
        if (lowerKeys.has(t) || text.includes(raw) || (t.length > 3 && text.includes(t + "("))) found.push(tok);
    }
    return found;
}

const LIB = path.join(ROOT, "components");
const exampleDirs = readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^[A-Z0-9]+-\d\d-/.test(d.name))
    .map((d) => d.name).sort()
    .filter((n) => !only.length || only.some((o) => n.startsWith(o) || n === o))
    .map((dir) => ({ dir, kind: "example" }));
const componentDirs = (existsSync(LIB) ? readdirSync(LIB, { withFileTypes: true }) : [])
    .filter((d) => d.isDirectory() && existsSync(path.join(LIB, d.name, "component.json")))
    .map((d) => d.name).sort()
    .filter((n) => !only.length || only.some((o) => o === n || o === `components/${n}` || o === "components"))
    .map((name) => ({ dir: `components/${name}`, name, kind: "component" }));
const dirs = [...exampleDirs, ...componentDirs];

/** A component's meta as checked and catalogued: the demo's authored fields over the definition's. */
function componentView(authored, def, name) {
    return {
        family: "COMP", kind: "component", ...authored,
        summary: authored.summary ?? def.summary,
        capabilities: authored.capabilities ?? { primary: def.capabilities ?? [], secondary: [] },
        components: authored.components ?? [name],
        pitfalls: [...(def.pitfalls ?? []), ...(authored.pitfalls ?? [])],
    };
}

const catalog = [];
const componentCatalog = [];
const failures = [];
for (const { dir, kind, name } of dirs) {
    const base = path.join(ROOT, dir);
    const problems = [], warnings = [];
    if (!existsSync(path.join(base, "doc.json")) || !existsSync(path.join(base, "meta.json"))) {
        console.log(`FAIL ${dir}\n       ✗ needs doc.json and meta.json`);
        failures.push(dir);
        continue;
    }
    const authored = JSON.parse(readFileSync(path.join(base, "meta.json"), "utf8"));
    const meta = kind === "component"
        ? componentView(authored, JSON.parse(readFileSync(path.join(base, "component.json"), "utf8")), name)
        : authored;
    if (kind === "component" && authored.id !== name) problems.push(`meta id must be "${name}"`);
    const doc = JSON.parse(readFileSync(path.join(base, "doc.json"), "utf8"));
    const derived = {};
    // 0. library components expand to plain JSON (doc.expanded.json), which is what the
    //    Java reference converts; json2rc expands them itself
    let plainPath = path.join(base, "doc.json");
    try {
        if (usesComponents(doc)) {
            const ex = compileComponents(doc, base);
            derived.components = ex.components;
            derived.component_instances = ex.instances;
            // How each component reached the wire (expand or pattern, and why).
            derived.component_modes = ex.modes;
            derived.component_patterns = ex.report.filter((r) => r.mode === "pattern").map((r) => `${r.pattern} x${r.calls}`);
            plainPath = path.join(base, "doc.expanded.json");
            writeFileSync(plainPath, JSON.stringify(ex.doc, null, 1) + "\n");
        }
    } catch (e) { problems.push(`components: ${e.message}`); }
    // 1. convert
    let bytes = null;
    try {
        bytes = jsonToRc(doc, base);
        writeFileSync(path.join(base, "doc.rc"), bytes);
        derived.converter = "json2rc";
        derived.bytes = bytes.length;
    } catch (e) { problems.push(`convert: ${e.message}`); }
    if (bytes) {
        // 2. check
        const { report, log } = await checkReport(path.join(base, "doc.rc"));
        if (!report?.parse?.ok) problems.push(`parse: ${report?.parse?.message ?? log}`);
        else {
            derived.header = report.header;
            derived.op_count = report.ops?.total;
            derived.operations = report.ops?.byName;
            derived.host_variables = (report.namedVariables ?? []).map(({ name, type, value }) => ({ name, type, value }));
        }
        // 3. render at the canonical inputs
        const r = meta.check?.render ?? {};
        try {
            const { png, findings } = await renderFile(path.join(base, "doc.rc"), r);
            if (png) writeFileSync(path.join(base, "render.png"), png);
            derived.render_findings = findings.map((f) => `${f.level}: ${f.code}`);
            for (const f of findings) {
                if (meta.expect_findings?.includes(f.code)) continue;
                if (f.level === "error") problems.push(`render: ${f.code} — ${f.message}`);
                else if (f.level === "warning") warnings.push(`render: ${f.code} — ${f.message}`);
            }
        } catch (e) { problems.push(`render: ${e.message}`); }
        // 4. audit
        try {
            // The authored JSON too: the design rules that need it (repeated subtrees, literal
            // colours) look at what was written, before components expand.
            const a = await inspect(new Uint8Array(bytes), "audit", { width: r.width, height: r.height, source_json: doc });
            derived.audit = a.counts;
            derived.audit_findings = a.findings.map((f) => `${f.severity}: ${f.code}`);
            for (const f of a.findings.filter((f) => f.severity !== "info")) {
                if (!meta.expect_findings?.includes(f.code)) warnings.push(`audit: ${f.severity} ${f.code} — ${f.title}`);
            }
            const s = await inspect(new Uint8Array(bytes), "summary", { width: r.width, height: r.height });
            derived.repaint = s.repaint?.verdict;
            derived.interaction_targets = s.interactions;
        } catch (e) { problems.push(`inspect: ${e.message}`); }
        // An expected finding is required, not just excused: a fixture (DX-*) whose mistake
        // stops being detected is broken.
        const seen = new Set([...(derived.render_findings ?? []), ...(derived.audit_findings ?? [])]
            .map((f) => f.split(": ")[1]));
        for (const code of meta.expect_findings ?? []) {
            if (!seen.has(code)) problems.push(`expected finding ${code} was not reported`);
        }
        // 6. the Java reference converter
        if (JAVA) {
            // meta.java_difference names a known reference bug that explains a difference
            // (for example an SVG path string, which the Java writer pads to 1024 floats).
            const msg = javaCheck(plainPath, bytes, dir);
            derived.java_identical = msg === null;
            if (msg && meta.java_difference) warnings.push(`${msg} (known: ${meta.java_difference})`);
            else if (msg) problems.push(msg);
        }
        // 7. the other renders (meta.check.renders): another theme, or another componentTheme,
        //    which is a document of its own
        const renders = meta.check?.renders ?? [];
        if (renders.length) derived.renders = {};
        for (const entry of renders) {
            const { name: rname, componentTheme, ...opts } = entry;
            if (!/^[a-z][\w-]*$/.test(rname ?? "")) { problems.push(`check.renders: name ${JSON.stringify(rname)} must be a lower-case word`); continue; }
            const info = derived.renders[rname] = {};
            let rcPath = path.join(base, "doc.rc");
            try {
                if (componentTheme !== undefined) {
                    if (!usesComponents(doc)) throw new Error("componentTheme needs a document that uses components");
                    const ex = compileComponents(doc, base, { theme: componentTheme });
                    const variantPlain = path.join(base, `doc.${rname}.expanded.json`);
                    writeFileSync(variantPlain, JSON.stringify(ex.doc, null, 1) + "\n");
                    const vbytes = jsonToRc(ex.doc, base);
                    rcPath = path.join(base, `doc.${rname}.rc`);
                    writeFileSync(rcPath, vbytes);
                    Object.assign(info, { componentTheme, bytes: vbytes.length, component_modes: ex.modes });
                    if (ex.motion_removed) info.motion_removed = ex.motion_removed;
                    const { report, log } = await checkReport(rcPath);
                    if (!report?.parse?.ok) throw new Error(`parse: ${report?.parse?.message ?? log}`);
                    info.op_count = report.ops?.total;
                    info.host_variables = (report.namedVariables ?? []).map(({ name, type, value }) => ({ name, type, value }));
                    if (JAVA) {
                        const msg = javaCheck(variantPlain, vbytes, `${dir}.${rname}`);
                        info.java_identical = msg === null;
                        if (msg && meta.java_difference) warnings.push(`${rname}: ${msg} (known: ${meta.java_difference})`);
                        else if (msg) problems.push(`${rname}: ${msg}`);
                    }
                    const s = await inspect(new Uint8Array(vbytes), "summary", { width: r.width, height: r.height });
                    info.repaint = s.repaint?.verdict;
                }
                const args = { ...r, ...opts };
                if (opts.theme) info.theme = opts.theme;
                const { png, findings } = await renderFile(rcPath, args);
                if (png) writeFileSync(path.join(base, `render-${rname}.png`), png);
                info.render = `render-${rname}.png`;
                info.render_findings = findings.map((f) => `${f.level}: ${f.code}`);
                for (const f of findings) {
                    if (meta.expect_findings?.includes(f.code)) continue;
                    if (f.level === "error") problems.push(`render ${rname}: ${f.code} — ${f.message}`);
                    else if (f.level === "warning") warnings.push(`render ${rname}: ${f.code} — ${f.message}`);
                }
                // A render at another size is a resize check: audit the layout at that size too.
                if (opts.width !== undefined || opts.height !== undefined) {
                    const w = opts.width ?? r.width, h = opts.height ?? r.height;
                    const a = await inspect(new Uint8Array(readFileSync(rcPath)), "audit", { width: w, height: h });
                    info.size = [w, h];
                    info.audit_findings = a.findings.map((f) => `${f.severity}: ${f.code}`);
                    for (const f of a.findings.filter((f) => f.severity !== "info" && /^layout_/.test(f.code))) {
                        if (!meta.expect_findings?.includes(f.code)) warnings.push(`resize ${rname} (${w}×${h}): ${f.code} — ${f.title}`);
                    }
                }
            } catch (e) { problems.push(`render ${rname}: ${e.message}`); }
        }
    }
    // 5. derive + check authored fields
    // Evidence comes from what the document really contains: its expanded form when it
    // calls library components.
    const plain = plainPath === path.join(base, "doc.json") ? doc : JSON.parse(readFileSync(plainPath, "utf8"));
    const keys = jsonKeys(plain);
    for (const k of jsonKeys(doc)) keys.add(k);
    const text = jsonStrings(plain).join("\n").toLowerCase();
    derived.json_keys = [...keys].sort();
    derived.evidence = {};
    const caps = [...(meta.capabilities?.primary ?? []), ...(meta.capabilities?.secondary ?? [])];
    for (const cap of caps) {
        const ev = evidenceFor(cap, keys, text, plain);
        if (ev === null) problems.push(`capability ${cap} is not in the vocabulary`);
        else if (!ev.length) problems.push(`capability ${cap} has no evidence in the document (${VOCAB.capabilities[cap].evidence.join(", ")})`);
        else derived.evidence[cap] = ev;
    }
    for (const u of meta.use_cases ?? []) if (!VOCAB.use_cases[u]) problems.push(`use case ${u} is not in the vocabulary`);
    if (meta.form_factor && !VOCAB.form_factors[meta.form_factor]) problems.push(`form factor ${meta.form_factor} is not in the vocabulary`);
    for (const c of meta.components ?? []) if (!VOCAB.components?.[c]) warnings.push(`component ${c} is not in the vocabulary`);
    if (kind === "component" && !(derived.components ?? []).includes(name)) problems.push(`the demo does not call ${name}`);
    for (const c of derived.components ?? []) {
        if (!(meta.components ?? []).includes(c)) warnings.push(`uses component ${c}; list it in meta.components`);
    }
    for (const sn of meta.snippets ?? []) {
        if (pointer(doc, sn.pointer) === undefined) problems.push(`snippet ${sn.pointer} does not resolve`);
        if (sn.shows && !caps.includes(sn.shows)) warnings.push(`snippet ${sn.pointer} shows ${sn.shows}, which the example does not claim`);
    }
    for (const p of meta.capabilities?.primary ?? []) {
        if (!(meta.snippets ?? []).some((s) => s.shows === p)) problems.push(`primary capability ${p} has no snippet`);
    }
    if ((meta.teaches ?? []).length < 2) problems.push("teaches: at least two lines");
    // Documents get resized: each example renders at another size (a check.renders entry with
    // width/height), or says why it is fixed-size (meta.fixed_size: "a 227×227 watch face").
    if (!(meta.check?.renders ?? []).some((e) => e.width !== undefined || e.height !== undefined) && !meta.fixed_size) {
        warnings.push("no resize check: add a check.renders entry with another width/height, or meta.fixed_size with the reason");
    }
    // Every exported number needs a range (meta.inputs.variables.<name>.min/max): the playground's
    // slider uses it and an agent setting the variable knows what makes sense.
    for (const v of derived.host_variables ?? []) {
        if (!["float", "int", "integer"].includes(v.type)) continue;
        const spec = meta.inputs?.variables?.[v.name];
        const r = spec && typeof spec === "object" ? spec : {};
        if (typeof r.min !== "number" || typeof r.max !== "number") { warnings.push(`host variable ${v.name}: give it a range (inputs.variables.${v.name}.min/max)`); continue; }
        if (r.min >= r.max) problems.push(`host variable ${v.name}: min ${r.min} is not below max ${r.max}`);
        else if (v.value < r.min - 1e-6 || v.value > r.max + 1e-6) problems.push(`host variable ${v.name}: its value ${v.value} is outside ${r.min}..${r.max}`);
    }
    derived.built_at = new Date().toISOString();
    authored.derived = derived;
    writeFileSync(path.join(base, "meta.json"), JSON.stringify(authored, null, 1) + "\n");

    const ok = !problems.length && (!STRICT || !warnings.length);
    console.log(`${ok ? "ok  " : "FAIL"} ${dir}${derived.bytes ? ` (${derived.bytes} B, ${derived.op_count} ops)` : ""}`);
    for (const p of problems) console.log(`       ✗ ${p}`);
    for (const w of warnings) console.log(`       ! ${w}`);
    if (ok) {
        const { derived: _, ...fields } = meta;
        const d = derived;
        (kind === "component" ? componentCatalog : catalog).push({ ...fields, folder: dir,
            derived: { bytes: d.bytes, op_count: d.op_count, header: d.header, host_variables: d.host_variables,
                       components: d.components, java_identical: d.java_identical,
                       ...(d.renders ? { renders: Object.fromEntries(Object.entries(d.renders).map(([k, v]) => [k, { render: v.render, theme: v.theme, componentTheme: v.componentTheme, bytes: v.bytes, host_variables: v.host_variables }])) } : {}), repaint: d.repaint, interaction_targets: d.interaction_targets, audit: d.audit,
                       evidence: d.evidence, json_keys: d.json_keys } });
    } else failures.push(dir);
}
if (!only.length || WRITE_CATALOG) {
    // `related` ids must name examples that exist (the plan's ids that aren't built yet don't).
    const ids = new Set([...catalog, ...componentCatalog].map((e) => e.id));
    for (const e of [...catalog, ...componentCatalog]) {
        const missing = (e.related ?? []).filter((r) => !ids.has(r));
        if (missing.length) console.log(`  !  ${e.folder}: related ${missing.join(", ")} not in the catalog (yet)`);
    }
    writeFileSync(path.join(ROOT, "catalog.json"), JSON.stringify({ version: 1, vocabulary: "docs/examples-vocabulary.json",
        built_at: new Date().toISOString(), examples: catalog, components: componentCatalog }, null, 1) + "\n");
}
console.log(`\n${exampleDirs.length} example(s), ${componentDirs.length} component(s): ${dirs.length - failures.length} ok, ${failures.length} failed` +
            (only.length && !WRITE_CATALOG ? " (catalog.json not rewritten for a partial build)" : ""));
process.exit(failures.length ? 1 : 0);
