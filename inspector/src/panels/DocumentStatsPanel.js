import {
    getOpName,
    isModifierOp,
    isContainerOp,
    isComponentOp,
    getEffectiveChildren,
    filterCommands,
    prettyPrintFloatExpression,
    prettyPrintIntegerExpression,
    toRawBits
} from './CommandListPanel.js';
import { updateVariablesPanel, getSystemVarName } from './VariablesPanel.js';
import { getFloatExprVarDependencies, getIntegerExprVarDependencies } from './DependencyGraphPanel.js';
import { getAllOperationsFlat } from './DocumentLoader.js';

export function renderDocumentStatistics(doc, ops, u8) {
    if (!doc && typeof window !== 'undefined') {
        doc = window.currentDocument;
    }
    if ((!ops || ops.length === 0) && typeof window !== 'undefined') {
        ops = window.currentParsedOps || window.allOps;
    }
    if (!u8 && typeof window !== 'undefined') {
        if (window.currentU8Buffer) {
            u8 = window.currentU8Buffer;
        } else if (window.currentBuffer) {
            u8 = new Uint8Array(window.currentBuffer);
            window.currentU8Buffer = u8;
        }
    } else if (u8 instanceof ArrayBuffer) {
        u8 = new Uint8Array(u8);
    }

    const totalBytes = u8 ? u8.length : (window.currentBuffer ? window.currentBuffer.byteLength : 0);
    const sizeBadge = document.getElementById('statsTotalSizeBadge');
    const opsBadge = document.getElementById('statsTotalOpsBadge');
    const totalVal = document.getElementById('kpiTotalSize');
    const totalSub = document.getElementById('kpiTotalSub');

    const totalOpsCount = ops ? ops.length : 0;
    if (sizeBadge) sizeBadge.textContent = `${totalBytes} B`;
    if (opsBadge) opsBadge.textContent = `${totalOpsCount} Ops`;
    if (totalVal) totalVal.textContent = `${totalBytes} B`;
    if (totalSub) totalSub.textContent = `${totalOpsCount} ops total`;

    if ((!ops || ops.length === 0) && (!doc || totalBytes === 0)) {
        resetStatsUI();
        return;
    }

    let headerB = 0, headerCount = 0;
    let layoutB = 0, layoutCount = 0;
    let dataB = 0, dataCount = 0;
    let drawB = 0, drawCount = 0;
    let modB = 0, modCount = 0;

    (ops || []).forEach(op => {
        const startOff = op._byteStart ?? 0;
        const endOff = op._byteEnd ?? 0;
        const sizeB = endOff > startOff ? endOff - startOff : 0;
        const opCode = op.OP_CODE !== undefined ? op.OP_CODE : (op.constructor?.OP_CODE ?? 0);
        const name = getOpName(op);

        if (opCode === 0 || name === 'Header') {
            headerB += sizeB;
            headerCount++;
        } else if (isModifierOp(op)) {
            modB += sizeB;
            modCount++;
        } else if (isContainerOp(op) || isComponentOp(op) || (opCode >= 200 && opCode <= 214) || name.includes('Layout') || name === 'ContainerEnd' || name === 'Mi') {
            layoutB += sizeB;
            layoutCount++;
        } else if ((opCode >= 100 && opCode <= 106) || opCode === 80 || opCode === 81 || opCode === 137 || opCode === 157 || opCode === 176 || opCode === 189 || name.includes('TextData') || name.includes('Expression') || name.includes('Variable') || name.includes('Constant') || name.includes('Data') || name.includes('Bitmap') || name.includes('PathData') || name.includes('FontData')) {
            dataB += sizeB;
            dataCount++;
        } else {
            drawB += sizeB;
            drawCount++;
        }
    });

    const headerPct = totalBytes ? Math.round((headerB / totalBytes) * 100) : 0;
    const layoutPct = totalBytes ? Math.round((layoutB / totalBytes) * 100) : 0;
    const dataPct = totalBytes ? Math.round((dataB / totalBytes) * 100) : 0;
    const drawPct = totalBytes ? Math.round((drawB / totalBytes) * 100) : 0;
    const modPct = totalBytes ? Math.round((modB / totalBytes) * 100) : 0;

    // Update Progress Segments
    setSegment('segHeader', headerPct, `Header: ${headerB} B (${headerPct}%)`);
    setSegment('segLayout', layoutPct, `Layout: ${layoutB} B (${layoutPct}%)`);
    setSegment('segData', dataPct, `Data & Vars: ${dataB} B (${dataPct}%)`);
    setSegment('segDraw', drawPct, `Draw & Paint: ${drawB} B (${drawPct}%)`);
    setSegment('segModifier', modPct, `Modifiers: ${modB} B (${modPct}%)`);

    // Update KPI Card Values
    setKpi('kpiDataSize', `${dataB} B`, 'kpiDataSub', `${dataCount} ops (${dataPct}%)`);
    setKpi('kpiLayoutSize', `${layoutB} B`, 'kpiLayoutSub', `${layoutCount} ops (${layoutPct}%)`);
    setKpi('kpiDrawSize', `${drawB} B`, 'kpiDrawSub', `${drawCount} ops (${drawPct}%)`);
    setKpi('kpiModifierSize', `${modB} B`, 'kpiModifierSub', `${modCount} ops (${modPct}%)`);

    // Tree & Component Metrics Breakdown
    renderComponentsBreakdown(doc, ops, totalBytes);

    // Modifiers Breakdown & Styling Analysis
    renderModifiersBreakdown(doc, ops, totalBytes);

    // Variables & Float Expressions Analysis
    renderVariablesBreakdown(doc, ops, totalBytes);

    // Opcode Types Breakdown
    renderOpTypesBreakdown(ops, totalBytes);

    if (typeof window.updateVariablesPanel === 'function') window.updateVariablesPanel();
    else if (typeof updateVariablesPanel === 'function') updateVariablesPanel();
}

// Cached Analysis State
let cachedStatsDoc = null;
let cachedStatsOps = null;
let cachedStatsU8 = null;
let cachedComponentsAnalysis = null;
let cachedVariablesAnalysis = null;

export function invalidateDocumentStatsCache() {
    cachedStatsDoc = null;
    cachedStatsOps = null;
    cachedStatsU8 = null;
    cachedComponentsAnalysis = null;
    cachedVariablesAnalysis = null;
}

export function computeGranularHistogram(instances) {
    if (!instances || instances.length === 0) return [];
    const sizeMap = new Map();
    instances.forEach(inst => {
        const sz = inst.size;
        let entry = sizeMap.get(sz);
        if (!entry) {
            entry = {
                size: sz,
                count: 0,
                combos: new Map(),
                minDepth: 999,
                maxDepth: 0
            };
            sizeMap.set(sz, entry);
        }
        entry.count++;
        if (inst.depth < entry.minDepth) entry.minDepth = inst.depth;
        if (inst.depth > entry.maxDepth) entry.maxDepth = inst.depth;

        let comboKey = 'No attached modifiers';
        if (inst.mods && inst.mods.length > 0) {
            comboKey = inst.mods.join(' + ');
        } else if (inst.parentName) {
            comboKey = `Attached to ${inst.parentName}`;
        }
        entry.combos.set(comboKey, (entry.combos.get(comboKey) || 0) + 1);
    });

    const totalInstances = instances.length;
    const sortedSizes = Array.from(sizeMap.values()).sort((a, b) => a.size - b.size);
    
    // If <= 16 distinct sizes, each size is its own exact discrete bar!
    if (sortedSizes.length <= 16) {
        return sortedSizes.map(item => {
            const topCombos = Array.from(item.combos.entries()).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (×${v})`).join(', ');
            return {
                min: item.size,
                max: item.size,
                size: item.size,
                count: item.count,
                pct: Math.round((item.count / totalInstances) * 100),
                exactPct: ((item.count / totalInstances) * 100).toFixed(1),
                label: `${item.size} B`,
                isDiscrete: true,
                topCombos,
                minDepth: item.minDepth,
                maxDepth: item.maxDepth
            };
        });
    }

    // Fine-grained bins for large variety of distinct sizes
    const min = sortedSizes[0].size;
    const max = sortedSizes[sortedSizes.length - 1].size;
    const range = max - min;
    const binCount = Math.min(12, Math.max(6, Math.ceil(range / 8)));
    const step = Math.max(1, Math.ceil(range / binCount));
    const bins = [];

    for (let i = 0; i < binCount; i++) {
        const bMin = min + i * step;
        const bMax = (i === binCount - 1) ? max : (bMin + step - 1);
        if (bMin <= max) {
            bins.push({
                min: bMin,
                max: Math.min(max, bMax),
                count: 0,
                isDiscrete: bMin === bMax,
                label: bMin === bMax ? `${bMin} B` : `${bMin}–${bMax} B`,
                combos: new Map()
            });
        }
    }

    instances.forEach(inst => {
        const s = inst.size;
        for (let i = 0; i < bins.length; i++) {
            if (s >= bins[i].min && (i === bins.length - 1 ? s <= bins[i].max : s <= bins[i].max)) {
                bins[i].count++;
                let comboKey = 'No attached modifiers';
                if (inst.mods && inst.mods.length > 0) comboKey = inst.mods.join(' + ');
                else if (inst.parentName) comboKey = `Attached to ${inst.parentName}`;
                bins[i].combos.set(comboKey, (bins[i].combos.get(comboKey) || 0) + 1);
                break;
            }
        }
    });

    return bins.filter(b => b.count > 0).map(b => {
        const topCombos = Array.from(b.combos.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} (×${v})`).join(', ');
        return {
            min: b.min,
            max: b.max,
            count: b.count,
            pct: Math.round((b.count / totalInstances) * 100),
            exactPct: ((b.count / totalInstances) * 100).toFixed(1),
            label: b.label,
            isDiscrete: b.isDiscrete,
            topCombos
        };
    });
}

export function computeHistogram(sizes, binCount = 4) {
    if (!sizes || sizes.length === 0) return [];
    return computeGranularHistogram(sizes.map(s => ({ size: s, mods: [], depth: 1 })));
}

export function getModifierIcon(name) {
    if (name.includes('Background') || name.includes('Bg')) return '🎨';
    if (name.includes('Padding') || name.includes('Pad')) return '🔲';
    if (name.includes('Width')) return '↔️';
    if (name.includes('Height')) return '↕️';
    if (name.includes('RoundedClip') || name.includes('ClipRounded')) return '🔘';
    if (name.includes('Clip')) return '✂️';
    if (name.includes('Visibility')) return '👁️';
    if (name.includes('Click') || name.includes('Touch')) return '🖱️';
    if (name.includes('Scroll')) return '📜';
    if (name.includes('Border')) return '🖼️';
    if (name.includes('Scale') || name.includes('Transform')) return '🔍';
    if (name.includes('Alpha') || name.includes('Opacity')) return '🌓';
    if (name.includes('Weight')) return '⚖️';
    if (name.includes('Align')) return '📐';
    return '🏷️';
}

