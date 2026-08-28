#!/usr/bin/env node
// =========================================================================
// RemoteCompose Inspector MCP Server (Option A: Headless CDP Engine)
// Modularized Option A approach: Inspects RemoteCompose .rc binary files
// using Headless Chrome + dist/index.html without modifying the webpage client.
// Includes visual screenshot capture, hierarchical component tree decompiler,
// dead code analyzer, and empirical performance profiler tools.
// =========================================================================

import fs from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INSPECTOR_DIST_PATH = path.join(__dirname, 'dist', 'index.html');
const ARTIFACT_DIR = '/Users/nicolasroard/.gemini/jetski/brain/cca5ec88-b1f7-4f0d-9999-0bfb57a94b0a';

/**
 * Executes inspection, rendering, or performance profiling pipeline on RemoteCompose .rc document
 * using Headless Chrome CDP evaluation bridge.
 */
export async function inspectRcDocumentHeadless(rcFilePath, mode = 'inspect', options = {}) {
    if (!existsSync(INSPECTOR_DIST_PATH)) {
        throw new Error(`dist/index.html not found at ${INSPECTOR_DIST_PATH}. Run 'node build.mjs' first.`);
    }
    if (!existsSync(rcFilePath)) {
        throw new Error(`RemoteCompose file not found: ${rcFilePath}`);
    }

    const rcBuffer = readFileSync(rcFilePath);
    const rcBase64 = rcBuffer.toString('base64');
    const fileName = path.basename(rcFilePath);
    const byteSize = rcBuffer.length;
    const frameCount = Number(options.frameCount) || 60;
    const warmupFrames = Number(options.warmupFrames) || 10;

    const pythonScript = `
import subprocess, time, urllib.request, json, socket, base64, os

port_num = 9488 + int(time.time() * 1000) % 300
target_url = 'file://${INSPECTOR_DIST_PATH}'
chrome_cmd = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '--headless=new',
    f'--remote-debugging-port={port_num}',
    '--no-sandbox',
    '--disable-gpu',
    target_url
]
proc = subprocess.Popen(chrome_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(25):
        time.sleep(0.2)
        try:
            res = urllib.request.urlopen(f'http://localhost:{port_num}/json')
            break
        except Exception:
            pass
    targets = json.loads(res.read().decode())
    page_target = next((t for t in targets if t['type'] == 'page'), None)
    ws_url = page_target['webSocketDebuggerUrl']
    parts = ws_url.replace('ws://', '').split('/')
    host, port = parts[0].split(':')
    path = '/' + '/'.join(parts[1:])
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.connect((host, int(port)))
    key = base64.b64encode(os.urandom(16)).decode()
    req = (f'GET {path} HTTP/1.1\\r\\nHost: {host}:{port}\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Key: {key}\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n')
    s.sendall(req.encode('utf-8'))
    s.recv(4096)
    time.sleep(1.5)

    def send_cmd(msg_id, method, params=None):
        msg = json.dumps({'id': msg_id, 'method': method, 'params': params or {}}).encode('utf-8')
        length = len(msg)
        mask = os.urandom(4)
        masked = bytearray(length)
        for i in range(length): masked[i] = msg[i] ^ mask[i % 4]
        if length <= 125:
            hdr = bytearray([0x81, 0x80 | length])
        elif length <= 65535:
            hdr = bytearray([0x81, 0x80 | 126]) + length.to_bytes(2, 'big')
        else:
            hdr = bytearray([0x81, 0x80 | 127]) + length.to_bytes(8, 'big')
        s.sendall(hdr + mask + masked)
        s.settimeout(30.0)
        while True:
            head = s.recv(2)
            if not head or len(head) < 2: continue
            flen = head[1] & 0x7f
            if flen == 126:
                flen = int.from_bytes(s.recv(2), 'big')
            elif flen == 127:
                flen = int.from_bytes(s.recv(8), 'big')
            payload = bytearray()
            while len(payload) < flen:
                chunk = s.recv(min(flen - len(payload), 65536))
                if not chunk: break
                payload.extend(chunk)
            try:
                parsed = json.loads(payload.decode('utf-8', errors='ignore'))
                if parsed.get('id') == msg_id:
                    return parsed
            except Exception:
                pass

    b64 = """${rcBase64}"""
    file_name = """${fileName}"""
    byte_size = ${byteSize}
    mode = """${mode}"""
    frame_count = ${frameCount}
    warmup_frames = ${warmupFrames}

    expr = f'''
    (async () => {{
        try {{
            const bin = atob("{b64}");
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            await window.loadRcArrayBuffer(bytes.buffer, "{file_name}");

            const doc = window.currentDocument;
            const ops = window.currentParsedOps || [];
            const player = window.currentPlayer;

            if ("{mode}" === "decompile_tree") {{
                const decompiled = window.decompileDocumentToJson ? window.decompileDocumentToJson(doc) : null;
                return {{
                    fileName: "{file_name}",
                    fileSizeBytes: {byte_size},
                    dimensions: {{
                        width: doc && typeof doc.getWidth === 'function' ? doc.getWidth() : null,
                        height: doc && typeof doc.getHeight === 'function' ? doc.getHeight() : null
                    }},
                    totalOperations: ops.length,
                    componentTree: decompiled
                }};
            }}

            if ("{mode}" === "treemap") {{
                const treemapModel = window.currentTreemapModel;
                const catSummary = {{}};
                if (treemapModel && treemapModel.categories) {{
                    for (const [key, cat] of Object.entries(treemapModel.categories)) {{
                        if (cat.totalBytes > 0) {{
                            catSummary[key] = {{
                                name: cat.name,
                                icon: cat.icon,
                                totalBytes: cat.totalBytes,
                                pctOfTotal: Number(cat.pctOfTotal.toFixed(2)),
                                operationsCount: cat.ops.length
                            }};
                        }}
                    }}
                }}
                return {{
                    fileName: "{file_name}",
                    fileSizeBytes: {byte_size},
                    totalOperations: ops.length,
                    categoryBreakdown: catSummary,
                    topSpaceConsumers: treemapModel ? treemapModel.topConsumers.map(c => ({{
                        idx: c.idx,
                        name: c.name,
                        opCode: c.opCode,
                        hexCode: c.hexCode,
                        sizeBytes: c.sizeBytes,
                        pctOfTotal: Number(c.pctOfTotal.toFixed(2)),
                        category: c.category,
                        offsetRange: c.startHex + '..' + c.endHex
                    }})) : []
                }};
            }}

            if ("{mode}" === "screenshot") {{
                const canvas = document.getElementById("previewCanvas");
                if (canvas && typeof player !== 'undefined' && player) {{
                    if (typeof player.repaint === 'function') player.repaint();
                }}
                const dataUrl = canvas ? canvas.toDataURL("image/png") : null;
                return {{
                    fileName: "{file_name}",
                    fileSizeBytes: {byte_size},
                    dimensions: {{
                        width: canvas ? canvas.width : (doc ? doc.getWidth() : 300),
                        height: canvas ? canvas.height : (doc ? doc.getHeight() : 300)
                    }},
                    pngDataUrl: dataUrl
                }};
            }}

            if ("{mode}" === "profile") {{
                const measuredFramesCount = {frame_count};
                const warmupCount = {warmup_frames};
                const recordedOpsByType = new Map();
                const recordedOpsByInstance = new Map();
                let totalOpsMeasured = 0;

                if (player && typeof player.setMeasurementSink === 'function') {{
                    player.setMeasurementSink(m => {{
                        if (!m) return;
                        totalOpsMeasured += m.total;
                        if (Array.isArray(m.byType)) {{
                            for (const item of m.byType) {{
                                let entry = recordedOpsByType.get(item.key);
                                if (!entry) {{
                                    entry = {{ key: item.key, name: item.name, opCode: item.opCode, totalCount: 0, maxInSingleFrame: 0 }};
                                    recordedOpsByType.set(item.key, entry);
                                }}
                                entry.totalCount += item.count;
                                if (item.count > entry.maxInSingleFrame) entry.maxInSingleFrame = item.count;
                            }}
                        }}
                        if (Array.isArray(m.byInstance)) {{
                            for (const item of m.byInstance) {{
                                let entry = recordedOpsByInstance.get(item.id);
                                if (!entry) {{
                                    entry = {{ id: item.id, name: item.name, key: item.key, totalCount: 0, maxInSingleFrame: 0 }};
                                    recordedOpsByInstance.set(item.id, entry);
                                }}
                                entry.totalCount += item.count;
                                if (item.count > entry.maxInSingleFrame) entry.maxInSingleFrame = item.count;
                            }}
                        }}
                    }});
                }}

                // Warmup passes
                for (let f = 0; f < warmupCount; f++) {{
                    if (player && typeof player.repaint === 'function') player.repaint();
                }}

                // Reset counters before measured runs
                recordedOpsByType.clear();
                recordedOpsByInstance.clear();
                totalOpsMeasured = 0;

                // Measured benchmark runs
                const frameDurationsMs = [];
                const tStart = performance.now();
                for (let f = 0; f < measuredFramesCount; f++) {{
                    const fStart = performance.now();
                    if (player && typeof player.repaint === 'function') player.repaint();
                    const fEnd = performance.now();
                    frameDurationsMs.push(fEnd - fStart);
                }}
                const tTotal = performance.now() - tStart;

                if (player && typeof player.setMeasurementSink === 'function') {{
                    player.setMeasurementSink(null);
                }}

                frameDurationsMs.sort((a, b) => a - b);
                const sum = frameDurationsMs.reduce((acc, v) => acc + v, 0);
                const avgMs = measuredFramesCount > 0 ? (sum / measuredFramesCount) : 0;
                const minMs = frameDurationsMs[0] || 0;
                const maxMs = frameDurationsMs[frameDurationsMs.length - 1] || 0;
                const medianMs = frameDurationsMs[Math.floor(frameDurationsMs.length / 2)] || 0;
                const p95Ms = frameDurationsMs[Math.floor(frameDurationsMs.length * 0.95)] || 0;
                const p99Ms = frameDurationsMs[Math.floor(frameDurationsMs.length * 0.99)] || 0;
                const estimatedFps = avgMs > 0 ? Math.min(1000 / avgMs, 1000) : 0;

                const topOpTypes = Array.from(recordedOpsByType.values())
                    .sort((a, b) => b.totalCount - a.totalCount)
                    .map(t => ({{
                        name: t.name,
                        opCode: t.opCode,
                        avgExecutionsPerFrame: Number((t.totalCount / (measuredFramesCount || 1)).toFixed(1)),
                        peakInSingleFrame: t.maxInSingleFrame,
                        totalExecutions: t.totalCount
                    }}));

                const topInstances = Array.from(recordedOpsByInstance.values())
                    .sort((a, b) => b.totalCount - a.totalCount)
                    .slice(0, 20)
                    .map(inst => {{
                        const op = window.findOperationByInstanceId ? window.findOperationByInstanceId(inst.id) : null;
                        let detail = op && typeof op.deepToString === 'function' ? op.deepToString("").trim() : inst.name;
                        return {{
                            instanceId: inst.id,
                            name: inst.name,
                            avgExecutionsPerFrame: Number((inst.totalCount / (measuredFramesCount || 1)).toFixed(1)),
                            peakInSingleFrame: inst.maxInSingleFrame,
                            totalExecutions: inst.totalCount,
                            description: detail
                        }};
                    }});

                let rating = 'EXCELLENT (<4ms, 240Hz capable)';
                if (avgMs >= 16.67) rating = 'POOR (>16.6ms, will drop below 60fps)';
                else if (avgMs >= 8.33) rating = 'MODERATE (8.3-16.6ms, 60fps stable, drops on 120Hz)';
                else if (avgMs >= 4.0) rating = 'GOOD (4-8.3ms, 120Hz capable)';

                return {{
                    fileName: "{file_name}",
                    fileSizeBytes: {byte_size},
                    profilingConfig: {{
                        measuredFrames: measuredFramesCount,
                        warmupFrames: warmupCount,
                        totalBenchTimeMs: Number(tTotal.toFixed(2))
                    }},
                    frameTiming: {{
                        averageFrameTimeMs: Number(avgMs.toFixed(3)),
                        medianFrameTimeMs: Number(medianMs.toFixed(3)),
                        p95FrameTimeMs: Number(p95Ms.toFixed(3)),
                        p99FrameTimeMs: Number(p99Ms.toFixed(3)),
                        minFrameTimeMs: Number(minMs.toFixed(3)),
                        maxFrameTimeMs: Number(maxMs.toFixed(3)),
                        estimatedMaxFps: Number(estimatedFps.toFixed(1)),
                        performanceRating: rating
                    }},
                    operationsPerFrame: {{
                        averageOpsPerFrame: Number((totalOpsMeasured / (measuredFramesCount || 1)).toFixed(1)),
                        totalOpsExecutedAcrossRun: totalOpsMeasured
                    }},
                    topExecutedOpcodeTypes: topOpTypes,
                    hottestOperationInstances: topInstances
                }};
            }}

            // Default 'inspect' mode
            const usage = window.getVariableUsageInfo ? window.getVariableUsageInfo(doc, ops) : {{ definedVarIds: new Set(), unusedVarIds: new Set(), refMap: new Map() }};
            const islands = window.getUnusedIslandsAnalysis ? window.getUnusedIslandsAnalysis(doc) : {{ unusedIslandSet: new Set(), removableOpSet: new Set(), removableOpsCount: 0 }};

            const opcodeCounts = {{}};
            ops.forEach(op => {{
                const opName = window.getOpName ? window.getOpName(op) : 'Operation';
                opcodeCounts[opName] = (opcodeCounts[opName] || 0) + 1;
            }});

            const width = doc && typeof doc.getWidth === 'function' ? doc.getWidth() : null;
            const height = doc && typeof doc.getHeight === 'function' ? doc.getHeight() : null;

            const opSummary = ops.slice(0, 50).map((op, idx) => {{
                const opName = window.getOpName ? window.getOpName(op) : 'Operation';
                const opId = window.getOpId ? window.getOpId(op) : null;
                const desc = typeof op.deepToString === 'function' ? op.deepToString("") : (op.toString ? op.toString() : "");
                const isRemovable = islands.removableOpSet ? islands.removableOpSet.has(op) : false;
                return {{ idx, opName, opId, desc, isRemovable }};
            }});

            return {{
                fileName: "{file_name}",
                fileSizeBytes: {byte_size},
                dimensions: {{ width, height }},
                totalOperations: ops.length,
                opcodeBreakdown: opcodeCounts,
                variableAnalysis: {{
                    totalDefinedVariables: usage.definedVarIds ? Array.from(usage.definedVarIds) : [],
                    unusedVariableIds: usage.unusedVarIds ? Array.from(usage.unusedVarIds) : [],
                    unusedIslandsCount: islands.unusedIslandSet ? islands.unusedIslandSet.size : 0,
                    removableOperationsCount: islands.removableOpsCount || 0,
                    removableOpIndices: ops.map((op, i) => islands.removableOpSet && islands.removableOpSet.has(op) ? i + 1 : -1).filter(i => i >= 0)
                }},
                sampleOperations: opSummary
            }};
        }} catch (err) {{
            return {{ error: err.stack || err.message }};
        }}
    }})()
    '''

    data = send_cmd(100, 'Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': True})
    val = data.get('result', {}).get('result', {}).get('value')
    print(json.dumps(val))
finally:
    proc.terminate()
`;

    const tmpPyPath = path.join(__dirname, `_tmp_cdp_${Date.now()}.py`);
    await fs.writeFile(tmpPyPath, pythonScript, 'utf8');

    try {
        const out = execSync(`python3 "${tmpPyPath}"`, { cwd: __dirname, encoding: 'utf8', maxBuffer: 25 * 1024 * 1024 });
        await fs.unlink(tmpPyPath).catch(() => {});
        return JSON.parse(out.trim());
    } catch (err) {
        await fs.unlink(tmpPyPath).catch(() => {});
        throw new Error(err.stderr || err.stdout || err.message);
    }
}

