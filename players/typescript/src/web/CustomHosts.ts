// The web player's custom-component host: what the engine cannot draw itself, drawn here.
//
// A refract deck embeds three kinds of content through LAYOUT_CUSTOM components, each named
// by a config string the C++ player's hosts also read:
//
//   rc:<path>#k=v&…      another RemoteCompose document, painted live inside the box
//                         (RcDocumentHost.cpp): fit | fill | native, a source crop, and —
//                         for a film that runs across many slides — persist, step, stepid,
//                         timeid (see the comments on drawRc below).
//   video:<path>#…       a video, played muted and looped, fitted into the box.
//   camera:<device>#…    the speaker, in the box. On a page built from a recorded talk that
//                        is the take recorded with the narration (setCameraTake), drawn in
//                        step with the audio — the viewer is watching a talk, not being
//                        asked for their own face. Without a take it falls back to the
//                        viewer's camera (getUserMedia), which is what a live page wants.
//                        `mirror=1` flips it; the device is advisory in a browser.
//   web:<url>#…          a web page; there is no drawing a browser into a canvas, so it
//                         becomes the same labelled frame the desktop player's exports show.
//
// Documents and videos are fetched relative to the host page unless the page supplies a
// resolver (a deck opened off the disk cannot fetch, so its files travel inside the page).

import type { CustomComponentHost } from '../core/CustomComponentHost';
import type { PaintContext } from '../core/PaintContext';
import { CoreDocument } from '../core/CoreDocument';
import { RemoteComposeBuffer } from '../core/RemoteComposeBuffer';
import { RemoteContext } from '../core/RemoteContext';
import { Theme } from '../core/operations/DataOperations';
import { CanvasPaintContext } from './CanvasPaintContext';
import { WebRemoteContext } from './WebRemoteContext';

export type EmbedResolver = (path: string) => Promise<ArrayBuffer | null>;

interface EmbedConfig {
    kind: string;            // "rc", "video", "web", "camera", or "" for a bare path
    path: string;
    fit: string;             // fit | fill | native
    crop: [number, number, number, number];
    mirror: boolean;         // camera: flipped left-right
    gate: number;
    persist: boolean;
    hasStep: boolean;
    step: number;
    stepId: number;
    timeId: number;
}

// "rc:media/film.rc#persist=1&step=0&stepid=42&timeid=43" and friends. A bare "#value" is
// still read as the fit, for back-compat with the first decks.
export function parseEmbedConfig(config: string, defaultFit = 'fit'): EmbedConfig {
    const out: EmbedConfig = {
        kind: '', path: config, fit: defaultFit, crop: [0, 0, 1, 1], mirror: false, gate: 0,
        persist: false, hasStep: false, step: 0, stepId: -1, timeId: -1,
    };
    const colon = config.indexOf(':');
    if (colon > 0 && /^[a-z]+$/.test(config.slice(0, colon))) {
        out.kind = config.slice(0, colon);
        out.path = config.slice(colon + 1);
    }
    // A camera fills its box unless told otherwise, and "camera:" alone is the default one.
    if (out.kind === 'camera') {
        out.fit = 'fill';
        if (!out.path || out.path.startsWith('#')) out.path = 'default' + out.path;
    }
    const hash = out.path.indexOf('#');
    if (hash >= 0) {
        const opts = out.path.slice(hash + 1);
        out.path = out.path.slice(0, hash);
        for (const tok of opts.split('&')) {
            const eq = tok.indexOf('=');
            if (eq < 0) {
                if (tok === 'persist') out.persist = true;
                else if (tok === 'mirror') out.mirror = true;
                else if (tok) out.fit = tok;
                continue;
            }
            const k = tok.slice(0, eq), v = tok.slice(eq + 1);
            if (k === 'fit') out.fit = v;
            else if (k === 'mirror') out.mirror = !(v === '0' || v === 'false' || v === 'off');
            else if (k === 'persist') out.persist = !(v === '0' || v === 'false' || v === 'off');
            else if (k === 'step') { out.hasStep = true; out.step = parseFloat(v) || 0; out.persist = true; }
            else if (k === 'stepid') out.stepId = parseInt(v, 10);
            else if (k === 'timeid') out.timeId = parseInt(v, 10);
            else if (k === 'gate') out.gate = parseFloat(v) || 0;
            else if (k === 'crop') {
                const t = v.split(',').map(parseFloat);
                if (t.length === 4 && t.every(x => !isNaN(x))) out.crop = [t[0], t[1], t[2], t[3]];
            }
        }
    }
    return out;
}

