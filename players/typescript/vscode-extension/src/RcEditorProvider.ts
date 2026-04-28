import * as vscode from 'vscode';

export class RcEditorProvider implements vscode.CustomReadonlyEditorProvider {

    static readonly viewType = 'rc.preview';

    static register(context: vscode.ExtensionContext): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(
            RcEditorProvider.viewType,
            new RcEditorProvider(context),
            { supportsMultipleEditorsPerDocument: true }
        );
    }

    constructor(private readonly context: vscode.ExtensionContext) {}

    openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
        return { uri, dispose() {} };
    }

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
    ): Promise<void> {
        const webview = webviewPanel.webview;
        webview.options = { enableScripts: true };

        const bundleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', 'rc-bundle.js')
        );
        const rc2jsonUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'media', 'rc2json-bundle.js')
        );

        const theme = this.getTheme();

        webview.html = this.getHtml(bundleUri, rc2jsonUri, theme);

        // Send the file data once the webview is ready
        const sendFileData = async () => {
            const data = await vscode.workspace.fs.readFile(document.uri);
            const base64 = Buffer.from(data).toString('base64');
            webview.postMessage({ type: 'load', data: base64 });
        };

        // The webview posts 'ready' when its JS has loaded
        webview.onDidReceiveMessage(msg => {
            if (msg.type === 'ready') {
                sendFileData();
            }
        });

        // Watch for file changes on disk
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(document.uri, '*')
        );
        const onFileChange = (changedUri: vscode.Uri) => {
            if (changedUri.toString() === document.uri.toString()) {
                sendFileData();
            }
        };
        watcher.onDidChange(onFileChange);
        watcher.onDidCreate(onFileChange);

        // Listen for theme changes
        const themeDisposable = vscode.window.onDidChangeActiveColorTheme(() => {
            webview.postMessage({ type: 'theme', value: this.getTheme() });
        });

        webviewPanel.onDidDispose(() => {
            watcher.dispose();
            themeDisposable.dispose();
        });
    }

    private getTheme(): 'light' | 'dark' {
        const kind = vscode.window.activeColorTheme.kind;
        return (kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight)
            ? 'light' : 'dark';
    }

    private getHtml(bundleUri: vscode.Uri, rc2jsonUri: vscode.Uri, theme: 'light' | 'dark'): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: auto; }
    body {
        display: flex;
        flex-direction: column;
        background: var(--vscode-editor-background, #1e1e1e);
        min-height: 100%;
    }

    /* Toolbar */
    #toolbar {
        display: flex;
        gap: 4px;
        padding: 6px 12px;
        border-bottom: 1px solid var(--vscode-panel-border, #444);
        background: var(--vscode-editorGroupHeader-tabsBackground, #252526);
        flex-shrink: 0;
    }
    .tab-btn {
        font: 12px var(--vscode-font-family, sans-serif);
        color: var(--vscode-foreground, #ccc);
        background: none;
        border: 1px solid transparent;
        border-radius: 3px;
        padding: 3px 12px;
        cursor: pointer;
    }
    .tab-btn:hover { background: var(--vscode-toolbar-hoverBackground, #333); }
    .tab-btn.active {
        color: var(--vscode-textLink-foreground, #3794ff);
        border-color: var(--vscode-textLink-foreground, #3794ff);
    }

    /* Visual view */
    #visual-view {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 0;
    }
    #wrapper {
        position: relative;
        border: 1px solid var(--vscode-panel-border, #444);
    }
    #container {
        display: block;
        overflow: hidden;
    }
    canvas { display: block; }

    /* JSON view */
    #json-view {
        flex: 1;
        display: none;
        overflow: auto;
        padding: 12px;
        min-height: 0;
    }
    #json-pre {
        font: 13px/1.5 var(--vscode-editor-fontFamily, 'Menlo', monospace);
        color: var(--vscode-editor-foreground, #d4d4d4);
        white-space: pre-wrap;
        word-break: break-all;
        tab-size: 2;
    }
    /* JSON syntax highlighting */
    .json-key { color: var(--vscode-symbolIcon-propertyForeground, #9cdcfe); }
    .json-str { color: var(--vscode-symbolIcon-stringForeground, #ce9178); }
    .json-num { color: var(--vscode-symbolIcon-numberForeground, #b5cea8); }
    .json-bool { color: var(--vscode-symbolIcon-booleanForeground, #569cd6); }
    .json-null { color: var(--vscode-symbolIcon-nullForeground, #569cd6); }

    /* Content area: wraps main view + vars panel */
    #content {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
    }
    #content.layout-side {
        flex-direction: row;
    }

    /* Variables panel */
    #vars-view {
        display: none;
        flex-direction: column;
        overflow: auto;
        padding: 8px 12px;
        flex-shrink: 0;
    }
    /* Bottom layout (default) */
    #content:not(.layout-side) > #vars-view {
        max-height: 40vh;
        border-top: 1px solid var(--vscode-panel-border, #444);
    }
    /* Side layout */
    #content.layout-side > #vars-view {
        max-width: 40vw;
        min-width: 200px;
        border-left: 1px solid var(--vscode-panel-border, #444);
        max-height: none;
    }
    #pause-btn, #layout-btn {
        font: 12px var(--vscode-font-family, sans-serif);
        color: var(--vscode-button-foreground, #fff);
        background: var(--vscode-button-background, #0e639c);
        border: none;
        border-radius: 3px;
        padding: 3px 12px;
        cursor: pointer;
    }
    #pause-btn:hover, #layout-btn:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
    #vars-table {
        width: 100%;
        border-collapse: collapse;
        font: 13px/1.5 var(--vscode-editor-fontFamily, 'Menlo', monospace);
        color: var(--vscode-editor-foreground, #d4d4d4);
    }
    #vars-table th {
        text-align: left;
        padding: 4px 12px;
        border-bottom: 2px solid var(--vscode-panel-border, #444);
        color: var(--vscode-foreground, #ccc);
        font-weight: 600;
        position: sticky;
        top: 0;
        background: var(--vscode-editor-background, #1e1e1e);
    }
    #vars-table td {
        padding: 2px 12px;
        border-bottom: 1px solid var(--vscode-panel-border, #333);
        white-space: nowrap;
    }
    #vars-table td:first-child { text-align: right; }
    #vars-table td:last-child { font-variant-numeric: tabular-nums; }
    .toggle-btn.active {
        color: var(--vscode-textLink-foreground, #3794ff);
        border-color: var(--vscode-textLink-foreground, #3794ff);
    }

    /* Panel sub-tabs */
    #panel-toolbar {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-bottom: 4px;
        flex-shrink: 0;
    }
    .panel-tab-btn {
        font: 11px var(--vscode-font-family, sans-serif);
        color: var(--vscode-foreground, #ccc);
        background: none;
        border: 1px solid transparent;
        border-radius: 3px;
        padding: 2px 10px;
        cursor: pointer;
    }
    .panel-tab-btn:hover { background: var(--vscode-toolbar-hoverBackground, #333); }
    .panel-tab-btn.active {
        color: var(--vscode-textLink-foreground, #3794ff);
        border-color: var(--vscode-textLink-foreground, #3794ff);
    }
    #panel-vars, #panel-cmds {
        flex: 1;
        overflow: auto;
        min-height: 0;
    }
    #panel-cmds { display: none; }
    #cmds-table {
        width: 100%;
        border-collapse: collapse;
        font: 13px/1.5 var(--vscode-editor-fontFamily, 'Menlo', monospace);
        color: var(--vscode-editor-foreground, #d4d4d4);
    }
    #cmds-table th {
        text-align: left;
        padding: 4px 12px;
        border-bottom: 2px solid var(--vscode-panel-border, #444);
        color: var(--vscode-foreground, #ccc);
        font-weight: 600;
        position: sticky;
        top: 0;
        background: var(--vscode-editor-background, #1e1e1e);
    }
    #cmds-table td {
        padding: 2px 12px;
        border-bottom: 1px solid var(--vscode-panel-border, #333);
        white-space: nowrap;
    }
    #cmds-table td:first-child { text-align: right; }

    /* Resize handles */
    .handle {
        position: absolute;
        z-index: 10;
    }
    .handle-right {
        top: 0; right: -5px;
        width: 10px; height: 100%;
        cursor: ew-resize;
    }
    .handle-bottom {
        bottom: -5px; left: 0;
        width: 100%; height: 10px;
        cursor: ns-resize;
    }
    .handle-corner {
        right: -5px; bottom: -5px;
        width: 16px; height: 16px;
        cursor: nwse-resize;
    }
    /* Corner grip dots */
    .handle-corner::after {
        content: '';
        position: absolute;
        right: 3px; bottom: 3px;
        width: 8px; height: 8px;
        background:
            radial-gradient(circle, var(--vscode-descriptionForeground, #888) 1.5px, transparent 1.5px) 0 0 / 4px 4px;
    }
    /* Highlight on hover */
    .handle-right:hover, .handle-right.active { background: var(--vscode-focusBorder, #007fd4); opacity: 0.5; }
    .handle-bottom:hover, .handle-bottom.active { background: var(--vscode-focusBorder, #007fd4); opacity: 0.5; }
    .handle-corner:hover, .handle-corner.active { background: var(--vscode-focusBorder, #007fd4); opacity: 0.5; border-radius: 2px; }

    #status {
        position: absolute;
        bottom: -20px;
        right: 0;
        font: 11px var(--vscode-font-family, sans-serif);
        color: var(--vscode-descriptionForeground, #888);
        white-space: nowrap;
        pointer-events: none;
    }
    #reset-btn {
        position: absolute;
        bottom: -21px;
        left: 0;
        font: 11px var(--vscode-font-family, sans-serif);
        color: var(--vscode-textLink-foreground, #3794ff);
        background: none;
        border: none;
        cursor: pointer;
        padding: 0;
    }
    #reset-btn:hover { text-decoration: underline; }
</style>
</head>
<body>
<div id="toolbar">
    <button class="tab-btn active" data-view="visual">Visual</button>
    <button class="tab-btn" data-view="json">JSON</button>
    <span style="flex:1"></span>
    <button class="tab-btn toggle-btn active" id="vars-toggle">Panel</button>
</div>
<div id="content" class="layout-side">
    <div id="visual-view">
        <div id="wrapper">
            <div id="container"></div>
            <div class="handle handle-right" data-dir="e"></div>
            <div class="handle handle-bottom" data-dir="s"></div>
            <div class="handle handle-corner" data-dir="se"></div>
            <button id="reset-btn">Fill</button>
            <div id="status"></div>
        </div>
    </div>
    <div id="json-view">
        <pre id="json-pre"></pre>
    </div>
    <div id="vars-view" style="display:flex">
        <div id="panel-toolbar">
            <button class="panel-tab-btn active" data-panel="vars">Variables</button>
            <button class="panel-tab-btn" data-panel="cmds">Commands</button>
            <span style="flex:1"></span>
            <button id="pause-btn">Pause</button>
            <button id="layout-btn" title="Toggle bottom / side-by-side layout">Bottom</button>
        </div>
        <div id="panel-vars">
            <table id="vars-table">
                <thead><tr><th>ID</th><th>Name</th><th>Value</th></tr></thead>
                <tbody id="vars-tbody"></tbody>
            </table>
        </div>
        <div id="panel-cmds">
            <table id="cmds-table">
                <thead><tr><th>#</th><th>Name</th><th>Arguments</th></tr></thead>
                <tbody id="cmds-tbody"></tbody>
            </table>
        </div>
    </div>
</div>
<script src="${bundleUri}"></script>
<script src="${rc2jsonUri}"></script>
<script>
(function() {
    const vscode = acquireVsCodeApi();
    const wrapper = document.getElementById('wrapper');
    const container = document.getElementById('container');
    const status = document.getElementById('status');
    const resetBtn = document.getElementById('reset-btn');
    const visualView = document.getElementById('visual-view');
    const jsonView = document.getElementById('json-view');
    const jsonPre = document.getElementById('json-pre');
    const varsView = document.getElementById('vars-view');
    const varsTbody = document.getElementById('vars-tbody');
    const pauseBtn = document.getElementById('pause-btn');
    const varsToggle = document.getElementById('vars-toggle');
    const contentEl = document.getElementById('content');
    const layoutBtn = document.getElementById('layout-btn');
    const panelVars = document.getElementById('panel-vars');
    const panelCmds = document.getElementById('panel-cmds');
    const cmdsTbody = document.getElementById('cmds-tbody');
    let handle = null;
    let currentTheme = '${theme}';
    let isFillMode = true;
    let cachedJsonHtml = null;
    let currentView = 'visual';
    let varsVisible = true;
    let varsIsPaused = false;
    let varsLastUpdate = 0;
    let varsLayout = 'side';
    let activePanel = 'vars';

    // --- Variables listener ---
    function varsListenerCb(entries) {
        var now = performance.now();
        if (now - varsLastUpdate < 150) return;
        varsLastUpdate = now;
        var nameMap = null;
        var ctx = handle && handle.player.getRemoteContext();
        if (ctx && ctx.getVariableNameMap) {
            nameMap = ctx.getVariableNameMap();
        }
        entries.sort(function(a, b) { return a[0] - b[0]; });
        var html = '';
        for (var i = 0; i < entries.length; i++) {
            var id = entries[i][0];
            var val = entries[i][1];
            var name = nameMap ? (nameMap.get(id) || '') : '';
            var displayVal = (val === Math.floor(val)) ? val.toString() : val.toFixed(6);
            html += '<tr><td>' + id + '</td><td>' + name + '</td><td>' + displayVal + '</td></tr>';
        }
        varsTbody.innerHTML = html;
    }

    function attachVarsListener() {
        if (handle && handle.player) {
            handle.player.setVariableListener(varsListenerCb);
        }
    }

    function detachVarsListener() {
        if (handle && handle.player) {
            handle.player.removeVariableListener();
        }
    }

    // --- Panel toggle (independent of Visual/JSON tabs) ---
    varsToggle.addEventListener('click', function() {
        varsVisible = !varsVisible;
        varsToggle.classList.toggle('active', varsVisible);
        varsView.style.display = varsVisible ? 'flex' : 'none';
        if (varsVisible && activePanel === 'vars' && !varsIsPaused) {
            attachVarsListener();
        } else {
            detachVarsListener();
        }
        if (isFillMode) fillViewport();
    });

    // --- Panel sub-tab switching ---
    document.querySelectorAll('.panel-tab-btn[data-panel]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var panel = btn.dataset.panel;
            if (panel === activePanel) return;
            activePanel = panel;
            document.querySelectorAll('.panel-tab-btn[data-panel]').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            panelVars.style.display = (panel === 'vars') ? 'block' : 'none';
            panelCmds.style.display = (panel === 'cmds') ? 'block' : 'none';
            pauseBtn.style.display = (panel === 'vars') ? 'inline-block' : 'none';
            // Manage vars listener based on active panel
            if (panel === 'vars' && varsVisible && !varsIsPaused) {
                attachVarsListener();
            } else if (panel !== 'vars') {
                detachVarsListener();
            }
        });
    });

    // --- Build commands table from RC2JSON output ---
    function buildCommandsTable(json) {
        if (!json || !json.operations) return;
        var rows = [];
        function walk(ops, depth) {
            if (!ops) return;
            for (var i = 0; i < ops.length; i++) {
                var op = ops[i];
                var name = op.op || '?';
                var indent = '';
                for (var d = 0; d < depth; d++) indent += '\\u00a0\\u00a0';
                var args = [];
                for (var key in op) {
                    if (key === 'op' || key === 'opcode' || key === '_children') continue;
                    var val = op[key];
                    if (typeof val === 'string') {
                        var display = val.length > 40 ? val.substring(0, 37) + '...' : val;
                        args.push(key + '="' + display.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '"');
                    } else if (typeof val === 'object' && val !== null) {
                        args.push(key + '=' + JSON.stringify(val));
                    } else {
                        args.push(key + '=' + val);
                    }
                }
                rows.push({ depth: depth, name: name, args: args.join(', '), indent: indent });
                if (op._children) {
                    walk(op._children, depth + 1);
                }
            }
        }
        walk(json.operations, 0);
        var html = '';
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            html += '<tr><td>' + i + '</td><td>' + r.indent + r.name + '</td><td>' + r.args + '</td></tr>';
        }
        cmdsTbody.innerHTML = html;
    }

    // --- View toggle (Visual / JSON tabs) ---
    document.querySelectorAll('.tab-btn[data-view]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var view = btn.dataset.view;
            if (view === currentView) return;
            currentView = view;
            document.querySelectorAll('.tab-btn[data-view]').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            if (view === 'json') {
                visualView.style.display = 'none';
                jsonView.style.display = 'block';
                if (cachedJsonHtml) jsonPre.innerHTML = cachedJsonHtml;
            } else {
                jsonView.style.display = 'none';
                visualView.style.display = 'flex';
            }
        });
    });

    // --- Pause/Resume ---
    pauseBtn.addEventListener('click', function() {
        varsIsPaused = !varsIsPaused;
        pauseBtn.textContent = varsIsPaused ? 'Resume' : 'Pause';
        if (varsIsPaused) {
            detachVarsListener();
        } else if (varsVisible) {
            attachVarsListener();
        }
    });

    // --- Layout toggle (bottom / side-by-side) ---
    layoutBtn.addEventListener('click', function() {
        if (varsLayout === 'bottom') {
            varsLayout = 'side';
            contentEl.classList.add('layout-side');
            layoutBtn.textContent = 'Bottom';
        } else {
            varsLayout = 'bottom';
            contentEl.classList.remove('layout-side');
            layoutBtn.textContent = 'Side';
        }
        if (isFillMode) fillViewport();
    });

    // --- JSON syntax highlighting ---
    function highlightJson(jsonStr) {
        return jsonStr.replace(
            /("(?:\\\\.|[^"\\\\])*")\s*:/g,
            '<span class="json-key">$1</span>:'
        ).replace(
            /:\s*("(?:\\\\.|[^"\\\\])*")/g,
            function(m, val) { return ': <span class="json-str">' + val + '</span>'; }
        ).replace(
            /:\s*(-?\\d+\\.?\\d*(?:[eE][+-]?\\d+)?)/g,
            ': <span class="json-num">$1</span>'
        ).replace(
            /:\s*(true|false)/g,
            ': <span class="json-bool">$1</span>'
        ).replace(
            /:\s*(null)/g,
            ': <span class="json-null">$1</span>'
        );
    }

    function base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    function updateStatus(w, h) {
        status.textContent = Math.round(w) + ' x ' + Math.round(h);
    }

    function applySize(w, h) {
        container.style.width = w + 'px';
        container.style.height = h + 'px';
        if (handle) handle.resize(w, h);
        updateStatus(w, h);
    }

    function fillViewport() {
        isFillMode = true;
        resetBtn.style.display = 'none';
        var rect = visualView.getBoundingClientRect();
        var vw = rect.width - 40;
        var vh = rect.height - 40;
        applySize(Math.max(vw, 100), Math.max(vh, 100));
    }

    function initPlayer() {
        handle = RC.createPlayer(container, {
            theme: currentTheme,
            onLoad: function(doc) {
                var w = container.clientWidth;
                var h = container.clientHeight;
                updateStatus(w, h);
            }
        });
        fillViewport();
    }

    initPlayer();

    // Observe container for external size changes
    var ro = new ResizeObserver(function(entries) {
        if (!handle) return;
        var entry = entries[0];
        var w = Math.floor(entry.contentRect.width);
        var h = Math.floor(entry.contentRect.height);
        if (w > 0 && h > 0) {
            handle.resize(w, h);
            updateStatus(w, h);
        }
    });
    ro.observe(container);

    // In fill mode, track viewport resizes
    window.addEventListener('resize', function() {
        if (isFillMode) fillViewport();
    });

    // Reset button
    resetBtn.addEventListener('click', function() {
        fillViewport();
    });

    // --- Drag resize handles ---
    var handles = document.querySelectorAll('.handle');
    handles.forEach(function(el) {
        el.addEventListener('pointerdown', function(e) {
            e.preventDefault();
            e.stopPropagation();
            var dir = el.dataset.dir;
            var startX = e.clientX;
            var startY = e.clientY;
            var startW = container.clientWidth;
            var startH = container.clientHeight;
            el.classList.add('active');
            el.setPointerCapture(e.pointerId);

            function onMove(ev) {
                var dx = ev.clientX - startX;
                var dy = ev.clientY - startY;
                var newW = startW;
                var newH = startH;
                if (dir === 'e' || dir === 'se') newW = Math.max(50, startW + dx);
                if (dir === 's' || dir === 'se') newH = Math.max(50, startH + dy);
                applySize(newW, newH);
                if (isFillMode) {
                    isFillMode = false;
                    resetBtn.style.display = '';
                }
            }

            function onUp() {
                el.classList.remove('active');
                el.removeEventListener('pointermove', onMove);
                el.removeEventListener('pointerup', onUp);
            }

            el.addEventListener('pointermove', onMove);
            el.addEventListener('pointerup', onUp);
        });
    });

    // Messages from extension host
    window.addEventListener('message', function(event) {
        var msg = event.data;
        if (msg.type === 'load') {
            var buf = base64ToArrayBuffer(msg.data);
            handle.loadFromArrayBuffer(buf);

            // Attach vars listener on first load if panel is visible
            if (varsVisible && activePanel === 'vars' && !varsIsPaused) {
                attachVarsListener();
            }

            // Generate JSON view + Commands table
            try {
                var json = RC2JSON.rc2json(buf);
                var jsonStr = JSON.stringify(json, null, 2);
                cachedJsonHtml = highlightJson(jsonStr.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'));
                if (currentView === 'json') jsonPre.innerHTML = cachedJsonHtml;
                buildCommandsTable(json);
            } catch (e) {
                cachedJsonHtml = '<span style="color:red">Error: ' + e.message + '</span>';
                if (currentView === 'json') jsonPre.innerHTML = cachedJsonHtml;
            }
        } else if (msg.type === 'theme') {
            currentTheme = msg.value;
            handle.player.setTheme(msg.value);
        }
    });

    // Signal ready
    vscode.postMessage({ type: 'ready' });
})();
</script>
</body>
</html>`;
    }
}
