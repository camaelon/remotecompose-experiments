// Repaint scheduling: what causes the next paint, and with which value.
//
// The engine decides in CoreDocument.paint():
//
//   1. paintContext.doesNeedsRepaint(), root.needsRepaint() or root.needsBoundsAnimation()
//        -> 1, meaning "paint again as soon as possible"
//   2. otherwise RemoteComposeState.getOpsToUpdate():
//        a listener on CONTINUOUS_SEC (1) -> 1
//        a listener on TIME_IN_SEC    (2) -> min(wakeIn, next second boundary)
//        a listener on TIME_IN_MIN    (3) -> min(wakeIn, next minute boundary)
//        wakeIn seconds set               -> that
//        nothing                          -> -1, idle
//
// RcdPlayer then reschedules: <= 1 goes straight to requestAnimationFrame (a repaint every
// frame), anything larger waits that many milliseconds first.
//
// Nothing here instruments the engine. `needsRepaint()` gives the decision, and the variable
// listener map gives the exact operations behind every time-driven cause. The one case that
// cannot name its caller is the immediate flag, because PaintContext records a bare boolean:
// for that this panel resolves the operations in the document that request an immediate
// repaint when they run, marks the ones whose state says they are doing so right now, and
// is explicit that the attribution is derived rather than observed.

const ID_CONTINUOUS_SEC = 1;
const ID_TIME_IN_SEC = 2;
const ID_TIME_IN_MIN = 3;

const SYS_VAR_NAMES = {
    [ID_CONTINUOUS_SEC]: 'CONTINUOUS_SEC',
    [ID_TIME_IN_SEC]: 'TIME_IN_SEC',
    [ID_TIME_IN_MIN]: 'TIME_IN_MIN'
};

// TimeAttribute (172) modes whose apply() calls needsRepaint() on every frame.
const TIME_ATTR_CONTINUOUS = {
    0: 'timeFromNowSec', 1: 'timeFromNowMin', 3: 'timeFromArgSec',
    4: 'timeFromArgMin', 14: 'timeFromLoadSec'
};

// Particle operations whose paint() ends in needsRepaint().
const PARTICLE_REPAINT_OPS = { 163: 'ParticlesLoop', 194: 'ParticlesCompare' };

const OP_TOUCH_EXPRESSION = 157;
const OP_FLOAT_EXPRESSION = 81;
const OP_TIME_ATTRIBUTE = 172;

function opCodeOf(op) {
    if (!op) return -1;
    return op.OP_CODE !== undefined ? op.OP_CODE : (op.constructor ? op.constructor.OP_CODE : -1);
}

function opNameOf(op) {
    if (typeof window.getOpName === 'function') return window.getOpName(op);
    return (op && op.constructor && op.constructor.name || 'Operation').replace(/^_/, '');
}

/** Locate an operation in the flat command list so a cause can deep-link to it. */
function opIndexOf(op) {
    const ops = window.currentParsedOps;
    if (!Array.isArray(ops)) return -1;
    return ops.indexOf(op);
}

function describeOp(op, note) {
    return { op, idx: opIndexOf(op), name: opNameOf(op), varId: op && op.mId !== undefined ? op.mId : null, note };
}

function getState(doc) {
    if (!doc) return null;
    return typeof doc.getRemoteComposeState === 'function' ? doc.getRemoteComposeState() : doc.mRemoteComposeState;
}

function listenersOn(state, id) {
    if (!state) return [];
    const l = typeof state.getListeners === 'function' ? state.getListeners(id) : null;
    return Array.isArray(l) ? l : [];
}

/**
 * Operations that ask for an immediate repaint when they run. `active` means the operation's
 * own state says it is requesting one right now; without it the operation only does so under
 * a condition this panel cannot observe (a touch in flight, for instance).
 */