// Where a box of `cropW`×`cropH` source units lands in a `w`×`h` box under `fit`.
export function fitInto(w: number, h: number, cropW: number, cropH: number, fit: string) {
    let s: number;
    if (fit === 'fill') s = Math.max(w / cropW, h / cropH);
    else if (fit === 'native') s = 1;
    else s = Math.min(w / cropW, h / cropH);
    const dw = cropW * s, dh = cropH * s;
    return { s, ox: (w - dw) * 0.5, oy: (h - dh) * 0.5 };
}

interface NestedDoc {
    persist: boolean;
    ok: boolean;
    failed: boolean;
    doc: CoreDocument | null;
    ctx: WebRemoteContext | null;
    paint: CanvasPaintContext | null;
    hostBase: number;        // persist: host seconds accumulated over earlier slides
    hostLast: number;        // persist: the host time last seen, to notice a new slide
}

interface VideoEmbed {
    element: HTMLVideoElement;
    ready: boolean;
}

// The viewer's camera, once asked for: one stream for every camera embed on the page.
interface CameraFeed {
    element: HTMLVideoElement;
    ready: boolean;
    failed: boolean;
    stream: MediaStream | null;
}

// The take recorded with this slide's narration, played under it.
interface CameraTake {
    element: HTMLVideoElement;
    src: string;
    ready: boolean;
}

export class WebCustomHost implements CustomComponentHost {
    private docs = new Map<string, NestedDoc>();
    private videos = new Map<string, VideoEmbed>();
    private camera: CameraFeed | null = null;
    private take: CameraTake | null = null;
    private resolver: EmbedResolver;
    private defaultFit = 'fit';
    // Something asked to be painted before it was ready; the page is told so it paints again.
    private pending = 0;

    constructor(resolver?: EmbedResolver) {
        this.resolver = resolver ?? (async (path: string) => {
            try {
                const response = await fetch(path);
                return response.ok ? await response.arrayBuffer() : null;
            } catch {
                return null;
            }
        });
    }

    setResolver(resolver: EmbedResolver): void { this.resolver = resolver; }
    setDefaultFit(fit: string): void { this.defaultFit = fit; }

    // The camera take for the slide being shown, or null for none. A camera box then draws
    // the recording instead of asking the viewer for their own camera.
    setCameraTake(src: string | null): void {
        if (this.take && this.take.src === src) return;
        if (this.take) {
            this.take.element.pause();
            this.take.element.remove();
            this.take = null;
        }
        if (!src || typeof document === 'undefined') return;
        const element = document.createElement('video');
        element.src = src;
        element.muted = true;            // the narration is the sound; this is the picture
        element.playsInline = true;
        element.preload = 'auto';
        // A detached video element never loads: it lives in the page, out of sight.
        element.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
        document.body.appendChild(element);
        const take: CameraTake = { element, src, ready: false };
        element.addEventListener('loadeddata', () => { take.ready = true; });
        this.take = take;
    }

    // Where the narration has got to, and whether it is running: the take follows it rather
    // than its own clock, so the speaker's face and their voice stay together. Seeking every
    // frame would stall the decoder, so it plays and is nudged back only when it drifts.
    setCameraTakeTime(seconds: number, playing: boolean): void {
        const take = this.take;
        if (!take || !take.ready) return;
        const element = take.element;
        if (playing && element.paused) element.play().catch(() => {});
        if (!playing && !element.paused) element.pause();
        if (Math.abs(element.currentTime - seconds) > 0.25) {
            try { element.currentTime = seconds; } catch { /* not seekable yet */ }
        }
    }

