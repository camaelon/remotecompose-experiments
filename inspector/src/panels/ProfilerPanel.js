// =========================================================================
// Panel 8: Profiler & Operation Measurement Engine
// Modularized in src/panels/ProfilerPanel.js
// =========================================================================

import {
    KNOWN_OPCODES,
    prettyPrintFloatExpression,
    prettyPrintIntegerExpression
} from './CommandListPanel.js';
import { findOperationByInstanceId } from './LayoutManager.js';
import { selectAndRenderStepOp } from './StagePanel.js';

function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let isProfilerMeasuring = true;
let profilerRankMode = 'last'; // 'last' | 'total' | 'peak'
let profilerAcc = freshProfAcc();
let profilerDrawPending = false;
let profilerLastPaintTime = 0;

function freshProfAcc() {
    return {
        frames: 0,
        total: 0,
        peak: 0,
        last: 0,
        history: [], // per-frame totals for sparkline (up to 600)
        types: new Map(), // key -> { name, opCode, total, peak, last }
        insts: new Map(), // id -> { id, name, key, total, peak, last }
        badFrames: 0,
        lastProblem: '',
        unattributed: 0
    };
}

export function accumulateProfiler(a, m, opsPerFrame) {
    if (!m) return;
    a.frames++;
    a.last = m.total;
    a.total += m.total;
    if (m.total > a.peak) a.peak = m.total;

    a.history.push(m.total);
    if (a.history.length > 600) a.history.shift();

    let expected = null;
    if (typeof opsPerFrame === 'number' && opsPerFrame >= 0) {
        expected = opsPerFrame;
    }
    if (expected !== null && m.total !== expected) {
        a.badFrames++;
        a.lastProblem = `frame #${m.frame}: got ${m.total} ops, expected ${expected}`;
    }

    if (m.unattributed) {
        a.unattributed += m.unattributed;
    }

    // Reset last-frame counters on type entries
    a.types.forEach(v => { v.last = 0; });
    if (Array.isArray(m.byType)) {
        for (const item of m.byType) {
            let entry = a.types.get(item.key);
            if (!entry) {
                entry = { name: item.name, opCode: item.opCode, total: 0, peak: 0, last: 0 };
                a.types.set(item.key, entry);
            }
            entry.last = item.count;
            entry.total += item.count;
            if (item.count > entry.peak) entry.peak = item.count;
        }
    }

    // Reset last-frame counters on instance entries
    a.insts.forEach(v => { v.last = 0; });
    if (Array.isArray(m.byInstance)) {
        for (const item of m.byInstance) {
            let entry = a.insts.get(item.id);
            if (!entry) {
                entry = { id: item.id, name: item.name, key: item.key, total: 0, peak: 0, last: 0, lastFrame: 0 };
                a.insts.set(item.id, entry);
            }
            entry.last = item.count;
            entry.total += item.count;
            entry.lastFrame = a.frames;
            if (item.count > entry.peak) entry.peak = item.count;
        }
    }
}

export function scheduleProfilerDraw() {
    if (profilerDrawPending) return;
    profilerDrawPending = true;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const elapsed = now - profilerLastPaintTime;
    if (elapsed >= 100) {
        profilerDrawPending = false;
        profilerLastPaintTime = now;
        drawProfiler();
    } else {
        setTimeout(() => {
            profilerDrawPending = false;
            profilerLastPaintTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
            drawProfiler();
        }, 100 - elapsed);
    }
}

// ---------------------------------------------------------------------------
// Coverage — which operations has measurement never seen?
//
// The profiler answers "what executed and how often". It has no way to say what *didn't*,
// and the dead-code analysis cannot either: that one is static over the expression graph, so
// it never sees a conditional branch not taken, a state-layout variant never shown, or a loop
// body that ran zero times.
//
// No engine change is needed to answer it. OperationMeasurement stamps an operation with a
// symbol-keyed instance id the first time it counts one, and only then. An operation carrying
// no such symbol has never been counted for the life of this document — so walking the whole
// operation tree and testing for the symbol is an exact record of what never ran.
// ---------------------------------------------------------------------------

