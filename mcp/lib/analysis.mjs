// Turns rc2image's --report facts into findings a caller can act on.
//
// rc2image reports only what it observed (op counts, declared variables, font families,
// pixel stats); what counts as suspicious lives here, so thresholds can change without a
// rebuild. Each finding is {level: "error" | "warning" | "info", code, message}.

const TEXT_OPS = new Set(["DRAW_TEXT_ANCHOR", "DRAW_TEXT_ON_PATH", "DRAW_TEXT_RUN", "LAYOUT_TEXT", "CoreText"]);
const FRAME_DRIVEN_OPS = new Set(["ParticlesCreate", "ParticlesLoop", "ImpulseOperation", "ImpulseProcess"]);
const TOUCH_OPS = new Set(["TouchExpression", "MODIFIER_TOUCH_DOWN", "MODIFIER_TOUCH_UP", "MODIFIER_TOUCH_CANCEL"]);
const CLICK_OPS = new Set(["CLICK_AREA", "MODIFIER_CLICK", "MODIFIER_MULTI_CLICK"]);
// Ops that every document has, which say nothing about whether it draws anything.
const STRUCTURAL_OPS = new Set(["HEADER", "LAYOUT_ROOT", "LayoutComponentContent", "CanvasContent",
                                "COMPONENT_VALUE"]);

const count = (byName, set) => Object.entries(byName ?? {})
    .reduce((n, [name, c]) => n + (set.has(name) ? c : 0), 0);

/** Features of the document, from the op counts. */
export function documentFeatures(report) {
    const byName = report?.ops?.byName ?? {};
    return {
        text: count(byName, TEXT_OPS) > 0,
        frameDriven: count(byName, FRAME_DRIVEN_OPS) > 0,
        touch: count(byName, TOUCH_OPS) > 0,
        clickAreas: count(byName, CLICK_OPS),
        threeD: Object.keys(byName).some((n) => /3D/.test(n)),
    };
}

/**
 * opts: {simulated: bool, tapped: bool} — how the document was rendered, which changes
 * what an empty image means. log: rc2image's stderr, for its own warnings and click hits.
 */
