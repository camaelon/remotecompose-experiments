// {"$gen": {"kind": "graph", "nodes": [...], "edges": [...]}}: a process diagram laid out on
// the server. The caller names nodes and edges; this file solves a Sugiyama-style layered
// layout (cycles broken by DFS, layers by longest path, crossings reduced by barycentre sweeps
// and adjacent swaps, coordinates by iterated neighbour averaging projected onto the layer's
// order with isotonic regression) and writes it out as plain RemoteCompose JSON:
//
//   box (fills what it is given)
//     tree variables: the box's size, the orientation, unit sizes, one across position per
//       distinct coordinate and one per layer (everything below reads these by id)
//     canvas: every edge, drawn once in a "top-to-bottom" frame that a rotate + mirror turns
//       into left-to-right when the box is wide (one set of commands for both orientations)
//     one box per node at an offset, with its text: text is laid out and measured by the
//       player, so the usual cut-text checks apply
//
// Orientation: both layouts are scored at run time from the box's size (node width and layer
// gap each orientation would get) and the better one is shown; `direction` pins it.

export const kind = "graph";
export const doc = "A layered process diagram (Sugiyama): nodes with labels and a status, directed edges with optional labels; top-to-bottom when tall, left-to-right when wide";

const STATUS = new Set(["ok", "active", "failed", "pending"]);
const dim = (v, d) => (v === undefined || v === null || v === "" ? d : typeof v === "number" || /^-?\d+(\.\d+)?$/.test(String(v)) ? Number(v) : String(v));
const sizeExpr = (v, win) => { const d = dim(v, win); return typeof d === "number" ? `min(${fmt(d)}, ${win})` : d; };
// Players animate a component's bounds when layout moves it, while a canvas redraws at once:
// on a resize the node boxes would slide away from their arrows. animationId 0 turns that off
// (AnimationSpec.isAnimationEnabled is id != 0 in Java and TS). Each is a modifier of
// its own: the Java parser reads one key per modifier object. Generator output keeps it in
// mono (checked: the mono expansions carry every one).
const still = () => ({ animationSpec: { animationId: 0 } });
const fmt = (n) => { const r = Math.round(n * 1000) / 1000; return String(Object.is(r, -0) ? 0 : r); };

// ---------------------------------------------------------------------------------------------
// Input

/** Normalises nodes and edges: nodes [{id, label, status}], edges [{from, to, label, status}]. */
export function parseGraph(spec) {
    const nodes = [], byId = new Map();
    const add = (n) => {
        const node = typeof n === "string" ? { id: n, label: n } : { ...n };
        if (node.id === undefined || node.id === null || node.id === "") node.id = node.label;
        if (node.id === undefined) throw new Error("a node needs an id or a label");
        node.id = String(node.id);
        node.label = String(node.label ?? node.id);
        if (byId.has(node.id)) throw new Error(`node '${node.id}' is listed twice`);
        byId.set(node.id, node); nodes.push(node);
        return node;
    };
    for (const n of spec.nodes ?? []) add(n);
    const edges = [];
    for (const e of spec.edges ?? []) {
        let edge;
        if (Array.isArray(e)) edge = { from: e[0], to: e[1], label: e[2] };
        else if (typeof e === "string") {
            const m = e.split(/\s*(?:->|>|→)\s*/);
            if (m.length < 2) throw new Error(`edge '${e}': write it "from > to"`);
            // "a > b > c" is a chain
            for (let i = 0; i + 1 < m.length; i++) edges.push({ from: m[i], to: m[i + 1] });
            continue;
        } else edge = { ...e };
        edges.push(edge);
    }
    for (const e of edges) {
        e.from = String(e.from); e.to = String(e.to);
        for (const end of [e.from, e.to]) if (!byId.has(end)) {
            if (spec.nodes?.length) throw new Error(`edge ${e.from} > ${e.to}: no node '${end}' (nodes: ${[...byId.keys()].join(", ")})`);
            add(end);
        }
        if (e.label !== undefined && e.label !== null) e.label = String(e.label); else delete e.label;
    }
    if (!nodes.length) throw new Error("give nodes, edges or both");
    return { nodes, edges: edges.filter((e) => e.from !== e.to) };
}

// ---------------------------------------------------------------------------------------------
// The solver: pure functions over indexes, exported for the tests.

/** DFS from each node in input order; an edge to a node on the stack is a back edge. */
export function findBackEdges(n, edges) {
    const out = Array.from({ length: n }, () => []);
    edges.forEach(([u, v], i) => out[u].push([v, i]));
    const state = new Uint8Array(n), back = new Set();
    const visit = (u) => {
        state[u] = 1;
        for (const [v, i] of out[u]) {
            if (state[v] === 1) back.add(i);
            else if (state[v] === 0) visit(v);
        }
        state[u] = 2;
    };
    // Start at the sources first, so a loop back to the start is what gets reversed.
    const indeg = new Array(n).fill(0);
    for (const [, v] of edges) indeg[v]++;
    for (let u = 0; u < n; u++) if (!state[u] && indeg[u] === 0) visit(u);
    for (let u = 0; u < n; u++) if (!state[u]) visit(u);
    return back;
}

