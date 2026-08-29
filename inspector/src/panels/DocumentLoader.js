// =========================================================================
// Document Loader, Drag & Drop, URL Fetch & ArrayBuffer Parsing Engine
// Modularized in src/panels/DocumentLoader.js
// =========================================================================

import { armProfiler, drawProfiler, resetProfilerTotals } from './ProfilerPanel.js';
import {
    invalidateUnusedIslandsAnalysisCache,
    renderExpressionDependencyGraph
} from './DependencyGraphPanel.js';
import { renderCommandsList } from './CommandListPanel.js';
import {
    setJsonInputValue,
    decompileDocumentToJson,
    compileAndLoadJson,
    showCompileStatus
} from './JsonEditorPanel.js';
import {
    currentDensity,
    customStageWidth,
    customStageHeight,
    applyDensity,
    applyStageDimensions
} from './StagePanel.js';
import {
    renderComponentTree,
    renderRunningOperationsTree
} from './ComponentTreePanel.js';
import { renderDocumentStatistics, invalidateDocumentStatsCache } from './DocumentStatsPanel.js';
import { renderBinaryTreemapPanel } from './BinaryTreemapPanel.js';
import { renderThemeEnvironmentPanel } from './ThemeEnvironmentPanel.js';
import { renderResponsiveMatrixPanel } from './ResponsiveMatrixPanel.js';
import { renderLayoutInspectorPanel } from './LayoutInspectorPanel.js';

export let currentPlayer = null;
export let currentDocument = null;
export let currentBuffer = null;
export let currentParsedOps = [];

export function initDropZone() {
    const dropZone = document.getElementById('headerDropZone') || document.getElementById('dropZone');
    ['dragenter', 'dragover'].forEach(eventName => {
        window.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (dropZone) dropZone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        window.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (dropZone) dropZone.classList.remove('dragover');
        }, false);
    });

    window.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length > 0) {
            processFile(dt.files[0]);
        }
    });
}

export function handleFileSelect(event) {
    const files = event.target.files;
    if (files && files.length > 0) {
        processFile(files[0]);
        event.target.value = '';
    }
}

export function processFile(file) {
    if (!file) return;
    const fileName = file.name || 'file.rc';
    const isJson = fileName.toLowerCase().endsWith('.json');
    const reader = new FileReader();

    showCompileStatus(`⏳ Loading ${fileName}...`, true);

    if (isJson) {
        reader.onload = (e) => {
            try {
                const jsonText = e.target.result;
                const textarea = document.getElementById('jsonTextarea');
                if (textarea) textarea.value = jsonText;
                const jsonObj = JSON.parse(jsonText);
                compileAndLoadJson(jsonObj, fileName);
            } catch (err) {
                showCompileStatus(`❌ JSON Parse Error: ${err.message}`, false);
            }
        };
        reader.onerror = () => showCompileStatus('❌ Failed to read JSON file.', false);
        reader.readAsText(file);
    } else {
        reader.onload = async (e) => {
            try {
                const arrayBuffer = e.target.result;
                showCompileStatus(`⏳ Processing ${fileName} (${arrayBuffer.byteLength} B)...`, true);
                await loadRcArrayBuffer(arrayBuffer, fileName);
                showCompileStatus(`✓ Loaded ${fileName} (${arrayBuffer.byteLength} B)`, true);
            } catch (err) {
                console.error('Error loading .rc file:', err);
                showCompileStatus(`❌ Error loading .rc file: ${err.message}`, false);
            }
        };
        reader.onerror = () => showCompileStatus('❌ Failed to read .rc binary file.', false);
        reader.readAsArrayBuffer(file);
    }
}

export function getAllOperationsFlat(doc, u8) {
    if (!doc) return [];
    const topOps = (typeof doc.getOperations === 'function' ? doc.getOperations() : doc.mOps) || [];
    const result = [];
    const visited = new Set();

    function visit(op) {
        if (!op || visited.has(op)) return;
        visited.add(op);
        result.push(op);
        const children = (typeof op.getList === 'function' ? op.getList() : null) || op.mOps || op.mOperations || op.operations || op.mList || op.list;
        if (Array.isArray(children)) {
            children.forEach(child => visit(child));
        }
    }

    topOps.forEach(op => visit(op));

    if (u8 && u8.length > 0) {
        const covered = new Array(u8.length).fill(false);
        result.forEach(op => {
            if (op._byteStart !== undefined && op._byteEnd !== undefined) {
                for (let i = op._byteStart; i < op._byteEnd; i++) {
                    covered[i] = true;
                }
            }
        });

        for (let i = 0; i < u8.length; i++) {
            if (!covered[i] && u8[i] === 214) {
                result.push({
                    OP_CODE: 214,
                    _byteStart: i,
                    _byteEnd: i + 1,
                    deepToString: () => "ContainerEnd",
                    constructor: { name: "ContainerEnd", OP_CODE: 214 }
                });
                covered[i] = true;
            }
        }

        result.sort((a, b) => (a._byteStart ?? 0) - (b._byteStart ?? 0));
    }

    return result;
}

