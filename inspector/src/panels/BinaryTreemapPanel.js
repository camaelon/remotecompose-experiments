// =========================================================================
// Panel 10: Binary Treemap & Byte Allocation Visualizer
// Modularized in src/panels/BinaryTreemapPanel.js
// =========================================================================

import { getOpName, isContainerOp, isModifierOp, selectCommandCard, toggleCommandExpand, getOpBitmapDataUrl, parsePathDataOp } from './CommandListPanel.js';

// Color palette for binary categories
export const CATEGORY_COLORS = {
    header: { bg: '#475569', border: '#64748b', text: '#f1f5f9', name: 'Header & Metadata', icon: '🏷️' },
    layout: { bg: '#065f46', border: '#10b981', text: '#ecfdf5', name: 'Layout & Containers', icon: '📐' },
    modifier: { bg: '#881337', border: '#f43f5e', text: '#fff1f2', name: 'Modifiers', icon: '🎨' },
    text: { bg: '#78350f', border: '#fbbf24', text: '#fffbeb', name: 'Text & Fonts', icon: '🔤' },
    path: { bg: '#581c87', border: '#c084fc', text: '#faf5ff', name: 'Paths & Geometries', icon: '✏️' },
    state: { bg: '#0369a1', border: '#38bdf8', text: '#f0f9ff', name: 'Variables & Expressions', icon: '🎛️' },
    draw: { bg: '#1e3a8a', border: '#60a5fa', text: '#eff6ff', name: 'Draw & Paint Operations', icon: '🖌️' },
    bitmap: { bg: '#c2410c', border: '#fb923c', text: '#fff7ed', name: 'Bitmaps & Assets', icon: '🖼️' },
    control: { bg: '#134e4a', border: '#2dd4bf', text: '#f0fdfa', name: 'Loops & Control Flow', icon: '🔁' },
    other: { bg: '#334155', border: '#94a3b8', text: '#f8fafc', name: 'Other / Padding', icon: '📦' }
};

// Current Treemap State
export let currentTreemapModel = null;
export let treemapZoomCategory = null; // null = root (all categories), or category key string
export let treemapViewMode = 'treemap'; // 'treemap' or 'table'
export let treemapSearchQuery = '';
export let treemapMinSizeBytes = 0;
export let selectedTreemapOpIdx = null;

/**
 * Classifies an operation into a semantic binary category
 */
export function classifyOpCategory(op) {
    if (!op) return 'other';
    const name = getOpName(op);
    const opCode = op.OP_CODE !== undefined ? op.OP_CODE : (op.constructor?.OP_CODE ?? 0);

    // 1. Header & Root Metadata
    if (opCode === 0 || name === 'Header' || name === 'RootContentBehavior' || name === 'RootContentDescription' || opCode === 65 || opCode === 103) {
        return 'header';
    }

    // 2. Modifiers
    if (isModifierOp(op) || name.endsWith('Modifier') || name.endsWith('ModifierOperation') || (opCode >= 16 && opCode <= 19) || opCode === 54 || opCode === 55 || opCode === 58 || opCode === 59 || opCode === 67 || opCode === 83 || opCode === 107 || opCode === 108 || (opCode >= 219 && opCode <= 226) || (opCode >= 228 && opCode <= 233) || opCode === 235) {
        return 'modifier';
    }

    // 3. Layout & Containers (must precede general draw/text)
    if ((opCode >= 200 && opCode <= 214) || isContainerOp(op) || (name.includes('Layout') && name !== 'CanvasLayout') || name === 'ContainerEnd' || name === 'ComponentStart' || name === 'CollapsibleRow' || name === 'CollapsibleColumn' || name === 'StateLayout') {
        return 'layout';
    }

    // 4. Variables, State, Expressions, Constants
    if (name.includes('Expression') || name.includes('Variable') || name.includes('Constant') || name.includes('DataDynamic') || name.includes('UpdateDynamic') || name.includes('FloatList') || name.includes('IdList') || name.includes('DataMap') || name.includes('ValueFloat') || name.includes('ValueInteger') || name.includes('ValueString') || opCode === 80 || opCode === 81 || opCode === 134 || opCode === 137 || opCode === 138 || opCode === 140 || opCode === 143 || opCode === 144 || opCode === 145 || opCode === 146 || opCode === 147 || opCode === 148 || opCode === 154 || opCode === 186 || opCode === 187 || opCode === 197 || opCode === 198 || opCode === 212 || opCode === 213 || opCode === 218 || opCode === 222 || opCode === 227) {
        return 'state';
    }

    // 5. Paths & Geometries
    if (name.includes('Path') || opCode === 38 || (opCode >= 120 && opCode <= 125) || opCode === 158 || opCode === 159 || opCode === 160 || opCode === 175 || opCode === 193) {
        return 'path';
    }

    // 6. Bitmaps & Assets
    if (name.includes('Bitmap') || name.includes('Image') || opCode === 44 || opCode === 66 || opCode === 101 || opCode === 149 || opCode === 171 || opCode === 190 || opCode === 234) {
        return 'bitmap';
    }

    // 7. Text & Fonts (excluding TextLayout which is layout, and excluding FloatExpression / NamedVariable)
    if (name.includes('Text') || name.includes('Font') || opCode === 43 || opCode === 48 || opCode === 49 || opCode === 53 || opCode === 57 || opCode === 102 || opCode === 133 || opCode === 135 || opCode === 136 || (opCode >= 151 && opCode <= 156) || opCode === 167 || opCode === 170 || opCode === 182 || opCode === 183 || opCode === 184 || opCode === 189 || opCode === 199 || opCode === 208) {
        return 'text';
    }

    // 8. Control Flow, Matrices & Loops
    if (name.includes('Loop') || name === 'Theme' || name.includes('Matrix') || name.includes('Touch') || name.includes('Click') || name.includes('HostAction') || name.includes('Conditional') || name.includes('Function') || opCode === 14 || opCode === 63 || opCode === 64 || (opCode >= 126 && opCode <= 131) || opCode === 142 || opCode === 157 || (opCode >= 164 && opCode <= 168) || opCode === 177 || opCode === 178 || opCode === 181 || opCode === 188 || opCode === 191 || opCode === 192 || opCode === 209 || opCode === 210 || opCode === 215 || opCode === 216) {
        return 'control';
    }

    // 9. Drawing Primitives & Canvas Paints
    if (name.startsWith('Draw') || name.includes('Paint') || name.includes('Shader') || name.includes('Particle') || opCode === 39 || opCode === 40 || opCode === 42 || opCode === 45 || opCode === 46 || opCode === 47 || opCode === 51 || opCode === 52 || opCode === 56 || opCode === 139 || opCode === 152 || (opCode >= 161 && opCode <= 163) || opCode === 173 || opCode === 174 || opCode === 194) {
        return 'draw';
    }

    return 'draw';
}