export function getCachedComponentsAnalysis(doc, ops, totalBytes, u8) {
    if (cachedStatsDoc === doc && cachedStatsOps === ops && cachedStatsU8 === u8 && cachedComponentsAnalysis) {
        return cachedComponentsAnalysis;
    }

    // Traversal state
    const allInstances = [];
    const componentStats = new Map();
    const depthDistribution = new Map();
    const modifierStats = new Map();
    const compModCountDist = new Map();
    const allModInstances = [];
    let totalComponentsCount = 0;
    let totalComponentBytes = 0;
    let totalModifiersAttached = 0;
    let totalModifierBytes = 0;
    let styledComponentsCount = 0;
    let containerCount = 0;
    let leafCount = 0;
    let maxDepth = 0;
    const visited = new Set();

    function getComponentIcon(name) {
        if (name.includes('Text')) return '🔤';
        if (name.includes('Box') || name === 'BoxLayout') return '📦';
        if (name.includes('Column') || name === 'ColumnLayout') return '📑';
        if (name.includes('Row') || name === 'RowLayout') return '↔️';
        if (name.includes('State') || name === 'StateLayout') return '🔀';
        if (name.includes('FitBox')) return '📐';
        if (name.includes('Canvas')) return '🎨';
        if (name.includes('Particle')) return '✨';
        if (name.includes('Root')) return '🏠';
        return '🧱';
    }

    function processComponentNode(node, depth) {
        if (!node || visited.has(node)) return;
        visited.add(node);

        const name = getOpName(node);
        const isRoot = name === 'RootLayoutComponent' || node.OP_CODE === 200;

        if (isRoot) {
            // RootLayoutComponent is a transparent wrapper: do not count as a component, do not count in hierarchy depth
            const effectiveChildren = getEffectiveChildren(node);
            effectiveChildren.forEach(child => {
                if (isComponentOp(child)) {
                    processComponentNode(child, 1);
                }
            });
            return;
        }

        if (!isComponentOp(node)) return;

        totalComponentsCount++;
        if (depth > maxDepth) maxDepth = depth;
        depthDistribution.set(depth, (depthDistribution.get(depth) || 0) + 1);

        const isCont = isContainerOp(node);
        if (isCont) containerCount++;
        else leafCount++;

        const startOff = node._byteStart ?? 0;
        const endOff = node._byteEnd ?? 0;
        const nodeBytes = endOff > startOff ? endOff - startOff : 0;
        let instanceBytes = nodeBytes;
        const mods = [];
        let compModCount = 0;

        let stats = componentStats.get(name);
        if (!stats) {
            stats = {
                name,
                icon: getComponentIcon(name),
                count: 0,
                totalBytes: 0,
                sizes: [],
                instances: [],
                modCount: 0,
                modTypes: new Map(),
                isContainer: isCont
            };
            componentStats.set(name, stats);
        }

        // Traverse children & attached modifiers using getEffectiveChildren
        const effectiveChildren = getEffectiveChildren(node);
        const childComponents = [];

        effectiveChildren.forEach(child => {
            if (isModifierOp(child)) {
                compModCount++;
                stats.modCount++;
                totalModifiersAttached++;
                const modName = getOpName(child).replace(/ModifierOperation$/, '').replace(/Modifier$/, '');
                mods.push(modName);
                stats.modTypes.set(modName, (stats.modTypes.get(modName) || 0) + 1);
                
                const mStart = child._byteStart ?? 0;
                const mEnd = child._byteEnd ?? 0;
                const mSize = mEnd > mStart ? mEnd - mStart : 0;
                instanceBytes += mSize;
                totalModifierBytes += mSize;

                let mStats = modifierStats.get(modName);
                if (!mStats) {
                    mStats = {
                        name: modName,
                        icon: getModifierIcon(modName),
                        rawOpName: getOpName(child),
                        count: 0,
                        totalBytes: 0,
                        sizes: [],
                        instances: [],
                        targetComps: new Map()
                    };
                    modifierStats.set(modName, mStats);
                }
                mStats.count++;
                mStats.totalBytes += mSize;
                mStats.sizes.push(mSize);
                mStats.targetComps.set(name, (mStats.targetComps.get(name) || 0) + 1);

                const modInst = { op: child, name: modName, size: mSize, parentName: name, depth };
                mStats.instances.push(modInst);
                allModInstances.push(modInst);
            } else if (isComponentOp(child)) {
                childComponents.push(child);
            }
        });

        if (compModCount > 0) styledComponentsCount++;
        compModCountDist.set(compModCount, (compModCountDist.get(compModCount) || 0) + 1);

        const instObj = { op: node, name, size: instanceBytes, mods, depth, isContainer: isCont };
        stats.count++;
        stats.totalBytes += instanceBytes;
        stats.sizes.push(instanceBytes);
        stats.instances.push(instObj);
        allInstances.push(instObj);
        totalComponentBytes += instanceBytes;

        // Each children level counts as +1 depth
        childComponents.forEach(childComp => {
            processComponentNode(childComp, depth + 1);
        });
    }

    // Traverse starting from root layout component
    const root = typeof doc?.getRootLayoutComponent === 'function' ? doc.getRootLayoutComponent() : doc?.mRootLayoutComponent;
    if (root) {
        processComponentNode(root, 1);
    } else if (doc && typeof doc.getOperations === 'function') {
        const topOps = doc.getOperations() || [];
        topOps.forEach(op => {
            if (isComponentOp(op)) processComponentNode(op, 1);
        });
    } else if (ops && ops.length > 0) {
        ops.forEach(op => {
            if (isComponentOp(op)) processComponentNode(op, 1);
        });
    }

    if (totalComponentsCount === 0 && ops && ops.length > 0) {
        ops.forEach(op => {
            const name = getOpName(op);
            if (name === 'RootLayoutComponent' || op.OP_CODE === 200) return;
            if (isComponentOp(op)) {
                totalComponentsCount++;
                const isCont = isContainerOp(op);
                if (isCont) containerCount++; else leafCount++;
                const startOff = op._byteStart ?? 0;
                const endOff = op._byteEnd ?? 0;
                const sizeB = endOff > startOff ? endOff - startOff : 0;
                totalComponentBytes += sizeB;

                let stats = componentStats.get(name);
                if (!stats) {
                    stats = {
                        name,
                        icon: getComponentIcon(name),
                        count: 0,
                        totalBytes: 0,
                        sizes: [],
                        instances: [],
                        modCount: 0,
                        modTypes: new Map(),
                        isContainer: isCont
                    };
                    componentStats.set(name, stats);
                }
                const instObj = { op, name, size: sizeB, mods: [], depth: 1, isContainer: isCont };
                stats.count++;
                stats.totalBytes += sizeB;
                stats.sizes.push(sizeB);
                stats.instances.push(instObj);
                allInstances.push(instObj);
            }
        });
        maxDepth = 1;
        depthDistribution.set(1, totalComponentsCount);
        compModCountDist.set(0, totalComponentsCount);
    }

    // Pre-calculate statistical summaries & granular histograms for each component kind
    componentStats.forEach((stats) => {
        const sorted = [...stats.sizes].sort((a, b) => a - b);
        stats.minSize = sorted.length > 0 ? sorted[0] : 0;
        stats.maxSize = sorted.length > 0 ? sorted[sorted.length - 1] : 0;
        stats.medianSize = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;
        stats.avgSize = stats.count > 0 ? (stats.totalBytes / stats.count).toFixed(1) : '0';
        stats.histogram = computeGranularHistogram(stats.instances);
    });

    // Pre-calculate statistical summaries & granular histograms for each modifier kind
    modifierStats.forEach((mStats) => {
        const sorted = [...mStats.sizes].sort((a, b) => a - b);
        mStats.minSize = sorted.length > 0 ? sorted[0] : 0;
        mStats.maxSize = sorted.length > 0 ? sorted[sorted.length - 1] : 0;
        mStats.medianSize = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;
        mStats.avgSize = mStats.count > 0 ? (mStats.totalBytes / mStats.count).toFixed(1) : '0';
        mStats.histogram = computeGranularHistogram(mStats.instances);
    });

    // Global document-wide component and modifier size histograms
    const globalHistogram = computeGranularHistogram(allInstances);
    const globalModHistogram = computeGranularHistogram(allModInstances);

    const result = {
        allInstances,
        componentStats,
        depthDistribution,
        globalHistogram,
        modifierStats,
        compModCountDist,
        allModInstances,
        globalModHistogram,
        totalComponentsCount,
        totalComponentBytes,
        totalModifiersAttached,
        totalModifierBytes,
        styledComponentsCount,
        containerCount,
        leafCount,
        maxDepth
    };

    cachedStatsDoc = doc;
    cachedStatsOps = ops;
    cachedStatsU8 = u8;
    cachedComponentsAnalysis = result;

    return result;
}