function findImmediateRequesters(doc, animationTime) {
    const ops = window.currentParsedOps;
    if (!Array.isArray(ops)) return [];
    const found = [];

    ops.forEach(op => {
        const code = opCodeOf(op);

        if (code === OP_TIME_ATTRIBUTE) {
            const mode = (op.mType ?? 0) & 255;
            const modeName = TIME_ATTR_CONTINUOUS[mode];
            if (modeName) {
                found.push({ ...describeOp(op, `${modeName} — re-reads the clock every frame`), active: true });
            }
            return;
        }

        if (PARTICLE_REPAINT_OPS[code]) {
            found.push({ ...describeOp(op, `${PARTICLE_REPAINT_OPS[code]} advances the simulation every frame`), active: true });
            return;
        }

        if (code === OP_TOUCH_EXPRESSION) {
            found.push({ ...describeOp(op, 'while a touch gesture is settling'), active: false });
            return;
        }

        if (code === OP_FLOAT_EXPRESSION) {
            if (op.mFloatAnimation) {
                const duration = typeof op.mFloatAnimation.getDuration === 'function'
                    ? op.mFloatAnimation.getDuration() : NaN;
                const elapsed = animationTime - op.mLastChange;
                const running = Number.isFinite(duration) && Number.isFinite(elapsed) && elapsed <= duration;
                const remaining = running ? Math.max(0, duration - elapsed) : 0;
                found.push({
                    ...describeOp(op, running
                        ? `animating — ${(remaining * 1000).toFixed(0)} ms left of ${(duration * 1000).toFixed(0)} ms`
                        : 'animated, currently settled'),
                    active: running
                });
            } else if (op.mSpring) {
                const target = typeof op.mSpring.getTargetValue === 'function' ? op.mSpring.getTargetValue() : NaN;
                const settling = Number.isFinite(target) && Math.abs(target - op.mLastAnimatedValue) > 0.01;
                found.push({
                    ...describeOp(op, settling ? 'spring still settling' : 'spring, currently settled'),
                    active: settling
                });
            }
        }
    });

    return found;
}

/**
 * Reconstruct the engine's decision and everything that fed into it.
 * Causes are returned in the engine's own precedence order, each flagged as winning
 * (it determines the delay), subsumed (it would schedule a repaint but something sooner
 * wins) or inactive.
 */