// =========================================================================
// Official Model Context Protocol (MCP) JSON-RPC Stdio Protocol Handler
// =========================================================================

const MCP_TOOLS = [
    {
        name: 'rc_inspect_document',
        description: 'Loads a RemoteCompose binary (.rc) file headlessly into the Inspector engine and runs deep inspection (opcode disassembly, dimensions, variable counts, and operation summary).',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'Absolute path to the RemoteCompose (.rc) binary file on disk.'
                }
            },
            required: ['filePath']
        }
    },
    {
        name: 'rc_analyze_dead_code',
        description: 'Analyzes a RemoteCompose document for dead code, unused expression islands (unreachable mathematical calculation chains), and lists exact operations that can be safely removed to optimize file size.',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'Absolute path to the RemoteCompose (.rc) binary file on disk.'
                }
            },
            required: ['filePath']
        }
    },
    {
        name: 'rc_decompile_tree',
        description: 'Decompiles a RemoteCompose binary (.rc) file into a hierarchical Component Tree representation (Column, Row, Box, Text, Image, applied Modifiers, and nested children).',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'Absolute path to the RemoteCompose (.rc) binary file on disk.'
                }
            },
            required: ['filePath']
        }
    },
    {
        name: 'rc_render_screenshot',
        description: 'Renders the RemoteCompose (.rc) document headlessly on the preview canvas and captures a visual PNG screenshot saved to the artifacts folder for visual multimodal analysis.',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'Absolute path to the RemoteCompose (.rc) binary file on disk.'
                },
                outputName: {
                    type: 'string',
                    description: 'Optional output PNG file name (defaults to file base name with .png extension).'
                }
            },
            required: ['filePath']
        }
    },
    {
        name: 'rc_profile_performance',
        description: 'Profiles real-time animation/rendering performance across N frames (frame duration stats, median/p95/p99 ms, FPS, hot-spot operations, and execution frequency ranking).',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'Absolute path to the RemoteCompose (.rc) binary file on disk.'
                },
                frameCount: {
                    type: 'number',
                    description: 'Number of frames to profile (default: 60).'
                },
                warmupFrames: {
                    type: 'number',
                    description: 'Number of warmup frames before measuring (default: 10).'
                }
            },
            required: ['filePath']
        }
    },
    {
        name: 'rc_analyze_binary_treemap',
        description: 'Analyzes the hierarchical byte allocation, category breakdown (Header, Layout, Modifiers, Text, Paths, State, Draw, Bitmaps), and top space-consuming operations of a RemoteCompose (.rc) binary file.',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'Absolute path to the RemoteCompose (.rc) binary file on disk.'
                }
            },
            required: ['filePath']
        }
    }
];