export function renderComponentsBreakdown(doc, ops, totalBytes) {
    const container = document.getElementById('componentKindsList');
    const depthContainer = document.getElementById('componentDepthHistogram');
    const globalSizeContainer = document.getElementById('componentGlobalSizeHistogram');
    const globalSizeRangeEl = document.getElementById('globalSizeSpectrumRange');
    const badge = document.getElementById('compTotalBadge');
    
    // KPI elements
    const kpiTotalEl = document.getElementById('kpiCompTotal');
    const kpiDepthEl = document.getElementById('kpiCompMaxDepth');
    const kpiPayloadEl = document.getElementById('kpiCompPayload');
    const kpiAvgPayloadEl = document.getElementById('kpiCompAvgPayload');
    const kpiModsEl = document.getElementById('kpiCompModifiers');
    const kpiContainersLeavesEl = document.getElementById('kpiCompContainersLeaves');

    if (!doc && typeof window !== 'undefined') doc = window.currentDocument;
    if ((!ops || ops.length === 0) && typeof window !== 'undefined') ops = window.currentParsedOps || window.allOps;
    const u8 = typeof window !== 'undefined' ? window.currentU8Buffer : null;
    if (!totalBytes && typeof window !== 'undefined') {
        totalBytes = window.currentU8Buffer ? window.currentU8Buffer.length : (window.currentBuffer ? window.currentBuffer.byteLength : 0);
    }

    if (!doc && (!ops || ops.length === 0)) {
        if (container) container.innerHTML = `<div style="text-align:center; padding:16px; color:var(--text-muted); font-size:0.8rem;">No components analyzed.</div>`;
        if (depthContainer) depthContainer.innerHTML = '';
        if (globalSizeContainer) globalSizeContainer.innerHTML = '';
        if (badge) badge.textContent = '0 Components';
        return;
    }

    // Retrieve cached analysis
    const analysis = getCachedComponentsAnalysis(doc, ops, totalBytes, u8);
    const { componentStats, depthDistribution, globalHistogram, totalComponentsCount, totalComponentBytes, totalModifiersAttached, containerCount, leafCount, maxDepth } = analysis;

    // Update KPIs
    const avgPayload = totalComponentsCount > 0 ? (totalComponentBytes / totalComponentsCount).toFixed(1) : 0;
    const avgMods = totalComponentsCount > 0 ? (totalModifiersAttached / totalComponentsCount).toFixed(2) : 0;
    const contPct = totalComponentsCount > 0 ? Math.round((containerCount / totalComponentsCount) * 100) : 0;
    const leafPct = totalComponentsCount > 0 ? (100 - contPct) : 0;
    const payloadPct = totalBytes > 0 ? ((totalComponentBytes / totalBytes) * 100).toFixed(1) : 0;

    if (badge) badge.textContent = `${totalComponentsCount} Components`;
    if (kpiTotalEl) kpiTotalEl.textContent = totalComponentsCount;
    if (kpiDepthEl) kpiDepthEl.textContent = `Depth ${maxDepth}`;
    if (kpiPayloadEl) kpiPayloadEl.textContent = `${totalComponentBytes} B (${payloadPct}%)`;
    if (kpiAvgPayloadEl) kpiAvgPayloadEl.textContent = `${avgPayload} B/comp`;
    if (kpiModsEl) kpiModsEl.textContent = `${totalModifiersAttached} (${avgMods}/comp)`;
    if (kpiContainersLeavesEl) kpiContainersLeavesEl.textContent = `${containerCount} cont (${contPct}%) / ${leafCount} leaf (${leafPct}%)`;

    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    // 1. Render Hierarchy Depth Histogram
    if (depthContainer) {
        let depthHtml = `<div style="display:flex; align-items:flex-end; gap:4px; height:46px; padding-top:2px;">`;
        const maxComponentsAtAnyDepth = Math.max(...Array.from(depthDistribution.values()), 1);

        for (let d = 1; d <= maxDepth; d++) {
            const count = depthDistribution.get(d) || 0;
            const barHeightPct = Math.max(12, Math.round((count / maxComponentsAtAnyDepth) * 100));
            depthHtml += `
                <div style="flex:1; display:flex; flex-direction:column; height:100%; justify-content:flex-end; align-items:center; min-width:18px;" title="Level ${d}: ${count} components (${Math.round((count / totalComponentsCount) * 100)}%)">
                    <div style="height:12px; display:flex; align-items:center; justify-content:center; margin-bottom:2px;">
                        <span style="font-size:0.56rem; font-family:var(--code-font); color:var(--text-muted); line-height:1;">${count}</span>
                    </div>
                    <div style="flex:1; display:flex; align-items:flex-end; width:100%; min-height:14px;">
                        <div style="width:100%; height:${barHeightPct}%; background:var(--accent-blue); border-radius:2px 2px 0 0; min-height:4px; opacity:0.85;"></div>
                    </div>
                    <div style="height:14px; display:flex; align-items:center; justify-content:center; margin-top:2px;">
                        <span style="font-size:0.58rem; font-weight:600; color:var(--text-secondary); line-height:1;">L${d}</span>
                    </div>
                </div>
            `;
        }
        depthHtml += `</div>`;
        depthContainer.innerHTML = depthHtml;
    }

    // 2. Render Document-Wide Granular Component Size Spectrum
    if (globalSizeContainer && globalHistogram && globalHistogram.length > 0) {
        const minGlobal = globalHistogram[0].min;
        const maxGlobal = globalHistogram[globalHistogram.length - 1].max;
        if (globalSizeRangeEl) globalSizeRangeEl.textContent = `${minGlobal} B – ${maxGlobal} B`;

        let globalSizeHtml = `<div style="display:flex; align-items:flex-end; gap:3px; height:46px; padding-top:2px;">`;
        const maxBinCount = Math.max(...globalHistogram.map(b => b.count), 1);

        globalHistogram.forEach(b => {
            const barHeightPct = Math.max(12, Math.round((b.count / maxBinCount) * 100));
            globalSizeHtml += `
                <div style="flex:1; display:flex; flex-direction:column; height:100%; justify-content:flex-end; align-items:center; min-width:20px; position:relative;" title="Payload ${b.label}: ${b.count} components (${b.exactPct}%)\nTypical config: ${esc(b.topCombos)}">
                    <div style="height:12px; display:flex; align-items:center; justify-content:center; margin-bottom:2px;">
                        <span style="font-size:0.56rem; font-family:var(--code-font); color:var(--text-muted); line-height:1;">${b.count}</span>
                    </div>
                    <div style="flex:1; display:flex; align-items:flex-end; width:100%; min-height:14px;">
                        <div style="width:100%; height:${barHeightPct}%; background:var(--accent-emerald); border-radius:2px 2px 0 0; min-height:4px; opacity:0.85; transition:opacity 0.1s ease;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.85"></div>
                    </div>
                    <div style="height:14px; display:flex; align-items:center; justify-content:center; margin-top:2px;">
                        <span style="font-size:0.56rem; font-family:var(--code-font); color:var(--text-secondary); line-height:1; overflow:hidden; text-overflow:clip; white-space:nowrap; max-width:28px;">${b.label}</span>
                    </div>
                </div>
            `;
        });
        globalSizeHtml += `</div>`;
        globalSizeContainer.innerHTML = globalSizeHtml;
    }

    // 3. Render Component Kinds Table with Granular Discrete Size Histograms
    if (container) {
        const sortedKinds = Array.from(componentStats.values()).sort((a, b) => b.count - a.count || b.totalBytes - a.totalBytes);

        let html = `<div style="display:flex; flex-direction:column; gap:8px;">`;

        sortedKinds.forEach(k => {
            const kindPct = totalComponentBytes > 0 ? ((k.totalBytes / totalComponentBytes) * 100).toFixed(1) : 0;
            
            let topModsStr = '';
            if (k.modTypes && k.modTypes.size > 0) {
                const modEntries = Array.from(k.modTypes.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);
                topModsStr = modEntries.map(([mName, mCnt]) => `${mName} ×${mCnt}`).join(', ');
            }

            // Build granular discrete histogram bars
            let histogramBarsHtml = '';
            if (k.histogram && k.histogram.length > 0) {
                const maxBinCount = Math.max(...k.histogram.map(b => b.count), 1);
                k.histogram.forEach(b => {
                    const barHeightPct = Math.max(18, Math.round((b.count / maxBinCount) * 100));
                    const tooltip = `${esc(k.name)} payload ${b.label}: ${b.count} components (${b.exactPct}%)\nModifiers: ${esc(b.topCombos)}`;
                    histogramBarsHtml += `
                        <div style="flex:1; display:flex; flex-direction:column; height:100%; position:relative; cursor:pointer; min-width:26px;" title="${tooltip}">
                            <div style="height:12px; display:flex; align-items:center; justify-content:center; margin-bottom:2px;">
                                <span style="font-size:0.58rem; font-family:var(--code-font); color:var(--text-muted); line-height:1;">${b.count}</span>
                            </div>
                            <div style="flex:1; display:flex; align-items:flex-end; width:100%; min-height:18px;">
                                <div style="width:100%; height:${barHeightPct}%; background:${k.isContainer ? 'rgba(16,185,129,0.75)' : 'rgba(56,189,248,0.75)'}; border-radius:2px 2px 0 0; min-height:4px; transition:all 0.12s ease;" onmouseover="this.style.background='${k.isContainer ? '#10b981' : '#38bdf8'}'; this.style.transform='scaleY(1.05)';" onmouseout="this.style.background='${k.isContainer ? 'rgba(16,185,129,0.75)' : 'rgba(56,189,248,0.75)'}'; this.style.transform='none';"></div>
                            </div>
                            <div style="height:14px; display:flex; align-items:center; justify-content:center; margin-top:3px;">
                                <span style="font-size:0.6rem; color:var(--text-secondary); font-family:var(--code-font); text-align:center; white-space:nowrap; line-height:1; font-weight:600;">${b.label}</span>
                            </div>
                        </div>
                    `;
                });
            }

            html += `
                <div class="comp-type-row" onclick="filterCommandsByType('${esc(k.name)}')" title="Click to filter disassembly for ${esc(k.name)}">
                    <!-- Top Line: Icon, Name, Category, Count, Total Bytes -->
                    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
                        <div style="display:flex; align-items:center; gap:6px;">
                            <span style="font-size:0.95rem;">${k.icon}</span>
                            <span style="font-weight:600; font-size:0.82rem; color:var(--text-primary);">${esc(k.name)}</span>
                            <span class="badge" style="font-size:0.65rem; background:${k.isContainer ? 'rgba(16,185,129,0.15); color:#10b981;' : 'rgba(56,189,248,0.15); color:#38bdf8;'}">${k.isContainer ? 'Container' : 'Leaf'}</span>
                            <span class="op-type-count">×${k.count}</span>
                        </div>
                        <div style="text-align:right;">
                            <span style="font-family:var(--code-font); font-size:0.78rem; font-weight:700; color:var(--text-primary);">${k.totalBytes} B</span>
                            <span style="font-size:0.68rem; color:var(--text-muted); margin-left:4px;">(${kindPct}%)</span>
                        </div>
                    </div>

                    <!-- Metrics Line: Min, Median, Avg, Max & Modifiers -->
                    <div style="display:flex; align-items:center; justify-content:space-between; font-size:0.68rem; color:var(--text-secondary); margin-bottom:4px;">
                        <div style="display:flex; gap:6px; align-items:center;">
                            <span>Min: <strong style="color:var(--text-primary); font-family:var(--code-font);">${k.minSize} B</strong></span>
                            <span>Med: <strong style="color:var(--text-primary); font-family:var(--code-font);">${k.medianSize} B</strong></span>
                            <span>Avg: <strong style="color:var(--accent-amber); font-family:var(--code-font);">${k.avgSize} B</strong></span>
                            <span>Max: <strong style="color:var(--text-primary); font-family:var(--code-font);">${k.maxSize} B</strong></span>
                        </div>
                        ${topModsStr ? `<div style="font-size:0.65rem; color:var(--text-muted); max-width:160px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;" title="Attached Modifiers: ${esc(topModsStr)}">🏷️ ${esc(topModsStr)}</div>` : ''}
                    </div>

                    <!-- Granular Size Distribution Histogram -->
                    <div style="margin-top:5px; margin-bottom:3px; padding:6px 8px; background:rgba(0,0,0,0.2); border-radius:6px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                            <span style="font-size:0.6rem; color:var(--text-muted); text-transform:uppercase; font-weight:600; letter-spacing:0.3px;">Discrete Size Distribution (${k.histogram.length} size ${k.histogram.length === 1 ? 'cluster' : 'clusters'})</span>
                            <span style="font-size:0.62rem; color:var(--text-secondary); font-family:var(--code-font);">${k.minSize === k.maxSize ? `Uniform (${k.minSize} B)` : `${k.minSize} B – ${k.maxSize} B`}</span>
                        </div>
                        <div style="display:flex; align-items:flex-end; gap:6px; height:52px; padding-bottom:2px;">
                            ${histogramBarsHtml}
                        </div>
                    </div>

                    <!-- Overall Payload Share Bar -->
                    <div class="op-type-bar-mini" style="width:100%; height:3px; margin-top:2px;">
                        <div class="op-type-bar-fill" style="width:${kindPct}%; background:${k.isContainer ? '#10b981' : '#38bdf8'};"></div>
                    </div>
                </div>
            `;
        });

        html += `</div>`;
        container.innerHTML = html;
    }
}