export function analyzeRepaintSchedule(doc, player) {
    const empty = { available: false, delayMs: -1, verdict: 'idle', causes: [], requesters: [] };
    if (!doc || typeof doc.needsRepaint !== 'function') return empty;

    const state = getState(doc);
    const delayMs = doc.needsRepaint();
    const now = Date.now();
    const animationTime = player && player.remoteContext && typeof player.remoteContext.getAnimationTime === 'function'
        ? player.remoteContext.getAnimationTime() : NaN;

    const paintCtx = player ? player.paintContext : null;
    const immediateFlag = !!(paintCtx && typeof paintCtx.doesNeedsRepaint === 'function' && paintCtx.doesNeedsRepaint());
    const root = doc.mRootLayoutComponent;
    const layoutRepaint = !!(root && typeof root.needsRepaint === 'function' && root.needsRepaint());
    const boundsAnimation = !!(root && typeof root.needsBoundsAnimation === 'function' && root.needsBoundsAnimation());

    const contSec = listenersOn(state, ID_CONTINUOUS_SEC);
    const timeSec = listenersOn(state, ID_TIME_IN_SEC);
    const timeMin = listenersOn(state, ID_TIME_IN_MIN);
    const wakeSeconds = state ? state.mRepaintSeconds : NaN;
    const hasWake = typeof wakeSeconds === 'number' && !Number.isNaN(wakeSeconds);

    const requesters = findImmediateRequesters(doc, animationTime);

    // Replay the engine's precedence to work out which cause actually won.
    let winner = null;
    if (immediateFlag) winner = 'immediate';
    else if (layoutRepaint || boundsAnimation) winner = 'layout';
    else if (contSec.length) winner = 'continuousSec';
    else {
        const wakeMs = hasWake ? Math.trunc(wakeSeconds * 1000) : Number.MAX_SAFE_INTEGER;
        if (timeSec.length) winner = (2 + 1000 - (now % 1000)) <= wakeMs ? 'timeInSec' : 'wakeIn';
        else if (timeMin.length) winner = (2 + 60000 - (now % 60000)) <= wakeMs ? 'timeInMin' : 'wakeIn';
        else if (hasWake) winner = 'wakeIn';
    }

    const causes = [];
    const push = (kind, present, label, value, ops, detail) => {
        if (!present) return;
        causes.push({ kind, label, value, ops, detail, winning: winner === kind });
    };

    push('immediate', immediateFlag, 'An operation requested an immediate repaint',
        'every frame',
        requesters.filter(r => r.active),
        'PaintContext records only a flag, so the operations below are resolved from the document rather than observed at the call site.');

    push('layout', layoutRepaint || boundsAnimation,
        boundsAnimation ? 'Layout bounds animation in progress' : 'Layout requested a repaint',
        'every frame', []);

    push('continuousSec', contSec.length > 0,
        `${contSec.length} operation${contSec.length === 1 ? ' listens' : 's listen'} to $CONTINUOUS_SEC`,
        'every frame', contSec.map(op => describeOp(op, 'reads continuousSec()')),
        'A listener on CONTINUOUS_SEC makes getOpsToUpdate() return 1 before it considers anything else — this is the usual cause of an unexplained constant repaint.');

    push('timeInSec', timeSec.length > 0,
        `${timeSec.length} operation${timeSec.length === 1 ? ' listens' : 's listen'} to $TIME_IN_SEC`,
        `in ${2 + 1000 - (now % 1000)} ms — the next second boundary, so at most 1002 ms apart`,
        timeSec.map(op => describeOp(op, 'reads timeInSec()')));

    push('timeInMin', timeMin.length > 0,
        `${timeMin.length} operation${timeMin.length === 1 ? ' listens' : 's listen'} to $TIME_IN_MIN`,
        `in ${2 + 60000 - (now % 60000)} ms — the next minute boundary, so at most 60002 ms apart`,
        timeMin.map(op => describeOp(op, 'reads timeInMin()')));

    push('wakeIn', hasWake, 'An operation scheduled an explicit wake',
        `${(wakeSeconds * 1000).toFixed(0)} ms (wakeIn ${wakeSeconds}s)`, [],
        'wakeIn() is recorded on the state, not against the operation that called it.');

    const verdict = delayMs === 1 || delayMs === 0 ? 'continuous' : (delayMs < 0 ? 'idle' : 'scheduled');

    // What the document asks for, as distinct from what this host actually paints.
    const requested = winner === null ? 'never — nothing schedules a repaint'
        : (delayMs >= 0 && delayMs <= 1) ? 'every frame'
        : delayMs < 0 ? 'never — nothing schedules a repaint'
        : `every ~${delayMs} ms`;

    return {
        available: true, delayMs, verdict, winner, causes, requesters, requested,
        idleCandidates: requesters.filter(r => !r.active)
    };
}

// ---------------------------------------------------------------------------
// History — a repaint that only fires sometimes is easy to miss in a single sample.
// ---------------------------------------------------------------------------

const HISTORY_LIMIT = 600;

// A paint rate over a fixed wall-clock window, rather than a count over the last N frames.
// A frame window is the wrong unit here: a document that paints once a second keeps its
// startup layout burst in view for a minute, and reports itself as repainting constantly
// when it has been idle the whole time. Five seconds of wall clock also answers the question
// this panel exists for directly — 60 paints/s is a constant repaint, 1 paint/s is a clock.
const SUMMARY_WINDOW_MS = 5000;

let history = [];
let lastVerdict = null;

export function resetRepaintHistory() {
    history = [];
    lastVerdict = null;
    renderRepaintPanel();
}

export function recordRepaintSample(delayMs) {
    history.push({ t: Date.now(), delayMs });
    if (history.length > HISTORY_LIMIT) history.shift();
}