/**
 * Builds the complete hierarchical byte allocation model for a document
 */
export function buildBinaryTreemapModel(doc, ops, u8) {
    const totalBytes = u8 ? u8.length : 0;
    if (!totalBytes || !ops || ops.length === 0) {
        return {
            totalBytes: 0,
            categories: {},
            topConsumers: [],
            allAllocations: []
        };
    }

    const categories = {
        header: { key: 'header', ...CATEGORY_COLORS.header, totalBytes: 0, ops: [] },
        layout: { key: 'layout', ...CATEGORY_COLORS.layout, totalBytes: 0, ops: [] },
        modifier: { key: 'modifier', ...CATEGORY_COLORS.modifier, totalBytes: 0, ops: [] },
        text: { key: 'text', ...CATEGORY_COLORS.text, totalBytes: 0, ops: [] },
        path: { key: 'path', ...CATEGORY_COLORS.path, totalBytes: 0, ops: [] },
        state: { key: 'state', ...CATEGORY_COLORS.state, totalBytes: 0, ops: [] },
        draw: { key: 'draw', ...CATEGORY_COLORS.draw, totalBytes: 0, ops: [] },
        bitmap: { key: 'bitmap', ...CATEGORY_COLORS.bitmap, totalBytes: 0, ops: [] },
        control: { key: 'control', ...CATEGORY_COLORS.control, totalBytes: 0, ops: [] },
        other: { key: 'other', ...CATEGORY_COLORS.other, totalBytes: 0, ops: [] }
    };

    const allAllocations = [];

    ops.forEach((op, idx) => {
        const start = op._byteStart ?? 0;
        const end = op._byteEnd ?? (start + 4);
        const size = end > start ? (end - start) : 4;
        const catKey = classifyOpCategory(op);
        const name = getOpName(op);
        const opCode = op.OP_CODE !== undefined ? op.OP_CODE : (op.constructor?.OP_CODE ?? 0);
        const opId = op.mId ?? op.mVariableId ?? op.mTextId ?? op.mBitmapId ?? op.mPathId ?? null;

        const allocItem = {
            idx,
            op,
            name,
            opCode,
            opId,
            hexCode: '0x' + (opCode || 0).toString(16).padStart(2, '0').toUpperCase(),
            start,
            end,
            sizeBytes: size,
            pctOfTotal: totalBytes ? ((size / totalBytes) * 100) : 0,
            category: catKey,
            startHex: '0x' + start.toString(16).padStart(4, '0').toUpperCase(),
            endHex: '0x' + end.toString(16).padStart(4, '0').toUpperCase()
        };

        if (categories[catKey]) {
            categories[catKey].totalBytes += size;
            categories[catKey].ops.push(allocItem);
        }
        allAllocations.push(allocItem);
    });

    // Compute category percentages and sort inner ops
    Object.keys(categories).forEach(k => {
        const cat = categories[k];
        cat.pctOfTotal = totalBytes ? ((cat.totalBytes / totalBytes) * 100) : 0;
        cat.ops.sort((a, b) => b.sizeBytes - a.sizeBytes);
    });

    // Top individual consumers
    const topConsumers = [...allAllocations]
        .sort((a, b) => b.sizeBytes - a.sizeBytes)
        .slice(0, 10);

    return {
        totalBytes,
        categories,
        topConsumers,
        allAllocations
    };
}

/**
 * Standard Squarified 2D Treemap Partition Algorithm
 * Computes rectangular coordinates { x, y, width, height } for weighted items
 */