export function renderModifiersBreakdown(doc, ops, totalBytes) {
    const container = document.getElementById('modifierKindsList');
    const countContainer = document.getElementById('modifierCountHistogram');
    const globalSizeContainer = document.getElementById('modifierGlobalSizeHistogram');
    const globalSizeRangeEl = document.getElementById('globalModSizeRange');
    const badge = document.getElementById('modTotalBadge');
    
    // KPI elements
    const kpiTotalEl = document.getElementById('kpiModTotal');
    const kpiDistinctEl = document.getElementById('kpiModDistinctTypes');
    const kpiPayloadEl = document.getElementById('kpiModPayload');
    const kpiAvgPayloadEl = document.getElementById('kpiModAvgPayload');
    const kpiDensityEl = document.getElementById('kpiModDensity');
    const kpiStyledEl = document.getElementById('kpiModStyledPercent');

    if (!doc && typeof window !== 'undefined') doc = window.currentDocument;
    if ((!ops || ops.length === 0) && typeof window !== 'undefined') ops = window.currentParsedOps || window.allOps;
    const u8 = typeof window !== 'undefined' ? window.currentU8Buffer : null;
    if (!totalBytes && typeof window !== 'undefined') {
        totalBytes = window.currentU8Buffer ? window.currentU8Buffer.length : (window.currentBuffer ? window.currentBuffer.byteLength : 0);
    }

    if (!doc && (!ops || ops.length === 0)) {
        if (container) container.innerHTML = `<div style="text-align:center; padding:16px; color:var(--text-muted); font-size:0.8rem;">No modifiers analyzed.</div>`;
        if (countContainer) countContainer.innerHTML = '';
        if (globalSizeContainer) globalSizeContainer.innerHTML = '';
        if (badge) badge.textContent = '0 Modifiers';
        return;
    }

    // Retrieve cached analysis
    const analysis = getCachedComponentsAnalysis(doc, ops, totalBytes, u8);
    const { modifierStats, compModCountDist, allModInstances, globalModHistogram, totalComponentsCount, totalModifiersAttached, totalModifierBytes, styledComponentsCount } = analysis;

    // Update KPIs
    const avgModPayload = totalModifiersAttached > 0 ? (totalModifierBytes / totalModifiersAttached).toFixed(1) : 0;
    const modDensity = totalComponentsCount > 0 ? (totalModifiersAttached / totalComponentsCount).toFixed(2) : 0;
    const styledPct = totalComponentsCount > 0 ? ((styledComponentsCount / totalComponentsCount) * 100).toFixed(1) : 0;
    const modPayloadPct = totalBytes > 0 ? ((totalModifierBytes / totalBytes) * 100).toFixed(1) : 0;

    if (badge) badge.textContent = `${totalModifiersAttached} Modifiers`;
    if (kpiTotalEl) kpiTotalEl.textContent = totalModifiersAttached;
    if (kpiDistinctEl) kpiDistinctEl.textContent = `${modifierStats.size} distinct types`;
    if (kpiPayloadEl) kpiPayloadEl.textContent = `${totalModifierBytes} B (${modPayloadPct}%)`;
    if (kpiAvgPayloadEl) kpiAvgPayloadEl.textContent = `${avgModPayload} B/mod`;
    if (kpiDensityEl) kpiDensityEl.textContent = `${modDensity} / comp`;
    if (kpiStyledEl) kpiStyledEl.textContent = `${styledPct}% styled (${styledComponentsCount}/${totalComponentsCount})`;

    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    // 1. Render Modifiers per Component Histogram
    if (countContainer && compModCountDist) {
        let countHtml = `<div style="display:flex; align-items:flex-end; gap:4px; height:46px; padding-top:2px;">`;
        const sortedCounts = Array.from(compModCountDist.entries()).sort((a, b) => a[0] - b[0]);
        const maxCompsAtAnyCount = Math.max(...sortedCounts.map(e => e[1]), 1);

        sortedCounts.forEach(([modCnt, compNum]) => {
            const barHeightPct = Math.max(12, Math.round((compNum / maxCompsAtAnyCount) * 100));
            const pctOfComps = totalComponentsCount > 0 ? Math.round((compNum / totalComponentsCount) * 100) : 0;
            const label = modCnt === 0 ? '0 mods' : (modCnt === 1 ? '1 mod' : `${modCnt} mods`);
            countHtml += `
                <div style="flex:1; display:flex; flex-direction:column; height:100%; justify-content:flex-end; align-items:center; min-width:18px;" title="${compNum} components have ${modCnt} attached modifiers (${pctOfComps}%)">
                    <div style="height:12px; display:flex; align-items:center; justify-content:center; margin-bottom:2px;">
                        <span style="font-size:0.56rem; font-family:var(--code-font); color:var(--text-muted); line-height:1;">${compNum}</span>
                    </div>
                    <div style="flex:1; display:flex; align-items:flex-end; width:100%; min-height:14px;">
                        <div style="width:100%; height:${barHeightPct}%; background:var(--accent-rose); border-radius:2px 2px 0 0; min-height:4px; opacity:0.85;"></div>
                    </div>
                    <div style="height:14px; display:flex; align-items:center; justify-content:center; margin-top:2px;">
                        <span style="font-size:0.56rem; font-weight:600; color:var(--text-secondary); line-height:1; white-space:nowrap;">${label}</span>
                    </div>
                </div>
            `;
        });
        countHtml += `</div>`;
        countContainer.innerHTML = countHtml;
    }

    // 2. Render Document-Wide Granular Modifier Size Spectrum
    if (globalSizeContainer && globalModHistogram && globalModHistogram.length > 0) {
        const minGlobal = globalModHistogram[0].min;
        const maxGlobal = globalModHistogram[globalModHistogram.length - 1].max;
        if (globalSizeRangeEl) globalSizeRangeEl.textContent = `${minGlobal} B – ${maxGlobal} B`;

        let globalSizeHtml = `<div style="display:flex; align-items:flex-end; gap:3px; height:46px; padding-top:2px;">`;
        const maxBinCount = Math.max(...globalModHistogram.map(b => b.count), 1);

        globalModHistogram.forEach(b => {
            const barHeightPct = Math.max(12, Math.round((b.count / maxBinCount) * 100));
            globalSizeHtml += `
                <div style="flex:1; display:flex; flex-direction:column; height:100%; justify-content:flex-end; align-items:center; min-width:20px; position:relative;" title="Modifier payload ${b.label}: ${b.count} modifiers (${b.exactPct}%)\n${esc(b.topCombos)}">
                    <div style="height:12px; display:flex; align-items:center; justify-content:center; margin-bottom:2px;">
                        <span style="font-size:0.56rem; font-family:var(--code-font); color:var(--text-muted); line-height:1;">${b.count}</span>
                    </div>
                    <div style="flex:1; display:flex; align-items:flex-end; width:100%; min-height:14px;">
                        <div style="width:100%; height:${barHeightPct}%; background:var(--accent-amber); border-radius:2px 2px 0 0; min-height:4px; opacity:0.85; transition:opacity 0.1s ease;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.85"></div>
                    </div>
                    <div style="height:14px; display:flex; align-items:center; justify-content:center; margin-top:2px;">
                        <span style="font-size:0.56rem; font-family:var(--code-font); color:var(--text-secondary); line-height:1; overflow:hidden; text-overflow:clip; white-space:nowrap; max-width:28px;">${b.label}</span>
                    </div>
                </div>
            `;
        });
        globalSizeHtml += `</div>`;
        globalSizeContainer.innerHTML = globalSizeHtml;
    }

    // 3. Render Modifier Kinds Table (Clean 2-line cards with target components & size spread)
    if (container) {
        const sortedModifiers = Array.from(modifierStats.values()).sort((a, b) => b.totalBytes - a.totalBytes || b.count - a.count);

        let html = `<div style="display:flex; flex-direction:column; gap:6px;">`;

        sortedModifiers.forEach(m => {
            const modPct = totalModifierBytes > 0 ? ((m.totalBytes / totalModifierBytes) * 100).toFixed(1) : 0;
            
            let targetsStr = '';
            if (m.targetComps && m.targetComps.size > 0) {
                const targetEntries = Array.from(m.targetComps.entries()).sort((a, b) => b[1] - a[1]);
                targetsStr = targetEntries.map(([cName, cCnt]) => `${cName} ×${cCnt}`).join(', ');
            }

            const filterTarget = m.rawOpName || m.name;
            const isUniform = m.minSize === m.maxSize;
            const sizeSpreadStr = isUniform ? `Uniform (${m.minSize} B)` : `${m.minSize} B – ${m.maxSize} B (Avg: ${m.avgSize} B)`;

            html += `
                <div class="comp-type-row" onclick="filterCommandsByType('${esc(filterTarget)}')" title="Click to filter disassembly for ${esc(filterTarget)}">
                    <!-- Top Line: Icon, Name, Category Badge, Count, Total Bytes -->
                    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
                        <div style="display:flex; align-items:center; gap:6px;">
                            <span style="font-size:0.95rem;">${m.icon}</span>
                            <span style="font-weight:600; font-size:0.82rem; color:var(--text-primary);">${esc(m.name)}</span>
                            <span class="badge" style="font-size:0.65rem; background:rgba(244,63,94,0.15); color:#f43f5e;">Modifier</span>
                            <span class="op-type-count">×${m.count}</span>
                        </div>
                        <div style="text-align:right;">
                            <span style="font-family:var(--code-font); font-size:0.78rem; font-weight:700; color:var(--text-primary);">${m.totalBytes} B</span>
                            <span style="font-size:0.68rem; color:var(--text-muted); margin-left:4px;">(${modPct}%)</span>
                        </div>
                    </div>

                    <!-- Metrics Line: Size Spread & Target Components Attached To -->
                    <div style="display:flex; align-items:center; justify-content:space-between; font-size:0.68rem; color:var(--text-secondary); margin-bottom:4px;">
                        <div style="display:flex; gap:6px; align-items:center;">
                            <span>Size: <strong style="color:var(--text-primary); font-family:var(--code-font);">${sizeSpreadStr}</strong></span>
                        </div>
                        ${targetsStr ? `<div style="font-size:0.65rem; color:var(--text-muted); max-width:200px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;" title="Attached To: ${esc(targetsStr)}">🎯 ${esc(targetsStr)}</div>` : ''}
                    </div>

                    <!-- Overall Modifier Payload Share Bar -->
                    <div class="op-type-bar-mini" style="width:100%; height:3px; margin-top:2px;">
                        <div class="op-type-bar-fill" style="width:${modPct}%; background:#f43f5e;"></div>
                    </div>
                </div>
            `;
        });

        html += `</div>`;
        container.innerHTML = html;
    }
}