export function analyze(report, { simulated = false, tapped = false, log = "" } = {}) {
    const out = [];
    const add = (level, code, message) => out.push({ level, code, message });
    if (!report) return out;

    const parse = report.parse ?? {};
    if (parse.ok === false) {
        const where = parse.offset >= 0 ? ` at byte ${parse.offset} (opcode ${parse.opcode}` +
            (parse.lastGoodOp ? `, after ${parse.lastGoodOp}` : "") + ")" : "";
        const what = parse.kind === "unknown_opcode"
            ? "an opcode this engine has no reader for — a newer or corrupt document"
            : parse.kind === "read_past_end"
                ? "an operation that reads past the end of the data — truncated, or a corrupt length/count"
                : "a document the engine rejected";
        add("error", `parse_${parse.kind ?? "failed"}`, `The .rc does not parse: ${what}${where}. ${parse.message ?? ""}`.trim());
        return out;
    }

    const f = documentFeatures(report);
    const byName = report.ops?.byName ?? {};
    const contentOps = Object.entries(byName)
        .filter(([n]) => !STRUCTURAL_OPS.has(n)).reduce((n, [, c]) => n + c, 0);
    if (contentOps === 0) add("warning", "empty_document", "The document contains no content operations.");

    const { width, height } = report.header ?? {};
    if (!(width > 0) || !(height > 0)) {
        add("warning", "no_size", `The header gives no size (${width}x${height}); a default is used. Pass width/height.`);
    }
    if (f.text && report.fonts && report.fonts.families === 0) {
        add("error", "no_fonts",
            "The document draws text but the renderer has no fonts installed, so every text draw " +
            "paints nothing. Install one on the server (e.g. fonts-dejavu-core).");
    }
    if (f.frameDriven && !simulated) {
        add("warning", "needs_frames",
            "The document uses particles/impulses, whose per-frame work starts on the second " +
            "frame; a single-frame render can be legitimately empty. Pass `duration` (e.g. 1).");
    }
    if (f.touch || f.clickAreas) {
        add("info", "interactive",
            `The document is interactive (${[f.touch && "touch expressions", f.clickAreas && `${f.clickAreas} click target(s)`]
                .filter(Boolean).join(", ")}); touch_events can drive it.`);
    }
    if (report.namedVariables?.length) {
        add("info", "host_variables",
            "Host-settable variables: " + report.namedVariables
                .map((v) => `${v.name} (${v.type}) = ${JSON.stringify(v.value)}`).join(", "));
    }

    // Components the layout placed past their parent (rc2image's `layout` section).
    const lo = report.layout;
    if (lo?.overflowing > 0) {
        add("warning", "component_overflow", `${lo.overflowing} component(s) extend past their parent's box and are drawn cut off` +
            (lo.examples?.length ? `: ${lo.examples.slice(0, 4).join("; ")}` : "") +
            ". Size drawings from their box (componentWidth()/componentHeight(), a fitBox with smaller children), or let the " +
            "least important content collapse (collapsibleColumn) or scroll.");
    }

    if (lo?.zeroSize > 0) {
        add("warning", "zero_size", `${lo.zeroSize} visible component(s) got no size from the layout, so they draw nothing` +
            (lo.zeroSizeExamples?.length ? `: ${lo.zeroSizeExamples.slice(0, 4).join("; ")}` : "") +
            ". A weight shares what the other children leave (nothing, if they fill the row), and a weight does not combine " +
            "with widthIn/heightIn; a collapsible layout drops its children lowest priority first until the rest fit.");
    }

    // Text the renderer could not fit (rc2image's `text` section, counted while painting).
    const tx = report.text;
    if (tx && (tx.truncated || tx.clipped)) {
        const parts = [tx.truncated && `${tx.truncated} text(s) lost lines to maxLines`,
                       tx.clipped && `${tx.clipped} text(s) wider or taller than their box and cut at the edge`].filter(Boolean);
        const ex = (tx.examples ?? []).filter((e) => e.kind !== "ellipsized").slice(0, 4).map((e) => `${JSON.stringify(e.text)} (${e.kind})`);
        add("warning", "text_overflow", parts.join("; ") + (ex.length ? `: ${ex.join(", ")}` : "") +
            ". Check the image for cut words; give the text more room (a wider box, a weight, fewer fixed sizes), " +
            "fewer words, or maxLines with overflow \"ellipsis\".");
    } else if (tx && tx.ellipsized) {
        add("info", "text_ellipsized", `${tx.ellipsized} text(s) end in an ellipsis: they do not fit their box at this size.`);
    }

    const r = report.render;
    if (r) {
        if (r.changedFraction === 0) {
            add("warning", "blank",
                `The image is entirely the background colour (${r.background}): nothing drew, or ` +
                "everything drew in that colour" +
                (f.frameDriven && !simulated ? " — likely the single-frame case above." : "."));
        } else if (r.distinctColors === 1) {
            add("warning", "solid", "The image is a single solid colour: only a background fill drew.");
        } else if (r.contentBounds) {
            const [l, t, rr, b] = r.contentBounds;
            const area = ((rr - l) * (b - t)) / (r.width * r.height);
            if (r.changedFraction < 0.001) {
                add("warning", "nearly_blank",
                    `Almost nothing drew: ${(r.changedFraction * 100).toFixed(3)}% of pixels differ ` +
                    `from the background, within [${r.contentBounds.join(", ")}].`);
            } else if (area < 0.01) {
                add("info", "small_content", `All content sits in a small region [${r.contentBounds.join(", ")}].`);
            }
        }
    }

    for (const line of log.split("\n")) {
        const m = /^warning:\s*(.*)$/.exec(line.trim());
        if (m) add("warning", "renderer", m[1]);
    }
    if (tapped) {
        const releases = log.split("\n").filter((l) => /^up t=/.test(l));
        const hits = releases.filter((l) => /click hit/.test(l)).length;
        // A document driven by touch expressions (a slider, a scroll) takes presses with no
        // click target, so a release that hits none is not a miss there.
        if (releases.length && hits === 0 && !f.touch) {
            add("warning", "taps_missed",
                f.clickAreas
                    ? `None of the ${releases.length} release(s) hit a click target — check the coordinates are in document space.`
                    : "Taps were sent but the document has no click targets.");
        }
    }
    return out;
}

export const formatFindings = (findings) =>
    findings.map((x) => `${x.level}: [${x.code}] ${x.message}`).join("\n");
