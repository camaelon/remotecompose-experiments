// {"$gen": {"kind": "timeline", "items": [...]}}: a schedule laid out on the server. The caller
// names intervals (start, end, label, optional lane and category); this file packs each lane's
// intervals into rows (greedy, sorted by start, a heap of row ends: O(n log n)), picks the axis
// ticks and writes plain RemoteCompose JSON:
//
//   box (the size it is given, default the window)
//     tree variables: the size, the plot's left edge and scale (dp per time unit)
//     canvas: grid lines, tick labels, lane bands
//     one box per lane name, one box per interval at an offset with its label inside; a short
//       bar's label moves beside it, when there is room there, by a visibility switched at run
//       time from the bar's width in dp; the "now" line on top
//
// Times: numbers, "HH:MM" (hours of a day), "Mon 09:00" (hours of a week from Monday 00:00)
// or ISO dates "2026-11-02" / "2026-11-02T09:00" (hours from the axis start). `now` is a time,
// "clock" (read from the device clock at run time, for "HH:MM" and week axes and dates), or an
// expression in the axis unit.

export const kind = "timeline";
export const doc = "A schedule: intervals with start, end, label, lane and category packed into rows, a time axis with ticks, and a now marker that may follow the clock";

// Bars are placed by layout, which players animate on a resize while the axis canvas redraws
// at once; animationId 0 keeps them together (its own modifier object: Java reads one key per object).
const still = () => ({ animationSpec: { animationId: 0 } });
const fmt = (n) => { const r = Math.round(n * 1000) / 1000; return String(Object.is(r, -0) ? 0 : r); };
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PALETTE = ["primary", "secondary", "success", "warning", "error"];

// ---------------------------------------------------------------------------------------------
// Times

/** The kind of a time value: number, day ("HH:MM"), week ("Mon 09:00"), date (ISO). */
export function timeKind(v) {
    if (typeof v === "number") return "number";
    const s = String(v).trim();
    if (/^-?\d+(\.\d+)?$/.test(s)) return "number";
    if (/^\d{1,2}:\d{2}$/.test(s)) return "day";
    if (/^[A-Za-z]{3}\w*(\s+\d{1,2}(:\d{2})?)?$/.test(s) && DAYS.includes(s.slice(0, 1).toUpperCase() + s.slice(1, 3).toLowerCase())) return "week";
    if (/^\d{4}-\d{2}-\d{2}([T ]\d{1,2}:\d{2})?$/.test(s)) return "date";
    throw new Error(`time '${v}': write a number, "HH:MM", "Mon 09:00" or "2026-11-02[T09:00]"`);
}

/** A time as hours (number: as given; day: hours since midnight; week: since Monday 00:00; date: since 1970, UTC). */
export function toHours(v, kind = timeKind(v)) {
    const s = String(v).trim();
    if (kind === "number") return Number(v);
    if (kind === "day") { const [h, m] = s.split(":").map(Number); return h + m / 60; }
    if (kind === "week") {
        const [d, t = "0:00"] = s.split(/\s+/);
        const i = DAYS.findIndex((x) => x.toLowerCase() === d.slice(0, 3).toLowerCase());
        if (i < 0) throw new Error(`time '${v}': unknown day '${d}'`);
        const [h, m = 0] = t.split(":").map(Number);
        return i * 24 + h + m / 60;
    }
    const [date, time = "0:00"] = s.split(/[T ]/);
    const [y, mo, d] = date.split("-").map(Number);
    const [h, m] = time.split(":").map(Number);
    return Date.UTC(y, mo - 1, d, h, m) / 3600000;
}

