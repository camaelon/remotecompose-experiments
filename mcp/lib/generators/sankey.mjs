// {"$gen": {"kind": "sankey", "flows": "@flows", "sources": [...], "uses": [...]}}: a two-column
// Sankey diagram, sources on the left and uses on the right, with one ribbon per (source, use)
// pair. `flows` names a float array, row-major: flows[s * uses.length + u] is what source s
// sends to use u. Every value is eased on its own (a plain variable reading the array, then an
// animated variable of it: the C++ player does not re-animate an expression that reads the
// array directly), and every offset is a sum of eased values, so ribbons, bars and labels move
// together and the stack never comes apart mid-transition. Mono looks (ctx.mono) get outlined
// ribbons, ink bars and no particles. What this file writes:
//
//   canvas (fillMaxSize, or fillMaxWidth x height)
//     per flow: g_k = arrayGet(flows, k), f_k = {value: @g_k, anim}
//     node totals, a scale k = (height - gaps) / total, node tops
//     per ribbon (skipped while its flow is ~0): its two offsets, one closed pathExpression
//       (a in 0..2: the top edge forward, the bottom edge back, x = xs + dx (1 - |1 - a|),
//       y eased by (1 - cos(pi a)) / 2, plus the width past a = 1), linear (flags 4);
//       a gradient from the source colour to the use colour, or in mono an outline over a
//       faint fill
//     particles (not in mono): per ribbon `dots` dots at fract(T * speed * flow + j / dots)
//     bars and labels (name, then the value with its unit)

export const kind = "sankey";
export const doc = "A two-column Sankey (sources to uses) from a row-major float array: eased ribbons, optional flowing particles, labelled bars";

const SRC_COLORS = ["@colors.warning", "@colors.muted", "@colors.success", "@colors.primary"];
const USE_COLORS = ["@colors.error", "@colors.primary", "@colors.secondary", "@colors.highlight", "@colors.success", "@colors.warning"];

/** Items as [{label, color}], from strings, [label, color] pairs or objects. */
export function nodes(list, defaults, what) {
    if (!Array.isArray(list) || list.length === 0) throw new Error(`sankey: ${what} needs a list of nodes`);
    return list.map((it, i) => {
        const o = typeof it === "string" ? { label: it } : Array.isArray(it) ? { label: it[0], color: it[1] } : { ...it };
        if (o.label === undefined) throw new Error(`sankey: ${what}[${i}] has no label`);
        o.color ??= defaults[i % defaults.length];
        return o;
    });
}