export async function loadRcArrayBuffer(arrayBuffer, name, sourceJson) {
    currentBuffer = arrayBuffer;
    window.currentBuffer = currentBuffer;
    const u8 = new Uint8Array(arrayBuffer);
    window.currentU8Buffer = u8;

    // Update UI Header Stats
    const badgeEl = document.getElementById('fileStatusBadge');
    if (badgeEl) {
        badgeEl.textContent = name;
        badgeEl.title = `Loaded: ${name} (${u8.length.toLocaleString()} bytes). Click or drop file to change.`;
    }
    const headerDropZone = document.getElementById('headerDropZone');
    if (headerDropZone) headerDropZone.classList.add('has-file');
    const sizeEl = document.getElementById('metaSize');
    if (sizeEl) sizeEl.textContent = `Size: ${u8.length} B`;

    let canvas = document.getElementById('previewCanvas');
    if (currentPlayer) {
        currentPlayer.stop();
        // Replace canvas with a clean clone to strip all previous pointer event listeners attached by older RcdPlayer instances
        const newCanvas = canvas.cloneNode(true);
        if (canvas.parentNode) {
            canvas.parentNode.replaceChild(newCanvas, canvas);
        }
        canvas = newCanvas;
    }

    const rcRuntime = (typeof RC !== 'undefined' ? RC : undefined) || (typeof window !== 'undefined' ? window.RC : undefined) || globalThis.RC;
    if (rcRuntime && typeof rcRuntime.RcdPlayer !== 'undefined') {
        currentPlayer = new rcRuntime.RcdPlayer(canvas);
        if (typeof currentPlayer.setDensity === 'function') {
            currentPlayer.setDensity(currentDensity);
        }
        window.currentPlayer = currentPlayer;
        window.currentBuffer = currentBuffer;
        resetProfilerTotals();
        armProfiler(currentPlayer);
        currentDocument = await currentPlayer.loadFromArrayBuffer(arrayBuffer);
        window.currentDocument = currentDocument;
        if (typeof currentPlayer.setDensity === 'function') {
            currentPlayer.setDensity(currentDensity);
        }
        const rContext = currentPlayer.getRemoteContext();
        if (rContext && typeof rContext.setDensity === 'function') {
            rContext.setDensity(currentDensity);
        }
        armProfiler(currentPlayer);
        invalidateUnusedIslandsAnalysisCache();
        invalidateDocumentStatsCache();
        if (currentPlayer && typeof currentPlayer.setVariableListener === 'function') {
            currentPlayer.setVariableListener(() => {
                if (typeof window.updateVariableValuesLive === 'function') window.updateVariableValuesLive();
                if (typeof window.updateComponentTreeLive === 'function') window.updateComponentTreeLive();
                if (typeof window.updateRunningTreeLive === 'function') window.updateRunningTreeLive();
                if (typeof window.updateRepaintPanelLive === 'function') window.updateRepaintPanelLive();
                if (typeof window.refreshLayers3DBounds === 'function') window.refreshLayers3DBounds();
            });
        }
        drawProfiler();
        if (typeof window.resetRepaintHistory === 'function') window.resetRepaintHistory();
        if (typeof window.renderInteractionPanel === 'function') window.renderInteractionPanel();
        if (typeof window.renderAccessibilityPanel === 'function') window.renderAccessibilityPanel();
        if (typeof window.invalidateLayers3DModel === 'function') window.invalidateLayers3DModel();
    }

    // Maintain selected preview density (default 1.0) on document load
    applyDensity(currentDensity, false);

    const docWidth = currentDocument ? (typeof currentDocument.getAuthorWidth === 'function' ? currentDocument.getAuthorWidth() : (currentDocument.mHeader ? currentDocument.mHeader.mWidth : currentDocument.getWidth())) : 300;
    const docHeight = currentDocument ? (typeof currentDocument.getAuthorHeight === 'function' ? currentDocument.getAuthorHeight() : (currentDocument.mHeader ? currentDocument.mHeader.mHeight : currentDocument.getHeight())) : 300;
    const finalW = customStageWidth !== null ? customStageWidth : docWidth;
    const finalH = customStageHeight !== null ? customStageHeight : docHeight;
    applyStageDimensions(finalW, finalH);

    // Update JSON Editor Source
    if (sourceJson) {
        const str = typeof sourceJson === 'string' ? sourceJson : JSON.stringify(sourceJson, null, 2);
        setJsonInputValue(str);
    } else if (currentDocument) {
        const decompiled = decompileDocumentToJson(currentDocument);
        setJsonInputValue(JSON.stringify(decompiled, null, 2));
    }

    // Extract Operations & Component Tree
    const allOps = currentDocument ? getAllOperationsFlat(currentDocument, u8) : [];
    currentParsedOps = allOps;
    window.currentParsedOps = allOps;
    window.allOps = allOps;
    const metaOpsEl = document.getElementById('metaOps');
    if (metaOpsEl) metaOpsEl.textContent = `Ops: ${allOps.length}`;
    const cmdBadgeEl = document.getElementById('cmdCountBadge');
    if (cmdBadgeEl) cmdBadgeEl.textContent = `${allOps.length} Ops`;

    renderCommandsList(allOps, u8);
    renderComponentTree(currentDocument);
    renderRunningOperationsTree(currentDocument);
    renderDocumentStatistics(currentDocument, allOps, u8);
    renderExpressionDependencyGraph();
    renderBinaryTreemapPanel(currentDocument, allOps, u8);
    renderThemeEnvironmentPanel(currentDocument);
    const p12 = document.getElementById('pane12');
    if (p12 && !p12.classList.contains('hidden-panel')) {
        renderResponsiveMatrixPanel(currentBuffer);
    }
    const p13 = document.getElementById('pane13');
    if (p13 && !p13.classList.contains('hidden-panel')) {
        renderLayoutInspectorPanel(currentDocument);
    }
}

