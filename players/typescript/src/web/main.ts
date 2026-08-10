// Web player entry point: loads .rcd files and renders them on a Canvas.

import { WireBuffer } from '../core/WireBuffer';
import { CoreDocument } from '../core/CoreDocument';
import { RemoteComposeBuffer } from '../core/RemoteComposeBuffer';
import { CanvasPaintContext } from './CanvasPaintContext';
import { WebRemoteContext } from './WebRemoteContext';
import { ContextMode, RemoteContext } from '../core/RemoteContext';
import { Header } from '../core/operations/Header';
import { Theme } from '../core/operations/DataOperations';
import type { MeasurementSink } from '../core/OperationMeasurement';

/**
 * How far a press may travel and still count as a tap, in document units.
 *
 * Android takes this from `ViewConfiguration.getScaledTouchSlop()` (8dp on most devices).
 * The browser exposes no equivalent, so 8 is used directly — CSS pixels and dp agree
 * closely enough, and the value only has to separate "finger wobble" from "drag".
 */
const TOUCH_SLOP = 8;

export class RcdPlayer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private document: CoreDocument | null = null;
    private paintContext: CanvasPaintContext | null = null;
    private remoteContext: WebRemoteContext | null = null;
    private animationFrameId: number | null = null;
    private startTime = 0;
    private onLoad: ((doc: CoreDocument) => void) | null = null;

    // Theme override: 'light' | 'dark' | 'auto' (default)
    private themeOverride: 'light' | 'dark' | 'auto' = 'auto';

    // Variable listener
    private variableListener: ((entries: Array<[number, number]>) => void) | null = null;

    // Measurement sink, remembered across document loads.
    private measurementSink: MeasurementSink | null = null;

    /**
     * Display density. Dimensions in a document are authored in dp and scaled by this —
     * a `widthIn(120)` is 120dp, which is 315 physical pixels on a 420dpi phone.
     *
     * Defaults to the browser's devicePixelRatio, the closest equivalent to Android's
     * DisplayMetrics.density. Headless there is no such thing, so it falls back to 1 —
     * which is what a document authored for a phone will NOT look right at, so the render
     * tools take an explicit --density.
     */
    private density: number =
        (typeof window !== 'undefined' && window.devicePixelRatio) || 1;

    // Touch/pointer tracking
    private pointerIsDown = false;
    private pointerHistory: { x: number; y: number; t: number }[] = [];

    // Tap detection. A press that ends without travelling more than TOUCH_SLOP is a
    // click, and clicks are a *separate dispatch channel* from touch — see the
    // pointerup handler.
    private pointerDownX = 0;
    private pointerDownY = 0;
    private pointerHasMoved = false;

    // Fit transform applied each frame in renderFrame to scale the document's
    // native size into the canvas. Pointer coords must be inverse-mapped.
    private mContentScale = 1;
    private mContentOffsetX = 0;
    private mContentOffsetY = 0;

    private isPaused = false;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get 2D context');
        this.ctx = ctx;
        this.setupPointerEvents();
    }

    private setupPointerEvents(): void {
        this.canvas.addEventListener('pointerdown', (e: PointerEvent) => {
            if (!this.document || !this.remoteContext) return;
            this.pointerIsDown = true;
            const { x, y } = this.canvasCoords(e);
            this.pointerDownX = x;
            this.pointerDownY = y;
            this.pointerHasMoved = false;
            this.pointerHistory = [{ x, y, t: performance.now() }];
            this.remoteContext.loadFloat(RemoteContext.ID_TOUCH_EVENT_TIME, this.remoteContext.getAnimationTime());
            this.document.touchDown(this.remoteContext, x, y);
            this.scheduleRepaint();
        });

        this.canvas.addEventListener('pointermove', (e: PointerEvent) => {
            if (!this.pointerIsDown || !this.document || !this.remoteContext) return;
            const { x, y } = this.canvasCoords(e);
            if (!this.pointerHasMoved) {
                const dx = x - this.pointerDownX;
                const dy = y - this.pointerDownY;
                const slop = TOUCH_SLOP / (this.mContentScale || 1);
                if (dx * dx + dy * dy > slop * slop) this.pointerHasMoved = true;
            }
            this.pointerHistory.push({ x, y, t: performance.now() });
            if (this.pointerHistory.length > 5) this.pointerHistory.shift();
            this.remoteContext.loadFloat(RemoteContext.ID_TOUCH_EVENT_TIME, this.remoteContext.getAnimationTime());
            this.document.touchDrag(this.remoteContext, x, y);
            this.scheduleRepaint();
        });

        this.canvas.addEventListener('pointerup', (e: PointerEvent) => {
            if (!this.pointerIsDown || !this.document || !this.remoteContext) return;
            this.pointerIsDown = false;
            const { x, y } = this.canvasCoords(e);
            const { dx, dy } = this.computeVelocity(x, y);
            this.remoteContext.loadFloat(RemoteContext.ID_TOUCH_EVENT_TIME, this.remoteContext.getAnimationTime());
            // Taps and touches are two separate dispatch channels, and a document can use
            // either. `touchUp` drives touch listeners and touch modifiers; `onClick` is
            // what reaches ClickModifier — a button does nothing without it. Only the
            // touch channel was wired here, so no clickable document responded at all.
            //
            // Order and the slop test both follow RemoteComposeView.onTouchEvent: the
            // click fires first, and only when the press did not travel far enough to be
            // a drag (otherwise scrolling a list would also press whatever it started on).
            if (!this.pointerHasMoved) {
                this.document.onClick(this.remoteContext, x, y);
            }
            this.document.touchUp(this.remoteContext, x, y, dx, dy);
            this.pointerHistory = [];
            this.scheduleRepaint();
        });

        this.canvas.addEventListener('pointercancel', () => {
            this.pointerIsDown = false;
            this.pointerHasMoved = false;
            this.pointerHistory = [];
        });
    }

    private canvasCoords(e: PointerEvent): { x: number; y: number } {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const px = (e.clientX - rect.left) * scaleX;
        const py = (e.clientY - rect.top) * scaleY;
        // Inverse of the renderFrame fit transform: map canvas pixels
        // back into the document's native coordinate space.
        const s = this.mContentScale || 1;
        return {
            x: (px - this.mContentOffsetX) / s,
            y: (py - this.mContentOffsetY) / s
        };
    }

    private computeVelocity(curX: number, curY: number): { dx: number; dy: number } {
        if (this.pointerHistory.length < 2) return { dx: 0, dy: 0 };
        const first = this.pointerHistory[0];
        const now = performance.now();
        const dt = (now - first.t) / 1000; // seconds
        if (dt <= 0) return { dx: 0, dy: 0 };
        return {
            dx: (curX - first.x) / dt,
            dy: (curY - first.y) / dt
        };
    }

    private scheduleRepaint(): void {
        if (this.isPaused) return;
        if (this.animationFrameId === null) {
            this.animationFrameId = requestAnimationFrame(this.renderFrame);
        }
    }

    pause(): void {
        this.isPaused = true;
        this.stop();
    }

    play(): void {
        this.isPaused = false;
        this.scheduleRepaint();
    }

    getIsPaused(): boolean {
        return this.isPaused;
    }

    setOnLoad(cb: (doc: CoreDocument) => void): void {
        this.onLoad = cb;
    }

    setTheme(theme: 'light' | 'dark' | 'auto'): void {
        this.themeOverride = theme;
        this.scheduleRepaint();
    }

    setVariableListener(cb: (entries: Array<[number, number]>) => void): void {
        this.variableListener = cb;
    }

    removeVariableListener(): void {
        this.variableListener = null;
    }

    /**
     * Enable per-frame operation measurement; `sink` is called once per painted frame.
     * Pass `null` to disable. Safe to call before a document is loaded — the setting is
     * remembered and reapplied to each document, so a profiler can be armed up front and
     * see the very first frame.
     */
    setMeasurementSink(sink: MeasurementSink | null): void {
        this.measurementSink = sink;
        this.remoteContext?.setMeasurementSink(sink);
    }

    /** Set the display density; documents are authored in dp and scale by it. */
    setDensity(density: number): void {
        if (density > 0 && !Number.isNaN(density)) {
            this.density = density;
            this.remoteContext?.setDensity(density);
            this.scheduleRepaint();
        }
    }

    getDensity(): number { return this.density; }

    /** Operations executed in the last painted frame — available with measurement off. */
    getOpsPerFrame(): number {
        return this.document?.getOpsPerFrame() ?? 0;
    }

    async loadFromArrayBuffer(data: ArrayBuffer): Promise<CoreDocument> {
        this.stop();

        const buffer = RemoteComposeBuffer.fromArrayBuffer(data);
        const doc = new CoreDocument();
        doc.initFromBuffer(buffer);

        this.document = doc;

        // Use the current canvas size — don't resize to document dimensions.
        // The document's own generation density is only a hint about how it was authored;
        // what matters for layout is the density of the display it is being shown on.
        const density = this.density
            || (doc.getProperty(Header.DOC_DENSITY_AT_GENERATION) as number) || 1;
        // The viewport is in *physical pixels*, not dp — density is not divided out here.
        // Android hands RemoteComposeView its pixel width and sets the display density
        // alongside it; the dp→px conversion happens per-modifier in updateVariables, so
        // dividing here would apply it a second time. Verified against the device: a 980px
        // viewport at density 2.625 reproduces the phone's flow segmentation exactly, while
        // 980/2.625 = 373 puts one card per row.
        const docWidth = this.canvas.width;
        const docHeight = this.canvas.height;

        // Override document dimensions to match canvas
        doc.setWidth(docWidth);
        doc.setHeight(docHeight);

        // Create contexts
        this.paintContext = new CanvasPaintContext(null as any, this.ctx);
        this.remoteContext = new WebRemoteContext(this.paintContext);

        // Wire up
        doc.initializeContext(this.remoteContext);
        this.remoteContext.setPaintContext(this.paintContext);
        this.paintContext.setContext(this.remoteContext);
        this.remoteContext.mWidth = docWidth;
        this.remoteContext.mHeight = docHeight;
        this.remoteContext.setDensity(density);
        // Reapply an armed sink so measurement covers this document from its first frame.
        if (this.measurementSink) this.remoteContext.setMeasurementSink(this.measurementSink);

        // Apply data operations first (load texts, bitmaps, paths, etc.)
        doc.applyDataOperations(this.remoteContext);

        // Wait a tick for bitmap decoding
        await new Promise(resolve => setTimeout(resolve, 50));

        if (this.onLoad) this.onLoad(doc);

        // Start rendering
        this.startTime = performance.now();
        this.renderFrame(this.startTime);

        return doc;
    }

    async loadFromUrl(url: string): Promise<CoreDocument> {
        const response = await fetch(url);
        const data = await response.arrayBuffer();
        return this.loadFromArrayBuffer(data);
    }

    private renderFrame = (timestamp: number): void => {
        this.animationFrameId = null;
        if (!this.document || !this.remoteContext || !this.paintContext) return;

        const elapsed = (timestamp - this.startTime) / 1000;
        this.remoteContext.setAnimationTime(elapsed);
        this.remoteContext.currentTime = Date.now();

        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // The engine already sizes the document to `context.mWidth` /
        // `context.mHeight` (which we keep in sync with the canvas in
        // `loadFromArrayBuffer` and `resize`).  For SIZING_SCALE
        // documents `paint()` applies its own translate+scale transform
        // internally; for everything else `paint()` does
        // `setWidth(context.mWidth)` so the content fills the context
        // space natively.  Either way, no outer ctx transform is needed
        // — applying one here would double-scale.
        this.mContentScale = 1;
        this.mContentOffsetX = 0;
        this.mContentOffsetY = 0;

        // Reset paint state
        this.paintContext.reset();
        this.paintContext.clearNeedsRepaint();

        // Paint the document — resolve theme
        let theme: number;
        if (this.themeOverride === 'light') {
            theme = Theme.LIGHT;
        } else if (this.themeOverride === 'dark') {
            theme = Theme.DARK;
        } else {
            const isDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
            theme = isDark ? Theme.DARK : Theme.LIGHT;
        }
        this.document.paint(this.remoteContext, theme);

        // Notify variable listener after paint
        if (this.variableListener) {
            this.variableListener(this.remoteContext.mRemoteComposeState.getFloatEntries());
        }

        if (this.isPaused) return;

        // Schedule next frame if needed
        const repaintDelay = this.document.needsRepaint();
        if (repaintDelay >= 0) {
            if (repaintDelay <= 1) {
                this.animationFrameId = requestAnimationFrame(this.renderFrame);
            } else {
                setTimeout(() => {
                    this.animationFrameId = requestAnimationFrame(this.renderFrame);
                }, repaintDelay);
            }
        }
    };

    stop(): void {
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    /**
     * Stop, and release the WebGL context.
     *
     * `stop()` only cancels the animation frame; a document that used a shader still
     * holds a WebGL context afterwards. Callers showing many documents at once must
     * use this instead, or the browser's context limit silently blanks the earliest
     * ones.
     */
    destroy(): void {
        this.stop();
        if (this.paintContext) {
            this.paintContext.destroy();
        }
    }

    repaint(): void {
        if (this.document) {
            this.renderFrame(performance.now());
        }
    }

    resize(newWidth: number, newHeight: number): void {
        this.canvas.width = newWidth;
        this.canvas.height = newHeight;
        this.canvas.style.width = newWidth + 'px';
        this.canvas.style.height = newHeight + 'px';
        // Keep the engine's RemoteContext in sync with the new canvas
        // size so non-SIZING_SCALE documents re-flow into it on next
        // paint.  Without this the content would keep drawing at the
        // original load-time size.
        if (this.remoteContext) {
            // Physical pixels, matching the load path — see the note there on why density
            // is not divided out.
            this.remoteContext.mWidth  = newWidth;
            this.remoteContext.mHeight = newHeight;
            // The DATA pass in CoreDocument.paint reloads
            // ID_WINDOW_WIDTH / ID_WINDOW_HEIGHT from these, so
            // expressions track the new size automatically.
        }
        this.scheduleRepaint();
    }

    getDocument(): CoreDocument | null { return this.document; }
    getRemoteContext(): WebRemoteContext | null { return this.remoteContext; }

    /**
     * Capture a screenshot of the current canvas as a PNG Blob.
     *
     * Usage:
     *   const blob = await player.screenshot();
     *   // Download:
     *   const a = document.createElement('a');
     *   a.href = URL.createObjectURL(blob);
     *   a.download = 'screenshot.png';
     *   a.click();
     *
     *   // Or get as data URL:
     *   const url = await player.screenshotDataURL();
     */
    async screenshot(type = 'image/png', quality?: number): Promise<Blob> {
        return new Promise((resolve, reject) => {
            this.canvas.toBlob(
                (blob) => blob ? resolve(blob) : reject(new Error('toBlob failed')),
                type, quality
            );
        });
    }

    /** Capture a screenshot as a data URL string (e.g. "data:image/png;base64,..."). */
    screenshotDataURL(type = 'image/png', quality?: number): string {
        return this.canvas.toDataURL(type, quality);
    }

    /** Save a screenshot as a file download. */
    async saveScreenshot(filename = 'screenshot.png'): Promise<void> {
        const blob = await this.screenshot();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }
}

// Re-export public API
import { createPlayer, RcPlayerElement, base64ToArrayBuffer } from './RcPlayerElement';
export { createPlayer, RcPlayerElement, base64ToArrayBuffer };
export type { RcPlayerOptions, RcPlayerHandle } from './RcPlayerElement';
export type { MeasurementSink, FrameMeasurement, TypeCount, InstanceCount } from '../core/OperationMeasurement';

// Auto-initialize if running in browser
if (typeof window !== 'undefined') {
    (window as any).RcdPlayer = RcdPlayer;
    (window as any).RC = {
        RcdPlayer,
        createPlayer,
        RcPlayerElement,
        base64ToArrayBuffer
    };

    // Register <rc-player> custom element
    if (!customElements.get('rc-player')) {
        customElements.define('rc-player', RcPlayerElement);
    }
}