export function computeSquarifiedTreemap(items, x, y, width, height) {
    if (!items || items.length === 0 || width <= 0 || height <= 0) return [];

    const totalWeight = items.reduce((acc, it) => acc + Math.max(0.0001, it.weight || it.sizeBytes || 0), 0);
    if (totalWeight <= 0) return [];

    const totalArea = width * height;
    const elements = items.map(it => ({
        ...it,
        normalizedArea: (((it.weight || it.sizeBytes || 0) / totalWeight) * totalArea)
    })).sort((a, b) => b.normalizedArea - a.normalizedArea);

    const resultRects = [];

    function worstAspectRatio(row, w) {
        if (row.length === 0) return Infinity;
        let sum = 0;
        let max = -Infinity;
        let min = Infinity;
        for (let i = 0; i < row.length; i++) {
            const area = row[i].normalizedArea;
            sum += area;
            if (area > max) max = area;
            if (area < min) min = area;
        }
        if (sum === 0 || w === 0) return Infinity;
        const side = sum / w;
        return Math.max((w * w * max) / (sum * sum), (sum * sum) / (w * w * min));
    }

    function layoutRow(row, rx, ry, rw, rh, isHorizontal) {
        const rowArea = row.reduce((sum, el) => sum + el.normalizedArea, 0);
        if (isHorizontal) {
            const rowHeight = rowArea / rw;
            let currentX = rx;
            for (const el of row) {
                const elWidth = el.normalizedArea / rowHeight;
                resultRects.push({
                    item: el,
                    x: currentX,
                    y: ry,
                    width: elWidth,
                    height: rowHeight
                });
                currentX += elWidth;
            }
            return {
                newX: rx,
                newY: ry + rowHeight,
                newW: rw,
                newH: Math.max(0, rh - rowHeight)
            };
        } else {
            const rowWidth = rowArea / rh;
            let currentY = ry;
            for (const el of row) {
                const elHeight = el.normalizedArea / rowWidth;
                resultRects.push({
                    item: el,
                    x: rx,
                    y: currentY,
                    width: rowWidth,
                    height: elHeight
                });
                currentY += elHeight;
            }
            return {
                newX: rx + rowWidth,
                newY: ry,
                newW: Math.max(0, rw - rowWidth),
                newH: rh
            };
        }
    }

    function squarify(children, row, rx, ry, rw, rh) {
        if (children.length === 0) {
            if (row.length > 0) {
                const isHoriz = rw >= rh;
                layoutRow(row, rx, ry, rw, rh, isHoriz);
            }
            return;
        }

        const isHoriz = rw >= rh;
        const sideLength = isHoriz ? rw : rh;
        const next = children[0];
        const nextRow = [...row, next];

        if (row.length === 0 || worstAspectRatio(row, sideLength) >= worstAspectRatio(nextRow, sideLength)) {
            squarify(children.slice(1), nextRow, rx, ry, rw, rh);
        } else {
            const rem = layoutRow(row, rx, ry, rw, rh, isHoriz);
            squarify(children, [], rem.newX, rem.newY, rem.newW, rem.newH);
        }
    }

    squarify(elements, [], x, y, width, height);
    return resultRects;
}

/**
 * Main Render Function for Panel 10
 */
export function renderBinaryTreemapPanel(doc, ops, u8) {
    const allOps = ops || (window.currentParsedOps || []);
    const buffer = u8 || (window.currentBuffer ? new Uint8Array(window.currentBuffer) : null);
    
    currentTreemapModel = buildBinaryTreemapModel(doc || window.currentDocument, allOps, buffer);
    if (typeof window !== 'undefined') {
        window.currentTreemapModel = currentTreemapModel;
    }

    const badge = document.getElementById('treemapTotalSizeBadge');
    if (badge) {
        badge.textContent = `${currentTreemapModel.totalBytes} B`;
    }

    updateTreemapUI();
}

/**
 * Updates Treemap UI View (Treemap / Table) based on current state
 */