    // A new host document: embeds that do not persist go with the old one. The persistent
    // ones — a film running across slides — carry on, clock and all.
    retire(): void {
        for (const [key, nested] of this.docs) {
            if (!nested.persist) {
                if (nested.paint) nested.paint.dispose();
                this.docs.delete(key);
            }
        }
        for (const [key, video] of this.videos) {
            video.element.pause();
            video.element.removeAttribute('src');
            this.videos.delete(key);
        }
    }

    reset(): void {
        for (const nested of this.docs.values()) if (nested.paint) nested.paint.dispose();
        this.docs.clear();
        this.retire();
    }

    drawCustom(_componentId: number, config: string, pc: PaintContext,
               w: number, h: number, timeSec: number): boolean {
        if (w <= 0 || h <= 0) return false;
        const cfg = parseEmbedConfig(config, this.defaultFit);
        if (!cfg.path) return false;
        if (cfg.kind === 'video') return this.drawVideo(cfg, pc, w, h);
        if (cfg.kind === 'camera') return this.drawCamera(cfg, pc, w, h);
        if (cfg.kind === 'web') return this.drawWebFrame(cfg, pc, w, h);
        if (cfg.kind && cfg.kind !== 'rc') return false;
        return this.drawRc(cfg, config, pc, w, h, timeSec);
    }

    // ── Embedded documents ────────────────────────────────────────────

    private drawRc(cfg: EmbedConfig, config: string, pc: PaintContext,
                   w: number, h: number, timeSec: number): boolean {
        // Gated embed: during a slide's opening transition its expensive live content is
        // skipped (a static snapshot is shown over it instead — refract's `freeze`).
        if (cfg.gate > 0 && timeSec < cfg.gate) return true;

        const host = pc as CanvasPaintContext;
        if (typeof host.getCanvas !== 'function') return false;
        const canvas = host.getCanvas();

        const key = cfg.persist ? 'persist:' + cfg.path : config;
        let nested = this.docs.get(key);
        if (!nested) {
            nested = { persist: cfg.persist, ok: false, failed: false, doc: null, ctx: null,
                       paint: null, hostBase: 0, hostLast: 0 };
            this.docs.set(key, nested);
            this.load(nested, cfg.path, canvas);
        }
        if (!nested.ok) {
            // Loading (or lost): nothing to draw yet, but the page must paint again once it
            // is there, and the box stays the box.
            if (!nested.failed) pc.needsRepaint();
            return true;
        }
        const doc = nested.doc!, ctx = nested.ctx!, paint = nested.paint!;

        let docW = doc.getWidth(), docH = doc.getHeight();
        if (docW <= 0) docW = w;
        if (docH <= 0) docH = h;
        const cropX = cfg.crop[0] * docW, cropY = cfg.crop[1] * docH;
        let cropW = (cfg.crop[2] - cfg.crop[0]) * docW, cropH = (cfg.crop[3] - cfg.crop[1]) * docH;
        if (cropW <= 0 || cropH <= 0) { cropW = docW; cropH = docH; }
        const { s, ox, oy } = fitInto(w, h, cropW, cropH, cfg.fit);

        // A persistent document keeps its own clock (seconds since it first loaded) so a
        // slide change neither restarts nor rewinds it; the host's slide clock still reaches
        // it through `timeid`, and the slide's number through `stepid`. The same stitching
        // as RcDocumentHost.cpp, so a film cut for the desktop plays the same here.
        let docTime = timeSec;
        if (nested.persist) {
            if (timeSec + 1e-6 < nested.hostLast) nested.hostBase += nested.hostLast;
            nested.hostLast = timeSec;
            docTime = nested.hostBase + timeSec;
        }
        paint.setCanvas(canvas);
        ctx.mWidth = docW;
        ctx.mHeight = docH;
        ctx.currentTime = Date.now();
        ctx.overrideFloat(RemoteContext.ID_ANIMATION_TIME, docTime);
        ctx.setAnimationTime(docTime);
        if (cfg.hasStep && cfg.stepId >= 0) ctx.overrideFloat(cfg.stepId, cfg.step);
        if (cfg.timeId >= 0) ctx.overrideFloat(cfg.timeId, timeSec);

        // The engine has already translated the canvas so (0,0)..(w,h) is the component
        // box; clip to it, place the fitted document inside, and paint it in its own
        // coordinate space, clipped to its own bounds so nothing spills past the embed.
        canvas.save();
        canvas.beginPath();
        canvas.rect(0, 0, w, h);
        canvas.clip();
        canvas.translate(ox, oy);
        canvas.scale(s, s);
        canvas.translate(-cropX, -cropY);
        canvas.beginPath();
        canvas.rect(0, 0, docW, docH);
        canvas.clip();
        paint.reset();
        paint.clearNeedsRepaint();
        try {
            doc.paint(ctx, Theme.DARK);
        } finally {
            canvas.restore();
        }
        // An animating embed keeps the page painting, as the desktop player's does.
        if (doc.needsRepaint() >= 0 || paint.doesNeedsRepaint()) pc.needsRepaint();
        return true;
    }

