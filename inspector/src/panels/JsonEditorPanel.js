// =========================================================================
// Panel 4: JSON Editor & Decompiler Panel
// Modularized in src/panels/JsonEditorPanel.js
// Handles CodeMirror JSON source editing, bidirectional compilation,
// document decompilation to JSON, and sample demo loading.
// =========================================================================

import {
    getOpName,
    getEffectiveChildren
} from './CommandListPanel.js';

export let jsonEditor = null;

export function refreshJsonEditor() {
    if (jsonEditor) {
        jsonEditor.refresh();
    }
}

export const SAMPLE_DEMOS = window.SAMPLE_DEMOS || {
    interactive: {
        name: 'interactive_demo.rc',
        json: {
            header: { width: 300, height: 300 },
            root: {
                type: "BoxLayout",
                id: 0,
                modifiers: [
                    "WidthModifier(0, 300)",
                    "HeightModifier(0, 300)",
                    "BackgroundModifier(4294967295)"
                ],
                children: [
                    {
                        type: "ColumnLayout",
                        id: 1,
                        modifiers: [
                            "WidthModifier(1, 0)",
                            "HeightModifier(1, 0)",
                            "PaddingModifier(20, 20, 20, 20)"
                        ],
                        children: [
                            {
                                type: "CoreText",
                                id: 2,
                                text: "RemoteCompose Live Editor"
                            }
                        ]
                    }
                ]
            }
        }
    }
};

export function initJsonEditor() {
    const textarea = document.getElementById('jsonTextarea');
    if (typeof CodeMirror !== 'undefined' && textarea && !jsonEditor) {
        jsonEditor = CodeMirror.fromTextArea(textarea, {
            mode: { name: "javascript", json: true },
            theme: "dracula",
            lineNumbers: true,
            foldGutter: true,
            gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter"],
            matchBrackets: true,
            autoCloseBrackets: true,
            tabSize: 2,
            lineWrapping: true
        });
        jsonEditor.setSize("100%", "100%");
    }
}

export function getJsonInputValue() {
    if (jsonEditor) return jsonEditor.getValue();
    const textarea = document.getElementById('jsonTextarea');
    return textarea ? textarea.value : '';
}

export function setJsonInputValue(val) {
    if (jsonEditor) {
        jsonEditor.setValue(val);
        setTimeout(() => jsonEditor.refresh(), 50);
    } else {
        const textarea = document.getElementById('jsonTextarea');
        if (textarea) textarea.value = val;
    }
}

export function formatJsonInput() {
    const raw = getJsonInputValue();
    if (!raw.trim()) return;
    try {
        const parsed = JSON.parse(raw);
        const formatted = JSON.stringify(parsed, null, 2);
        setJsonInputValue(formatted);
        showCompileStatus("✨ JSON formatted successfully", true);
    } catch (err) {
        showCompileStatus(`❌ JSON Format Error: ${err.message}`, false);
    }
}

export function copyJsonInput() {
    const raw = getJsonInputValue();
    if (!raw) return;
    navigator.clipboard.writeText(raw).then(() => {
        showCompileStatus("📋 JSON copied to clipboard!", true);
    }).catch(err => {
        showCompileStatus(`❌ Copy failed: ${err}`, false);
    });
}

export function recompileJsonInput() {
    const text = getJsonInputValue();
    try {
        const jsonObj = JSON.parse(text);
        compileAndLoadJson(jsonObj, 'custom.rc');
    } catch (err) {
        showCompileStatus(`❌ JSON Syntax Error: ${err.message}`, false);
    }
}

export function loadSelectedDemo(key = 'interactive') {
    const demoKey = key || 'interactive';
    if (!SAMPLE_DEMOS[demoKey]) return;

    const demo = SAMPLE_DEMOS[demoKey];
    compileAndLoadJson(demo.json, demo.name);
}

