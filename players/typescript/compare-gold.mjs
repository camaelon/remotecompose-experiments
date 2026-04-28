// compare-gold.mjs: Headless gold-image comparison tool for RemoteCompose TypeScript player.
// Renders each .rcd file using node-canvas and compares against reference .png files.

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { execSync } from 'child_process';
import { createCanvas, loadImage, Image } from 'canvas';

// --- Path2D polyfill for node-canvas ---
// node-canvas doesn't provide Path2D, but CanvasPaintContext uses it.
// This polyfill records path commands and replays them on the context.
if (typeof globalThis.Path2D === 'undefined') {
    class Path2DPolyfill {
        constructor() {
            this._commands = [];
        }
        moveTo(x, y) { this._commands.push({ cmd: 'moveTo', args: [x, y] }); }
        lineTo(x, y) { this._commands.push({ cmd: 'lineTo', args: [x, y] }); }
        quadraticCurveTo(cpx, cpy, x, y) { this._commands.push({ cmd: 'quadraticCurveTo', args: [cpx, cpy, x, y] }); }
        bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y) { this._commands.push({ cmd: 'bezierCurveTo', args: [cp1x, cp1y, cp2x, cp2y, x, y] }); }
        closePath() { this._commands.push({ cmd: 'closePath', args: [] }); }
        rect(x, y, w, h) { this._commands.push({ cmd: 'rect', args: [x, y, w, h] }); }
        arc(x, y, r, sa, ea, ccw) { this._commands.push({ cmd: 'arc', args: [x, y, r, sa, ea, ccw] }); }
        ellipse(x, y, rx, ry, rot, sa, ea, ccw) { this._commands.push({ cmd: 'ellipse', args: [x, y, rx, ry, rot, sa, ea, ccw] }); }
        roundRect(x, y, w, h, radii) { this._commands.push({ cmd: 'roundRect', args: [x, y, w, h, radii] }); }
        addPath(path) {
            if (path && path._commands) {
                this._commands.push(...path._commands);
            }
        }
        _replay(ctx) {
            for (const { cmd, args } of this._commands) {
                ctx[cmd](...args);
            }
        }
    }
    globalThis.Path2D = Path2DPolyfill;
}

// Monkey-patch CanvasRenderingContext2D to support Path2D arguments in fill/stroke/clip
// We need to do this on each canvas context we create, since node-canvas doesn't support Path2D natively.
function patchContextForPath2D(ctx) {
    const origFill = ctx.fill.bind(ctx);
    const origStroke = ctx.stroke.bind(ctx);
    const origClip = ctx.clip.bind(ctx);

    ctx.fill = function(pathOrRule, rule) {
        if (pathOrRule && pathOrRule._commands) {
            ctx.beginPath();
            pathOrRule._replay(ctx);
            if (rule) origFill(rule);
            else origFill();
        } else {
            origFill(pathOrRule, rule);
        }
    };

    ctx.stroke = function(pathOrVoid) {
        if (pathOrVoid && pathOrVoid._commands) {
            ctx.beginPath();
            pathOrVoid._replay(ctx);
            origStroke();
        } else {
            origStroke();
        }
    };

    ctx.clip = function(pathOrRule, rule) {
        if (pathOrRule && pathOrRule._commands) {
            ctx.beginPath();
            pathOrRule._replay(ctx);
            if (rule) origClip(rule);
            else origClip();
        } else if (typeof pathOrRule === 'string') {
            origClip(pathOrRule);
        } else {
            origClip();
        }
    };
}

// --- Step 1: Bundle the TS code for Node.js ---
console.log('Bundling TypeScript for Node.js...');

const bundlePath = '/tmp/rcd-gold-bundle.mjs';
execSync(
    `npx esbuild src/node-entry.ts --bundle --outfile=${bundlePath} --format=esm --target=es2020 --platform=node 2>&1`,
    { cwd: import.meta.dirname }
);