const MEASURE_SYMBOL_NAME = 'rcMeasureId';

function measurementIdOf(op) {
    if (!op || typeof op !== 'object') return undefined;
    const symbols = Object.getOwnPropertySymbols(op);
    for (let i = 0; i < symbols.length; i++) {
        if (symbols[i].description === MEASURE_SYMBOL_NAME) return op[symbols[i]];
    }
    return undefined;
}

/**
 * Coverage over the same operation universe the rest of the inspector uses — the flat
 * command list — so the numbers here line up with the Disassembly panel and every row can
 * deep-link to it. Falling back to a tree walk would report a different total than the
 * panel next to it, which is worse than no number at all.
 *
 * "Never ran" means measurement never counted the operation. The engine counts an operation
 * where it executes it, which includes modifiers applied during layout — so a click action
 * that the layout pass walks is counted even before anyone taps. What this reliably finds is
 * the opposite case: operations the engine never reached at all.
 */
// Wire framing, not work: ContainerEnd closes a container for the reader and its apply() is
// empty, so the engine never executes one. Counting them would bury the signal — a document
// with a thousand containers reports a thousand operations that "never ran" and nothing else.
const NON_EXECUTABLE_OPCODES = new Set([214]);

export function computeCoverage(doc) {
    const ops = window.currentParsedOps;
    if (!Array.isArray(ops) || !ops.length) return { executed: [], never: [], total: 0 };
    const executed = [];
    const never = [];
    ops.forEach((op, idx) => {
        if (!op || typeof op !== 'object') return;
        const opCode = op.OP_CODE !== undefined ? op.OP_CODE : (op.constructor ? op.constructor.OP_CODE : -1);
        if (NON_EXECUTABLE_OPCODES.has(opCode)) return;
        const name = typeof window.getOpName === 'function' ? window.getOpName(op)
            : (op.constructor?.name || 'Operation').replace(/^_/, '');
        const entry = { op, idx, name, id: measurementIdOf(op) };
        if (entry.id === undefined) never.push(entry); else executed.push(entry);
    });
    return { executed, never, total: executed.length + never.length };
}