export function updateTreemapUI() {
    const container = document.getElementById('treemapVisualContainer');
    const tableContainer = document.getElementById('treemapTableContainer');
    const breadcrumbsBar = document.getElementById('treemapBreadcrumbs');
    const topHogsContainer = document.getElementById('treemapTopHogsContainer');

    if (!container || !currentTreemapModel) return;

    // 1. Update Breadcrumbs & Navigation
    if (breadcrumbsBar) {
        const rootActive = !treemapZoomCategory;
        let breadcrumbsHtml = `
            <button class="treemap-crumb ${rootActive ? 'active' : ''}" onclick="setTreemapZoom(null)">
                <span>📦 Entire Document</span>
                <span class="badge" style="margin-left:4px;">${currentTreemapModel.totalBytes} B</span>
            </button>
        `;
        if (treemapZoomCategory && currentTreemapModel.categories[treemapZoomCategory]) {
            const cat = currentTreemapModel.categories[treemapZoomCategory];
            breadcrumbsHtml += `
                <span style="color:var(--text-muted);">/</span>
                <button class="treemap-crumb active" onclick="setTreemapZoom('${cat.key}')">
                    <span>${cat.icon} ${cat.name}</span>
                    <span class="badge" style="margin-left:4px;">${cat.totalBytes} B (${cat.pctOfTotal.toFixed(1)}%)</span>
                </button>
            `;
        }
        breadcrumbsBar.innerHTML = breadcrumbsHtml;
    }

    // 2. Render Top 5 Space Consumers Card
    if (topHogsContainer) {
        if (currentTreemapModel.topConsumers.length === 0) {
            topHogsContainer.innerHTML = `<span style="font-size:0.75rem; color:var(--text-muted);">No operations recorded.</span>`;
        } else {
            const top5 = currentTreemapModel.topConsumers.slice(0, 5);
            let topHtml = '';
            top5.forEach(it => {
                const color = CATEGORY_COLORS[it.category]?.border || 'var(--accent-blue)';
                const isSelected = it.idx === selectedTreemapOpIdx;
                topHtml += `
                    <div class="treemap-hog-pill ${isSelected ? 'selected' : ''}" data-op-idx="${it.idx}" onclick="onTreemapItemClick(${it.idx})" title="Op #${it.idx + 1} (${it.name}): ${it.sizeBytes} B (${it.pctOfTotal.toFixed(1)}% of total)\nClick to inspect in Command List">
                        <span style="display:flex; align-items:center; gap:4px;">
                            <span style="width:6px; height:6px; border-radius:50%; background:${color};"></span>
                            <span style="font-family:var(--code-font); font-weight:600;">#${it.idx + 1} ${it.name}</span>
                        </span>
                        <strong style="color:var(--accent-amber); font-family:var(--code-font);">${it.sizeBytes} B <span style="font-weight:normal; font-size:0.65rem; color:var(--text-muted);">(${it.pctOfTotal.toFixed(1)}%)</span></strong>
                    </div>
                `;
            });
            topHogsContainer.innerHTML = topHtml;
        }
    }

    // 3. Render Treemap or Table
    if (treemapViewMode === 'table') {
        if (container) container.style.display = 'none';
        if (tableContainer) {
            tableContainer.style.display = 'block';
            renderAllocationTable();
        }
    } else {
        if (tableContainer) tableContainer.style.display = 'none';
        if (container) {
            container.style.display = 'block';
            renderSquarifiedTreemapSvg();
        }
    }
}

/**
 * Renders visual SVG representations for BitmapData and PathData within treemap tiles
 */
export function renderTileVisualPreview(it, rx, ry, rw, rh, canShowLabel, canShowSub) {
    if (!it) return '';

    // 1. Operation Tile Visual Representation (Zoomed or Single Op)
    if (it.isOp) {
        const op = it.op;
        const opCode = it.opCode;
        const name = it.name;

        // BitmapData Visual Preview
        if (opCode === 101 || name === 'BitmapData') {
            const dataUrl = getOpBitmapDataUrl(op);
            if (!dataUrl) return '';

            const topOffset = canShowSub ? 32 : (canShowLabel ? 18 : 2);
            const availW = Math.max(0, rw - 8);
            const availH = Math.max(0, rh - topOffset - 4);

            if (availW >= 16 && availH >= 16) {
                return `
                    <image href="${dataUrl}" x="${rx + 4}" y="${ry + topOffset}"
                           width="${availW}" height="${availH}"
                           preserveAspectRatio="xMidYMid meet"
                           style="pointer-events:none; border-radius:2px; filter:drop-shadow(0 1px 3px rgba(0,0,0,0.5));" />
                `;
            } else if (rw >= 20 && rh >= 20) {
                return `
                    <image href="${dataUrl}" x="${rx + 2}" y="${ry + 2}"
                           width="${rw - 4}" height="${rh - 4}"
                           preserveAspectRatio="xMidYMid meet"
                           opacity="0.35"
                           style="pointer-events:none;" />
                `;
            }
        }

        // PathData Visual Representation
        if (opCode === 123 || name === 'PathData') {
            const parsed = parsePathDataOp(op);
            if (!parsed || !parsed.d) return '';

            const minX = isFinite(parsed.minX) ? parsed.minX : 0;
            const minY = isFinite(parsed.minY) ? parsed.minY : 0;
            const pw = parsed.w > 0 && isFinite(parsed.w) ? parsed.w : 100;
            const ph = parsed.h > 0 && isFinite(parsed.h) ? parsed.h : 100;

            const topOffset = canShowSub ? 32 : (canShowLabel ? 18 : 2);
            const availW = Math.max(0, rw - 8);
            const availH = Math.max(0, rh - topOffset - 4);

            if (availW >= 16 && availH >= 16) {
                return `
                    <svg x="${rx + 4}" y="${ry + topOffset}" width="${availW}" height="${availH}"
                         viewBox="${minX} ${minY} ${pw} ${ph}" preserveAspectRatio="xMidYMid meet"
                         style="overflow:visible; pointer-events:none;">
                        <path d="${parsed.d}" fill="rgba(192, 132, 252, 0.25)" stroke="#c084fc"
                              stroke-width="2" vector-effect="non-scaling-stroke"
                              stroke-linecap="round" stroke-linejoin="round" />
                    </svg>
                `;
            } else if (rw >= 20 && rh >= 20) {
                return `
                    <svg x="${rx + 2}" y="${ry + 2}" width="${rw - 4}" height="${rh - 4}"
                         viewBox="${minX} ${minY} ${pw} ${ph}" preserveAspectRatio="xMidYMid meet"
                         opacity="0.3" style="overflow:visible; pointer-events:none;">
                        <path d="${parsed.d}" fill="rgba(192, 132, 252, 0.2)" stroke="#c084fc"
                              stroke-width="1.5" vector-effect="non-scaling-stroke" />
                    </svg>
                `;
            }
        }
    }

    // 2. Category Tile Visual Representation (Root Level)
    if (it.isCategory) {
        if (it.key === 'bitmap' && rw >= 60 && rh >= 50 && it.ops && it.ops.length > 0) {
            const firstBmp = it.ops.find(o => o.opCode === 101 || o.name === 'BitmapData');
            if (firstBmp) {
                const dataUrl = getOpBitmapDataUrl(firstBmp.op);
                if (dataUrl) {
                    const topOffset = canShowSub ? 52 : (canShowLabel ? 26 : 4);
                    const availW = Math.max(0, rw - 12);
                    const availH = Math.max(0, rh - topOffset - 6);
                    if (availW >= 20 && availH >= 20) {
                        return `
                            <image href="${dataUrl}" x="${rx + 6}" y="${ry + topOffset}"
                                   width="${availW}" height="${availH}"
                                   preserveAspectRatio="xMidYMid meet"
                                   opacity="0.8"
                                   style="pointer-events:none; border-radius:3px; filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5));" />
                        `;
                    }
                }
            }
        }

        if (it.key === 'path' && rw >= 60 && rh >= 50 && it.ops && it.ops.length > 0) {
            const firstPath = it.ops.find(o => o.opCode === 123 || o.name === 'PathData');
            if (firstPath) {
                const parsed = parsePathDataOp(firstPath.op);
                if (parsed && parsed.d) {
                    const minX = isFinite(parsed.minX) ? parsed.minX : 0;
                    const minY = isFinite(parsed.minY) ? parsed.minY : 0;
                    const pw = parsed.w > 0 && isFinite(parsed.w) ? parsed.w : 100;
                    const ph = parsed.h > 0 && isFinite(parsed.h) ? parsed.h : 100;

                    const topOffset = canShowSub ? 52 : (canShowLabel ? 26 : 4);
                    const availW = Math.max(0, rw - 12);
                    const availH = Math.max(0, rh - topOffset - 6);
                    if (availW >= 20 && availH >= 20) {
                        return `
                            <svg x="${rx + 6}" y="${ry + topOffset}" width="${availW}" height="${availH}"
                                 viewBox="${minX} ${minY} ${pw} ${ph}" preserveAspectRatio="xMidYMid meet"
                                 opacity="0.8" style="overflow:visible; pointer-events:none;">
                                <path d="${parsed.d}" fill="rgba(192, 132, 252, 0.3)" stroke="#c084fc"
                                      stroke-width="2" vector-effect="non-scaling-stroke"
                                      stroke-linecap="round" stroke-linejoin="round" />
                            </svg>
                        `;
                    }
                }
            }
        }
    }

    return '';
}