const mod = await import(bundlePath);
const {
    RemoteComposeBuffer,
    CoreDocument,
    CanvasPaintContext,
    WebRemoteContext,
    ContextMode,
} = mod;

// --- Step 2: Find .rcd/.png pairs ---
const sampleDir = join(import.meta.dirname, '..', 'sample_data');
const rcdFiles = readdirSync(sampleDir).filter(f => f.endsWith('.rcd')).sort();

const pairs = [];
for (const rcd of rcdFiles) {
    const name = rcd.replace('.rcd', '');
    const pngFile = name + '.png';
    const pngPath = join(sampleDir, pngFile);
    if (existsSync(pngPath)) {
        pairs.push({ name, rcdPath: join(sampleDir, rcd), pngPath });
    } else {
        console.log(`  SKIP ${rcd} (no matching .png)`);
    }
}

console.log(`\nFound ${pairs.length} .rcd/.png pairs to compare.\n`);

// --- Step 3: Comparison functions ---
function computeMetrics(actual, expected, width, height) {
    const len = width * height * 4;
    let sumSqErr = 0;
    let diffPixels = 0;
    let maxChannelErr = 0;
    const THRESHOLD = 5;

    for (let i = 0; i < len; i += 4) {
        let pixelDiff = false;
        for (let c = 0; c < 4; c++) {
            const diff = Math.abs(actual[i + c] - expected[i + c]);
            sumSqErr += diff * diff;
            if (diff > maxChannelErr) maxChannelErr = diff;
            if (diff > THRESHOLD) pixelDiff = true;
        }
        if (pixelDiff) diffPixels++;
    }

    const totalPixels = width * height;
    const totalChannels = len;
    const rmse = Math.sqrt(sumSqErr / totalChannels);
    const pctDiff = (diffPixels / totalPixels) * 100;

    return { rmse, pctDiff, maxChannelErr, diffPixels, totalPixels };
}

function createDiffImage(actual, expected, width, height) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    const diff = ctx.createImageData(width, height);

    for (let i = 0; i < actual.length; i += 4) {
        const dr = Math.abs(actual[i] - expected[i]);
        const dg = Math.abs(actual[i + 1] - expected[i + 1]);
        const db = Math.abs(actual[i + 2] - expected[i + 2]);
        const da = Math.abs(actual[i + 3] - expected[i + 3]);
        const maxD = Math.max(dr, dg, db, da);
        // Amplify the diff for visibility
        const amp = Math.min(255, maxD * 4);
        diff.data[i] = amp;
        diff.data[i + 1] = maxD > 5 ? 0 : 128;
        diff.data[i + 2] = 0;
        diff.data[i + 3] = 255;
    }

    ctx.putImageData(diff, 0, 0);
    return canvas;
}

// --- Step 4: Render and compare ---
const results = [];
const diffDir = join(import.meta.dirname, 'gold-diffs');
if (!existsSync(diffDir)) mkdirSync(diffDir, { recursive: true });