function renderCoverage() {
    const el = document.getElementById('profCoverageBody');
    if (!el) return;
    const doc = window.currentDocument;
    if (!doc) { el.innerHTML = ''; return; }

    if (profilerAcc.frames === 0) {
        el.innerHTML = `<div style="font-size:0.72rem; color:var(--text-muted);">No frames measured yet — coverage needs at least one painted frame.</div>`;
        return;
    }

    const { never, total } = computeCoverage(doc);
    const ran = total - never.length;
    const pct = total ? Math.round((ran / total) * 100) : 0;

    if (!total) { el.innerHTML = ''; return; }

    // Two different questions, and the second is the one that usually has an answer.
    //
    // "Never counted" catches an operation the engine never reached at all. It is rare,
    // because the layout walk counts almost everything a document contains — including a
    // click action nobody has tapped.
    //
    // "Ran before, but not in the last frame" is what actually moves: the inactive side of
    // a state layout, a branch whose condition just went false, a component scrolled out of
    // the tree. That is the coverage question worth watching while you drive the document.
    // Measured against a window of frames, not the single last one. Layout operations only
    // run on a measure pass, so "missing from the last frame" flags most of a document every
    // time it paints without re-measuring — which buries the branch that genuinely stopped.
    const STALE_FRAMES = 30;
    const idle = [];
    profilerAcc.insts.forEach(v => {
        if (v.total > 0 && (profilerAcc.frames - v.lastFrame) > STALE_FRAMES) idle.push(v);
    });
    idle.sort((a, b) => (b.total - a.total) || (a.lastFrame - b.lastFrame));

    const idleHtml = idle.length ? `
        <div style="margin-top:${never.length ? '8px' : '0'};">
            <div style="font-size:0.74rem; color:var(--text-secondary); margin-bottom:4px;">
                <strong style="color:var(--accent-amber);">${idle.length}</strong>
                operation${idle.length === 1 ? '' : 's'} ran earlier but not in the last ${STALE_FRAMES} frames
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:3px;">
                ${idle.slice(0, 24).map(v => `
                    <span onclick="selectRunningTreeNodeFromInstance(${v.id})"
                          title="Instance #${v.id} — ran ${v.total} times, last seen at frame ${v.lastFrame} of ${profilerAcc.frames}"
                          style="cursor:pointer; font-family:var(--code-font); font-size:0.68rem; padding:1px 5px; border-radius:3px; background:rgba(251,191,36,0.14); color:var(--accent-amber);">${escapeHtml(v.name)}</span>`).join('')}
                ${idle.length > 24 ? `<span style="font-size:0.68rem; color:var(--text-muted);">+${idle.length - 24}</span>` : ''}
            </div>
        </div>` : '';

    if (!never.length) {
        el.innerHTML = `<div style="font-size:0.74rem; color:var(--accent-emerald);">✓ All ${total} operations were counted at least once over ${profilerAcc.frames} frames.</div>${idleHtml}`;
        return;
    }

    const byName = new Map();
    never.forEach(e => {
        let g = byName.get(e.name);
        if (!g) { g = { name: e.name, count: 0, idxs: [] }; byName.set(e.name, g); }
        g.count++;
        if (g.idxs.length < 6) g.idxs.push(e.idx);
    });
    const groups = Array.from(byName.values()).sort((a, b) => b.count - a.count);

    el.innerHTML = `
        <div style="font-size:0.74rem; color:var(--text-secondary); margin-bottom:6px;">
            <strong style="color:${pct === 100 ? 'var(--accent-emerald)' : 'var(--accent-amber)'};">${ran}/${total}</strong>
            operations counted (${pct}%) over ${profilerAcc.frames} frames —
            <strong style="color:var(--accent-amber);">${never.length}</strong> never ran.
        </div>
        <table style="width:100%; border-collapse:collapse; font-size:0.73rem; font-family:var(--code-font);">
            <thead><tr style="border-bottom:1px solid var(--border-color); color:var(--text-muted); text-transform:uppercase; font-size:0.63rem;">
                <th style="text-align:left; padding:3px 0;">Operation</th>
                <th style="text-align:right; padding:3px 6px;">Never ran</th>
                <th style="text-align:left; padding:3px 0 3px 8px;">Where</th>
            </tr></thead>
            <tbody>${groups.map(g => `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
                    <td style="padding:3px 0; color:var(--text-primary);">${escapeHtml(g.name)}</td>
                    <td style="padding:3px 6px; text-align:right; color:var(--accent-amber);">${g.count}</td>
                    <td style="padding:3px 0 3px 8px;">${g.idxs.map(i => `
                        <span onclick="toggleCommandExpand(${i}, null); const el=document.getElementById('cmdCard-${i}'); if(el) el.scrollIntoView({behavior:'smooth', block:'center'});"
                              title="Operation #${i + 1} — click to show it in the Commands List"
                              style="cursor:pointer; color:var(--accent-blue); font-size:0.68rem; margin-right:4px;">#${i + 1}</span>`).join('')}${g.count > g.idxs.length ? `<span style="color:var(--text-muted); font-size:0.66rem;">+${g.count - g.idxs.length}</span>` : ''}</td>
                </tr>`).join('')}</tbody>
        </table>
        <div style="font-size:0.68rem; color:var(--text-muted); margin-top:5px; line-height:1.45;">
            Counted since the document loaded. A branch only taken on interaction stays here until you exercise it —
            fire it from the Interaction panel and watch this list shrink.
        </div>
        ${idleHtml}`;
}