/** Longest-path layering of a DAG (edges [u, v]); sources with successors move down next to them. */
export function assignLayers(n, dag) {
    const preds = Array.from({ length: n }, () => []), succs = Array.from({ length: n }, () => []);
    for (const [u, v] of dag) { preds[v].push(u); succs[u].push(v); }
    const layer = new Array(n).fill(-1);
    const get = (v) => {
        if (layer[v] >= 0) return layer[v];
        layer[v] = 0;   // a guard; the input is acyclic
        let l = 0;
        for (const u of preds[v]) l = Math.max(l, get(u) + 1);
        return (layer[v] = l);
    };
    for (let v = 0; v < n; v++) get(v);
    for (let v = 0; v < n; v++) {
        if (!preds[v].length && succs[v].length) layer[v] = Math.min(...succs[v].map((s) => layer[s])) - 1;
    }
    return layer;
}

/** Crossings between two adjacent layers: pairs of edges whose ends are in opposite orders. */
export function crossingsBetween(edges, posU, posV) {
    const list = edges.map(([u, v]) => [posU[u], posV[v]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let c = 0;
    for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++)
            if (list[i][0] !== list[j][0] && list[j][1] < list[i][1]) c++;
    return c;
}

/** Total crossings of an ordering: order[l] lists the node indexes of layer l. */
export function countCrossings(order, edgesByGap) {
    const pos = new Map();
    for (const row of order) row.forEach((v, i) => pos.set(v, i));
    const p = { get: (v) => pos.get(v) };
    let c = 0;
    for (const gap of edgesByGap) {
        const pu = {}, pv = {};
        for (const [u, v] of gap) { pu[u] = p.get(u); pv[v] = p.get(v); }
        c += crossingsBetween(gap, pu, pv);
    }
    return c;
}

/**
 * The layout of a graph given as n nodes and edges [u, v]. Returns
 * { layer, order (per layer, with dummies), across (per vertex, in node units), L, extent,
 *   chains (per input edge: the vertex path from its DAG start to its DAG end), reversed (set
 *   of edge indexes), crossings, nodeCount, isDummy }.
 */
export function layoutGraph(n, edges, { iterations = 24 } = {}) {
    const reversed = findBackEdges(n, edges);
    const dag = edges.map(([u, v], i) => (reversed.has(i) ? [v, u] : [u, v]));
    const layer = assignLayers(n, dag);
    const L = Math.max(...layer) + 1;
    // Dummy vertices for edges spanning several layers.
    const isDummy = new Array(n).fill(false);
    const segs = [];           // [u, v] between adjacent layers
    const chains = dag.map(([u, v]) => {
        const chain = [u];
        let prev = u;
        for (let l = layer[u] + 1; l < layer[v]; l++) {
            const d = layer.length;
            layer.push(l); isDummy.push(true);
            segs.push([prev, d]); chain.push(d); prev = d;
        }
        segs.push([prev, v]); chain.push(v);
        return chain;
    });
    const N = layer.length;
    const up = Array.from({ length: N }, () => []), down = Array.from({ length: N }, () => []);
    for (const [u, v] of segs) { down[u].push(v); up[v].push(u); }
    const edgesByGap = Array.from({ length: Math.max(0, L - 1) }, () => []);
    for (const [u, v] of segs) edgesByGap[layer[u]].push([u, v]);

    // Initial order: depth-first from the sources, so a chain reads in one column.
    const order = Array.from({ length: L }, () => []);
    const seen = new Uint8Array(N);
    const dfs = (v) => { if (seen[v]) return; seen[v] = 1; order[layer[v]].push(v); for (const w of down[v]) dfs(w); };
    for (let v = 0; v < n; v++) if (!up[v].length) dfs(v);
    for (let v = 0; v < N; v++) dfs(v);

    const cross = (o) => countCrossings(o, edgesByGap);
    const posOf = (o) => { const p = new Array(N); for (const row of o) row.forEach((v, i) => (p[v] = i)); return p; };
    let best = order.map((r) => r.slice()), bestC = cross(order);
    let cur = order.map((r) => r.slice());
    for (let it = 0; it < iterations && bestC > 0; it++) {
        const downward = it % 2 === 0;
        const ls = downward ? [...Array(L).keys()].slice(1) : [...Array(L).keys()].reverse().slice(1);
        for (const l of ls) {
            const p = posOf(cur);
            const ref = downward ? up : down;
            const bary = new Map(cur[l].map((v, i) => {
                const nb = ref[v];
                return [v, nb.length ? nb.reduce((s, w) => s + p[w], 0) / nb.length : i];
            }));
            cur[l] = cur[l].map((v, i) => [v, bary.get(v), i]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map((x) => x[0]);
        }
        const c = cross(cur);
        if (c < bestC) { bestC = c; best = cur.map((r) => r.slice()); }
    }
    // Adjacent swaps while any lowers the count.
    for (let improved = true, guard = 0; improved && bestC > 0 && guard < 50; guard++) {
        improved = false;
        for (let l = 0; l < L; l++) {
            for (let i = 0; i + 1 < best[l].length; i++) {
                const row = best[l];
                [row[i], row[i + 1]] = [row[i + 1], row[i]];
                const c = cross(best);
                if (c < bestC) { bestC = c; improved = true; } else [row[i], row[i + 1]] = [row[i + 1], row[i]];
            }
        }
    }

    // Coordinates across the layers, in node widths: a real node takes 1, a dummy (an edge
    // passing through the layer) less, so long edges run between nodes.
    const sep = (a, b) => (isDummy[a] && isDummy[b] ? 0.3 : isDummy[a] || isDummy[b] ? 0.65 : 1.12);
    const x = new Array(N).fill(0);
    for (const row of best) { let acc = 0; row.forEach((v, i) => { if (i) acc += sep(row[i - 1], v); x[v] = acc; }); }
    const w = (a, b) => (isDummy[a] && isDummy[b] ? 8 : isDummy[a] || isDummy[b] ? 2 : 1);
    const project = (row, desired, weight) => {
        // Isotonic regression (pool adjacent violators) of desired - offset, then back.
        const off = [0];
        for (let i = 1; i < row.length; i++) off.push(off[i - 1] + sep(row[i - 1], row[i]));
        const blocks = [];
        row.forEach((v, i) => {
            blocks.push({ s: (desired[i] - off[i]) * weight[i], w: weight[i], n: 1 });
            while (blocks.length > 1) {
                const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
                if (a.s / a.w <= b.s / b.w) break;
                blocks.splice(-2, 2, { s: a.s + b.s, w: a.w + b.w, n: a.n + b.n });
            }
        });
        let i = 0;
        for (const b of blocks) for (let k = 0; k < b.n; k++, i++) x[row[i]] = b.s / b.w + off[i];
    };
    const relax = (l, dirs) => {
        const row = best[l];
        const desired = [], weight = [];
        for (const v of row) {
            let s = 0, ws = 0;
            for (const nb of dirs) for (const u of nb[v]) { const ww = w(u, v); s += x[u] * ww; ws += ww; }
            desired.push(ws ? s / ws : x[v]);
            weight.push(ws ? ws : 0.01);
        }
        project(row, desired, weight);
    };
    for (let it = 0; it < 60; it++) {
        const phase = it % 3;
        if (phase === 0) for (let l = 1; l < L; l++) relax(l, [up]);
        else if (phase === 1) for (let l = L - 2; l >= 0; l--) relax(l, [down]);
        else for (let l = 0; l < L; l++) relax(l, [up, down]);
    }
    // Centre each node over its real neighbours exactly where nothing prevents it.
    const min = Math.min(...x);
    for (let v = 0; v < N; v++) x[v] -= min;
    // Snap to a 1/16 grid, so equal positions share one variable.
    for (let v = 0; v < N; v++) x[v] = Math.round(x[v] * 16) / 16;
    let extent = 0;
    for (let v = 0; v < N; v++) extent = Math.max(extent, x[v]);
    return { layer, order: best, across: x, L, extent: extent + 1, chains, reversed, crossings: bestC, nodeCount: n, isDummy, segs };
}

// ---------------------------------------------------------------------------------------------
// The document

const stableHash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36).slice(0, 4); };