export function decompileDocumentToJson(doc) {
    if (!doc) return {};
    const docWidth = doc.getWidth ? doc.getWidth() : 300;
    const docHeight = doc.getHeight ? doc.getHeight() : 300;

    const isContainerOp = typeof window.isContainerOp === 'function' ? window.isContainerOp : (op => {
        if (!op) return false;
        const name = getOpName(op);
        return typeof op.getList === 'function' && 
               name !== 'ContainerEnd' && name !== 'Mi' && op.OP_CODE !== 214 &&
               name !== 'LayoutComponentContent' && op.OP_CODE !== 201 &&
               name !== 'CanvasContent' && op.OP_CODE !== 207;
    });

    const isModifierOp = typeof window.isModifierOp === 'function' ? window.isModifierOp : (op => {
        if (!op) return false;
        const name = getOpName(op);
        return name.includes('Modifier') || (op.OP_CODE >= 50 && op.OP_CODE <= 90);
    });

    function decompileNode(op) {
        if (!op) return null;
        const name = getOpName(op);
        if (name === 'LayoutComponentContent' || op.OP_CODE === 201 || name === 'CanvasContent' || op.OP_CODE === 207) return null;
        const node = { type: name };

        if (typeof op.getId === 'function') {
            const id = op.getId();
            if (id !== undefined && id !== null) node.id = id;
        }

        const text = op.mText || (op.mTextId ? doc.getText(op.mTextId) : null);
        if (text) node.text = text;

        const children = getEffectiveChildren(op);
        const childComponents = [];
        const modifiers = [];
        const drawOps = [];

        children.forEach(child => {
            const cName = getOpName(child);
            if (cName === 'ContainerEnd' || cName === 'Mi') return;

            if (isContainerOp(child)) {
                const childJson = decompileNode(child);
                if (childJson) childComponents.push(childJson);
            } else if (isModifierOp(child)) {
                const modDesc = typeof child.deepToString === 'function' ? child.deepToString("").trim() : cName;
                modifiers.push(modDesc || cName);
            } else {
                const dDesc = typeof child.deepToString === 'function' ? child.deepToString("").trim() : cName;
                drawOps.push(dDesc || cName);
            }
        });

        if (modifiers.length > 0) node.modifiers = modifiers;
        if (childComponents.length > 0) node.children = childComponents;
        if (drawOps.length > 0) node.drawOperations = drawOps;

        return node;
    }

    const rootLayout = typeof doc.getRootLayoutComponent === 'function' ? doc.getRootLayoutComponent() : (doc.mRootLayoutComponent || null);
    const topOps = (typeof doc.getOperations === 'function' ? doc.getOperations() : doc.mOperations) || [];

    let rootNode = null;
    if (rootLayout) {
        rootNode = decompileNode(rootLayout);
    } else if (topOps.length > 0) {
        const containers = topOps.filter(op => isContainerOp(op)).map(op => decompileNode(op)).filter(Boolean);
        rootNode = containers.length === 1 ? containers[0] : (containers.length > 0 ? containers : null);
    }

    return {
        header: { width: docWidth, height: docHeight },
        root: rootNode || { type: "CanvasContent" }
    };
}

export function compileAndLoadJson(jsonObj, name) {
    try {
        if (typeof RemoteComposeSerializer === 'undefined') {
            showCompileStatus('❌ RemoteComposeSerializer runtime not loaded.', false);
            return;
        }
        const serializer = new RemoteComposeSerializer();
        const u8 = serializer.serialize(jsonObj);
        const buf = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
        showCompileStatus(`✓ Compiled ${u8.length} B binary stream`, true);
        if (typeof window.loadRcArrayBuffer === 'function') {
            window.loadRcArrayBuffer(buf, name || 'compiled.rc', jsonObj);
        }
    } catch (err) {
        showCompileStatus(`❌ Serialization Error: ${err.message}`, false);
    }
}

export function showCompileStatus(msg, isSuccess) {
    const el = document.getElementById('compileStatusMsg');
    if (!el) return;
    el.style.color = isSuccess ? 'var(--accent-emerald)' : 'var(--accent-rose)';
    el.textContent = msg;
}

// Global window mappings for HTML event handlers
window.initJsonEditor = initJsonEditor;
window.getJsonInputValue = getJsonInputValue;
window.setJsonInputValue = setJsonInputValue;
window.formatJsonInput = formatJsonInput;
window.copyJsonInput = copyJsonInput;
window.recompileJsonInput = recompileJsonInput;
window.loadSelectedDemo = loadSelectedDemo;
window.decompileDocumentToJson = decompileDocumentToJson;
window.compileAndLoadJson = compileAndLoadJson;
window.showCompileStatus = showCompileStatus;