export function exportRcFile() {
    if (!currentBuffer) {
        alert('No binary .rc buffer to download.');
        return;
    }
    const blob = new Blob([currentBuffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'document.rc';
    a.click();
    URL.revokeObjectURL(url);
}

export function fetchArrayBuffer(url) {
    return new Promise((resolve, reject) => {
        fetch(url).then(resp => {
            if (resp.ok) return resp.arrayBuffer();
            throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
        }).then(buf => resolve(buf)).catch(fetchErr => {
            // Fallback to XMLHttpRequest for file:// protocol or local CORS
            try {
                const xhr = new XMLHttpRequest();
                xhr.open('GET', url, true);
                xhr.responseType = 'arraybuffer';
                xhr.onload = function() {
                    if (xhr.status === 200 || (xhr.status === 0 && xhr.response && xhr.response.byteLength > 0)) {
                        resolve(xhr.response);
                    } else {
                        reject(fetchErr);
                    }
                };
                xhr.onerror = function() {
                    reject(fetchErr);
                };
                xhr.send();
            } catch (xhrErr) {
                reject(fetchErr);
            }
        });
    });
}

export async function loadDocumentFromUrlParam() {
    let targetUrl = null;
    try {
        // 1. Check Query String
        if (window.location.search && window.location.search.length > 1) {
            const searchStr = window.location.search.slice(1);
            try {
                const params = new URLSearchParams(window.location.search);
                targetUrl = params.get('url') || params.get('file') || params.get('rc') || params.get('doc') || params.get('src') || params.get('rc_url') || params.get('path') || params.get('uri');
            } catch (e) {}

            if (!targetUrl) {
                if (searchStr.startsWith('http://') || searchStr.startsWith('https://') || searchStr.startsWith('/') || searchStr.startsWith('./') || searchStr.startsWith('../') || searchStr.includes('.rc') || searchStr.includes('.json')) {
                    targetUrl = searchStr;
                }
            }
        }

        // 2. Check Hash
        if (!targetUrl && window.location.hash && window.location.hash.length > 1) {
            const hashStr = window.location.hash.slice(1);
            if (hashStr.startsWith('url=') || hashStr.startsWith('file=') || hashStr.startsWith('doc=') || hashStr.startsWith('rc=') || hashStr.startsWith('src=')) {
                try {
                    const params = new URLSearchParams(hashStr);
                    targetUrl = params.get('url') || params.get('file') || params.get('doc') || params.get('rc') || params.get('src');
                } catch (e) {}
            }
            if (!targetUrl) {
                if (hashStr.startsWith('http://') || hashStr.startsWith('https://') || hashStr.startsWith('/') || hashStr.startsWith('./') || hashStr.startsWith('../') || hashStr.includes('.rc') || hashStr.includes('.json')) {
                    targetUrl = hashStr;
                }
            }
        }

        if (!targetUrl) return;

        try {
            targetUrl = decodeURIComponent(targetUrl);
        } catch (e) {}

        const badge = document.getElementById('fileStatusBadge');
        const rawName = targetUrl.split('/').pop().split('?')[0] || 'remote.rc';
        if (badge) {
            badge.textContent = `Fetching ${rawName}...`;
            badge.style.background = 'rgba(56, 189, 248, 0.15)';
            badge.style.color = 'var(--accent-blue)';
            badge.title = `Loading from URL: ${targetUrl}`;
        }

        // Remove previous error banner if any
        const existingBanner = document.getElementById('urlErrorBanner');
        if (existingBanner) existingBanner.remove();

        const buffer = await fetchArrayBuffer(targetUrl);
        const filename = rawName;

        if (filename.endsWith('.json')) {
            const text = new TextDecoder().decode(buffer);
            try {
                const parsed = JSON.parse(text);
                compileAndLoadJson(parsed, filename);
                return;
            } catch (e) {
                console.warn('JSON parse error, falling back to binary .rc reader', e);
            }
        }

        await loadRcArrayBuffer(buffer, filename);
    } catch (err) {
        console.error(`Failed to load document from URL "${targetUrl}":`, err);
        const rawName = targetUrl ? (targetUrl.split('/').pop().split('?')[0] || targetUrl) : 'URL';
        const errMsg = err.message || String(err);
        
        const badge = document.getElementById('fileStatusBadge');
        if (badge) {
            badge.textContent = `❌ ${errMsg} (${rawName})`;
            badge.style.background = 'rgba(239, 68, 68, 0.2)';
            badge.style.color = 'var(--accent-rose)';
            badge.title = `Failed to fetch URL: ${targetUrl}\nError: ${errMsg}\nCheck network, CORS headers, or file path. Click to browse local files.`;
        }

        // Show detailed error banner inside drop zone
        const dropZoneBody = document.getElementById('dropZoneBody') || document.getElementById('dropZone');
        if (dropZoneBody && targetUrl) {
            const isCors = errMsg.toLowerCase().includes('failed to fetch') || errMsg.toLowerCase().includes('network') || errMsg.toLowerCase().includes('cors');
            const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            const bannerHtml = `
                <div id="urlErrorBanner" style="margin: 8px 0; padding: 12px 14px; background: rgba(239,68,68,0.12); border: 1px solid var(--accent-rose); border-radius: 6px; color: var(--accent-rose); font-size: 0.8rem; text-align: left;">
                    <div style="font-weight: 600; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
                        <span>⚠️ Failed to fetch RemoteCompose document</span>
                        <button onclick="document.getElementById('urlErrorBanner')?.remove()" style="background:none; border:none; color:var(--accent-rose); cursor:pointer; font-size:1rem; padding:0 4px;">✕</button>
                    </div>
                    <div style="word-break: break-all; margin-bottom: 4px; color: var(--text-primary);"><strong>Requested URL:</strong> <code style="color:var(--accent-blue);">${esc(targetUrl)}</code></div>
                    <div style="margin-bottom: 6px;"><strong>Error Detail:</strong> <span style="font-family:var(--code-font);">${esc(errMsg)}</span></div>
                    <div style="font-size: 0.72rem; color: var(--text-muted); line-height: 1.4; border-top: 1px dashed rgba(239,68,68,0.3); padding-top: 6px;">
                        ${isCors ? '💡 <strong>CORS / Network restriction:</strong> If fetching across domains, the server must provide <code>Access-Control-Allow-Origin: *</code> headers. If opening locally via <code>file://</code>, local cross-file requests may be restricted by your browser. You can drag and drop the file directly into this drop box.' : '💡 Please check that the URL is accessible and points to a valid <code>.rc</code> binary or <code>.json</code> file.'}
                    </div>
                </div>
            `;
            dropZoneBody.insertAdjacentHTML('afterbegin', bannerHtml);
        }
    }
}

if (typeof window !== 'undefined') {
    window.processFile = processFile;
    window.handleFileSelect = handleFileSelect;
    window.loadRcArrayBuffer = loadRcArrayBuffer;
    window.exportRcFile = exportRcFile;
    window.fetchArrayBuffer = fetchArrayBuffer;
    window.loadDocumentFromUrlParam = loadDocumentFromUrlParam;
    window.getAllOperationsFlat = getAllOperationsFlat;
}