function handleMcpRequest(request) {
    const { id, method, params } = request;

    if (method === 'initialize') {
        return {
            jsonrpc: '2.0',
            id,
            result: {
                protocolVersion: '2024-11-05',
                capabilities: { tools: {} },
                serverInfo: {
                    name: 'remotecompose-inspector-mcp',
                    version: '1.2.0'
                }
            }
        };
    }

    if (method === 'tools/list') {
        return {
            jsonrpc: '2.0',
            id,
            result: { tools: MCP_TOOLS }
        };
    }

    if (method === 'tools/call') {
        const { name, arguments: args } = params || {};
        return (async () => {
            try {
                if (name === 'rc_profile_performance') {
                    const profileResult = await inspectRcDocumentHeadless(args.filePath, 'profile', {
                        frameCount: args.frameCount,
                        warmupFrames: args.warmupFrames
                    });
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(profileResult, null, 2)
                                }
                            ]
                        }
                    };
                }

                if (name === 'rc_analyze_binary_treemap') {
                    const treemapResult = await inspectRcDocumentHeadless(args.filePath, 'treemap');
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(treemapResult, null, 2)
                                }
                            ]
                        }
                    };
                }

                if (name === 'rc_decompile_tree') {
                    const treeAnalysis = await inspectRcDocumentHeadless(args.filePath, 'decompile_tree');
                    return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify(treeAnalysis, null, 2)
                                }
                            ]
                        }
                    };
                }

                if (name === 'rc_render_screenshot') {
                    const screenshotResult = await inspectRcDocumentHeadless(args.filePath, 'screenshot');
                    const baseName = args.outputName || `${path.basename(args.filePath, '.rc')}_rendered.png`;
                    const artifactPath = path.join(ARTIFACT_DIR, baseName);

                    if (screenshotResult.pngDataUrl) {
                        const base64Data = screenshotResult.pngDataUrl.replace(/^data:image\/png;base64,/, '');
                        await fs.writeFile(artifactPath, Buffer.from(base64Data, 'base64'));
                    }

                    return {
                        jsonrpc: '2.0',
                        id,
                        result: {
                            content: [
                                {
                                    type: 'text',
                                    text: JSON.stringify({
                                        fileName: screenshotResult.fileName,
                                        dimensions: screenshotResult.dimensions,
                                        artifactImagePath: artifactPath,
                                        status: 'Rendered and saved to artifacts'
                                    }, null, 2)
                                }
                            ]
                        }
                    };
                }

                const analysis = await inspectRcDocumentHeadless(args.filePath, 'inspect');
                let contentText = '';

                if (name === 'rc_analyze_dead_code') {
                    contentText = JSON.stringify({
                        fileName: analysis.fileName,
                        fileSizeBytes: analysis.fileSizeBytes,
                        deadCodeSummary: {
                            unusedVariableIds: analysis.variableAnalysis.unusedVariableIds,
                            unusedIslandsCount: analysis.variableAnalysis.unusedIslandsCount,
                            removableOperationsCount: analysis.variableAnalysis.removableOperationsCount,
                            removableOpIndices: analysis.variableAnalysis.removableOpIndices
                        }
                    }, null, 2);
                } else {
                    contentText = JSON.stringify(analysis, null, 2);
                }

                return {
                    jsonrpc: '2.0',
                    id,
                    result: {
                        content: [
                            {
                                type: 'text',
                                text: contentText
                            }
                        ]
                    }
                };
            } catch (err) {
                return {
                    jsonrpc: '2.0',
                    id,
                    error: {
                        code: -32603,
                        message: err.message
                    }
                };
            }
        })();
    }

    return {
        jsonrpc: '2.0',
        id,
        error: {
            code: -32601,
            message: `Method not found: ${method}`
        }
    };
}