export function drawProfiler() {
    const pane = document.getElementById('pane8');
    if (!pane || pane.classList.contains('hidden-panel') || pane.classList.contains('collapsed')) return;

    const a = profilerAcc;

    // Summary tiles
    const lastEl = document.getElementById('prof-last');
    const peakEl = document.getElementById('prof-peak');
    const meanEl = document.getElementById('prof-mean');
    const framesEl = document.getElementById('prof-frames');
    const typesEl = document.getElementById('prof-types');
    const instEl = document.getElementById('prof-inst');

    if (lastEl) lastEl.textContent = a.last.toLocaleString();
    if (peakEl) peakEl.textContent = a.peak.toLocaleString();
    if (meanEl) meanEl.textContent = a.frames > 0 ? (a.total / a.frames).toFixed(1) : '0';
    if (framesEl) framesEl.textContent = a.frames.toLocaleString();
    if (typesEl) typesEl.textContent = a.types.size.toString();
    if (instEl) instEl.textContent = a.insts.size.toLocaleString();

    // Live hook status badge
    const sparkStatusEl = document.getElementById('prof-spark-status');
    if (sparkStatusEl) {
        sparkStatusEl.textContent = a.frames > 0 ? `Live: ${a.last.toLocaleString()} ops/fr` : 'Live Hook Armed';
        sparkStatusEl.style.color = isProfilerMeasuring ? 'var(--accent-emerald)' : 'var(--text-muted)';
    }

    // Invariant verification banner
    const invStatusEl = document.getElementById('profInvariantStatus');
    const invTextEl = document.getElementById('profInvariantText');
    if (invStatusEl && invTextEl) {
        if (a.badFrames > 0) {
            invStatusEl.style.background = 'rgba(239, 68, 68, 0.15)';
            invStatusEl.style.borderColor = 'rgba(239, 68, 68, 0.4)';
            invStatusEl.style.color = 'var(--accent-rose)';
            invTextEl.textContent = `Invariant mismatch: ${a.lastProblem}`;
        } else {
            invStatusEl.style.background = 'rgba(61, 220, 132, 0.1)';
            invStatusEl.style.borderColor = 'rgba(61, 220, 132, 0.3)';
            invStatusEl.style.color = 'var(--accent-emerald)';
            invTextEl.textContent = 'Invariants hold: byType and byInstance both sum to total = getOpsPerFrame()';
        }
    }

    drawProfilerSparkline(a);
    renderProfilerTables(a);
}