function statusStyle(status, mono) {
    const s = status ?? "none";
    const themed = !STATUS.has(s) && s !== "none" ? `@colors.${s}` : null;
    switch (s) {
        case "active": return { ring: null, fill: "@colors.primary", text: "@colors.onPrimary", weight: 700 };
        case "ok": return { ring: "@colors.success", ringW: 2, fill: "@colors.surface", text: "@colors.onSurface", icon: "check", iconColor: "@colors.success" };
        case "failed": return { ring: "@colors.error", ringW: 2, fill: "@colors.surface", text: "@colors.onSurface", icon: "close", iconColor: "@colors.error" };
        case "pending": return { ring: "@colors.outline", ringW: 1, fill: mono ? "@colors.surface" : "@colors.background", text: "@colors.muted" };
        case "none": return { ring: "@colors.outline", ringW: 1, fill: "@colors.surface", text: "@colors.onSurface" };
        default: return { ring: themed, ringW: 2, fill: "@colors.surface", text: "@colors.onSurface" };
    }
}

const EDGE_COLOR = { ok: "@colors.success", failed: "@colors.error", active: "@colors.primary", pending: "@colors.outline" };

export function generate(spec, ctx) {
    // A literal width or height equal to the document's own size means "the window": a client that
    // copies the header size into the call should still get a diagram that adapts.
    spec = { ...spec };
    for (const k of ["width", "height"]) if (typeof spec[k] === "number" && ctx.header && spec[k] === ctx.header[k]) delete spec[k];
    const { nodes, edges } = parseGraph(spec);
    if (nodes.length > 40) throw new Error(`${nodes.length} nodes: up to 40 fit a screen`);
    const index = new Map(nodes.map((nd, i) => [nd.id, i]));
    const lay = layoutGraph(nodes.length, edges.map((e) => [index.get(e.from), index.get(e.to)]));
    const { layer, across, L, extent, chains, reversed } = lay;
    const mono = ctx.mono;

    const p = `g${stableHash(JSON.stringify(spec))}_`;
    const V = (name) => `@${p}${name}`;
    const vars = [];
    const decl = (name, value) => { vars.push({ variable: { name: p + name, value: typeof value === "number" ? fmt(value) : value } }); return V(name); };

    const fs = Number(spec.fontSize ?? 13);
    // Three lines when labels are long and the diagram is short enough to afford them.
    const longest = Math.max(...nodes.map((nd) => nd.label.length));
    const lines = Math.max(1, Math.round(Number(spec.lines ?? (longest > 34 && L <= 5 ? 3 : 2))));
    const lineH = Math.round(fs * 1.3);
    const nh = Number(spec.nodeHeight ?? lines * lineH + 14);
    const maxW = Number(spec.maxNodeWidth ?? 240);
    const pad = Number(spec.padding ?? 8);
    const hasLabels = edges.some((e) => e.label);
    const gapA = 14;                       // between nodes in a layer
    // Between layers, left to right: edge labels sit there, above their line, so the gap
    // grows with the longest one.
    const longestEdge = Math.max(0, ...edges.map((e) => (e.label ?? "").length));
    const gapL = hasLabels ? Math.round(Math.min(150, Math.max(48, longestEdge * (fs - 2) * 0.6 + 16))) : 32;
    const minGapT = hasLabels ? 32 : 24;    // between layers, top to bottom, at its tightest
    const U = extent;
    const dir = String(spec.direction ?? "auto");

    // The size comes from the caller (default: the window). componentWidth() read by a tree
    // variable is 0 in a sibling's modifiers in the C++ player, so offsets can't use it.
    // A number is the most it takes: it never asks for more than the window, so a call written
    // for one screen still adapts to a smaller one.
    const W = decl("W", sizeExpr(spec.width, "windowWidth()")), H = decl("H", sizeExpr(spec.height, "windowHeight()"));
    // Each orientation's node width and layer pitch.
    const nwT = decl("nwT", `min(${maxW}, (${W} - ${2 * pad}) / ${fmt(U)} - ${gapA})`);
    const pitT = decl("pitT", `min(${fmt(nh + 76)}, (${H} - ${2 * pad}) / ${L})`);
    const nwL = decl("nwL", `min(${maxW}, (${W} - ${2 * pad}) / ${L} - ${gapL})`);
    const pitL = decl("pitL", `min(${fmt(nh + 30)}, (${H} - ${2 * pad}) / ${fmt(U)})`);
    // How comfortable each orientation is: node width against 120, the gap against what it
    // needs (1 = at ease). Text and nodes shrink to 77% when it is tight; under 0.4 the
    // diagram gives way to a one-line summary.
    // "right" and "down" are preferences: kept while they are comfortable (score 0.85) or no
    // worse than the other; "right!" and "down!" pin the orientation whatever the screen.
    const prefer = /^(right|lr|horizontal)/.test(dir) ? 1 : /^(down|tb|vertical)/.test(dir) ? 0 : null;
    const pinned = prefer !== null && dir.endsWith("!") ? prefer : null;
    // Top to bottom, nodes are wide: when the longest label fits on one line they are one
    // line tall, which is what lets a deep process fit a landscape screen.
    const hasIcon = nodes.some((nd) => nd.status === "ok" || nd.status === "failed");
    const est1 = Math.ceil(longest * fs * 0.55 + 16 + (hasIcon ? 18 : 0));
    const nh1 = lineH + 12;
    const nhT = pinned === 1 || spec.nodeHeight !== undefined || lines === 1 ? fmt(nh) : decl("nhT", `ifElse(${fmt(nh)}, ${fmt(nh1)}, step(${nwT}, ${est1}))`);
    const sT = pinned === 1 ? null : decl("sT", `min(${nwT} / 120, (${pitT} - 0.8 * ${nhT}) / ${minGapT})`);
    const sL = pinned === 0 ? null : decl("sL", `min(${nwL} / 120, (${pitL} - ${fmt(nh * 0.8)}) / 8)`);
    const lr = pinned ?? decl("lr", prefer === 1 ? `max(step(${sL}, 0.849), step(${sL}, ${sT}))`
        : prefer === 0 ? `(1 - step(${sT}, 0.849)) * step(${sL}, ${sT})` : `step(${sL}, ${sT} + 0.02)`);
    const best = pinned === 1 ? sL : pinned === 0 ? sT : decl("s", `max(${sT}, ${sL})`);
    const k = decl("k", `clamp(0.77, 1.2, ${best})`);
    const compact = !(spec.compact === false || spec.compact === 0);
    const show = compact ? decl("show", `step(${best}, 0.4)`) : null;
    const nhk = decl("nh", `${lr === 1 ? fmt(nh) : lr === 0 ? nhT : `ifElse(${nhT}, ${fmt(nh)}, ${lr})`} * ${k}`);
    const fsk = decl("fs", `${fmt(fs)} * ${k}`);
    const pick = (ifLR, ifTB) => (lr === 1 ? ifLR : lr === 0 ? ifTB : `ifElse(${ifTB}, ${ifLR}, ${lr})`);   // ifElse(else, then, cond)
    // In the top-to-bottom frame: a is across the layers, b along them.
    const nw = decl("nw", pick(nwL, nwT));
    const ua = decl("ua", pick(pitL, `${nwT} + ${gapA}`));
    const ub = decl("ub", pick(`${nwL} + ${gapL}`, pitT));
    const hA = decl("hA", pick(`${nhk} / 2`, `${nw} / 2`));
    const hB = decl("hB", pick(`${nw} / 2`, `${nhk} / 2`));
    const oa = decl("oa", `(${pick(H, W)} - ${fmt(U)} * ${ua}) / 2`);
    const ob = decl("ob", `(${pick(W, H)} - ${L} * ${ub}) / 2`);

    // One variable per distinct across position and per layer.
    const aVar = new Map();
    const A = (x) => {
        const k = fmt(x);
        if (!aVar.has(k)) aVar.set(k, decl(`a${aVar.size}`, `${oa} + ${fmt(x + 0.5)} * ${ua}`));
        return aVar.get(k);
    };
    const B = [];
    for (let l = 0; l < L; l++) B.push(decl(`b${l}`, `${ob} + ${fmt(l + 0.5)} * ${ub}`));

    // Ports: where each edge leaves its start's far side and enters its end's near side,
    // ordered by where the edge goes, so they don't cross at the node.
    const outPorts = new Map(), inPorts = new Map();
    chains.forEach((ch, i) => {
        (outPorts.get(ch[0]) ?? outPorts.set(ch[0], []).get(ch[0])).push({ i, toward: across[ch[1]] });
        const last = ch[ch.length - 1];
        (inPorts.get(last) ?? inPorts.set(last, []).get(last)).push({ i, toward: across[ch[ch.length - 2]] });
    });
    const portOf = new Map();   // `${i}:out|in` -> fraction of hA
    for (const [m, side] of [[outPorts, "out"], [inPorts, "in"]]) {
        for (const list of m.values()) {
            list.sort((a, b) => a.toward - b.toward || a.i - b.i);
            const k = list.length, step = Math.min(0.5, 1.3 / k);
            list.forEach((e, j) => portOf.set(`${e.i}:${side}`, (j - (k - 1) / 2) * step));
        }
    }
    const portExpr = (v, f) => (Math.abs(f) < 1e-6 ? A(across[v]) : `${A(across[v])} ${f < 0 ? "-" : "+"} ${fmt(Math.abs(f))} * ${hA}`);

    // Routes, in the top-to-bottom frame: a list of points [aExpr, bExpr]. Each gap between
    // layers gets tracks for its horizontal runs, so two runs that overlap don't share a line.
    const gaps = Array.from({ length: Math.max(0, L - 1) }, () => []);
    const routes = chains.map((ch, i) => {
        const pts = [];   // per layer crossing: [vertex, a-expression at its top, a at its bottom]
        for (let k = 0; k < ch.length; k++) {
            const v = ch[k];
            const isFirst = k === 0, isLast = k === ch.length - 1;
            const aOut = isFirst ? portExpr(v, portOf.get(`${i}:out`)) : A(across[v]);
            const aIn = isLast ? portExpr(v, portOf.get(`${i}:in`)) : A(across[v]);
            const numOut = isFirst ? across[v] + portOf.get(`${i}:out`) * 0.5 : across[v];
            const numIn = isLast ? across[v] + portOf.get(`${i}:in`) * 0.5 : across[v];
            pts.push({ v, l: layer[v], aIn, aOut, numIn, numOut });
        }
        for (let k = 0; k + 1 < pts.length; k++) {
            const s = pts[k], t = pts[k + 1];
            const lo = Math.min(s.numOut, t.numIn), hi = Math.max(s.numOut, t.numIn);
            const run = { route: i, k, lo, hi, straight: s.aOut === t.aIn };
            s.run = run;
            if (!run.straight) gaps[s.l].push(run);
        }
        return pts;
    });
    const trackVar = new Map();
    gaps.forEach((runs, l) => {
        runs.sort((a, b) => a.lo - b.lo || a.hi - b.hi);
        const ends = [];
        for (const r of runs) {
            let t = ends.findIndex((e) => e < r.lo - 0.05);
            if (t < 0) { t = ends.length; ends.push(r.hi); } else ends[t] = r.hi;
            r.track = t;
        }
        const T = Math.max(1, ends.length);
        for (const r of runs) r.T = T;
    });
    // The turns between layers run in the part of the gap past the edge labels, which sit
    // just after the node they leave (at most 60% of the gap).
    let G = null, gOff = null;
    const midOf = (l, t, T) => {
        const key = `${l}:${t}:${T}`;
        if (!G) {
            G = decl("G", `${ub} - 2 * ${hB}`);
            gOff = hasLabels ? decl("gO", `min(0.6 * ${G}, ${pick(fmt(Math.ceil(longestEdge * (fs - 2) * 0.6 + 10)), fmt(fs + 4))})`) : null;
        }
        const f = fmt((t + 1) / (T + 1));
        if (!trackVar.has(key)) trackVar.set(key, decl(`m${l}_${t}`, gOff ? `${B[l]} + ${hB} + ${gOff} + ${f} * (${G} - ${gOff})` : `${B[l]} + ${hB} + ${f} * ${G}`));
        return trackVar.get(key);
    };
    const top = [], bot = [];
    for (let l = 0; l < L; l++) { top.push(decl(`t${l}`, `${B[l]} - ${hB}`)); bot.push(decl(`d${l}`, `${B[l]} + ${hB}`)); }

    const smooth = String(spec.edges_style ?? spec.edgeStyle ?? "orthogonal") === "smooth";
    const arrowDown = ctx.path("arrow_down", [{ type: "moveTo", x: 0, y: 0 }, { type: "lineTo", x: -4.5, y: -8 }, { type: "lineTo", x: 4.5, y: -8 }, { type: "close" }]);
    const arrowUp = ctx.path("arrow_up", [{ type: "moveTo", x: 0, y: 0 }, { type: "lineTo", x: -4.5, y: 8 }, { type: "lineTo", x: 4.5, y: 8 }, { type: "close" }]);

    const byColor = new Map();
    const labels = [];
    routes.forEach((pts, i) => {
        const e = edges[i];
        const color = (e.status && (EDGE_COLOR[e.status] ?? `@colors.${e.status}`)) || "@colors.muted";
        const group = byColor.get(color) ?? byColor.set(color, { lines: [], heads: [] }).get(color);
        const cmds = group.lines;
        for (let k = 0; k + 1 < pts.length; k++) {
            const s = pts[k], t = pts[k + 1];
            const y0 = bot[s.l], y1 = top[t.l];
            // A dummy (an edge passing a layer) is a straight stretch through it.
            if (k > 0) cmds.push({ drawLine: { x1: s.aOut, y1: top[s.l], x2: s.aOut, y2: bot[s.l] } });
            if (smooth && !s.run.straight) {
                const id = `${p}c${i}_${k}`;
                cmds.push({ pathExpression: { id, expressionX: `${s.aOut} + (${t.aIn} - ${s.aOut}) * a[0] * a[0] * (3 - 2 * a[0])`, expressionY: `${y0} + (${y1} - ${y0}) * a[0]`, start: 0, end: 1, count: 16 } });
                cmds.push({ drawPath: { path: id } });
            } else if (s.run.straight) {
                cmds.push({ drawLine: { x1: s.aOut, y1: y0, x2: t.aIn, y2: y1 } });
            } else {
                const m = midOf(s.l, s.run.track, s.run.T);
                cmds.push({ drawLine: { x1: s.aOut, y1: y0, x2: s.aOut, y2: m } });
                cmds.push({ drawLine: { x1: s.aOut, y1: m, x2: t.aIn, y2: m } });
                cmds.push({ drawLine: { x1: t.aIn, y1: m, x2: t.aIn, y2: y1 } });
            }
        }
        const first = pts[0], last = pts[pts.length - 1];
        if (reversed.has(i)) group.heads.push({ save: [{ translate: { dx: first.aOut, dy: bot[first.l] } }, { drawPath: { path: arrowUp } }] });
        else group.heads.push({ save: [{ translate: { dx: last.aIn, dy: top[last.l] } }, { drawPath: { path: arrowDown } }] });
        if (e.label) {
            // Beside the edge's first stretch, at its far start (the original start for a
            // reversed edge is the DAG end).
            const at = reversed.has(i) ? { a: last.aIn, b: top[last.l], up: true, side: portOf.get(`${i}:in`) < 0 ? -1 : 1 } : { a: first.aOut, b: bot[first.l], up: false, side: portOf.get(`${i}:out`) < 0 ? -1 : 1 };
            labels.push({ text: e.label, color, ...at });
        }
    });

    const stroke = Number(spec.strokeWidth ?? (mono ? 1.5 : 1.5));
    const canvasCmds = [];
    if (lr !== 0) {
        if (lr === 1) canvasCmds.push({ rotate: { angle: 90 } }, { scale: { sx: 1, sy: -1 } });
        else canvasCmds.push({ rotate: { angle: `90 * ${lr}` } }, { scale: { sx: 1, sy: `1 - 2 * ${lr}` } });
    }
    for (const [color, g] of byColor) {
        canvasCmds.push({ paint: { ops: [{ color }, { alpha: 1 }, { style: "stroke" }, { strokeWidth: stroke }, { strokeCap: "round" }] } });
        canvasCmds.push(...g.lines);
        canvasCmds.push({ paint: { ops: [{ style: "fill" }] } });
        canvasCmds.push(...g.heads);
    }
    const cmds = [];
    if (canvasCmds.length) cmds.push({ save: canvasCmds });
    const bgColor = spec.background === undefined || spec.background === null ? "@colors.background" : String(spec.background);
    const plate = bgColor === "none" || bgColor === "" ? null : bgColor;
    if (labels.length) {
        const lfs = Math.max(9, fs - 2);
        let cur = null;
        for (const lb of labels) {
            // On the outer side of its own line (so two labels from one node part), just past
            // the node: top to bottom beside the line, left to right above or below it.
            const sb = lb.up ? "-" : "+", sa = lb.side < 0 ? "-" : "+";
            const tb = { x: `${lb.a} ${sa} 5`, y: `${lb.b} ${sb} 3`, panX: lb.side < 0 ? 1 : -1, panY: lb.up ? -1 : 1 };
            const rl = { x: `${lb.b} ${sb} 4`, y: `${lb.a} ${sa} 3`, panX: lb.up ? 1 : -1, panY: lb.side < 0 ? -1 : 1 };
            const mix = (k) => (lr === 1 ? rl[k] : lr === 0 ? tb[k] : typeof rl[k] === "number" && rl[k] === tb[k] ? rl[k] : `ifElse(${tb[k]}, ${rl[k]}, ${lr})`);
            // A plate of the background under the text, so a line crossing a tight gap
            // doesn't run through the words.
            const li = labels.indexOf(lb);
            const cv = (name, value) => { cmds.push({ variable: { name: `${p}${name}${li}`, value } }); return `@${p}${name}${li}`; };
            const lx = cv("lx", mix("x")), ly = cv("ly", mix("y"));
            if (plate) {
                const w = cv("lw", `${fmt(lb.text.length * 0.58)} * (${fsk} - 2) + 4`);
                const px = mix("panX"), py = mix("panY");
                const left = cv("ll", `${lx} - (${px} + 1) / 2 * ${w}`), top = cv("lt", `${ly} - (${py} + 1) / 2 * (${fsk} + 1)`);
                cmds.push({ paint: { ops: [{ color: plate }, { alpha: 1 }, { style: "fill" }] } });
                cmds.push({ drawRect: { left, top, right: `${left} + ${w}`, bottom: `${top} + ${fsk} + 1` } });
                cur = null;
            }
            if (lb.color !== cur) { cmds.push({ paint: { ops: [{ color: lb.color }, { alpha: 1 }, { style: "fill" }, { textSize: `${fsk} - 2` }] } }); cur = lb.color; }
            cmds.push({ drawTextAnchored: { text: lb.text, x: lx, y: ly, panX: mix("panX"), panY: mix("panY") } });
        }
    }

    // Nodes. With `current`, the steps that follow it (ok before it, active at it, pending
    // after it: "before" meaning it can be reached from them) switch faces at run time; a
    // step given failed or a theme colour keeps that.
    const dyn = currentOf(spec, nodes, lay, ctx, decl);
    const hx = decl("hx", `${nw} / 2`), hy = decl("hy", `${nhk} / 2`);
    const r = Number(spec.radius ?? 10);
    const face = (nd, status, extra) => {
        const st = statusStyle(status, mono);
        const mods = [...extra, { clip: { roundedRect: r } }];
        if (st.ring) mods.push({ background: st.ring }, { padding: st.ringW }, { clip: { roundedRect: r - st.ringW } });
        mods.push({ background: st.fill }, { padding: [6, 2] });
        const sayStatus = status && STATUS.has(status) ? `, ${status === "ok" ? "done" : status}` : "";
        if (sayStatus) mods.push({ semantics: { contentDescription: `${nd.label}${sayStatus}` } });
        const text = { text: { value: nd.label, fontSize: fsk, color: st.text, maxLines: lines, overflow: "ellipsis", textAlign: "center", ...(st.weight ? { fontWeight: st.weight } : {}) } };
        let child = text;
        if (st.icon) {
            text.text.modifiers = [{ weight: 1 }];
            child = { row: { verticalAlignment: "center", modifiers: ["fillMaxWidth"], children: [{ Icon: { name: st.icon, size: 16, color: st.iconColor } }, text] } };
        }
        return { box: { horizontalAlignment: "center", verticalAlignment: "center", modifiers: mods, children: [child] } };
    };
    const nodeBoxes = nodes.map((nd, v) => {
        const aE = A(across[v]), bE = B[layer[v]];
        const ox = lr === 1 ? `${bE} - ${hx}` : lr === 0 ? `${aE} - ${hx}` : `ifElse(${aE}, ${bE}, ${lr}) - ${hx}`;
        const oy = lr === 1 ? `${aE} - ${hy}` : lr === 0 ? `${bE} - ${hy}` : `ifElse(${bE}, ${aE}, ${lr}) - ${hy}`;
        const place = [{ offset: [ox, oy] }, still(), { width: nw }, { height: nhk }];
        if (dyn?.vis[v]) {
            const vis = dyn.vis[v];
            return { box: { modifiers: place, children: [
                face(nd, "ok", [{ visibility: vis.done }, still(), { width: nw }, { height: nhk }]),
                face(nd, "active", [{ visibility: vis.act }, still(), { width: nw }, { height: nhk }]),
                face(nd, "pending", [{ visibility: vis.pend }, still(), { width: nw }, { height: nhk }]),
            ] } };
        }
        return face(nd, dyn?.status[v] ?? nd.status, place);
    });

    const diagram = [{ canvas: { modifiers: [{ width: W }, still(), { height: H }], commands: cmds } }, ...nodeBoxes];
    const children = [...vars];
    if (show) {
        const hide = decl("hide", `1 - ${show}`);
        children.push(...vars.slice(children.length));
        children.push({ box: { modifiers: [{ visibility: show }, still(), { width: W }, { height: H }], children: diagram } });
        children.push(compactView(nodes, lay, hide, mono, dyn));
    } else children.push(...diagram);
    // Its own background (the page's colour by default), so it reads in every look when it
    // is the whole document; "none" leaves the parent's.
    const bg = spec.background === undefined || spec.background === null ? "@colors.background" : String(spec.background);
    const top_ = { box: { modifiers: [{ width: sizeExpr(spec.width, "windowWidth()") }, still(), { height: sizeExpr(spec.height, "windowHeight()") }, ...(bg === "none" || bg === "" ? [] : [{ background: bg }])], children } };
    if (spec.description) top_.box.modifiers.push({ semantics: { contentDescription: String(spec.description) } });
    return top_;
}