const OP_NAMES = {
    1: '+ (ADD)', 2: '- (SUB)', 3: '* (MUL)', 4: '/ (DIV)', 5: '% (MOD)',
    6: 'MIN', 7: 'MAX', 8: 'POW', 9: 'SQRT', 10: 'ABS', 11: 'SIGN',
    12: 'COPYSIGN', 13: 'EXP', 14: 'FLOOR', 15: 'LOG10', 16: 'LOG',
    17: 'ROUND', 18: 'SIN', 19: 'COS', 20: 'TAN', 21: 'ASIN', 22: 'ACOS',
    23: 'ATAN', 24: 'ATAN2', 25: 'MAD', 26: 'IFELSE', 27: 'CLAMP',
    28: 'CBRT', 29: 'DEG', 30: 'RAD', 31: 'CEIL', 44: 'GT (>)',
    49: 'LERP', 73: 'NEG (-)'
};

export function getCachedVariablesAnalysis(doc, ops, totalBytes, u8) {
    if (cachedStatsDoc === doc && cachedStatsOps === ops && cachedStatsU8 === u8 && cachedVariablesAnalysis) {
        return cachedVariablesAnalysis;
    }

    if (!ops || ops.length === 0) {
        if (typeof getAllOperationsFlat === 'function' && doc) {
            ops = getAllOperationsFlat(doc, u8);
        } else if (typeof window !== 'undefined' && typeof window.getAllOperationsFlat === 'function' && doc) {
            ops = window.getAllOperationsFlat(doc, u8);
        }
    }

    const namedVars = new Map();
    const constants = new Map();
    const expressions = new Map();
    const referencedInUI = new Map();
    const allVarIds = new Set();
    const operatorCounts = new Map();
    let totalOperatorCount = 0;
    let totalVarBytes = 0;

    const OFFSET = 0x310000;

    if (Array.isArray(ops)) {
        ops.forEach(op => {
            if (!op) return;
            const name = getOpName(op);
            const code = op.OP_CODE !== undefined ? op.OP_CODE : (op.constructor?.OP_CODE ?? 0);
            const startOff = op._byteStart ?? 0;
            const endOff = op._byteEnd ?? 0;
            const sizeB = endOff > startOff ? endOff - startOff : 0;

            if (name === 'NamedVariable' || code === 137) {
                const id = op.mVarId !== undefined ? op.mVarId : (op.mId !== undefined ? op.mId : op.varId);
                const vname = op.mVarName || op.mName || op.name || `var_${id}`;
                namedVars.set(id, { id, name: vname, size: sizeB, op });
                allVarIds.add(id);
                totalVarBytes += sizeB;
            } else if (name === 'FloatConstant' || code === 80) {
                const id = op.mId !== undefined ? op.mId : op.id;
                const val = op.mValue !== undefined ? op.mValue : op.value;
                constants.set(id, { id, value: val, size: sizeB, op });
                allVarIds.add(id);
                totalVarBytes += sizeB;
            } else if (name === 'FloatExpression' || code === 81) {
                const id = op.mId !== undefined ? op.mId : op.id;
                const bits = op.mBits || op.bits || op.srcExpression;
                const inputs = typeof getFloatExprVarDependencies === 'function' ? getFloatExprVarDependencies(bits) : [];
                const formula = (bits && typeof prettyPrintFloatExpression === 'function') ? prettyPrintFloatExpression(bits) : '';

                // Extract math operators
                if (bits && bits.length) {
                    for (let i = 0; i < bits.length; i++) {
                        const b = typeof toRawBits === 'function' ? toRawBits(bits[i]) : ((bits[i] >>> 0) || 0);
                        if ((b & 0x7f800000) === 0x7f800000 && (b & 0x7fffff) !== 0) {
                            const bitId = b & 0x7fffff;
                            if (bitId > OFFSET && bitId <= OFFSET + 79) {
                                const opCode = bitId - OFFSET;
                                const opName = OP_NAMES[opCode] || `OP_${opCode}`;
                                operatorCounts.set(opName, (operatorCounts.get(opName) || 0) + 1);
                                totalOperatorCount++;
                            }
                        }
                    }
                }

                expressions.set(id, { id, type: 'FloatExpression', formula, inputs, bits, size: sizeB, op });
                allVarIds.add(id);
                totalVarBytes += sizeB;
            } else if (name === 'IntegerExpression' || code === 144 || code === 82) {
                const id = op.mId !== undefined ? op.mId : op.id;
                const mask = op.mMask ?? op.mask ?? 0;
                const vals = op.mValues ?? op.values ?? op.srcExpression;
                const inputs = typeof getIntegerExprVarDependencies === 'function' ? getIntegerExprVarDependencies(mask, vals) : [];
                const formula = (vals && typeof prettyPrintIntegerExpression === 'function') ? prettyPrintIntegerExpression(mask, vals) : '';
                expressions.set(id, { id, type: 'IntegerExpression', formula, inputs, mask, vals, size: sizeB, op });
                allVarIds.add(id);
                totalVarBytes += sizeB;
            } else if (name === 'TouchExpression' || code === 157) {
                const id = op.mId !== undefined ? op.mId : op.id;
                expressions.set(id, { id, type: 'TouchExpression', formula: 'TouchInteraction', inputs: [], size: sizeB, op });
                allVarIds.add(id);
                totalVarBytes += sizeB;
            } else if (name === 'FloatFunction' || code === 83) {
                const id = op.mId !== undefined ? op.mId : op.id;
                expressions.set(id, { id, type: 'FloatFunction', formula: 'Function', inputs: [], size: sizeB, op });
                allVarIds.add(id);
                totalVarBytes += sizeB;
            } else {
                for (const key in op) {
                    if (key.endsWith('Id') || key.endsWith('ID') || key.includes('Var')) {
                        const val = op[key];
                        if (typeof val === 'number' && val > 0 && val < 0x40000000) {
                            if (!referencedInUI.has(val)) referencedInUI.set(val, new Set());
                            referencedInUI.get(val).add(name);
                            allVarIds.add(val);
                        }
                    }
                }
            }
        });
    }

    // Build downstream dependents mapping
    const dependentsMap = new Map();
    expressions.forEach(e => {
        e.inputs.forEach(inId => {
            allVarIds.add(inId);
            if (!dependentsMap.has(inId)) dependentsMap.set(inId, new Set());
            dependentsMap.get(inId).add(e.id);
        });
    });

    // Compute chain depths & critical paths via memoized DFS with cycle detection
    const depthMemo = new Map();
    const pathMemo = new Map();

    function computeChain(id, visited = new Set()) {
        if (depthMemo.has(id)) return { depth: depthMemo.get(id), path: pathMemo.get(id) };
        if (visited.has(id)) return { depth: 1, path: [id] };
        visited.add(id);

        const expr = expressions.get(id);
        if (!expr || !expr.inputs || expr.inputs.length === 0) {
            depthMemo.set(id, 1);
            pathMemo.set(id, [id]);
            return { depth: 1, path: [id] };
        }

        let maxInDepth = 0;
        let longestSubPath = [];

        expr.inputs.forEach(inId => {
            const res = computeChain(inId, new Set(visited));
            if (res.depth > maxInDepth) {
                maxInDepth = res.depth;
                longestSubPath = res.path;
            }
        });

        const d = maxInDepth + 1;
        const p = [...longestSubPath, id];
        depthMemo.set(id, d);
        pathMemo.set(id, p);
        return { depth: d, path: p };
    }

    let maxChainDepth = 0;
    const depthDist = new Map();

    expressions.forEach(e => {
        const { depth, path } = computeChain(e.id);
        e.depth = depth;
        e.longestPath = path;
        if (depth > maxChainDepth) maxChainDepth = depth;
        depthDist.set(depth, (depthDist.get(depth) || 0) + 1);
    });

    // Build depth histogram
    const depthHistogram = [];
    if (maxChainDepth > 0) {
        const maxAtAnyDepth = Math.max(...Array.from(depthDist.values()), 1);
        for (let d = 1; d <= maxChainDepth; d++) {
            const cnt = depthDist.get(d) || 0;
            depthHistogram.push({
                depth: d,
                count: cnt,
                pct: expressions.size > 0 ? Math.round((cnt / expressions.size) * 100) : 0,
                exactPct: expressions.size > 0 ? ((cnt / expressions.size) * 100).toFixed(1) : '0',
                barHeightPct: Math.max(12, Math.round((cnt / maxAtAnyDepth) * 100))
            });
        }
    }

    // Classify roles & Fan-Out
    let rootDriversCount = 0;
    let intermediateCount = 0;
    let terminalSinksCount = 0;
    let deadOrphansCount = 0;
    const rootSources = [];
    const fanoutBuckets = { '0 deps': 0, '1 dep': 0, '2-3 deps': 0, '4-7 deps': 0, '8+ deps': 0 };

    allVarIds.forEach(id => {
        const isExpr = expressions.has(id);
        const deps = dependentsMap.get(id) || new Set();
        const uiRefs = referencedInUI.get(id) || new Set();
        const hasInputs = isExpr && expressions.get(id).inputs.length > 0;
        const totalConsumers = deps.size + (uiRefs.size > 0 ? 1 : 0);

        if (totalConsumers === 0) fanoutBuckets['0 deps']++;
        else if (totalConsumers === 1) fanoutBuckets['1 dep']++;
        else if (totalConsumers <= 3) fanoutBuckets['2-3 deps']++;
        else if (totalConsumers <= 7) fanoutBuckets['4-7 deps']++;
        else fanoutBuckets['8+ deps']++;

        const vname = namedVars.get(id)?.name || (typeof getSystemVarName === 'function' ? getSystemVarName(id) : null) || `var_${id}`;

        if (!hasInputs && deps.size > 0) {
            rootDriversCount++;
            rootSources.push({ id, name: vname, depCount: deps.size, uiRefs: Array.from(uiRefs) });
        } else if (hasInputs && deps.size > 0) {
            intermediateCount++;
        } else if (hasInputs && deps.size === 0) {
            terminalSinksCount++;
        } else if (totalConsumers === 0) {
            deadOrphansCount++;
        }
    });

    rootSources.sort((a, b) => b.depCount - a.depCount);

    // Build list of unique critical paths
    const criticalPaths = [];
    const seenPathKeys = new Set();
    const sortedExprsForPaths = Array.from(expressions.values()).sort((a, b) => b.depth - a.depth);

    sortedExprsForPaths.forEach(e => {
        if (e.longestPath && e.longestPath.length >= 2 && criticalPaths.length < 8) {
            const key = e.longestPath.join('->');
            if (!seenPathKeys.has(key)) {
                seenPathKeys.add(key);
                const steps = e.longestPath.map(id => {
                    const name = namedVars.get(id)?.name || (typeof getSystemVarName === 'function' ? getSystemVarName(id) : null) || `var_${id}`;
                    const isSink = e.id === id;
                    const uiTarget = isSink && referencedInUI.has(id) ? Array.from(referencedInUI.get(id))[0] : null;
                    return { id, name, uiTarget };
                });
                criticalPaths.push({
                    depth: e.depth,
                    targetExprId: e.id,
                    targetName: namedVars.get(e.id)?.name || `var_${e.id}`,
                    steps
                });
            }
        }
    });

    // Operator frequency array
    const sortedOperators = Array.from(operatorCounts.entries())
        .map(([name, count]) => ({
            name,
            count,
            pct: totalOperatorCount > 0 ? ((count / totalOperatorCount) * 100).toFixed(1) : '0'
        }))
        .sort((a, b) => b.count - a.count);

    // Detailed items list
    const allDetailedItems = [];
    allVarIds.forEach(id => {
        const expr = expressions.get(id);
        const named = namedVars.get(id);
        const cnst = constants.get(id);
        const sysName = typeof getSystemVarName === 'function' ? getSystemVarName(id) : null;
        const deps = dependentsMap.get(id) || new Set();
        const uiRefs = referencedInUI.get(id) || new Set();

        const name = named?.name || sysName || `var_${id}`;
        const isNamed = !!named;
        const isSys = !!sysName || (id >= 1 && id <= 40);
        const isConst = !!cnst;
        const isExpr = !!expr;

        let kind = 'Anonymous Variable';
        let badgeColor = 'var(--text-muted)';
        if (isExpr) {
            kind = expr.type;
            badgeColor = 'var(--accent-blue)';
        } else if (isConst) {
            kind = 'FloatConstant';
            badgeColor = 'var(--accent-amber)';
        } else if (isSys) {
            kind = 'System Variable';
            badgeColor = 'var(--accent-emerald)';
        } else if (isNamed) {
            kind = 'NamedVariable';
            badgeColor = 'var(--accent-purple)';
        }

        const formula = expr?.formula || (isConst ? `Const = ${cnst.value}` : (isSys ? `System ID ${id}` : `Var ID ${id}`));
        const inputNames = (expr?.inputs || []).map(inId => ({
            id: inId,
            name: namedVars.get(inId)?.name || (typeof getSystemVarName === 'function' ? getSystemVarName(inId) : null) || `var_${inId}`
        }));

        const totalBytesForVar = (expr?.size || 0) + (named?.size || 0) + (cnst?.size || 0);

        allDetailedItems.push({
            id,
            name,
            kind,
            badgeColor,
            isExpr,
            formula,
            inputs: inputNames,
            depCount: deps.size,
            uiTargets: Array.from(uiRefs),
            depth: expr?.depth ?? (isExpr ? 1 : 0),
            size: totalBytesForVar,
            rawOpName: expr?.type || (isConst ? 'FloatConstant' : (isNamed ? 'NamedVariable' : 'Variable'))
        });
    });

    allDetailedItems.sort((a, b) => {
        if (a.isExpr && !b.isExpr) return -1;
        if (!a.isExpr && b.isExpr) return 1;
        if (a.depth !== b.depth) return b.depth - a.depth;
        if (a.depCount !== b.depCount) return b.depCount - a.depCount;
        return b.size - a.size;
    });

    cachedVariablesAnalysis = {
        totalVarsCount: allVarIds.size,
        namedVarsCount: namedVars.size,
        constCount: constants.size,
        expressionsCount: expressions.size,
        totalVarBytes,
        maxChainDepth,
        depthDist,
        depthHistogram,
        fanoutBuckets,
        rootDriversCount,
        rootSources,
        intermediateCount,
        terminalSinksCount,
        deadOrphansCount,
        criticalPaths,
        operatorStats: sortedOperators,
        totalOperatorCount,
        detailedItems: allDetailedItems
    };

    return cachedVariablesAnalysis;
}