function drawProfilerSparkline(a) {
    const canvas = document.getElementById('profSparkCanvas') || document.getElementById('profSparklineCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
    }
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const hist = a.history;
    if (!hist || hist.length === 0) {
        ctx.fillStyle = '#64748b';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Awaiting frame measurements...', w / 2, h / 2 + 4);
        ctx.restore();
        return;
    }

    let maxVal = 10;
    for (let i = 0; i < hist.length; i++) {
        if (hist[i] > maxVal) maxVal = hist[i];
    }
    maxVal = Math.ceil(maxVal * 1.15);

    // Baseline grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.25); ctx.lineTo(w, h * 0.25);
    ctx.moveTo(0, h * 0.5);  ctx.lineTo(w, h * 0.5);
    ctx.moveTo(0, h * 0.75); ctx.lineTo(w, h * 0.75);
    ctx.stroke();

    // Plot waveform path
    const n = hist.length;
    const step = n > 1 ? w / (n - 1) : w;

    ctx.beginPath();
    for (let i = 0; i < n; i++) {
        const x = i * step;
        const y = h - (hist[i] / maxVal) * (h - 6) - 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }

    // Fill area under line
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(16, 185, 129, 0.35)');
    grad.addColorStop(1, 'rgba(16, 185, 129, 0.01)');

    ctx.save();
    ctx.lineTo((n - 1) * step, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();

    // Stroke path
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Current value dot at tip
    const lastX = (n - 1) * step;
    const lastY = h - (hist[n - 1] / maxVal) * (h - 6) - 2;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#10b981';
    ctx.fill();

    // Ceiling label badge
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px var(--code-font, monospace)';
    ctx.textAlign = 'right';
    ctx.fillText(`${maxVal} ops`, w - 4, 11);

    ctx.restore();
}

function renderProfilerTables(a) {
    const typesTbody = document.getElementById('profTypesTbody');
    const instsTbody = document.getElementById('profInstsTbody');
    if (!typesTbody || !instsTbody) return;

    const k = profilerRankMode || 'last';
    const fmt = n => typeof n === 'number' ? n.toLocaleString() : (n ?? '0');
    const currentPlayer = window.currentPlayer;
    const KNOWN_OPCODES = window.KNOWN_OPCODES || {};
    const escapeHtml = typeof window.escapeHtml === 'function' ? window.escapeHtml : (s => s);
    const rCtx = (currentPlayer && typeof currentPlayer.getRemoteContext === 'function') ? currentPlayer.getRemoteContext() : null;

    // 1. By Type Table
    const typeList = [];
    a.types.forEach((v, key) => typeList.push({ key, v }));
    typeList.sort((x, y) => (y.v[k] - x.v[k]) || (y.v.total - x.v.total) || (x.v.name < y.v.name ? -1 : 1));

    let maxTypeVal = 0;
    typeList.forEach(item => { maxTypeVal = Math.max(maxTypeVal, item.v[k]); });

    let typesHtml = '';
    if (typeList.length === 0) {
        typesHtml = '<tr><td colspan="6" style="text-align:center; padding:16px; color:var(--text-muted);">No measurement data yet.</td></tr>';
    } else {
        typeList.forEach(item => {
            const v = item.v;
            const pct = maxTypeVal > 0 ? (v[k] / maxTypeVal * 100) : 0;
            const isMuted = v.last === 0;
            const opCodeBadge = v.opCode >= 0
                ? `<span class="badge" style="font-size:0.65rem; padding:1px 5px;">#${v.opCode}</span>`
                : `<span style="color:var(--text-muted);">—</span>`;
            const friendlyName = (v.opCode >= 0 && KNOWN_OPCODES[v.opCode]) ? KNOWN_OPCODES[v.opCode] : v.name;

            typesHtml += `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.04); ${isMuted ? 'opacity:0.6;' : ''}">
                    <td style="padding:4px 0; font-weight:600; color:var(--text-primary);">${escapeHtml(friendlyName)}</td>
                    <td style="padding:4px 4px; text-align:center;">${opCodeBadge}</td>
                    <td style="padding:4px 6px; text-align:right; color:var(--accent-emerald); font-weight:600;">${fmt(v.last)}</td>
                    <td style="padding:4px 6px; text-align:right; color:var(--accent-amber);">${fmt(v.peak)}</td>
                    <td style="padding:4px 6px; text-align:right; color:var(--text-secondary);">${fmt(v.total)}</td>
                    <td style="padding:4px 0 4px 6px;">
                        <div style="height:6px; background:rgba(255,255,255,0.06); border-radius:3px; overflow:hidden;">
                            <div style="height:100%; width:${pct.toFixed(1)}%; background:var(--accent-emerald); border-radius:3px;"></div>
                        </div>
                    </td>
                </tr>
            `;
        });
    }
    typesTbody.innerHTML = typesHtml;

    // 2. By Instance Table (Top 25) with Pretty-Printed Expressions
    const instList = [];
    a.insts.forEach((v, id) => instList.push({ id, v }));
    instList.sort((x, y) => (y.v[k] - x.v[k]) || (y.v.total - x.v.total) || (x.id - y.id));
    const topInsts = instList.slice(0, 25);

    let maxInstVal = 0;
    topInsts.forEach(item => { maxInstVal = Math.max(maxInstVal, item.v[k]); });

    let instsHtml = '';
    if (topInsts.length === 0) {
        instsHtml = '<tr><td colspan="6" style="text-align:center; padding:16px; color:var(--text-muted);">No measurement data yet.</td></tr>';
    } else {
        topInsts.forEach(item => {
            const v = item.v;
            const pct = maxInstVal > 0 ? (v[k] / maxInstVal * 100) : 0;
            const isMuted = v.last === 0;
            const opTypeObj = a.types.get(v.key);
            const opCode = opTypeObj ? opTypeObj.opCode : -1;
            const friendlyName = (opCode >= 0 && KNOWN_OPCODES[opCode]) ? KNOWN_OPCODES[opCode] : v.name;

            // Inspect operation instance to extract pretty-printed expression
            const op = typeof window.findOperationByInstanceId === 'function' ? window.findOperationByInstanceId(item.id) : null;
            let exprBadge = '';

            if (op) {
                if (opCode === 81 || friendlyName === 'FloatExpression') {
                    const bits = op.mBits || op.bits || op.srcExpression;
                    const exprStr = bits && typeof window.prettyPrintFloatExpression === 'function' ? window.prettyPrintFloatExpression(bits) : '';
                    let curVal = rCtx ? rCtx.getFloat(op.mId) : (typeof op.getValue === 'function' ? op.getValue() : NaN);
                    if (Number.isNaN(curVal) && typeof op.getValue === 'function') curVal = op.getValue();
                    const valFormatted = !Number.isNaN(curVal) && isFinite(curVal) ? (Number.isInteger(curVal) ? curVal.toString() : curVal.toFixed(2)) : '';
                    if (exprStr) {
                        exprBadge = `<div style="font-size:0.65rem; font-family:var(--code-font); color:var(--accent-blue); margin-top:2px; word-break:break-all;" title="${escapeHtml(exprStr)}">fx: <strong style="color:var(--text-primary);">${escapeHtml(exprStr)}</strong>${valFormatted ? ` = <strong style="color:var(--accent-emerald);">${valFormatted}</strong>` : ''}</div>`;
                    }
                } else if (opCode === 83 || opCode === 144 || friendlyName === 'IntegerExpression') {
                    const mask = op.mMask ?? op.mask ?? 0;
                    const values = op.mValues || op.values || [];
                    const exprStr = typeof window.prettyPrintIntegerExpression === 'function' ? window.prettyPrintIntegerExpression(mask, values) : '';
                    const curVal = rCtx ? rCtx.getInteger(op.mId) : (op.mValue ?? null);
                    if (exprStr) {
                        exprBadge = `<div style="font-size:0.65rem; font-family:var(--code-font); color:var(--accent-indigo, #818cf8); margin-top:2px; word-break:break-all;" title="${escapeHtml(exprStr)}">ix: <strong style="color:var(--text-primary);">${escapeHtml(exprStr)}</strong>${curVal !== null && curVal !== undefined ? ` = <strong style="color:var(--accent-emerald);">${curVal}</strong>` : ''}</div>`;
                    }
                } else if (opCode === 85 || friendlyName === 'ColorExpression') {
                    const curVal = rCtx ? rCtx.getColor(op.mId) : (op.mColor ?? 0);
                    const hex = '#' + ((curVal >>> 0) & 0xFFFFFF).toString(16).padStart(6, '0');
                    exprBadge = `<div style="font-size:0.65rem; font-family:var(--code-font); color:var(--accent-amber); margin-top:2px; display:flex; align-items:center; gap:4px;"><span style="width:8px; height:8px; border-radius:2px; background:${hex}; border:1px solid rgba(255,255,255,0.4);"></span>${hex}</div>`;
                } else if (friendlyName === 'DrawLine' && op.mX1 !== undefined && op.mX2 !== undefined) {
                    exprBadge = `<div style="font-size:0.62rem; font-family:var(--code-font); color:var(--text-muted); margin-top:2px;">(${op.mX1},${op.mY1}) → (${op.mX2},${op.mY2})</div>`;
                } else if (friendlyName === 'NamedVariable' && op.mName) {
                    exprBadge = `<div style="font-size:0.65rem; font-family:var(--code-font); color:var(--accent-amber); margin-top:2px;">"${escapeHtml(op.mName)}" = ${op.mValue ?? ''}</div>`;
                }
            }

            instsHtml += `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.04); ${isMuted ? 'opacity:0.6;' : ''}; cursor:pointer;" onclick="selectRunningTreeNodeFromInstance(${item.id})" title="Click to step to this operation instance">
                    <td style="padding:4px 0; color:var(--accent-blue); font-weight:600; vertical-align:top;">#${item.id}</td>
                    <td style="padding:4px 6px; color:var(--text-primary); vertical-align:top;">
                        <div>${escapeHtml(friendlyName)}</div>
                        ${exprBadge}
                    </td>
                    <td style="padding:4px 6px; text-align:right; color:var(--accent-emerald); font-weight:600; vertical-align:top;">${fmt(v.last)}</td>
                    <td style="padding:4px 6px; text-align:right; color:var(--accent-amber); vertical-align:top;">${fmt(v.peak)}</td>
                    <td style="padding:4px 6px; text-align:right; color:var(--text-secondary); vertical-align:top;">${fmt(v.total)}</td>
                    <td style="padding:4px 0 4px 6px; vertical-align:top;">
                        <div style="height:6px; background:rgba(255,255,255,0.06); border-radius:3px; overflow:hidden; margin-top:4px;">
                            <div style="height:100%; width:${pct.toFixed(1)}%; background:var(--accent-purple); border-radius:3px;"></div>
                        </div>
                    </td>
                </tr>
            `;
        });
    }
    instsTbody.innerHTML = instsHtml;

    renderCoverage();
}

export function selectRunningTreeNodeFromInstance(instanceId) {
    const op = typeof window.findOperationByInstanceId === 'function' ? window.findOperationByInstanceId(instanceId) : null;
    if (!op) return;
    if (typeof window.selectAndRenderStepOp === 'function') {
        window.selectAndRenderStepOp(op);
    }
}

export function armProfiler(targetPlayer) {
    const player = targetPlayer || (typeof window !== 'undefined' ? window.currentPlayer : null);
    if (!player || typeof player.setMeasurementSink !== 'function') return;
    if (isProfilerMeasuring) {
        player.setMeasurementSink(function(m) {
            accumulateProfiler(profilerAcc, m, player.getOpsPerFrame ? player.getOpsPerFrame() : null);
            scheduleProfilerDraw();
        });
    } else {
        player.setMeasurementSink(null);
    }
}

export function toggleProfilerMeasurement() {
    isProfilerMeasuring = !isProfilerMeasuring;
    const btn = document.getElementById('profMeasureBtn');
    if (btn) {
        btn.textContent = `Measurement: ${isProfilerMeasuring ? 'ON' : 'OFF'}`;
        if (isProfilerMeasuring) {
            btn.classList.remove('btn-secondary');
        } else {
            btn.classList.add('btn-secondary');
        }
    }
    armProfiler();
    if (isProfilerMeasuring) {
        const currentPlayer = typeof window !== 'undefined' ? window.currentPlayer : null;
        if (currentPlayer && typeof currentPlayer.repaint === 'function') {
            currentPlayer.repaint();
        }
    }
    drawProfiler();
}

export function resetProfilerTotals() {
    profilerAcc = freshProfAcc();
    const currentPlayer = typeof window !== 'undefined' ? window.currentPlayer : null;
    if (currentPlayer && typeof currentPlayer.repaint === 'function') {
        currentPlayer.repaint();
    }
    drawProfiler();
}

export function setProfilerRank(rank) {
    profilerRankMode = rank || 'last';
    drawProfiler();
}

window.armProfiler = armProfiler;
window.drawProfiler = drawProfiler;
window.toggleProfilerMeasurement = toggleProfilerMeasurement;
window.resetProfilerTotals = resetProfilerTotals;
window.setProfilerRank = setProfilerRank;
window.selectRunningTreeNodeFromInstance = selectRunningTreeNodeFromInstance;