// Direct CLI execution mode when called with --inspect, --decompile, --screenshot, --profile, or --treemap
const args = process.argv.slice(2);
const inspectIdx = args.findIndex(a => a === '--inspect' || a === '--file');
const decompileIdx = args.findIndex(a => a === '--decompile');
const screenshotIdx = args.findIndex(a => a === '--screenshot');
const profileIdx = args.findIndex(a => a === '--profile');
const treemapIdx = args.findIndex(a => a === '--treemap');

if (treemapIdx !== -1 && args[treemapIdx + 1]) {
    const targetFile = path.resolve(args[treemapIdx + 1]);
    console.log(`🤖 RemoteCompose Option A Headless Binary Treemap Analyzer`);
    console.log(`📦 Analyzing byte allocation for: ${targetFile} ...\n`);

    inspectRcDocumentHeadless(targetFile, 'treemap')
        .then(result => {
            console.log(JSON.stringify(result, null, 2));
            process.exit(0);
        })
        .catch(err => {
            console.error('❌ Treemap analysis failed:', err.message);
            process.exit(1);
        });
} else if (profileIdx !== -1 && args[profileIdx + 1]) {
    const targetFile = path.resolve(args[profileIdx + 1]);
    const framesIdx = args.findIndex(a => a === '--frames');
    const frameCount = framesIdx !== -1 ? Number(args[framesIdx + 1]) : 60;

    console.log(`🤖 RemoteCompose Option A Headless Performance Profiler`);
    console.log(`⏱️ Profiling ${frameCount} frames for: ${targetFile} ...\n`);

    inspectRcDocumentHeadless(targetFile, 'profile', { frameCount })
        .then(result => {
            console.log(JSON.stringify(result, null, 2));
            process.exit(0);
        })
        .catch(err => {
            console.error('❌ Profiling failed:', err.message);
            process.exit(1);
        });
} else if (decompileIdx !== -1 && args[decompileIdx + 1]) {
    const targetFile = path.resolve(args[decompileIdx + 1]);
    console.log(`🤖 RemoteCompose Option A Headless Component Tree Decompiler`);
    console.log(`📄 Decompiling component tree: ${targetFile} ...\n`);

    inspectRcDocumentHeadless(targetFile, 'decompile_tree')
        .then(result => {
            console.log(JSON.stringify(result, null, 2));
            process.exit(0);
        })
        .catch(err => {
            console.error('❌ Decompilation failed:', err.message);
            process.exit(1);
        });
} else if (screenshotIdx !== -1 && args[screenshotIdx + 1]) {
    const targetFile = path.resolve(args[screenshotIdx + 1]);
    console.log(`🤖 RemoteCompose Option A Headless Renderer Screenshot Engine`);
    console.log(`📸 Rendering screenshot for: ${targetFile} ...\n`);

    inspectRcDocumentHeadless(targetFile, 'screenshot')
        .then(async (result) => {
            const baseName = `${path.basename(targetFile, '.rc')}_rendered.png`;
            const artifactPath = path.join(ARTIFACT_DIR, baseName);
            if (result.pngDataUrl) {
                const base64Data = result.pngDataUrl.replace(/^data:image\/png;base64,/, '');
                await fs.writeFile(artifactPath, Buffer.from(base64Data, 'base64'));
            }
            console.log(JSON.stringify({
                fileName: result.fileName,
                dimensions: result.dimensions,
                artifactImagePath: artifactPath
            }, null, 2));
            process.exit(0);
        })
        .catch(err => {
            console.error('❌ Screenshot rendering failed:', err.message);
            process.exit(1);
        });
} else if (inspectIdx !== -1 && args[inspectIdx + 1]) {
    const targetFile = path.resolve(args[inspectIdx + 1]);
    console.log(`🤖 RemoteCompose Option A Headless CDP Inspector`);
    console.log(`📄 Analyzing document: ${targetFile} ...\n`);

    inspectRcDocumentHeadless(targetFile, 'inspect')
        .then(result => {
            console.log(JSON.stringify(result, null, 2));
            process.exit(0);
        })
        .catch(err => {
            console.error('❌ Diagnostic analysis failed:', err.message);
            process.exit(1);
        });
} else if (import.meta.url === `file://${process.argv[1]}`) {
    // Standard MCP Stdio JSON-RPC protocol server loop
    process.stdin.setEncoding('utf-8');
    let buffer = '';

    process.stdin.on('data', async (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep remainder

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                const request = JSON.parse(trimmed);
                const response = await handleMcpRequest(request);
                process.stdout.write(JSON.stringify(response) + '\n');
            } catch (e) {
                process.stdout.write(JSON.stringify({
                    jsonrpc: '2.0',
                    id: null,
                    error: { code: -32700, message: 'Parse error' }
                }) + '\n');
            }
        }
    });
}