// The summary shown when the box is too small for the diagram: which step the process is at
// (the first active node, else the first failed, else the first pending), and one dot per step
// in reading order, its look saying its status.
/**
 * `current` (a step index, a node id, or an expression such as "@step"): a static one becomes
 * statuses; a run-time one becomes, per step that follows it, three visibility variables
 * (done, active, pending). "Done" is "current can be reached from it" (a table of N x N
 * floats, one arrayGet per step), so a branch not taken stays pending.
 */
export function currentOf(spec, nodes, lay, ctx, decl) {
    const cur = spec.current;
    if (cur === undefined || cur === null || cur === "") return null;
    const n = nodes.length;
    const follows = (nd) => nd.status === undefined || ["ok", "active", "pending"].includes(nd.status);
    // Reachability over the DAG (back edges reversed, as laid out).
    const reach = Array.from({ length: n }, () => new Set());
    const succ = Array.from({ length: lay.layer.length }, () => []);
    for (const [u, v] of lay.segs) succ[u].push(v);
    for (let v = 0; v < n; v++) {
        const stack = [...succ[v]];
        while (stack.length) { const w = stack.pop(); if (w < n && reach[v].has(w)) continue; if (w < n) reach[v].add(w); stack.push(...succ[w]); }
    }
    const byId = nodes.findIndex((nd) => nd.id === String(cur));
    const lit = byId >= 0 ? byId : typeof cur === "number" || /^-?\d+$/.test(String(cur)) ? Number(cur) : null;
    if (lit !== null) {
        const status = nodes.map((nd, v) => (!follows(nd) ? nd.status : v === lit ? "active" : reach[v].has(lit) ? "ok" : lit >= n ? "ok" : "pending"));
        return { status, vis: [], static: lit };
    }
    const c = decl("cur", `clamp(-1, ${n}, round(${cur}))`);
    const table = [];
    for (let v = 0; v < n; v++) for (let w = 0; w < n; w++) table.push(reach[v].has(w) ? 1 : 0);
    const m = ctx.floatArray("flow_done", table);
    const vis = nodes.map((nd, v) => {
        if (!follows(nd)) return null;
        // past the last step every step is done; before the first, none is
        const done = decl(`dn${v}`, `ifElse(arrayGet(${m}, ${v * n} + clamp(0, ${n - 1}, ${c})) * step(${c}, -0.5), 1, step(${c}, ${n - 0.5}))`);
        const act = decl(`ac${v}`, `1 - min(1, abs(${c} - ${v}))`);
        return { done, act, pend: decl(`pn${v}`, `1 - ${done} - ${act}`) };
    });
    return { status: nodes.map((nd) => nd.status), vis, cur: c };
}