function historySummary() {
    if (!history.length) return null;
    const cutoff = Date.now() - SUMMARY_WINDOW_MS;
    const recent = history.filter(h => h.t >= cutoff);
    if (!recent.length) return { paints: 0, rate: 0, continuous: 0, scheduled: 0, idle: 0, quiet: true };
    const span = Math.max(1, Date.now() - Math.min(recent[0].t, cutoff));
    return {
        paints: recent.length,
        rate: recent.length / (span / 1000),
        continuous: recent.filter(h => h.delayMs >= 0 && h.delayMs <= 1).length,
        scheduled: recent.filter(h => h.delayMs > 1).length,
        idle: recent.filter(h => h.delayMs < 0).length,
        quiet: false
    };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function esc(s) {
    return typeof window.escapeHtml === 'function' ? window.escapeHtml(String(s)) : String(s);
}

function opChipHtml(entry) {
    const label = entry.varId !== null && entry.varId !== undefined && entry.varId !== -1
        ? `${entry.name} [${entry.varId}]` : entry.name;
    const jump = entry.idx >= 0
        ? `event.stopPropagation(); toggleCommandExpand(${entry.idx}, ${entry.varId ?? 'null'}); const el=document.getElementById('cmdCard-${entry.idx}'); if (el) el.scrollIntoView({behavior:'smooth', block:'center'});`
        : '';
    const title = entry.idx >= 0 ? `Operation #${entry.idx + 1} — click to show it in the Commands List` : 'Not present in the flat command list';
    return `
        <div style="display:flex; align-items:baseline; gap:6px; padding:2px 0;">
            <span onclick="${jump}" title="${esc(title)}" style="cursor:${entry.idx >= 0 ? 'pointer' : 'default'}; color:var(--accent-blue); background:rgba(56,189,248,0.14); border-radius:3px; padding:0 4px; font-family:var(--code-font); font-size:0.72rem; white-space:nowrap;">
                ${entry.idx >= 0 ? `#${entry.idx + 1} ` : ''}${esc(label)}
            </span>
            ${entry.note ? `<span style="color:var(--text-muted); font-size:0.7rem;">${esc(entry.note)}</span>` : ''}
        </div>`;
}

function causeCardHtml(cause) {
    const accent = cause.winning ? 'var(--accent-blue)' : 'var(--border-color)';
    const badge = cause.winning
        ? `<span class="badge" style="background:var(--accent-blue); color:#06202e;">determines next paint</span>`
        : `<span class="badge" style="background:rgba(148,163,184,0.18); color:var(--text-muted);">subsumed</span>`;
    return `
        <div style="border:1px solid ${accent}; border-left:3px solid ${accent}; border-radius:5px; padding:7px 10px; margin-bottom:6px; background:${cause.winning ? 'rgba(56,189,248,0.06)' : 'transparent'};">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:3px;">
                <span style="font-size:0.78rem; color:var(--text-primary); font-weight:600;">${esc(cause.label)}</span>
                ${badge}
            </div>
            <div style="font-family:var(--code-font); font-size:0.75rem; color:var(--accent-amber); margin-bottom:${cause.ops.length || cause.detail ? '5px' : '0'};">${esc(cause.value)}</div>
            ${cause.ops.length ? `<div style="margin-bottom:4px;">${cause.ops.map(opChipHtml).join('')}</div>` : ''}
            ${cause.detail ? `<div style="font-size:0.69rem; color:var(--text-muted); line-height:1.45;">${esc(cause.detail)}</div>` : ''}
        </div>`;
}

export function renderRepaintPanel() {
    const container = document.getElementById('repaintPanelBody');
    if (!container) return;

    const doc = window.currentDocument;
    const player = window.currentPlayer;
    const a = analyzeRepaintSchedule(doc, player);

    if (!a.available) {
        container.innerHTML = `<div style="text-align:center; padding:28px; color:var(--text-muted);">No document loaded yet.</div>`;
        return;
    }

    const verdictStyles = {
        continuous: { color: '#f43f5e', bg: 'rgba(244,63,94,0.12)', icon: '🔴', text: 'Repainting every frame' },
        scheduled: { color: 'var(--accent-amber)', bg: 'rgba(251,191,36,0.12)', icon: '🟡', text: `Next repaint in ${a.delayMs} ms` },
        idle: { color: 'var(--accent-emerald)', bg: 'rgba(16,185,129,0.12)', icon: '🟢', text: 'Idle — no repaint scheduled' }
    };
    const v = verdictStyles[a.verdict];

    const hist = historySummary();
    const rateColor = !hist ? 'var(--text-muted)'
        : hist.rate >= 20 ? '#f43f5e' : hist.rate >= 2 ? 'var(--accent-amber)' : 'var(--accent-emerald)';
    const histHtml = hist ? `
        <div style="display:flex; gap:10px; align-items:center; font-size:0.72rem; color:var(--text-secondary); margin-bottom:8px; flex-wrap:wrap;">
            <span title="Frames this inspector actually painted over the last 5 seconds of wall clock. This can exceed what the document asks for: the player arms a fresh timer chain on every repaint() call, and those chains each re-arm, so several can run at once.">Observed here, last 5 s:</span>
            <span style="color:${rateColor}; font-weight:600; font-family:var(--code-font);">${hist.paints} paints (${hist.rate.toFixed(1)}/s)</span>
            ${hist.continuous ? `<span style="color:#f43f5e;">${hist.continuous} continuous</span>` : ''}
            ${hist.scheduled ? `<span style="color:var(--accent-amber);">${hist.scheduled} scheduled</span>` : ''}
            ${hist.idle ? `<span style="color:var(--accent-emerald);">${hist.idle} idle</span>` : ''}
            <button class="btn btn-secondary" style="padding:1px 7px; font-size:0.68rem; margin-left:auto;" onclick="resetRepaintHistory()">🧹 Reset</button>
        </div>` : '';

    const idleHtml = a.idleCandidates.length ? `
        <div style="margin-top:10px; padding:7px 10px; border:1px dashed var(--border-color); border-radius:5px;">
            <div style="font-size:0.74rem; color:var(--text-secondary); font-weight:600; margin-bottom:4px;">Can request an immediate repaint, but is not right now</div>
            ${a.idleCandidates.map(opChipHtml).join('')}
        </div>` : '';

    const noCause = a.causes.length === 0
        ? `<div style="font-size:0.75rem; color:var(--text-muted); padding:8px 0;">Nothing in this document asks to be repainted. It paints once and stays put until an input or a variable changes.</div>`
        : '';

    container.innerHTML = `
        <div style="padding:8px 10px; border-radius:6px; background:${v.bg}; border:1px solid ${v.color}; margin-bottom:10px;">
            <div style="display:flex; align-items:center; gap:8px;">
                <span style="font-size:1rem;">${v.icon}</span>
                <span style="font-weight:600; color:${v.color}; font-size:0.86rem;">${esc(v.text)}</span>
                <span style="margin-left:auto; font-family:var(--code-font); font-size:0.72rem; color:var(--text-muted);" title="The value the engine returned when it last painted. Delays below are recomputed against the clock now, so they count down between paints.">needsRepaint() = ${a.delayMs} at last paint</span>
            </div>
            <div style="font-size:0.71rem; color:var(--text-secondary); margin-top:4px;">The document asks to be painted <strong style="color:${v.color};">${esc(a.requested)}</strong>.</div>
        </div>
        ${histHtml}
        ${noCause}
        ${a.causes.map(causeCardHtml).join('')}
        ${idleHtml}`;
}

/** Called once per painted frame from the player's variable listener. */
export function updateRepaintPanelLive() {
    const doc = window.currentDocument;
    if (!doc || typeof doc.needsRepaint !== 'function') return;
    const delay = doc.needsRepaint();
    recordRepaintSample(delay);
    const pane = document.getElementById('pane15');
    if (!pane || pane.classList.contains('hidden-panel')) return;
    // The verdict is stable across most frames; only re-render when it moves or roughly twice
    // a second, so a continuously repainting document does not spend its budget on this panel.
    const bucket = delay <= 1 ? 'c' : (delay < 0 ? 'i' : 's');
    const key = `${bucket}:${Math.floor(Date.now() / 500)}`;
    if (key === lastVerdict) return;
    lastVerdict = key;
    renderRepaintPanel();
}