export function generate(spec, ctx) {
    const flows = String(spec.flows ?? "");
    if (!/^@\w+$/.test(flows)) throw new Error(`sankey: flows must name a float array ("@flows"), got ${JSON.stringify(spec.flows)}`);
    const S = nodes(spec.sources, SRC_COLORS, "sources");
    const U = nodes(spec.uses, USE_COLORS, "uses");
    const ns = S.length, nu = U.length;
    const anim = Number(spec.anim ?? 1.2);
    const dots = Math.max(0, Math.round(Number(spec.dots ?? 7)));
    const particles = spec.particles !== false && dots > 0 && !ctx.mono;
    const speed = spec.speed ?? 0.16;
    const unit = String(spec.unit ?? " kW");
    const dotColor = spec.dotColor ?? "@colors.onSurface";
    const decimals = Math.round(Number(spec.decimals ?? 1));
    const whole = Math.round(Number(spec.whole ?? 2));
    const p = ctx.unique("sankey");
    // the mono looks (ctx.mono) are written on their own: no hue, no gradient, no particles
    const mono = Boolean(ctx.mono);
    const fork = (then, els) => (mono ? then : els);
    const v = (n) => `${p}_${n}`;
    const cmds = [];
    // commit: written where it stands. A deferred variable would be written at its first use,
    // which for a ribbon's offsets can be inside the conditional of a ribbon that is skipped
    // (a zero flow), and the TypeScript player then never computes it for the ribbons after.
    const V = (n, value) => cmds.push({ variable: { name: v(n), value, commit: true } });
    const at = (n) => `@${v(n)}`;

    V("W", "componentWidth()");
    V("H", "componentHeight()");
    V("lw", `clamp(70, 150, ${at("W")} * 0.21)`);
    V("bw", `clamp(6, 12, ${at("W")} * 0.014)`);
    V("g", `clamp(14, 30, ${at("H")} * 0.06)`);
    V("ht", `${at("H")} - 16`);
    for (let k = 0; k < ns * nu; k++) {
        V(`g${k}`, `arrayGet(${flows}, ${k})`);
        cmds.push({ variable: { name: v(`f${k}`), value: anim > 0 ? { value: at(`g${k}`), anim } : at(`g${k}`) } });
    }
    const f = (s, u) => at(`f${s * nu + u}`);
    // sums are written as chains of variables so no expression passes 32 entries
    const sum = (terms) => terms.length ? terms.join(" + ") : "0";
    for (let s = 0; s < ns; s++) V(`S${s}`, sum(U.map((_, u) => f(s, u))));
    for (let u = 0; u < nu; u++) V(`U${u}`, sum(S.map((_, s) => f(s, u))));
    V("tot", sum(S.map((_, s) => at(`S${s}`))));
    const gaps = Math.max(ns, nu) - 1;
    V("k", `(${at("ht")} - ${gaps} * ${at("g")}) / max(${at("tot")}, 0.05)`);
    // the shorter column is centred against the taller one
    const offS = (Math.max(ns, nu) - ns) / 2, offU = (Math.max(ns, nu) - nu) / 2;
    for (let s = 0; s < ns; s++) V(`st${s}`, s === 0 ? `8 + ${offS} * ${at("g")}` : `${at(`st${s - 1}`)} + ${at(`S${s - 1}`)} * ${at("k")} + ${at("g")}`);
    for (let u = 0; u < nu; u++) V(`ut${u}`, u === 0 ? `8 + ${offU} * ${at("g")}` : `${at(`ut${u - 1}`)} + ${at(`U${u - 1}`)} * ${at("k")} + ${at("g")}`);
    V("xs", `${at("lw")} + ${at("bw")} / 2`);
    V("xt", `${at("W")} - ${at("lw")} - ${at("bw")} / 2`);
    V("dx", `${at("xt")} - ${at("xs")}`);

    const ribbons = [], parts = [];
    for (let s = 0; s < ns; s++) for (let u = 0; u < nu; u++) {
        const i = s * nu + u;
        // running offsets inside the source and inside the use, as variables (short sums)
        const ya = u === 0 ? at(`st${s}`) : `${at(`ya${i - 1}`)} + ${f(s, u - 1)} * ${at("k")}`;
        const yb = s === 0 ? at(`ut${u}`) : `${at(`yb${i - nu}`)} + ${f(s - 1, u)} * ${at("k")}`;
        // offsets are needed by later ribbons even when this one is not drawn
        V(`ya${i}`, ya);
        V(`yb${i}`, yb);
        V(`w${i}`, `${f(s, u)} * ${at("k")}`);
        const band = { pathExpression: { id: v(`r${i}`),
            expressionX: `${at("xs")} + ${at("dx")} * (1 - abs(1 - a[0]))`,
            expressionY: `${at(`ya${i}`)} + (${at(`yb${i}`)} - ${at(`ya${i}`)}) * (1 - cos(3.14159 * a[0])) / 2 + ${at(`w${i}`)} * step(a[0], 1)`,
            start: 0, end: 2, count: 96, flags: 4 } };
        ribbons.push({ conditionalOperations: { condition: "gt", v1: f(s, u), v2: 0.01, commands: [
            band,
            ...fork([
                { paint: { ops: [{ shader: 0 }, { color: "@colors.onSurface" }, { style: "fill" }, { alpha: 0.1 }] } },
                { drawPath: { path: v(`r${i}`) } },
                { paint: { ops: [{ color: "@colors.onSurface" }, { style: "stroke" }, { strokeWidth: 1 }, { alpha: 0.85 }] } },
                { drawPath: { path: v(`r${i}`) } },
            ], [
                { paint: { ops: [{ style: "fill" }, { linearGradient: { x1: at("xs"), y1: 0, x2: at("xt"), y2: 0, colors: [S[s].color, U[u].color] } }, { alpha: 0.68 }] } },
                { drawPath: { path: v(`r${i}`) } },
            ]),
        ] } });
        if (particles) {
            parts.push({ conditionalOperations: { condition: "gt", v1: at(`w${i}`), v2: 3, commands: [
                { variable: { name: v(`p${i}`), value: `fract(${at("T")} * ${speed} * arrayGet(${flows}, ${i}))` } },
                { variable: { name: v(`q${i}`), value: `clamp(1.2, 3.2, 1 + ${at(`w${i}`)} * 0.05)` } },
                { loop: { index: "j", from: 0, until: dots, commands: [
                    { variable: { name: v(`t${i}`), value: `fract(${at(`p${i}`)} + j / ${dots})` } },
                    { paint: { ops: [{ shader: 0 }, { color: dotColor }, { alpha: `0.85 * sin(3.14159 * ${at(`t${i}`)})` }] } },
                    { drawCircle: {
                        cx: `${at("xs")} + ${at("dx")} * ${at(`t${i}`)}`,
                        cy: `${at(`ya${i}`)} + (${at(`yb${i}`)} - ${at(`ya${i}`)}) * (1 - cos(3.14159 * ${at(`t${i}`)})) / 2 + ${at(`w${i}`)} * (0.5 + 0.32 * sin(j * 2.39 + ${i}))`,
                        radius: at(`q${i}`) } },
                ] } },
            ] } });
        }
    }
    cmds.push(...ribbons);
    if (particles) cmds.push({ variable: { name: v("T"), value: "continuousSec()" } }, ...parts);
    cmds.push({ paint: { ops: [{ shader: 0 }, { style: "fill" }, { alpha: 1 }] } });

    V("fs", `clamp(11, 14, ${at("W")} * 0.018)`);
    const valueText = (expr) => ({ type: "textMerge", id1: { type: "textFromFloat", value: expr, whole, decimal: decimals, flags: 5 }, id2: unit });
    const label = (side, n, i, top, tot) => {
        const left = side === "s";
        const c = v(`${side}c${i}`);
        const x = left ? `${at("lw")} - 10` : `${at("W")} - ${at("lw")} + 10`;
        const pan = left ? 1 : -1;
        return [
            ...fork([{ paint: { ops: [{ color: "@colors.onSurface" }] } }], [{ paint: { ops: [{ color: n.color }] } }]),
            { drawRoundRect: { left: left ? at("lw") : `${at("W")} - ${at("lw")} - ${at("bw")}`, top,
                right: left ? `${at("lw")} + ${at("bw")}` : `${at("W")} - ${at("lw")}`, bottom: `${top} + max(${tot} * ${at("k")}, 2)`, rx: 3, ry: 3 } },
            { variable: { name: c, value: `${top} + ${tot} * ${at("k")} / 2` } },
            { paint: { ops: [{ color: "@colors.muted" }, { textSize: at("fs") }] } },
            { drawTextAnchored: { text: String(n.label), x, y: `@${c} - 1`, panX: pan, panY: -1 } },
            { paint: { ops: [{ color: "@colors.onSurface" }, { textSize: `${at("fs")} + 3` }] } },
            { drawTextAnchored: { text: valueText(tot), x, y: `@${c} + 1`, panX: pan, panY: 1 } },
        ];
    };
    S.forEach((n, s) => cmds.push(...label("s", n, s, at(`st${s}`), at(`S${s}`))));
    U.forEach((n, u) => cmds.push(...label("u", n, u, at(`ut${u}`), at(`U${u}`))));

    const desc = spec.label ?? `Flows from ${S.map((n) => n.label).join(", ")} to ${U.map((n) => n.label).join(", ")}`;
    const fill = spec.fill !== false;
    return { canvas: {
        modifiers: [...(fill ? ["fillMaxSize"] : ["fillMaxWidth", { height: Number(spec.height ?? 320) }]), { semantics: { contentDescription: desc } }],
        commands: cmds } };
}