/**
 * Renders the Squarified Treemap as interactive SVG tiles
 */
export function renderSquarifiedTreemapSvg() {
    const container = document.getElementById('treemapVisualContainer');
    if (!container || !currentTreemapModel) return;

    const width = container.clientWidth || 500;
    const height = container.clientHeight || 340;

    if (currentTreemapModel.totalBytes === 0) {
        container.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:var(--text-muted); font-size:0.85rem; text-align:center; padding:32px;">
                <span>📦 No binary byte allocation data loaded.</span>
                <span style="font-size:0.75rem; margin-top:4px;">Open a .rc file or select a sample demo to inspect binary disk usage.</span>
            </div>
        `;
        return;
    }

    let itemsToLayout = [];

    // Filter by search & min size
    const query = (treemapSearchQuery || '').toLowerCase().trim();

    if (treemapZoomCategory && currentTreemapModel.categories[treemapZoomCategory]) {
        // Zoomed into a single category: layout individual operations inside this category
        const cat = currentTreemapModel.categories[treemapZoomCategory];
        itemsToLayout = cat.ops
            .filter(op => {
                if (treemapMinSizeBytes > 0 && op.sizeBytes < treemapMinSizeBytes) return false;
                if (query && !op.name.toLowerCase().includes(query) && !String(op.opId).includes(query)) return false;
                return true;
            })
            .map(op => ({
                ...op,
                weight: op.sizeBytes,
                isOp: true
            }));
    } else {
        // Root view: layout active categories that contain bytes
        const activeCats = Object.values(currentTreemapModel.categories).filter(c => c.totalBytes > 0);
        itemsToLayout = activeCats
            .filter(c => {
                if (treemapMinSizeBytes > 0 && c.totalBytes < treemapMinSizeBytes) return false;
                if (query && !c.name.toLowerCase().includes(query)) return false;
                return true;
            })
            .map(c => ({
                ...c,
                weight: c.totalBytes,
                isCategory: true
            }));
    }

    if (itemsToLayout.length === 0) {
        container.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:var(--text-muted); font-size:0.85rem; text-align:center;">
                <span>🔍 No items match filter "${escapeHtml(query || treemapMinSizeBytes + 'B')}"</span>
                <button class="btn btn-secondary" style="margin-top:8px; padding:2px 8px; font-size:0.75rem;" onclick="resetTreemapFilters()">Reset Filters</button>
            </div>
        `;
        return;
    }

    const rects = computeSquarifiedTreemap(itemsToLayout, 0, 0, width, height);

    let svgInner = '';

    rects.forEach(r => {
        const it = r.item;
        const rx = Math.max(0, r.x);
        const ry = Math.max(0, r.y);
        const rw = Math.max(1, r.width - 2); // 2px margin gap
        const rh = Math.max(1, r.height - 2);

        if (rw <= 2 || rh <= 2) return;

        if (it.isCategory) {
            const catColor = CATEGORY_COLORS[it.key] || CATEGORY_COLORS.other;
            const canShowLabel = rw > 45 && rh > 24;
            const canShowSub = rw > 70 && rh > 44;
            const visualPreview = renderTileVisualPreview(it, rx, ry, rw, rh, canShowLabel, canShowSub);

            svgInner += `
                <g class="treemap-tile category-tile" onclick="setTreemapZoom('${it.key}')" style="cursor:pointer;">
                    <rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="4"
                          fill="${catColor.bg}" stroke="${catColor.border}" stroke-width="1"
                          opacity="0.9" class="treemap-rect">
                        <title>${catColor.icon} ${it.name}\n${it.totalBytes} Bytes (${it.pctOfTotal.toFixed(1)}% of document)\n${it.ops.length} Operations\nClick to drill down into operations</title>
                    </rect>
                    ${visualPreview}
                    ${canShowLabel ? `
                        <text x="${rx + 6}" y="${ry + 16}" fill="${catColor.text}" font-size="11" font-weight="700" font-family="system-ui, sans-serif" pointer-events="none">
                            ${catColor.icon} ${it.name}
                        </text>
                    ` : ''}
                    ${canShowSub ? `
                        <text x="${rx + 6}" y="${ry + 32}" fill="${catColor.border}" font-size="10" font-weight="600" font-family="var(--code-font)" pointer-events="none">
                            ${it.totalBytes} B (${it.pctOfTotal.toFixed(1)}%)
                        </text>
                        <text x="${rx + 6}" y="${ry + 46}" fill="rgba(255,255,255,0.6)" font-size="9" font-family="system-ui, sans-serif" pointer-events="none">
                            ${it.ops.length} ops · Click to zoom
                        </text>
                    ` : ''}
                </g>
            `;
        } else if (it.isOp) {
            const catColor = CATEGORY_COLORS[it.category] || CATEGORY_COLORS.other;
            const isSelected = it.idx === selectedTreemapOpIdx;
            const canShowLabel = rw > 35 && rh > 18;
            const canShowSub = rw > 55 && rh > 34;
            const visualPreview = renderTileVisualPreview(it, rx, ry, rw, rh, canShowLabel, canShowSub);

            svgInner += `
                <g class="treemap-tile op-tile ${isSelected ? 'selected' : ''}" data-op-idx="${it.idx}" onclick="onTreemapItemClick(${it.idx})" style="cursor:pointer;">
                    <rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="3"
                          fill="${catColor.bg}" stroke="${isSelected ? 'var(--accent-blue)' : catColor.border}" stroke-width="${isSelected ? 2.5 : 1}"
                          opacity="${isSelected ? 1 : 0.85}" class="treemap-rect">
                        <title>Op #${it.idx + 1} (${it.name})\nOpCode: ${it.hexCode} (${it.opCode})\nSize: ${it.sizeBytes} Bytes (${it.pctOfTotal.toFixed(1)}% of total)\nOffset: ${it.startHex}..${it.endHex}\nClick to inspect in Command List</title>
                    </rect>
                    ${visualPreview}
                    ${canShowLabel ? `
                        <text x="${rx + 4}" y="${ry + 13}" fill="${catColor.text}" font-size="10" font-weight="600" font-family="var(--code-font)" pointer-events="none">
                            #${it.idx + 1} ${it.name}
                        </text>
                    ` : ''}
                    ${canShowSub ? `
                        <text x="${rx + 4}" y="${ry + 26}" fill="var(--accent-amber)" font-size="9" font-weight="600" font-family="var(--code-font)" pointer-events="none">
                            ${it.sizeBytes} B (${it.pctOfTotal.toFixed(1)}%)
                        </text>
                    ` : ''}
                </g>
            `;
        }
    });

    container.innerHTML = `
        <svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" style="display:block; overflow:visible;">
            ${svgInner}
        </svg>
    `;
}