    private async load(nested: NestedDoc, path: string, canvas: CanvasRenderingContext2D): Promise<void> {
        this.pending++;
        try {
            const data = await this.resolver(path);
            if (!data || data.byteLength === 0) { nested.failed = true; return; }
            const doc = new CoreDocument();
            doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(data));
            const paint = new CanvasPaintContext(null as any, canvas);
            const ctx = new WebRemoteContext(paint);
            doc.initializeContext(ctx);
            ctx.setPaintContext(paint);
            paint.setContext(ctx);
            ctx.mWidth = doc.getWidth();
            ctx.mHeight = doc.getHeight();
            ctx.setDensity(1);          // the document's own units; the host's fit scales them
            ctx.setCustomHost(this);    // a document inside a document can embed too
            doc.applyDataOperations(ctx);
            // A tick for bitmap decoding, as the player itself gives a new document.
            await new Promise(resolve => setTimeout(resolve, 50));
            nested.doc = doc;
            nested.ctx = ctx;
            nested.paint = paint;
            nested.ok = true;
        } catch (e) {
            console.error('embed: cannot load ' + path, e);
            nested.failed = true;
        } finally {
            this.pending--;
        }
    }

    // ── Videos ────────────────────────────────────────────────────────

    private drawVideo(cfg: EmbedConfig, pc: PaintContext, w: number, h: number): boolean {
        const host = pc as CanvasPaintContext;
        if (typeof host.getCanvas !== 'function' || typeof document === 'undefined') return false;
        const canvas = host.getCanvas();
        let video = this.videos.get(cfg.path);
        if (!video) {
            const element = document.createElement('video');
            element.src = cfg.path;
            element.muted = true;
            element.loop = true;
            element.playsInline = true;
            element.preload = 'auto';
            video = { element, ready: false };
            element.addEventListener('loadeddata', () => { video!.ready = true; });
            element.play().catch(() => { /* until the page has been clicked */ });
            this.videos.set(cfg.path, video);
        }
        pc.needsRepaint();      // a playing video is a new frame every frame
        const vw = video.element.videoWidth, vh = video.element.videoHeight;
        if (!video.ready || vw <= 0 || vh <= 0) return true;
        if (video.element.paused) video.element.play().catch(() => {});
        const cropX = cfg.crop[0] * vw, cropY = cfg.crop[1] * vh;
        let cropW = (cfg.crop[2] - cfg.crop[0]) * vw, cropH = (cfg.crop[3] - cfg.crop[1]) * vh;
        if (cropW <= 0 || cropH <= 0) { cropW = vw; cropH = vh; }
        const { s, ox, oy } = fitInto(w, h, cropW, cropH, cfg.fit);
        canvas.save();
        canvas.beginPath();
        canvas.rect(0, 0, w, h);
        canvas.clip();
        canvas.drawImage(video.element, cropX, cropY, cropW, cropH, ox, oy, cropW * s, cropH * s);
        canvas.restore();
        return true;
    }

    // ── The camera ────────────────────────────────────────────────────

    // The viewer's own camera in the box, the way the desktop player puts the speaker's
    // there. The stream is asked for once, on the first camera embed, and kept for the
    // page; the browser's own prompt does the asking. Until it arrives — or when it is
    // refused — the box is a dark plate, as on the desktop.
    private drawCamera(cfg: EmbedConfig, pc: PaintContext, w: number, h: number): boolean {
        const host = pc as CanvasPaintContext;
        if (typeof host.getCanvas !== 'function' || typeof document === 'undefined') return false;
        const canvas = host.getCanvas();
        // The take recorded with the narration, when this slide has one: what the speaker's
        // camera saw while they were saying this.
        if (this.take) {
            this.drawVideoInto(canvas, this.take.element, cfg, w, h, this.take.ready);
            pc.needsRepaint();
            return true;
        }
        if (!this.camera) {
            const element = document.createElement('video');
            element.muted = true;
            element.playsInline = true;
            element.autoplay = true;
            // Detached, a video element never starts: it lives in the page, out of sight.
            element.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
            document.body.appendChild(element);
            const feed: CameraFeed = { element, ready: false, failed: false, stream: null };
            this.camera = feed;
            const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
            if (!media || !media.getUserMedia) {
                feed.failed = true;
            } else {
                media.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
                    .then(stream => {
                        feed.stream = stream;
                        element.srcObject = stream;
                        element.addEventListener('loadeddata', () => { feed.ready = true; });
                        element.play().catch(() => {});
                    })
                    .catch(e => { console.warn('camera: not available', e); feed.failed = true; });
            }
        }
        const feed = this.camera;
        this.drawVideoInto(canvas, feed.element, cfg, w, h, feed.ready);
        if (!feed.failed) pc.needsRepaint();      // a live feed is a new frame every frame
        return true;
    }

    // One video element into a camera box: cropped, fitted, mirrored when asked, and a dark
    // plate until there are frames — the same thing the desktop player draws.
    private drawVideoInto(canvas: CanvasRenderingContext2D, element: HTMLVideoElement,
                          cfg: EmbedConfig, w: number, h: number, ready: boolean): void {
        canvas.save();
        canvas.beginPath();
        canvas.rect(0, 0, w, h);
        canvas.clip();
        const vw = element.videoWidth, vh = element.videoHeight;
        if (!ready || vw <= 0 || vh <= 0) {
            canvas.fillStyle = '#101318';
            canvas.fillRect(0, 0, w, h);
            canvas.restore();
            return;
        }
        const cropX = cfg.crop[0] * vw, cropY = cfg.crop[1] * vh;
        let cropW = (cfg.crop[2] - cfg.crop[0]) * vw, cropH = (cfg.crop[3] - cfg.crop[1]) * vh;
        if (cropW <= 0 || cropH <= 0) { cropW = vw; cropH = vh; }
        const { s, ox, oy } = fitInto(w, h, cropW, cropH, cfg.fit);
        if (cfg.mirror) {
            canvas.translate(w, 0);
            canvas.scale(-1, 1);
        }
        canvas.drawImage(element, cropX, cropY, cropW, cropH, ox, oy, cropW * s, cropH * s);
        canvas.restore();
    }

    // ── Web pages ─────────────────────────────────────────────────────

    private drawWebFrame(cfg: EmbedConfig, pc: PaintContext, w: number, h: number): boolean {
        const host = pc as CanvasPaintContext;
        if (typeof host.getCanvas !== 'function') return false;
        const canvas = host.getCanvas();
        canvas.save();
        canvas.beginPath();
        canvas.rect(0, 0, w, h);
        canvas.clip();
        canvas.fillStyle = '#171a20';
        canvas.fillRect(0, 0, w, h);
        canvas.strokeStyle = '#2a2f38';
        canvas.lineWidth = 2;
        canvas.strokeRect(1, 1, w - 2, h - 2);
        canvas.fillStyle = '#868d9c';
        const size = Math.max(12, Math.min(w * 0.03, h * 0.08));
        canvas.font = `${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
        canvas.textAlign = 'center';
        canvas.textBaseline = 'middle';
        canvas.fillText(cfg.path, w * 0.5, h * 0.5, w * 0.9);
        canvas.restore();
        return true;
    }
}