for (const { name, rcdPath, pngPath } of pairs) {
    try {
        // Parse .rcd
        const rcdData = readFileSync(rcdPath);
        const ab = rcdData.buffer.slice(rcdData.byteOffset, rcdData.byteOffset + rcdData.byteLength);
        const buffer = RemoteComposeBuffer.fromArrayBuffer(ab);
        const doc = new CoreDocument();
        doc.initFromBuffer(buffer);

        // Load reference PNG to determine target dimensions
        const refImg = await loadImage(pngPath);
        const refWidth = refImg.width;
        const refHeight = refImg.height;

        // Create a temporary canvas just for data operations (to get doc dimensions)
        const tmpCanvas = createCanvas(1, 1);
        const tmpCtx = tmpCanvas.getContext('2d');
        patchContextForPath2D(tmpCtx);

        const tmpPaintContext = new CanvasPaintContext(null, tmpCtx);
        const tmpRemoteContext = new WebRemoteContext(tmpPaintContext);
        doc.initializeContext(tmpRemoteContext);
        tmpRemoteContext.setPaintContext(tmpPaintContext);
        tmpPaintContext.setContext(tmpRemoteContext);

        // Override loadBitmap for node-canvas
        tmpPaintContext.loadBitmap = function(imageId, encoding, type, width, height, bitmap) {
            try {
                const img = new Image();
                img.src = Buffer.from(bitmap.buffer, bitmap.byteOffset, bitmap.byteLength);
                this.bitmapCache.set(imageId, img);
            } catch (e) {
                console.warn(`  Failed to load bitmap ${imageId}: ${e.message}`);
            }
        };

        // Apply data operations first to get correct doc dimensions & load resources
        doc.applyDataOperations(tmpRemoteContext);

        const docWidth = doc.getWidth() || 256;
        const docHeight = doc.getHeight() || 256;

        // Create the canvas at reference dimensions with #AABBCC background.
        // Document renders on opaque surface, matching how Android player renders
        // on the view's canvas (which has a background). Porter tests use color
        // filter (not globalCompositeOperation), so they work on opaque background.
        // Blend bitmap tests need opaque background for correct blend mode behavior.
        const canvas = createCanvas(refWidth, refHeight);
        const ctx = canvas.getContext('2d');
        patchContextForPath2D(ctx);

        // Fill with Android test framework background color (#AABBCC)
        ctx.fillStyle = '#AABBCC';
        ctx.fillRect(0, 0, refWidth, refHeight);

        // Scale to match reference image if needed
        if (refWidth !== docWidth || refHeight !== docHeight) {
            const scaleX = refWidth / docWidth;
            const scaleY = refHeight / docHeight;
            ctx.scale(scaleX, scaleY);
        }

        // Create real contexts pointing to the canvas
        const paintContext = new CanvasPaintContext(null, ctx);
        const remoteContext = new WebRemoteContext(paintContext);
        doc.initializeContext(remoteContext);
        remoteContext.setPaintContext(paintContext);
        paintContext.setContext(remoteContext);
        remoteContext.mWidth = docWidth;
        remoteContext.mHeight = docHeight;

        // Override loadBitmap for node-canvas on real paint context
        paintContext.loadBitmap = function(imageId, encoding, type, width, height, bitmap) {
            try {
                const img = new Image();
                img.src = Buffer.from(bitmap.buffer, bitmap.byteOffset, bitmap.byteLength);
                this.bitmapCache.set(imageId, img);
            } catch (e) {
                console.warn(`  Failed to load bitmap ${imageId}: ${e.message}`);
            }
        };

        // Override createLayerCanvas for node-canvas offscreen layer support
        paintContext.createLayerCanvas = function(w, h) {
            const c = createCanvas(w, h);
            const layerCtx = c.getContext('2d');
            patchContextForPath2D(layerCtx);
            return layerCtx;
        };

        // Apply data operations again on the real context to load resources
        doc.applyDataOperations(remoteContext);

        // Paint the document
        paintContext.reset();
        paintContext.clearNeedsRepaint();
        doc.paint(remoteContext, -1);

        // Get actual pixels (at reference resolution)
        const actualImageData = ctx.getImageData(0, 0, refWidth, refHeight);
        const actualPixels = actualImageData.data;

        // Draw reference to canvas to get pixel data
        const refCanvas = createCanvas(refWidth, refHeight);
        const refCtx = refCanvas.getContext('2d');
        refCtx.drawImage(refImg, 0, 0);
        const refImageData = refCtx.getImageData(0, 0, refWidth, refHeight);
        const refPixels = refImageData.data;

        // Compare
        const metrics = computeMetrics(actualPixels, refPixels, refWidth, refHeight);

        // Save diff image if there are differences
        if (metrics.rmse > 1) {
            const diffCanvas = createDiffImage(actualPixels, refPixels, refWidth, refHeight);
            const diffPng = diffCanvas.toBuffer('image/png');
            writeFileSync(join(diffDir, `${name}_diff.png`), diffPng);

            // Also save the actual rendering
            const actualPng = canvas.toBuffer('image/png');
            writeFileSync(join(diffDir, `${name}_actual.png`), actualPng);
        }

        results.push({
            name,
            status: metrics.rmse < 5 ? 'PASS' : 'FAIL',
            rmse: metrics.rmse,
            pctDiff: metrics.pctDiff,
            maxChannelErr: metrics.maxChannelErr,
            diffPixels: metrics.diffPixels,
            totalPixels: metrics.totalPixels
        });

        const indicator = metrics.rmse < 2 ? '  OK ' : ' FAIL';
        console.log(`${indicator} ${name} RMSE=${metrics.rmse.toFixed(2)} diff=${metrics.pctDiff.toFixed(1)}% maxErr=${metrics.maxChannelErr}`);

    } catch (e) {
        results.push({
            name,
            status: 'ERROR',
            rmse: Infinity,
            pctDiff: 100,
            maxChannelErr: 255,
            note: e.message
        });
        console.log(` ERR  ${name}: ${e.message}`);
    }
}