/**
 * Renders the ranked allocation table view
 */
export function renderAllocationTable() {
    const tbody = document.getElementById('treemapTableTbody');
    if (!tbody || !currentTreemapModel) return;

    let items = currentTreemapModel.allAllocations;

    // Apply Zoom Filter
    if (treemapZoomCategory) {
        items = items.filter(it => it.category === treemapZoomCategory);
    }

    // Apply Search Query & Min Size Filter
    const query = (treemapSearchQuery || '').toLowerCase().trim();
    if (query) {
        items = items.filter(it => it.name.toLowerCase().includes(query) || String(it.opId).includes(query) || it.startHex.toLowerCase().includes(query));
    }
    if (treemapMinSizeBytes > 0) {
        items = items.filter(it => it.sizeBytes >= treemapMinSizeBytes);
    }

    // Sort by size descending
    items = [...items].sort((a, b) => b.sizeBytes - a.sizeBytes);

    if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:24px; color:var(--text-muted);">No operations match filter.</td></tr>`;
        return;
    }

    let html = '';
    items.forEach(it => {
        const cat = CATEGORY_COLORS[it.category] || CATEGORY_COLORS.other;
        const isSelected = it.idx === selectedTreemapOpIdx;

        let previewThumbnail = '';
        if (it.opCode === 101 || it.name === 'BitmapData') {
            const dataUrl = getOpBitmapDataUrl(it.op);
            if (dataUrl) {
                previewThumbnail = `<img src="${dataUrl}" style="width:20px; height:20px; object-fit:contain; border-radius:2px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.15); margin-right:4px; flex-shrink:0;" title="BitmapData preview" />`;
            }
        } else if (it.opCode === 123 || it.name === 'PathData') {
            const parsed = parsePathDataOp(it.op);
            if (parsed && parsed.d) {
                const minX = isFinite(parsed.minX) ? parsed.minX : 0;
                const minY = isFinite(parsed.minY) ? parsed.minY : 0;
                const pw = parsed.w > 0 && isFinite(parsed.w) ? parsed.w : 100;
                const ph = parsed.h > 0 && isFinite(parsed.h) ? parsed.h : 100;
                previewThumbnail = `
                    <svg width="20" height="20" viewBox="${minX} ${minY} ${pw} ${ph}" preserveAspectRatio="xMidYMid meet"
                         style="background:rgba(0,0,0,0.3); border-radius:2px; border:1px solid rgba(192,132,252,0.3); margin-right:4px; flex-shrink:0;" title="PathData vector preview">
                        <path d="${parsed.d}" fill="rgba(192,132,252,0.3)" stroke="#c084fc" stroke-width="2" vector-effect="non-scaling-stroke"/>
                    </svg>
                `;
            }
        }

        html += `
            <tr class="treemap-table-row ${isSelected ? 'selected' : ''}" id="treemapRow-${it.idx}" data-op-idx="${it.idx}" onclick="onTreemapItemClick(${it.idx})" style="cursor:pointer;" title="Click to scroll to operation #${it.idx + 1} in Command List">
                <td style="padding:6px 8px; font-family:var(--code-font); color:var(--text-muted);">#${it.idx + 1}</td>
                <td style="padding:6px 8px; font-family:var(--code-font); font-weight:600; color:${cat.border}; display:flex; align-items:center; gap:6px;">
                    ${previewThumbnail || `<span style="font-size:0.8rem;">${cat.icon}</span>`}
                    <span>${escapeHtml(it.name)}</span>
                    ${it.opId !== null ? `<span style="color:var(--text-muted); font-size:0.7rem; font-weight:normal;">[ID: ${it.opId}]</span>` : ''}
                </td>
                <td style="padding:6px 8px; text-align:center; font-family:var(--code-font); font-size:0.7rem; color:var(--text-secondary);">${it.hexCode}</td>
                <td style="padding:6px 8px; text-align:center; font-family:var(--code-font); font-size:0.7rem; color:var(--text-muted);">${it.startHex}..${it.endHex}</td>
                <td style="padding:6px 8px; text-align:right; font-family:var(--code-font); font-weight:600; color:var(--accent-amber);">${it.sizeBytes} B</td>
                <td style="padding:6px 8px; width:110px;">
                    <div style="display:flex; align-items:center; gap:6px;">
                        <div style="flex:1; height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden;">
                            <div style="width:${Math.min(100, it.pctOfTotal)}%; height:100%; background:${cat.border}; border-radius:3px;"></div>
                        </div>
                        <span style="font-size:0.7rem; font-family:var(--code-font); color:var(--text-muted); min-width:32px; text-align:right;">${it.pctOfTotal.toFixed(1)}%</span>
                    </div>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

/**
 * Highlights a specific operation across all Treemap visual elements (SVG, Table, Top Hogs)
 */
export function highlightTreemapOp(idx) {
    selectedTreemapOpIdx = typeof idx === 'number' && idx >= 0 ? idx : null;

    // 1. Update SVG tiles
    document.querySelectorAll('.treemap-tile.op-tile').forEach(el => {
        const opIdx = Number(el.getAttribute('data-op-idx'));
        const isSel = opIdx === selectedTreemapOpIdx;
        el.classList.toggle('selected', isSel);
        const rect = el.querySelector('rect');
        if (rect) {
            if (isSel) {
                rect.style.stroke = 'var(--accent-blue)';
                rect.style.strokeWidth = '2.5px';
                rect.style.opacity = '1';
            } else {
                rect.style.stroke = '';
                rect.style.strokeWidth = '';
                rect.style.opacity = '';
            }
        }
    });

    // 2. Update Table rows
    document.querySelectorAll('.treemap-table-row').forEach(row => {
        const opIdx = Number(row.getAttribute('data-op-idx'));
        const isSel = opIdx === selectedTreemapOpIdx;
        row.classList.toggle('selected', isSel);
        if (isSel && treemapViewMode === 'table') {
            row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });

    // 3. Update Top Hogs
    document.querySelectorAll('.treemap-hog-pill').forEach(pill => {
        const opIdx = Number(pill.getAttribute('data-op-idx'));
        pill.classList.toggle('selected', opIdx === selectedTreemapOpIdx);
    });
}

/**
 * Handles clicking an item tile in the treemap or table row
 * Seamlessly selects, expands, and centers the operation in CommandListPanel (Pane 2)
 */
export function onTreemapItemClick(idx) {
    if (typeof idx !== 'number' || idx < 0) return;
    
    highlightTreemapOp(idx);

    // Only interact with and navigate Command List (Pane 2) if it is currently open
    const pane2 = document.getElementById('pane2');
    const isPane2Open = pane2 && !pane2.classList.contains('hidden-panel');
    if (!isPane2Open) return;

    // 1. Lookup operation
    const allOps = window.currentParsedOps || (currentTreemapModel?.allAllocations?.map(a => a.op) || []);
    const op = allOps[idx];
    const opId = op ? (op.mId ?? op.mVariableId ?? op.mTextId ?? op.mBitmapId ?? op.mPathId ?? null) : null;

    // 2. If a command search query is active and hides this item, clear it
    const searchInput = document.getElementById('cmdSearchInput');
    if (searchInput && searchInput.value.trim().length > 0) {
        const targetCard = document.getElementById(`cmdCard-${idx}`);
        if (!targetCard || targetCard.style.display === 'none') {
            searchInput.value = '';
            if (typeof window.filterCommands === 'function') {
                window.filterCommands();
            }
        }
    }

    // 3. Select command card in Command List (Pane 2)
    if (typeof window.selectCommandCard === 'function') {
        window.selectCommandCard(idx, opId, { source: 'treemap', focusGraph: false });
    } else if (typeof selectCommandCard === 'function') {
        selectCommandCard(idx, opId, { source: 'treemap', focusGraph: false });
    }

    // 4. Expand detailed properties in compact mode
    if (typeof window.toggleCommandExpand === 'function') {
        const card = document.getElementById(`cmdCard-${idx}`);
        if (card && !card.classList.contains('expanded')) {
            window.toggleCommandExpand(idx, opId);
        }
    }

    // 5. Smoothly scroll into view and trigger highlight pulse animation
    const cardEl = document.getElementById(`cmdCard-${idx}`);
    if (cardEl) {
        cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        cardEl.classList.add('selected');
        cardEl.classList.add('treemap-highlight-pulse');
        setTimeout(() => {
            if (cardEl) cardEl.classList.remove('treemap-highlight-pulse');
        }, 1800);
    }
}

/**
 * Sets Treemap Drill-down Zoom Category (null for entire document)
 */
export function setTreemapZoom(categoryKey) {
    treemapZoomCategory = categoryKey;
    updateTreemapUI();
}

/**
 * Switches View Mode ('treemap' or 'table')
 */
export function setTreemapViewMode(mode) {
    treemapViewMode = mode;
    const treemapBtn = document.getElementById('treemapModeVisualBtn');
    const tableBtn = document.getElementById('treemapModeTableBtn');

    if (treemapBtn && tableBtn) {
        if (mode === 'treemap') {
            treemapBtn.classList.add('active');
            treemapBtn.classList.remove('btn-secondary');
            tableBtn.classList.remove('active');
            tableBtn.classList.add('btn-secondary');
        } else {
            tableBtn.classList.add('active');
            tableBtn.classList.remove('btn-secondary');
            treemapBtn.classList.remove('active');
            treemapBtn.classList.add('btn-secondary');
        }
    }

    updateTreemapUI();
}

/**
 * Search and Filter Handlers
 */
export function onTreemapSearchInput(val) {
    treemapSearchQuery = val || '';
    const clearBtn = document.getElementById('treemapSearchClearBtn');
    if (clearBtn) {
        clearBtn.style.display = treemapSearchQuery ? 'block' : 'none';
    }
    updateTreemapUI();
}

export function clearTreemapSearch() {
    const input = document.getElementById('treemapSearchInput');
    if (input) input.value = '';
    onTreemapSearchInput('');
}

export function onTreemapMinSizeChange(minBytes) {
    treemapMinSizeBytes = Number(minBytes) || 0;
    updateTreemapUI();
}

export function resetTreemapFilters() {
    treemapSearchQuery = '';
    treemapMinSizeBytes = 0;
    treemapZoomCategory = null;
    const input = document.getElementById('treemapSearchInput');
    if (input) input.value = '';
    const select = document.getElementById('treemapMinSizeSelect');
    if (select) select.value = '0';
    updateTreemapUI();
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

if (typeof window !== 'undefined') {
    window.renderBinaryTreemapPanel = renderBinaryTreemapPanel;
    window.setTreemapZoom = setTreemapZoom;
    window.setTreemapViewMode = setTreemapViewMode;
    window.onTreemapSearchInput = onTreemapSearchInput;
    window.clearTreemapSearch = clearTreemapSearch;
    window.onTreemapMinSizeChange = onTreemapMinSizeChange;
    window.resetTreemapFilters = resetTreemapFilters;
    window.onTreemapItemClick = onTreemapItemClick;
    window.highlightTreemapOp = highlightTreemapOp;
}