const pad2 = (n) => String(n).padStart(2, "0");
/** Text for a tick at hours t. */
function tickText(t, kind, step) {
    if (kind === "number") return fmt(t);
    if (kind === "day") { const h = ((Math.round(t * 60) / 60) % 24 + 24) % 24; return `${pad2(Math.floor(h))}:${pad2(Math.round((h % 1) * 60))}`; }
    if (kind === "week") {
        const d = Math.floor(t / 24 + 1e-6);
        if (step >= 24) return DAYS[((d % 7) + 7) % 7];
        const h = t - d * 24;
        return h < 1e-6 ? DAYS[((d % 7) + 7) % 7] : `${pad2(Math.round(h))}:00`;
    }
    const dt = new Date(Math.round(t * 3600000));
    if (step >= 24) return step >= 24 * 28 ? `${MONTHS[dt.getUTCMonth()]}` : `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
    return `${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())}`;
}

/** Tick positions for [t0, t1] with about `target` intervals, on steps natural for the kind. */
export function chooseTicks(t0, t1, kind, target = 6) {
    const span = t1 - t0;
    let steps;
    if (kind === "number") {
        const raw = span / target, mag = 10 ** Math.floor(Math.log10(raw));
        steps = [1, 2, 2.5, 5, 10].map((m) => m * mag);
    } else steps = [0.25, 0.5, 1, 2, 3, 4, 6, 12, 24, 48, 24 * 7, 24 * 14, 24 * 30.4375];
    let step = steps.find((s) => span / s <= target) ?? steps[steps.length - 1];
    if (kind === "date" && step > 24 * 14) step = 24 * 30.4375;
    const ticks = [];
    if (kind === "date" && step > 24 * 14) {
        const d = new Date(t0 * 3600000);
        let m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
        while (m.getTime() / 3600000 <= t1 + 1e-6) { const t = m.getTime() / 3600000; if (t >= t0 - 1e-6) ticks.push(t); m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1)); }
    } else {
        for (let t = Math.ceil(t0 / step - 1e-9) * step; t <= t1 + 1e-9; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
    }
    return { step, ticks };
}

// ---------------------------------------------------------------------------------------------
// Packing

/** A binary min-heap on a key. */
class Heap {
    constructor(key) { this.a = []; this.key = key; }
    get size() { return this.a.length; }
    peek() { return this.a[0]; }
    push(x) { const a = this.a; a.push(x); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (this.key(a[p]) <= this.key(a[i])) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
    pop() {
        const a = this.a, top = a[0], last = a.pop();
        if (a.length) {
            a[0] = last; let i = 0;
            for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && this.key(a[l]) < this.key(a[m])) m = l; if (r < a.length && this.key(a[r]) < this.key(a[m])) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; }
        }
        return top;
    }
}

/**
 * Greedy interval packing: intervals [{start, end}] sorted by start, each into the lowest free
 * row (a row is free once its last interval has ended; touching ends share a row). Returns the
 * row of each interval, in input order, and the number of rows. O(n log n).
 */
export function packIntervals(intervals) {
    const order = intervals.map((_, i) => i).sort((a, b) => intervals[a].start - intervals[b].start || intervals[a].end - intervals[b].end || a - b);
    const busy = new Heap((x) => x.end), free = new Heap((r) => r);
    const row = new Array(intervals.length);
    let rows = 0;
    for (const i of order) {
        const { start, end } = intervals[i];
        while (busy.size && busy.peek().end <= start + 1e-9) free.push(busy.pop().row);
        const r = free.size ? free.pop() : rows++;
        row[i] = r;
        busy.push({ end, row: r });
    }
    return { row, rows };
}

// ---------------------------------------------------------------------------------------------
// The document

const stableHash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36).slice(0, 4); };

export function generate(spec, ctx) {
    const raw = spec.items ?? spec.intervals;
    if (!Array.isArray(raw) || !raw.length) throw new Error("give items: [{start, end, label, lane?, category?}]");
    const items = raw.map((it, i) => {
        const o = Array.isArray(it) ? { start: it[0], end: it[1], label: it[2], lane: it[3] } : { ...it };
        if (o.start === undefined || o.end === undefined) throw new Error(`item ${i}: start and end are required`);
        return o;
    });
    const kinds = new Set(items.flatMap((o) => [timeKind(o.start), timeKind(o.end)]));
    if (spec.start !== undefined) kinds.add(timeKind(spec.start));
    if (spec.end !== undefined) kinds.add(timeKind(spec.end));
    if (kinds.size > 1) throw new Error(`mixed time forms (${[...kinds].join(", ")}): write every time the same way`);
    const kind = [...kinds][0];
    for (const o of items) {
        o.s = toHours(o.start, kind); o.e = toHours(o.end, kind);
        // An end before its start crosses midnight (day) or the week's end.
        if (o.e <= o.s && kind === "day") o.e += 24;
        if (o.e <= o.s && kind === "week") o.e += 24 * 7;
        if (!(o.e > o.s)) throw new Error(`item '${o.label ?? o.start}': end must be after start`);
        o.label = o.label === undefined || o.label === null ? "" : String(o.label);
    }
    let t0 = spec.start !== undefined ? toHours(spec.start, kind) : Math.min(...items.map((o) => o.s));
    let t1 = spec.end !== undefined ? toHours(spec.end, kind) : Math.max(...items.map((o) => o.e));
    if (spec.end !== undefined && t1 <= t0) t1 += kind === "day" ? 24 : kind === "week" ? 168 : 0;
    if (spec.start === undefined || spec.end === undefined) {
        // Round the open ends out to a tick.
        const { step } = chooseTicks(t0, t1, kind);
        if (spec.start === undefined) t0 = Math.floor(t0 / step + 1e-9) * step;
        if (spec.end === undefined) t1 = Math.ceil(t1 / step - 1e-9) * step;
    }
    if (!(t1 > t0)) throw new Error("the axis is empty: end must be after start");
    // What falls outside the axis is cut at its ends (a Sunday night shift ends at the week's end).
    for (const o of items) { o.s = Math.max(o.s, t0); o.e = Math.min(o.e, t1); }
    const kept = items.filter((o) => o.e - o.s > 1e-9);
    items.length = 0; items.push(...kept);
    if (!items.length) throw new Error("no item falls inside the axis");

    // Lanes, in the order given (spec.lanes) or first seen.
    const laneNames = [];
    if (Array.isArray(spec.lanes)) for (const l of spec.lanes) laneNames.push(String(l));
    for (const o of items) if (o.lane !== undefined && !laneNames.includes(String(o.lane))) laneNames.push(String(o.lane));
    const hasLanes = laneNames.length > 0;
    const lanes = hasLanes ? laneNames.map((name) => ({ name, items: items.filter((o) => String(o.lane) === name) })) : [{ name: null, items }];
    if (hasLanes && items.some((o) => o.lane === undefined)) throw new Error("give every item a lane, or none");
    // Category colours, in order of first use (theme colour names pass through).
    const cats = [];
    for (const o of items) if (o.category !== undefined && !cats.includes(String(o.category))) cats.push(String(o.category));
    const catColor = (c) => {
        if (c === undefined) return "@colors.primary";
        const custom = spec.colors?.[c];
        if (custom) return custom.startsWith("@") || custom.startsWith("#") ? custom : `@colors.${custom}`;
        if (PALETTE.includes(c) || ["muted", "outline", "surfaceHigh"].includes(c)) return `@colors.${c}`;
        return `@colors.${PALETTE[cats.indexOf(c) % PALETTE.length]}`;
    };

    const mono = ctx.mono;
    const p = `t${stableHash(JSON.stringify(spec))}_`;
    const vars = [];
    const decl = (name, value) => { vars.push({ variable: { name: p + name, value: typeof value === "number" ? fmt(value) : value } }); return `@${p}${name}`; };

    const fs = Number(spec.fontSize ?? 12);
    const barH = Number(spec.barHeight ?? Math.round(fs * 1.9));
    const rowGap = 3, laneGap = hasLanes ? 6 : 0;
    const axisH = Math.round(fs * 1.4) + 6;
    const pad = 8;
    const T = t1 - t0;
    // The share of the width the lane names take (the rest is the plot).
    const g = hasLanes ? Number(spec.laneShare ?? 0.24) : 0;
    // The layout places the bars (weights in rows), so nothing below needs the box's size
    // except the choice of label (full, initial, beside, none), which reads the window width
    // (or `width`) as an estimate of the plot's: dp per time unit.
    const S = decl("S", `${fmt(1 - g)} * (${String(spec.width ?? "windowWidth()")} - ${2 * pad}) / ${fmt(T)}`);

    // Rows
    const placed = [];
    const laneRows = [];
    let y = axisH;
    const bands = [];
    lanes.forEach((lane, li) => {
        const { row, rows } = packIntervals(lane.items.map((o) => ({ start: o.s, end: o.e })));
        const n = Math.max(1, rows);
        const h = n * barH + (n - 1) * rowGap;
        bands.push({ y: y - laneGap / 2, h: h + laneGap, li });
        const rowsOf = Array.from({ length: n }, () => []);
        lane.items.forEach((o, k) => { const pl = { o, row: row[k], lane: li }; placed.push(pl); rowsOf[row[k]].push(pl); });
        laneRows.push({ lane, n, h, rowsOf });
        y += h + laneGap;
    });
    const contentH = y - laneGap;

    // Label choices, shared by bars of equal length, label and room.
    const cls = new Map();
    const labelClass = (d, label, room) => {
        const est = Math.ceil(label.length * fs * 0.56 + 10);
        const key = `${fmt(d)}|${label.length}|${fmt(room)}`;
        if (cls.has(key)) return cls.get(key);
        const c = {};
        c.full = decl(`f${cls.size}`, `step(${fmt(d)} * ${S}, ${est})`);
        const besideOk = room > 0 ? `step(${fmt(room)} * ${S}, ${est + 4})` : null;
        if (besideOk) c.out = decl(`o${cls.size}`, `(1 - ${c.full}) * ${besideOk}`);
        c.ini = decl(`i${cls.size}`, `(1 - ${c.full})${c.out ? ` * (1 - ${c.out})` : ""} * step(${fmt(d)} * ${S}, ${fmt(fs + 4)})`);
        c.est = est;
        cls.set(key, c);
        return c;
    };
    const colorOf = (o) => o.color ? (o.color.startsWith("@") || o.color.startsWith("#") ? o.color : `@colors.${o.color}`) : catColor(o.category === undefined ? undefined : String(o.category));
    const r = Math.min(6, barH / 3);
    const barFace = (color, children, extra = []) => {
        const mods = [...extra, { padding: [1, 0] }, { clip: { roundedRect: r } }];
        if (mono) mods.push({ background: "@colors.onSurface" }, { padding: 1 }, { clip: { roundedRect: r - 1 } }, { background: "@colors.surface" });
        else mods.push({ background: color });
        return { box: { verticalAlignment: "center", horizontalAlignment: "center", modifiers: mods, children } };
    };
    const onBar = mono ? "@colors.onSurface" : "@colors.onPrimary";
    const spacer = (w, child) => ({ box: { verticalAlignment: "center", ...(child?.end ? { horizontalAlignment: "end" } : {}), modifiers: child ? [{ weight: fmt(w) }, still(), { height: barH }] : [{ weight: fmt(w) }, "fillMaxHeight"], children: child ? [child.node] : [] } });

    const gpx = hasLanes ? decl("gp", `${fmt(g)} * (${String(spec.width ?? "windowWidth()")} - ${2 * pad}) - 6`) : null;
    const fullBy = new Map();
    const laneFull = (need) => {
        if (!fullBy.has(need)) { const on = decl(`n${fullBy.size}`, `step(${gpx}, ${need})`); fullBy.set(need, { on, off: decl(`m${fullBy.size}`, `1 - ${on}`) }); }
        return fullBy.get(need);
    };
    const laneNodes = laneRows.map(({ lane, n, h, rowsOf }) => {
        const rowNodes = rowsOf.map((list) => {
            list.sort((a, b) => a.o.s - b.o.s);
            const kids = [];
            let t = t0;
            const pending = [];   // a label that sits in the next gap
            list.forEach((pl, i) => {
                const { o } = pl;
                const gapL = o.s - t, next = i + 1 < list.length ? list[i + 1].o.s : t1, gapR = next - o.e;
                const room = Math.max(gapL, gapR), side = gapR >= gapL ? 1 : -1;
                const named = cats.length && !(spec.legend === false || spec.legend === 0) && o.category !== undefined && String(o.category) === o.label;   // the legend says it
                const c = o.label ? labelClass(o.e - o.s, o.label, named ? 0 : room) : null;
                const beside = c?.out ? { node: { text: { value: o.label, fontSize: fs, color: "@colors.onSurface", maxLines: 1, modifiers: [{ visibility: c.out }, { padding: [4, 0] }] } }, end: side < 0 } : null;
                if (gapL > 1e-9) kids.push(spacer(gapL, beside && side < 0 ? beside : pending.shift()));
                else if (beside && side < 0) { /* no room on the left after all */ }
                const texts = [];
                if (c) {
                    texts.push({ text: { value: o.label, fontSize: fs, fontWeight: 600, color: onBar, maxLines: 1, modifiers: [{ visibility: c.full }] } });
                    texts.push({ text: { value: o.label.trim().charAt(0).toUpperCase(), fontSize: fs, fontWeight: 700, color: onBar, maxLines: 1, modifiers: [{ visibility: c.ini }] } });
                }
                kids.push(barFace(colorOf(o), texts, [{ weight: fmt(o.e - o.s) }, still(), { height: barH }]));
                if (beside && side > 0) pending.push(beside);
                t = o.e;
            });
            if (t1 - t > 1e-9) kids.push(spacer(t1 - t, pending.shift()));
            return { row: { modifiers: ["fillMaxWidth", { height: barH }], children: kids } };
        });
        const plot = rowNodes.length === 1 ? { ...rowNodes[0] } : { column: { modifiers: ["fillMaxWidth"], children: rowNodes.flatMap((rn, i) => (i ? [{ box: { modifiers: [{ height: rowGap }] } }, rn] : [rn])) } };
        const kids = [];
        if (hasLanes) {
            // The name, or its initials when the gutter is narrower than the name's first word.
            const firstWord = lane.name.split(/\s+/)[0];
            const need = Math.ceil(Math.min(lane.name.length, Math.max(firstWord.length, 5)) * fs * 0.6 + 8);
            const initials = lane.name.split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
            const nameTexts = [{ text: { value: lane.name, fontSize: fs, fontWeight: 600, color: "@colors.onSurface", maxLines: n > 1 ? 2 : 1, overflow: "ellipsis" } }];
            if (initials !== lane.name && initials.length) {
                const full = laneFull(need);
                nameTexts[0].text.modifiers = [{ visibility: full.on }];
                nameTexts.push({ text: { value: initials, fontSize: fs, fontWeight: 700, color: "@colors.onSurface", maxLines: 1, modifiers: [{ visibility: full.off }] } });
            }
            kids.push({ box: { verticalAlignment: "center", modifiers: [{ weight: fmt(g) }, "fillMaxHeight", { padding: [0, 0, 6, 0] }], children: nameTexts } });
            const pm = plot.row ?? plot.column;
            pm.modifiers = [{ weight: fmt(1 - g) }, ...(plot.row ? [{ height: barH }] : [])];
            kids.push(plot);
            return { row: { modifiers: ["fillMaxWidth", { height: h }], children: kids } };
        }
        return plot;
    });

    // Axis and lane bands in a canvas behind, the now line in one on top; both measure
    // themselves, so they match the layout at any size.
    const { ticks, step } = chooseTicks(t0, t1, kind, Number(spec.ticks ?? 7));
    const back = [
        { variable: { name: `${p}cx`, value: `${pad} + ${fmt(g)} * (componentWidth() - ${2 * pad})` } },
        { variable: { name: `${p}cs`, value: `${fmt(1 - g)} * (componentWidth() - ${2 * pad}) / ${fmt(T)}` } },
    ];
    const X = (t) => (Math.abs(t - t0) < 1e-9 ? `@${p}cx` : `@${p}cx + ${fmt(t - t0)} * @${p}cs`);
    if (hasLanes && !mono && lanes.length > 1) {
        back.push({ paint: { ops: [{ color: "@colors.surfaceHigh" }, { alpha: 0.6 }, { style: "fill" }] } });
        for (const b of bands) if (b.li % 2 === 0) back.push({ drawRect: { left: 0, top: fmt(b.y), right: "componentWidth()", bottom: fmt(b.y + b.h) } });
    }
    back.push({ paint: { ops: [{ color: "@colors.outline" }, { alpha: mono ? 1 : 0.7 }, { style: "stroke" }, { strokeWidth: 1 }] } });
    for (const t of ticks) back.push({ drawLine: { x1: X(t), y1: axisH - 3, x2: X(t), y2: fmt(contentH) } });
    const texts = ticks.map((t) => tickText(t, kind, step));
    const centreOnDay = (kind === "week" || kind === "date") && step >= 24;
    const widest = Math.max(...texts.map((x) => x.length)) * (fs - 1) * 0.6 + 6;
    const thin = `step(${fmt(step)} * @${p}cs, ${fmt(widest)})`;
    back.push({ paint: { ops: [{ color: "@colors.muted" }, { alpha: 1 }, { style: "fill" }, { textSize: fs - 1 }] } });
    let alt = false;
    ticks.forEach((t, j) => {
        if (centreOnDay && t + step > t1 + 1e-6) return;   // a day name names the day after its line
        const odd = j % 2 === 1;
        if (odd !== alt) { back.push({ paint: { ops: [{ alpha: odd ? thin : 1 }] } }); alt = odd; }
        back.push({ drawTextAnchored: { text: texts[j], x: centreOnDay ? `${X(t)} + ${fmt(step / 2)} * @${p}cs` : `${X(t)} + 3`, y: axisH - 5, panX: centreOnDay ? 0 : -1, panY: -1 } });
    });

    let front = null;
    if (spec.now !== undefined && spec.now !== null && spec.now !== false) {
        let nowExpr;
        if (spec.now === "clock") {
            if (kind === "day") nowExpr = "timeInMin() / 60";
            else if (kind === "week") nowExpr = "(weekDay() - 1) * 24 + timeInMin() / 60";
            else if (kind === "date") nowExpr = "epochSecond() / 3600";
            else throw new Error("now: \"clock\" needs times written as \"HH:MM\", \"Mon 09:00\" or dates");
        } else if (typeof spec.now === "string" && /[@(]/.test(spec.now)) nowExpr = spec.now;
        else nowExpr = fmt(toHours(spec.now, kind));
        const nowT = decl("now", `${nowExpr} - ${fmt(t0)}`);
        const inRange = decl("nowIn", `step(${nowT}, -0.001) * step(${fmt(T)}, ${nowT})`);
        const nx = `@${p}nx`;
        front = { canvas: { modifiers: [still(), "fillMaxSize"], commands: [
            { variable: { name: `${p}nx`, value: `${pad} + ${fmt(g)} * (componentWidth() - ${2 * pad}) + ${nowT} * ${fmt(1 - g)} * (componentWidth() - ${2 * pad}) / ${fmt(T)}` } },
            { paint: { ops: [{ color: "@colors.error" }, { alpha: inRange }, { style: "stroke" }, { strokeWidth: 2 }] } },
            { drawLine: { x1: nx, y1: axisH - 3, x2: nx, y2: fmt(contentH) } },
            { paint: { ops: [{ style: "fill" }] } },
            { drawCircle: { cx: nx, cy: axisH - 3, radius: 3.5 } },
        ] } };
    }

    // Legend, when bars are coloured by category: a swatch drawn like a bar, with the initial
    // a narrow bar shows, then the name.
    let legend = null;
    if (cats.length && !(spec.legend === false || spec.legend === 0)) {
        legend = { flow: { modifiers: ["fillMaxWidth", { padding: [pad, 6, pad, 0] }], children: cats.map((c) => ({ row: { verticalAlignment: "center", modifiers: [{ padding: [0, 2, 12, 2] }], children: [
            barFace(catColor(c), [{ text: { value: c.trim().charAt(0).toUpperCase(), fontSize: fs, fontWeight: 700, color: onBar, maxLines: 1 } }], [{ width: barH }, { height: barH - 4 }]),
            { text: { value: c, fontSize: fs, color: "@colors.onSurface", maxLines: 1, modifiers: [{ padding: [4, 0, 0, 0] }] } },
        ] } })) } };
    }

    const col = { column: { modifiers: ["fillMaxWidth", { padding: [pad, 0, pad, 0] }], children: [{ box: { modifiers: [{ height: axisH }] } }, ...laneNodes.flatMap((ln, i) => (i ? [{ box: { modifiers: [{ height: laneGap }] } }, ln] : [ln]))] } };
    const stack = { box: { modifiers: ["fillMaxWidth", { height: fmt(contentH + 4) }], children: [...vars, { canvas: { modifiers: [still(), "fillMaxSize"], commands: back } }, col, ...(front ? [front] : [])] } };
    const out = legend ? { column: { modifiers: ["fillMaxWidth"], children: [stack, legend] } } : stack;
    if (spec.description) (out.column ?? out.box).modifiers.push({ semantics: { contentDescription: String(spec.description) } });
    return out;
}

// Exposed for the tests.
export const _internal = { tickText };