// --- Step 5: Summary ---
console.log('\n' + '='.repeat(90));
console.log('SUMMARY');
console.log('='.repeat(90));

// Sort by RMSE descending
results.sort((a, b) => b.rmse - a.rmse);

const passCount = results.filter(r => r.status === 'PASS').length;
const failCount = results.filter(r => r.status === 'FAIL').length;
const errCount = results.filter(r => r.status === 'ERROR').length;
const sizeCount = results.filter(r => r.status === 'SIZE_MISMATCH').length;

console.log(`\nTotal: ${results.length} | Pass: ${passCount} | Fail: ${failCount} | Error: ${errCount} | Size Mismatch: ${sizeCount}\n`);

// Table header
console.log(`${'File'.padEnd(40)} ${'Status'.padEnd(14)} ${'RMSE'.padStart(8)} ${'%Diff'.padStart(8)} ${'MaxErr'.padStart(8)} ${'Note'.padEnd(20)}`);
console.log('-'.repeat(100));

for (const r of results) {
    const note = r.note || '';
    console.log(
        `${r.name.padEnd(40)} ${r.status.padEnd(14)} ${r.rmse === Infinity ? '     Inf' : r.rmse.toFixed(2).padStart(8)} ` +
        `${r.pctDiff.toFixed(1).padStart(8)} ${String(r.maxChannelErr).padStart(8)} ${note}`
    );
}

// Categorize failures
const failures = results.filter(r => r.status === 'FAIL');
if (failures.length > 0) {
    console.log('\n' + '='.repeat(90));
    console.log('FAILURE CATEGORIES');
    console.log('='.repeat(90));

    const categories = {
        blend: failures.filter(f => f.name.startsWith('blend_')),
        porter: failures.filter(f => f.name.startsWith('porter_')),
        gradient: failures.filter(f => f.name.includes('gradient')),
        text: failures.filter(f => f.name.startsWith('text_') || f.name.startsWith('draw_text')),
        matrix: failures.filter(f => f.name.startsWith('matrix_')),
        paint: failures.filter(f => f.name.startsWith('paint_')),
        path: failures.filter(f => f.name.startsWith('path_') || f.name.startsWith('multi_path') || f.name.startsWith('clip_path')),
        clip: failures.filter(f => f.name.startsWith('clip_')),
        bitmap: failures.filter(f => f.name.includes('bitmap')),
    };

    for (const [cat, items] of Object.entries(categories)) {
        if (items.length > 0) {
            console.log(`\n${cat.toUpperCase()} (${items.length} failures):`);
            for (const item of items) {
                console.log(`  ${item.name}: RMSE=${item.rmse.toFixed(2)}, diff=${item.pctDiff.toFixed(1)}%`);
            }
        }
    }
}

console.log(`\nDiff images saved to: ${diffDir}`);