export function renderVariablesBreakdown(doc, ops, totalBytes) {
    const container = document.getElementById('exprVariablesList');
    const chainContainer = document.getElementById('exprChainDepthHistogram');
    const fanoutContainer = document.getElementById('varFanoutHistogram');
    const fanoutRangeEl = document.getElementById('varFanoutRange');
    const critPathsContainer = document.getElementById('exprCriticalPathsList');
    const critPathsCountEl = document.getElementById('exprCriticalPathsCount');
    const operatorsContainer = document.getElementById('exprOperatorsList');
    const operatorsTotalEl = document.getElementById('exprOperatorsTotal');
    const badge = document.getElementById('varExprTotalBadge');

    // KPI Elements
    const kpiVarTotalEl = document.getElementById('kpiVarTotal');
    const kpiVarSubEl = document.getElementById('kpiVarSub');
    const kpiExprTotalEl = document.getElementById('kpiExprTotal');
    const kpiExprSubEl = document.getElementById('kpiExprSub');
    const kpiChainDepthEl = document.getElementById('kpiChainMaxDepth');
    const kpiChainDepthSubEl = document.getElementById('kpiChainDepthSub');
    const kpiRootDriversEl = document.getElementById('kpiRootDrivers');
    const kpiRootDriversSubEl = document.getElementById('kpiRootDriversSub');
    const kpiTerminalSinksEl = document.getElementById('kpiTerminalSinks');
    const kpiTerminalSinksSubEl = document.getElementById('kpiTerminalSinksSub');
    const kpiExprPayloadEl = document.getElementById('kpiExprPayload');
    const kpiExprAvgPayloadEl = document.getElementById('kpiExprAvgPayload');

    if (!doc && typeof window !== 'undefined') doc = window.currentDocument;
    if ((!ops || ops.length === 0) && typeof window !== 'undefined') ops = window.currentParsedOps || window.allOps;
    const u8 = typeof window !== 'undefined' ? window.currentU8Buffer : null;
    if (!totalBytes && typeof window !== 'undefined') {
        totalBytes = window.currentU8Buffer ? window.currentU8Buffer.length : (window.currentBuffer ? window.currentBuffer.byteLength : 0);
    }

    if (!doc && (!ops || ops.length === 0)) {
        if (container) container.innerHTML = `<div style="text-align:center; padding:16px; color:var(--text-muted); font-size:0.8rem;">No variables or expressions analyzed.</div>`;
        if (chainContainer) chainContainer.innerHTML = '';
        if (fanoutContainer) fanoutContainer.innerHTML = '';
        if (critPathsContainer) critPathsContainer.innerHTML = '<div style="text-align:center; padding:8px; color:var(--text-muted); font-size:0.75rem;">No dependency chains detected.</div>';
        if (operatorsContainer) operatorsContainer.innerHTML = '<div style="color:var(--text-muted); font-size:0.75rem;">No operators analyzed.</div>';
        if (badge) badge.textContent = '0 Vars • 0 Exprs';
        return;
    }

    const analysis = getCachedVariablesAnalysis(doc, ops, totalBytes, u8);
    const {
        totalVarsCount,
        namedVarsCount,
        constCount,
        expressionsCount,
        totalVarBytes,
        maxChainDepth,
        depthDist,
        depthHistogram,
        fanoutBuckets,
        rootDriversCount,
        rootSources,
        intermediateCount,
        terminalSinksCount,
        deadOrphansCount,
        criticalPaths,
        operatorStats,
        totalOperatorCount,
        detailedItems
    } = analysis;

    // Update Badge
    if (badge) badge.textContent = `${totalVarsCount} Vars • ${expressionsCount} Exprs`;

    // Update 6 KPIs
    const varPayloadPct = totalBytes > 0 ? ((totalVarBytes / totalBytes) * 100).toFixed(1) : 0;
    const avgExprPayload = expressionsCount > 0 ? (totalVarBytes / expressionsCount).toFixed(1) : 0;
    const atMaxDepthCount = depthDist.get(maxChainDepth) || 0;
    const topDriverName = rootSources.length > 0 ? `${rootSources[0].name} (×${rootSources[0].depCount})` : 'None';
    const sinksPct = expressionsCount > 0 ? Math.round((terminalSinksCount / expressionsCount) * 100) : 0;

    if (kpiVarTotalEl) kpiVarTotalEl.textContent = totalVarsCount;
    if (kpiVarSubEl) kpiVarSubEl.textContent = `${namedVarsCount} named, ${constCount} const`;
    if (kpiExprTotalEl) kpiExprTotalEl.textContent = expressionsCount;
    if (kpiExprSubEl) kpiExprSubEl.textContent = `${intermediateCount + terminalSinksCount} dynamic, ${expressionsCount - (intermediateCount + terminalSinksCount)} static`;
    if (kpiChainDepthEl) kpiChainDepthEl.textContent = maxChainDepth > 0 ? `Depth ${maxChainDepth}` : 'Depth 0';
    if (kpiChainDepthSubEl) kpiChainDepthSubEl.textContent = `${atMaxDepthCount} at max depth`;
    if (kpiRootDriversEl) kpiRootDriversEl.textContent = `${rootDriversCount} sources`;
    if (kpiRootDriversSubEl) kpiRootDriversSubEl.textContent = `Top: ${topDriverName}`;
    if (kpiTerminalSinksEl) kpiTerminalSinksEl.textContent = `${terminalSinksCount} sinks`;
    if (kpiTerminalSinksSubEl) kpiTerminalSinksSubEl.textContent = `${sinksPct}% of expressions`;
    if (kpiExprPayloadEl) kpiExprPayloadEl.textContent = `${totalVarBytes} B (${varPayloadPct}%)`;
    if (kpiExprAvgPayloadEl) kpiExprAvgPayloadEl.textContent = `${avgExprPayload} B/expr`;

    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    // 1. Render Chain Depth Histogram
    if (chainContainer && depthHistogram) {
        let depthHtml = `<div style="display:flex; align-items:flex-end; gap:4px; height:46px; padding-top:2px;">`;
        if (depthHistogram.length === 0) {
            depthHtml += `<div style="color:var(--text-muted); font-size:0.75rem; text-align:center; width:100%; padding-top:12px;">No expressions</div>`;
        } else {
            depthHistogram.forEach(b => {
                depthHtml += `
                    <div style="flex:1; display:flex; flex-direction:column; height:100%; justify-content:flex-end; align-items:center; min-width:18px;" title="Depth ${b.depth}: ${b.count} expressions (${b.exactPct}%)">
                        <div style="height:12px; display:flex; align-items:center; justify-content:center; margin-bottom:2px;">
                            <span style="font-size:0.56rem; font-family:var(--code-font); color:var(--text-muted); line-height:1;">${b.count}</span>
                        </div>
                        <div style="flex:1; display:flex; align-items:flex-end; width:100%; min-height:14px;">
                            <div style="width:100%; height:${b.barHeightPct}%; background:var(--accent-rose); border-radius:2px 2px 0 0; min-height:4px; opacity:0.85;"></div>
                        </div>
                        <div style="height:14px; display:flex; align-items:center; justify-content:center; margin-top:2px;">
                            <span style="font-size:0.56rem; font-weight:600; color:var(--text-secondary); line-height:1; white-space:nowrap;">D${b.depth}</span>
                        </div>
                    </div>
                `;
            });
        }
        depthHtml += `</div>`;
        chainContainer.innerHTML = depthHtml;
    }

    // 2. Render Variable Fan-Out Distribution
    if (fanoutContainer && fanoutBuckets) {
        if (fanoutRangeEl) fanoutRangeEl.textContent = `Max: ${rootSources[0]?.depCount ?? 0} deps`;
        let fanoutHtml = `<div style="display:flex; align-items:flex-end; gap:4px; height:46px; padding-top:2px;">`;
        const bucketEntries = Object.entries(fanoutBuckets);
        const maxBucketVal = Math.max(...bucketEntries.map(e => e[1]), 1);

        bucketEntries.forEach(([label, cnt]) => {
            const barHeightPct = Math.max(12, Math.round((cnt / maxBucketVal) * 100));
            const pct = totalVarsCount > 0 ? Math.round((cnt / totalVarsCount) * 100) : 0;
            fanoutHtml += `
                <div style="flex:1; display:flex; flex-direction:column; height:100%; justify-content:flex-end; align-items:center; min-width:20px;" title="${cnt} variables have ${label} (${pct}%)">
                    <div style="height:12px; display:flex; align-items:center; justify-content:center; margin-bottom:2px;">
                        <span style="font-size:0.56rem; font-family:var(--code-font); color:var(--text-muted); line-height:1;">${cnt}</span>
                    </div>
                    <div style="flex:1; display:flex; align-items:flex-end; width:100%; min-height:14px;">
                        <div style="width:100%; height:${barHeightPct}%; background:var(--accent-purple); border-radius:2px 2px 0 0; min-height:4px; opacity:0.85;"></div>
                    </div>
                    <div style="height:14px; display:flex; align-items:center; justify-content:center; margin-top:2px;">
                        <span style="font-size:0.55rem; font-family:var(--code-font); color:var(--text-secondary); line-height:1; white-space:nowrap;">${label.replace(' deps', '').replace(' dep', '')}</span>
                    </div>
                </div>
            `;
        });
        fanoutHtml += `</div>`;
        fanoutContainer.innerHTML = fanoutHtml;
    }

    // 3. Render Longest Reactive Dependency Chains
    if (critPathsContainer) {
        if (critPathsCountEl) critPathsCountEl.textContent = `${criticalPaths.length} chains`;
        if (criticalPaths.length === 0) {
            critPathsContainer.innerHTML = `<div style="text-align:center; padding:8px; color:var(--text-muted); font-size:0.75rem;">No multi-step dependency chains found.</div>`;
        } else {
            let cpHtml = '';
            criticalPaths.forEach(cp => {
                const stepsHtml = cp.steps.map((st, idx) => {
                    const isLast = idx === cp.steps.length - 1;
                    return `
                        <span class="badge" style="font-size:0.65rem; background:rgba(56,189,248,0.15); color:var(--accent-blue); cursor:pointer;" onclick="filterCommandsByType('${esc(st.name)}')" title="Variable ID ${st.id} (${esc(st.name)})">${esc(st.name)}</span>
                        ${!isLast ? `<span style="color:var(--text-muted); font-size:0.7rem;">➔</span>` : ''}
                        ${st.uiTarget ? `<span style="font-size:0.65rem; color:var(--accent-emerald);">🎯 ${esc(st.uiTarget)}</span>` : ''}
                    `;
                }).join(' ');

                cpHtml += `
                    <div style="display:flex; align-items:center; justify-content:space-between; padding:4px 8px; background:rgba(255,255,255,0.03); border:1px solid var(--border-color); border-radius:4px; font-size:0.75rem;">
                        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                            <span class="badge" style="font-size:0.62rem; background:rgba(244,63,94,0.15); color:var(--accent-rose);">Depth ${cp.depth}</span>
                            ${stepsHtml}
                        </div>
                    </div>
                `;
            });
            critPathsContainer.innerHTML = cpHtml;
        }
    }

    // 4. Render RPN Math & Logic Operators Used
    if (operatorsContainer) {
        if (operatorsTotalEl) operatorsTotalEl.textContent = `${totalOperatorCount} operations`;
        if (operatorStats.length === 0) {
            operatorsContainer.innerHTML = `<div style="color:var(--text-muted); font-size:0.75rem;">No RPN operators evaluated.</div>`;
        } else {
            let opHtml = '';
            operatorStats.forEach(op => {
                opHtml += `
                    <span class="badge" style="font-size:0.7rem; padding:3px 8px; background:rgba(251,191,36,0.12); color:var(--accent-amber); border:1px solid rgba(251,191,36,0.3);" title="${op.count} times used (${op.pct}%)">
                        <strong>${esc(op.name)}</strong> ×${op.count} <span style="opacity:0.7; font-size:0.62rem;">(${op.pct}%)</span>
                    </span>
                `;
            });
            operatorsContainer.innerHTML = opHtml;
        }
    }

    // 5. Render Searchable Detailed Expressions & Variables List
    if (container) {
        if (detailedItems.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding:16px; color:var(--text-muted); font-size:0.8rem;">No variables or expressions found.</div>`;
        } else {
            let html = `<div style="display:flex; flex-direction:column; gap:6px;">`;

            detailedItems.forEach(item => {
                const inputsStr = item.inputs.length > 0
                    ? item.inputs.map(inp => `<span class="badge" style="font-size:0.6rem; background:rgba(255,255,255,0.06); color:var(--text-secondary);">${esc(inp.name)}</span>`).join(' ')
                    : '';

                const uiTargetsStr = item.uiTargets.length > 0
                    ? item.uiTargets.map(t => `<span style="color:var(--accent-emerald);">🎯 ${esc(t)}</span>`).join(', ')
                    : '';

                html += `
                    <div class="comp-type-row" onclick="filterCommandsByType('${esc(item.name)}')" title="Click to filter disassembly for ${esc(item.name)}" style="padding:6px 10px;">
                        <!-- Top Line: Name, Kind, ID, Depth, Size -->
                        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:3px;">
                            <div style="display:flex; align-items:center; gap:6px;">
                                <span style="font-weight:600; font-size:0.82rem; color:var(--text-primary); font-family:var(--code-font);">${esc(item.name)}</span>
                                <span class="badge" style="font-size:0.62rem; background:rgba(56,189,248,0.12); color:${item.badgeColor};">${esc(item.kind)}</span>
                                <span style="font-size:0.65rem; color:var(--text-muted); font-family:var(--code-font);">#${item.id}</span>
                                ${item.isExpr ? `<span class="badge" style="font-size:0.62rem; background:rgba(244,63,94,0.12); color:var(--accent-rose);">Depth ${item.depth}</span>` : ''}
                            </div>
                            <div style="text-align:right; display:flex; align-items:center; gap:6px;">
                                ${item.depCount > 0 ? `<span class="badge" style="font-size:0.62rem; background:rgba(192,132,252,0.15); color:var(--accent-purple);">🔗 ${item.depCount} deps</span>` : ''}
                                <span style="font-family:var(--code-font); font-size:0.75rem; font-weight:700; color:var(--text-primary);">${item.size} B</span>
                            </div>
                        </div>

                        <!-- Formula / Expression string -->
                        <div style="font-family:var(--code-font); font-size:0.72rem; color:var(--accent-amber); margin-bottom:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${esc(item.formula)}">
                            ${esc(item.formula)}
                        </div>

                        <!-- Footer line: Inputs & Target UI refs -->
                        <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.65rem; color:var(--text-secondary);">
                            <div style="display:flex; align-items:center; gap:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                                ${inputsStr ? `<span style="color:var(--text-muted);">Inputs:</span> ${inputsStr}` : '<span style="color:var(--text-muted);">Root / Leaf Variable</span>'}
                            </div>
                            ${uiTargetsStr ? `<div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:180px;">${uiTargetsStr}</div>` : ''}
                        </div>
                    </div>
                `;
            });

            html += `</div>`;
            container.innerHTML = html;
        }
    }
}

export function filterCommandsByType(typeName) {
    const input = document.getElementById('cmdSearchInput');
    if (input) {
        input.value = typeName;
        filterCommands();
        input.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

export function renderOpTypesBreakdown(ops, totalBytes) {
    const container = document.getElementById('opTypesList');
    const totalBadge = document.getElementById('opTypeTotalBadge');
    const avgSizeEl = document.getElementById('insightAvgOpSize');
    const strCountEl = document.getElementById('insightStringCount');
    const varCountEl = document.getElementById('insightVarCount');
    const clickCountEl = document.getElementById('insightClickCount');

    if (!ops || ops.length === 0 || !container) {
        if (container) container.innerHTML = `<div style="text-align:center; padding:16px; color:var(--text-muted); font-size:0.8rem;">No operations analyzed.</div>`;
        if (totalBadge) totalBadge.textContent = '0 Types';
        if (avgSizeEl) avgSizeEl.textContent = '0 B/op';
        if (strCountEl) strCountEl.textContent = '0';
        if (varCountEl) varCountEl.textContent = '0';
        if (clickCountEl) clickCountEl.textContent = '0';
        return;
    }

    // Insights metrics
    const avgOpSize = totalBytes ? (totalBytes / ops.length).toFixed(1) : 0;
    let stringCount = 0;
    let varCount = 0;
    let clickCount = 0;

    const typeMap = {};

    ops.forEach(op => {
        const name = getOpName(op);
        const startOff = op._byteStart ?? 0;
        const endOff = op._byteEnd ?? 0;
        const sizeB = endOff > startOff ? endOff - startOff : 0;
        const opCode = op.OP_CODE !== undefined ? op.OP_CODE : (op.constructor ? op.constructor.OP_CODE : 0);

        if (name.includes('Text') || name.includes('Font') || op.mText || op.mTextId) stringCount++;
        if (name.includes('Expression') || name.includes('Variable') || name.includes('Animated')) varCount++;
        if (name.includes('Click') || name.includes('Touch') || name.includes('Action')) clickCount++;

        if (!typeMap[name]) {
            typeMap[name] = {
                name,
                opCode,
                hexCode: '0x' + (opCode || 0).toString(16).padStart(2, '0').toUpperCase(),
                count: 0,
                totalBytes: 0
            };
        }
        typeMap[name].count++;
        typeMap[name].totalBytes += sizeB;
    });

    if (avgSizeEl) avgSizeEl.textContent = `${avgOpSize} B/op`;
    if (strCountEl) strCountEl.textContent = stringCount;
    if (varCountEl) varCountEl.textContent = varCount;
    if (clickCountEl) clickCountEl.textContent = clickCount;

    const typeArray = Object.values(typeMap).sort((a, b) => b.totalBytes - a.totalBytes);

    if (totalBadge) totalBadge.textContent = `${typeArray.length} Types`;

    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    let html = '';
    typeArray.forEach(item => {
        const pct = totalBytes ? ((item.totalBytes / totalBytes) * 100).toFixed(1) : 0;
        let color = 'var(--accent-blue)';
        if (item.name.includes('Layout') || item.name === 'ContainerEnd') color = '#10b981';
        else if (item.name.includes('Text') || item.name.includes('Data')) color = '#fbbf24';
        else if (item.name.includes('Modifier')) color = '#f43f5e';
        else if (item.name.includes('Draw') || item.name.includes('Paint') || item.name.includes('Path')) color = '#c084fc';

        html += `
            <div class="op-type-row" onclick="filterCommandsByType('${esc(item.name)}')" title="Click to filter disassembly for ${esc(item.name)}">
                <div class="op-type-left">
                    <span class="op-type-badge">${item.hexCode}</span>
                    <span class="op-type-name">${esc(item.name)}</span>
                    <span class="op-type-count">×${item.count}</span>
                </div>
                <div class="op-type-right">
                    <div class="op-type-bar-mini">
                        <div class="op-type-bar-fill" style="width: ${pct}%; background: ${color};"></div>
                    </div>
                    <span class="op-type-size" title="${item.totalBytes} B total across ${item.count} operation${item.count === 1 ? '' : 's'}">${item.totalBytes} B (${pct}%)</span>
                    <span class="op-type-avg" title="Average bytes per operation of this type — a small op repeated often costs differently from one large op">⌀ ${(item.totalBytes / item.count).toFixed(1)} B</span>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

export function setSegment(id, pct, title) {
    const el = document.getElementById(id);
    if (el) {
        el.style.width = `${pct}%`;
        el.title = title;
    }
}

export function setKpi(valId, valText, subId, subText) {
    const vEl = document.getElementById(valId);
    const sEl = document.getElementById(subId);
    if (vEl) vEl.textContent = valText;
    if (sEl) sEl.textContent = subText;
}

export function computeTreeMetrics(doc) {
    if (!doc) return { totalComponents: 0, maxDepth: 0 };
    const root = typeof doc.getRootLayoutComponent === 'function' ? doc.getRootLayoutComponent() : doc.mRootLayoutComponent;
    let totalComponents = 0;
    let maxDepth = 0;

    function traverse(op, depth) {
        if (!op) return;
        const name = getOpName(op);
        if (name === 'ContainerEnd' || name === 'Mi' || name === 'LayoutComponentContent' || name === 'CanvasContent' || isModifierOp(op)) return;

        const isRoot = name === 'RootLayoutComponent' || op.OP_CODE === 200;
        if (isRoot) {
            const children = getEffectiveChildren(op);
            children.forEach(child => {
                if (isContainerOp(child) || isComponentOp(child)) {
                    traverse(child, 1);
                }
            });
            return;
        }

        if (isContainerOp(op) || isComponentOp(op)) {
            totalComponents++;
            if (depth > maxDepth) maxDepth = depth;

            const children = getEffectiveChildren(op);
            children.forEach(child => {
                if (isContainerOp(child) || isComponentOp(child)) {
                    traverse(child, depth + 1);
                }
            });
        }
    }

    if (root) {
        traverse(root, 1);
    } else {
        const topOps = (typeof doc.getOperations === 'function' ? doc.getOperations() : doc.mOperations) || [];
        topOps.forEach(op => {
            if (isContainerOp(op) || isComponentOp(op)) traverse(op, 1);
        });
    }

    return { totalComponents, maxDepth };
}

export function resetStatsUI() {
    setSegment('segHeader', 0, '');
    setSegment('segLayout', 0, '');
    setSegment('segData', 0, '');
    setSegment('segDraw', 0, '');
    setSegment('segModifier', 0, '');
    setKpi('kpiTotalSize', '0 B', 'kpiTotalSub', '0 ops total');
    setKpi('kpiDataSize', '0 B', 'kpiDataSub', '0 ops (0%)');
    setKpi('kpiLayoutSize', '0 B', 'kpiLayoutSub', '0 ops (0%)');
    setKpi('kpiDrawSize', '0 B', 'kpiDrawSub', '0 ops (0%)');
    setKpi('kpiModifierSize', '0 B', 'kpiModifierSub', '0 ops (0%)');

    const sizeBadge = document.getElementById('statsTotalSizeBadge');
    if (sizeBadge) sizeBadge.textContent = '0 B';
    const opsBadge = document.getElementById('statsTotalOpsBadge');
    if (opsBadge) opsBadge.textContent = '0 Ops';

    const compEl = document.getElementById('kpiCompTotal');
    const depthEl = document.getElementById('kpiCompMaxDepth');
    const payloadEl = document.getElementById('kpiCompPayload');
    const avgPayloadEl = document.getElementById('kpiCompAvgPayload');
    const modsEl = document.getElementById('kpiCompModifiers');
    const contLeavesEl = document.getElementById('kpiCompContainersLeaves');
    const compBadge = document.getElementById('compTotalBadge');

    if (compEl) compEl.textContent = '0';
    if (depthEl) depthEl.textContent = 'Depth 0';
    if (payloadEl) payloadEl.textContent = '0 B (0%)';
    if (avgPayloadEl) avgPayloadEl.textContent = '0 B/comp';
    if (modsEl) modsEl.textContent = '0 (0/comp)';
    if (contLeavesEl) contLeavesEl.textContent = '0 cont / 0 leaf';
    if (compBadge) compBadge.textContent = '0 Components';

    const compContainer = document.getElementById('componentKindsList');
    if (compContainer) compContainer.innerHTML = `<div style="text-align:center; padding:16px; color:var(--text-muted); font-size:0.8rem;">No components analyzed.</div>`;
    const depthContainer = document.getElementById('componentDepthHistogram');
    if (depthContainer) depthContainer.innerHTML = '';
    const globalSizeContainer = document.getElementById('componentGlobalSizeHistogram');
    if (globalSizeContainer) globalSizeContainer.innerHTML = '';
    const globalSizeRangeEl = document.getElementById('globalSizeSpectrumRange');
    if (globalSizeRangeEl) globalSizeRangeEl.textContent = '0 B – 0 B';

    // Reset Modifier elements
    const modEl = document.getElementById('kpiModTotal');
    const modDistEl = document.getElementById('kpiModDistinctTypes');
    const modPayloadEl = document.getElementById('kpiModPayload');
    const modAvgPayloadEl = document.getElementById('kpiModAvgPayload');
    const modDensityEl = document.getElementById('kpiModDensity');
    const modStyledEl = document.getElementById('kpiModStyledPercent');
    const modBadge = document.getElementById('modTotalBadge');

    if (modEl) modEl.textContent = '0';
    if (modDistEl) modDistEl.textContent = '0 types';
    if (modPayloadEl) modPayloadEl.textContent = '0 B (0%)';
    if (modAvgPayloadEl) modAvgPayloadEl.textContent = '0 B/mod';
    if (modDensityEl) modDensityEl.textContent = '0.0 / comp';
    if (modStyledEl) modStyledEl.textContent = '0% styled';
    if (modBadge) modBadge.textContent = '0 Modifiers';

    const modContainer = document.getElementById('modifierKindsList');
    if (modContainer) modContainer.innerHTML = `<div style="text-align:center; padding:16px; color:var(--text-muted); font-size:0.8rem;">No modifiers analyzed.</div>`;
    const modCountContainer = document.getElementById('modifierCountHistogram');
    if (modCountContainer) modCountContainer.innerHTML = '';
    const modGlobalSizeContainer = document.getElementById('modifierGlobalSizeHistogram');
    if (modGlobalSizeContainer) modGlobalSizeContainer.innerHTML = '';
    const modGlobalRangeEl = document.getElementById('globalModSizeRange');
    if (modGlobalRangeEl) modGlobalRangeEl.textContent = '0 B – 0 B';

    // Reset Variable and Expression elements
    const varBadge = document.getElementById('varExprTotalBadge');
    if (varBadge) varBadge.textContent = '0 Vars • 0 Exprs';
    const kpiVarTotal = document.getElementById('kpiVarTotal');
    const kpiVarSub = document.getElementById('kpiVarSub');
    const kpiExprTotal = document.getElementById('kpiExprTotal');
    const kpiExprSub = document.getElementById('kpiExprSub');
    const kpiChainMaxDepth = document.getElementById('kpiChainMaxDepth');
    const kpiChainDepthSub = document.getElementById('kpiChainDepthSub');
    const kpiRootDrivers = document.getElementById('kpiRootDrivers');
    const kpiRootDriversSub = document.getElementById('kpiRootDriversSub');
    const kpiTerminalSinks = document.getElementById('kpiTerminalSinks');
    const kpiTerminalSinksSub = document.getElementById('kpiTerminalSinksSub');
    const kpiExprPayload = document.getElementById('kpiExprPayload');
    const kpiExprAvgPayload = document.getElementById('kpiExprAvgPayload');

    if (kpiVarTotal) kpiVarTotal.textContent = '0';
    if (kpiVarSub) kpiVarSub.textContent = '0 named, 0 const';
    if (kpiExprTotal) kpiExprTotal.textContent = '0';
    if (kpiExprSub) kpiExprSub.textContent = '0% active';
    if (kpiChainMaxDepth) kpiChainMaxDepth.textContent = 'Depth 0';
    if (kpiChainDepthSub) kpiChainDepthSub.textContent = '0 at max depth';
    if (kpiRootDrivers) kpiRootDrivers.textContent = '0 sources';
    if (kpiRootDriversSub) kpiRootDriversSub.textContent = '0 driving outputs';
    if (kpiTerminalSinks) kpiTerminalSinks.textContent = '0 sinks';
    if (kpiTerminalSinksSub) kpiTerminalSinksSub.textContent = '0% of expressions';
    if (kpiExprPayload) kpiExprPayload.textContent = '0 B (0%)';
    if (kpiExprAvgPayload) kpiExprAvgPayload.textContent = '0 B/expr';

    const exprChainContainer = document.getElementById('exprChainDepthHistogram');
    if (exprChainContainer) exprChainContainer.innerHTML = '';
    const varFanoutContainer = document.getElementById('varFanoutHistogram');
    if (varFanoutContainer) varFanoutContainer.innerHTML = '';
    const critPathsContainer = document.getElementById('exprCriticalPathsList');
    if (critPathsContainer) critPathsContainer.innerHTML = '<div style="text-align:center; padding:8px; color:var(--text-muted); font-size:0.75rem;">No dependency chains detected.</div>';
    const exprOperatorsContainer = document.getElementById('exprOperatorsList');
    if (exprOperatorsContainer) exprOperatorsContainer.innerHTML = '<div style="color:var(--text-muted); font-size:0.75rem;">No operators analyzed.</div>';
    const exprVarsContainer = document.getElementById('exprVariablesList');
    if (exprVarsContainer) exprVarsContainer.innerHTML = '<div style="text-align:center; padding:16px; color:var(--text-muted); font-size:0.8rem;">No variables or expressions analyzed.</div>';
}

if (typeof window !== 'undefined') {
    window.renderDocumentStatistics = renderDocumentStatistics;
    window.renderComponentsBreakdown = renderComponentsBreakdown;
    window.renderModifiersBreakdown = renderModifiersBreakdown;
    window.renderVariablesBreakdown = renderVariablesBreakdown;
    window.getCachedComponentsAnalysis = getCachedComponentsAnalysis;
    window.getCachedVariablesAnalysis = getCachedVariablesAnalysis;
    window.invalidateDocumentStatsCache = invalidateDocumentStatsCache;
    window.computeHistogram = computeHistogram;
    window.computeGranularHistogram = computeGranularHistogram;
    window.filterCommandsByType = filterCommandsByType;
    window.renderOpTypesBreakdown = renderOpTypesBreakdown;
    window.setSegment = setSegment;
    window.setKpi = setKpi;
    window.computeTreeMetrics = computeTreeMetrics;
    window.resetStatsUI = resetStatsUI;
}

