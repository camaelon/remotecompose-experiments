/**
 * The editor: type JSON on the left, watch the document play on the right.
 *
 * The compile step is this package; playback is the existing TypeScript player, which
 * is loaded alongside and exposes `window.RC.RcdPlayer`. Nothing here talks to a
 * server — compilation is local, so the round trip is a keystroke, not a request.
 */

import { compile, NotImplementedComponent } from "../engine/parser.js";

declare global {
    interface Window {
        RC?: { RcdPlayer: new (canvas: HTMLCanvasElement) => RcPlayer };
        RCJSON?: unknown;
    }
}

interface RcPlayer {
    loadFromArrayBuffer(buf: ArrayBuffer): Promise<void>;
    setTheme?(theme: number): void;
    destroy?(): void;
    stop?(): void;
}

const $ = <T extends HTMLElement>(id: string): T =>
    document.getElementById(id) as T;

let player: RcPlayer | null = null;
let lastGood: Uint8Array | null = null;

function setStatus(kind: "ok" | "warn" | "err", text: string): void {
    const el = $("status");
    el.className = `status ${kind}`;
    el.textContent = text;
}

/** Which line and column a character offset falls on, for a parse error. */
function lineCol(text: string, offset: number): string {
    const upto = text.slice(0, offset);
    const line = upto.split("\n").length;
    const col = offset - upto.lastIndexOf("\n");
    return `line ${line}, column ${col}`;
}

function play(bytes: Uint8Array): void {
    const stage = $("stage");
    // A player holds a WebGL context when the document uses a shader, and a browser
    // keeps only ~16 of those. Recompiling on every keystroke would burn through them
    // in seconds, so the old one is torn down before the new one is built.
    if (player) {
        try { player.destroy ? player.destroy() : player.stop?.(); } catch { /* ignore */ }
        player = null;
    }
    stage.innerHTML = "";
    const canvas = document.createElement("canvas");
    stage.appendChild(canvas);

    if (!window.RC?.RcdPlayer) {
        setStatus("err", "player bundle not loaded");
        return;
    }
    const copy = bytes.slice();
    player = new window.RC.RcdPlayer(canvas);
    player.loadFromArrayBuffer(copy.buffer as ArrayBuffer).catch((e: unknown) => {
        setStatus("err", `player rejected the document: ${e}`);
    });
}

function run(): void {
    const text = $<HTMLTextAreaElement>("editor").value;

    let doc: unknown;
    try {
        doc = JSON.parse(text);
    } catch (e) {
        const m = /position (\d+)/.exec(String(e));
        const where = m ? ` (${lineCol(text, Number(m[1]))})` : "";
        setStatus("err", `not valid JSON${where}: ${String(e).replace(/^SyntaxError: /, "")}`);
        return;
    }

    let bytes: Uint8Array;
    try {
        bytes = compile(doc);
    } catch (e) {
        // An unsupported construct is a different thing from a broken document, and
        // saying which is the difference between "fix your JSON" and "this engine
        // cannot do that yet".
        const unsupported = e instanceof NotImplementedComponent;
        setStatus(unsupported ? "warn" : "err",
            `${unsupported ? "not supported yet" : "compile failed"}: ${(e as Error).message}`);
        return;
    }

    lastGood = bytes;
    setStatus("ok", `${bytes.length} bytes`);
    $("download").removeAttribute("disabled");
    play(bytes);
}

function download(): void {
    if (!lastGood) return;
    const blob = new Blob([lastGood.slice() as unknown as BlobPart],
        { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "document.rc";
    a.click();
    URL.revokeObjectURL(a.href);
}

const SAMPLES: Record<string, unknown> = {
    "Hello": {
        header: { apiLevel: 7, width: 400, height: 300, profiles: 513 },
        root: {
            column: {
                modifiers: ["fillMaxSize", { background: "#FF101418" }],
                horizontalAlignment: "center",
                verticalAlignment: "center",
                children: [
                    { text: { value: "Hello", fontSize: 42.0, color: "#FFFFFFFF" } },
                    { text: { value: "RemoteCompose", fontSize: 18.0, color: "#FF8B95A5" } },
                ],
            },
        },
    },
    "Canvas": {
        header: { apiLevel: 7, width: 400, height: 400, profiles: 513 },
        root: {
            canvas: {
                modifiers: ["fillMaxSize"],
                commands: [
                    { paint: { color: "#FF0E1116", style: "fill" } },
                    { drawRect: { left: 0, top: 0, right: 400, bottom: 400 } },
                    { paint: { color: "#FF4DA3FF", style: "fill" } },
                    { drawCircle: { cx: 200.0, cy: 200.0, radius: 120.0 } },
                    { paint: { color: "#FFFFFFFF", style: "stroke", strokeWidth: 6.0 } },
                    { drawCircle: { cx: 200.0, cy: 200.0, radius: 150.0 } },
                ],
            },
        },
    },
    "Animated": {
        header: { apiLevel: 7, width: 400, height: 400, profiles: 513 },
        root: {
            canvas: {
                modifiers: ["fillMaxSize"],
                commands: [
                    { paint: { color: "#FF12161C", style: "fill" } },
                    { drawRect: { left: 0, top: 0, right: 400, bottom: 400 } },
                    { paint: { color: "#FF35D07F", style: "fill" } },
                    {
                        drawCircle: {
                            cx: "200 + sin(seconds) * 90",
                            cy: "200 + cos(seconds) * 90",
                            radius: 28.0,
                        },
                    },
                ],
            },
        },
    },
};

function init(): void {
    const editor = $<HTMLTextAreaElement>("editor");

    const picker = $<HTMLSelectElement>("samples");
    for (const name of Object.keys(SAMPLES)) {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        picker.appendChild(opt);
    }
    const load = (name: string): void => {
        editor.value = JSON.stringify(SAMPLES[name], null, 2);
        run();
    };
    picker.addEventListener("change", () => load(picker.value));

    // Recompile shortly after typing stops. Compiling is sub-millisecond, but building
    // a player is not, so this debounce is about the playback side.
    let timer: number | undefined;
    editor.addEventListener("input", () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(run, 400);
    });
    editor.addEventListener("keydown", (e) => {
        // Tab indents rather than leaving the field — this is a code editor.
        if (e.key === "Tab") {
            e.preventDefault();
            const s = editor.selectionStart, t = editor.selectionEnd;
            editor.value = editor.value.slice(0, s) + "  " + editor.value.slice(t);
            editor.selectionStart = editor.selectionEnd = s + 2;
        }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); }
    });

    $("run").addEventListener("click", run);
    $("download").addEventListener("click", download);

    const stored = localStorage.getItem("rcjson.editor");
    if (stored) { editor.value = stored; run(); } else { load("Hello"); }
    window.addEventListener("beforeunload", () => {
        localStorage.setItem("rcjson.editor", editor.value);
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}

export { compile };