function compactView(nodes, lay, visible, mono, dyn) {
    const seq = nodes.map((_, i) => i).sort((a, b) => lay.layer[a] - lay.layer[b] || lay.across[a] - lay.across[b]);
    const statusOf = (i) => dyn?.status?.[i] ?? nodes[i].status;
    const find = (st) => seq.find((i) => statusOf(i) === st);
    const focus = find("active") ?? find("failed") ?? find("pending");
    const n = seq.length;
    const head = focus === undefined ? `${n} steps` : `Step ${seq.indexOf(focus) + 1} of ${n}`;
    const label = focus === undefined ? `${nodes[seq[0]].label} to ${nodes[seq[n - 1]].label}` : nodes[focus].label;
    const dots = [];
    const groups = new Map();
    seq.forEach((v, j) => {
        const st = dyn?.vis?.[v] ? "dyn" : statusOf(v) ?? "none";
        (groups.get(st) ?? groups.set(st, []).get(st)).push(j);
    });
    const cx = (j) => `(componentWidth() - ${fmt((n - 1) * 14)}) / 2 + ${j * 14}`;
    const dotOf = (st, j) => (st === "failed" ? { drawRect: { left: `${cx(j)} - 4`, top: 2, right: `${cx(j)} + 4`, bottom: 10 } }
        : { drawCircle: { cx: cx(j), cy: 6, radius: st === "active" ? 5.5 : st === "pending" || st === "none" ? 3.5 : 4 } });
    for (const [st, js] of groups) {
        if (st === "dyn") {
            for (const j of js) {
                const vis = dyn.vis[seq[j]];
                for (const [s2, color, a] of [["ok", "@colors.success", vis.done], ["active", "@colors.primary", vis.act], ["pending", "@colors.outline", vis.pend]]) {
                    dots.push({ paint: { ops: [{ color }, { alpha: a }, { style: s2 === "pending" ? "stroke" : "fill" }, { strokeWidth: 1.5 }] } });
                    dots.push(dotOf(s2, j));
                }
            }
            continue;
        }
        const color = { ok: "@colors.success", active: "@colors.primary", failed: "@colors.error", pending: "@colors.outline", none: "@colors.outline" }[st] ?? `@colors.${st}`;
        const ring = st === "pending" || st === "none";
        dots.push({ paint: { ops: [{ color }, { alpha: 1 }, { style: ring ? "stroke" : "fill" }, { strokeWidth: 1.5 }] } });
        for (const j of js) {
            if (st === "failed") dots.push({ drawRect: { left: `${cx(j)} - 4`, top: 2, right: `${cx(j)} + 4`, bottom: 10 } });
            else dots.push({ drawCircle: { cx: cx(j), cy: 6, radius: st === "active" ? 5.5 : ring ? 3.5 : 4 } });
        }
    }
    // At run time: "Step k of n" from the current index, and the current step's label (one
    // text per step, each shown when it is current).
    const live = dyn?.cur;
    const headNode = live
        ? { text: { value: { type: "textMerge", id1: "Step ", id2: { type: "textMerge", id1: { type: "textFromFloat", value: `clamp(1, ${n}, ${live} + 1)`, whole: String(n).length, decimal: 0, flags: 5 }, id2: ` of ${n}` } }, fontSize: 12, color: "@colors.muted", maxLines: 1 } }
        : { text: { value: head, fontSize: 12, color: "@colors.muted", maxLines: 1 } };
    const labelText = (value, mods) => ({ text: { value, fontSize: 15, fontWeight: 700, color: "@colors.onSurface", maxLines: 2, overflow: "ellipsis", textAlign: "center", ...(mods ? { modifiers: mods } : {}) } });
    const labelNodes = live ? nodes.map((nd, v) => (dyn.vis[v] ? labelText(nd.label, [{ visibility: dyn.vis[v].act }]) : null)).filter(Boolean) : [labelText(label)];
    return { column: { horizontalAlignment: "center", verticalAlignment: "center", modifiers: [{ visibility: visible }, "fillMaxSize", { padding: 8 }], children: [
        headNode,
        ...labelNodes,
        { box: { modifiers: [{ height: 8 }] } },
        { canvas: { modifiers: ["fillMaxWidth", { height: 12 }], commands: dots } },
    ] } };
}
