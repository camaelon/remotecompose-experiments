// Thumbnails of the example renders for the examples site, made once and kept on disk.
// The cards used to load every full-size render (1280x800 PNGs for a 240 px card, plus its
// strip of looks), so a page load moved tens of megabytes. Dependency-free: a minimal PNG
// decoder (8-bit grey/RGB/RGBA/palette, not interlaced), an area-average downscale and a
// PNG encoder, all on node:zlib.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { deflateSync, inflateSync } from "node:zlib";

export const THUMB_DIR = process.env.RC_THUMB_DIR ?? path.join(os.tmpdir(), "rc-example-thumbs");

const CRC = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
    return t;
})();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }

/** {width, height, rgba: Uint8Array} */
export function decodePng(buf) {
    if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
    let p = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0, palette = null, trns = null;
    const idat = [];
    while (p < buf.length) {
        const len = buf.readUInt32BE(p), type = buf.toString("latin1", p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
        if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
        else if (type === "PLTE") palette = data;
        else if (type === "tRNS") trns = data;
        else if (type === "IDAT") idat.push(data);
        else if (type === "IEND") break;
        p += 12 + len;
    }
    if (depth !== 8 || interlace) throw new Error(`unsupported PNG (depth ${depth}, interlace ${interlace})`);
    const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
    if (!ch) throw new Error(`unsupported PNG colour type ${ctype}`);
    const raw = inflateSync(Buffer.concat(idat));
    const stride = w * ch, px = new Uint8Array(h * stride);
    for (let y = 0; y < h; y++) {
        const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
        for (let x = 0; x < stride; x++) {
            const a = x >= ch ? px[dst + x - ch] : 0, b = y ? px[dst - stride + x] : 0, c = x >= ch && y ? px[dst - stride + x - ch] : 0;
            let v = raw[src + x];
            if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
            else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
            px[dst + x] = v & 0xff;
        }
    }
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
        let r, g, b, al = 255;
        if (ctype === 6) { r = px[i * 4]; g = px[i * 4 + 1]; b = px[i * 4 + 2]; al = px[i * 4 + 3]; }
        else if (ctype === 2) { r = px[i * 3]; g = px[i * 3 + 1]; b = px[i * 3 + 2]; }
        else if (ctype === 0) { r = g = b = px[i]; }
        else if (ctype === 4) { r = g = b = px[i * 2]; al = px[i * 2 + 1]; }
        else { const k = px[i]; r = palette[k * 3]; g = palette[k * 3 + 1]; b = palette[k * 3 + 2]; al = trns && k < trns.length ? trns[k] : 255; }
        rgba.set([r, g, b, al], i * 4);
    }
    return { width: w, height: h, rgba };
}

/** Area-average downscale to `tw` wide (never up). */
export function downscale(img, tw) {
    if (img.width <= tw) return img;
    const th = Math.max(1, Math.round(img.height * tw / img.width)), sx = img.width / tw, sy = img.height / th;
    const out = new Uint8Array(tw * th * 4);
    for (let y = 0; y < th; y++) {
        const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
        for (let x = 0; x < tw; x++) {
            const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
            let r = 0, g = 0, b = 0, a = 0, n = 0;
            for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
                const i = (yy * img.width + xx) * 4, al = img.rgba[i + 3];
                r += img.rgba[i] * al; g += img.rgba[i + 1] * al; b += img.rgba[i + 2] * al; a += al; n++;
            }
            const o = (y * tw + x) * 4;
            if (a) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
            out[o + 3] = Math.round(a / n);
        }
    }
    return { width: tw, height: th, rgba: out };
}

export function encodePng(img) {
    const { width: w, height: h, rgba } = img;
    const opaque = rgba.every((v, i) => i % 4 !== 3 || v === 255), ch = opaque ? 3 : 4, stride = w * ch;
    const raw = Buffer.alloc(h * (stride + 1));
    for (let y = 0; y < h; y++) {
        // Filter "up" (2): renders are mostly flat colour, it compresses well and is cheap.
        raw[y * (stride + 1)] = 2;
        for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) {
            const v = rgba[(y * w + x) * 4 + c], up = y ? rgba[((y - 1) * w + x) * 4 + c] : 0;
            raw[y * (stride + 1) + 1 + x * ch + c] = (v - up) & 0xff;
        }
    }
    const chunk = (type, data) => {
        const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, "latin1");
        const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
        return Buffer.concat([head, data, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = opaque ? 2 : 6;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr),
        chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/**
 * The thumbnail of `file`, `width` px wide, as PNG bytes: from the disk cache when the source
 * is unchanged, else made and cached. Falls back to the source bytes if it cannot decode it.
 */
export function thumbnail(file, width) {
    const st = statSync(file);
    const key = createHash("sha1").update(`${file}|${st.mtimeMs}|${st.size}|${width}`).digest("hex");
    const out = path.join(THUMB_DIR, `${key}.png`);
    if (existsSync(out)) return readFileSync(out);
    const src = readFileSync(file);
    let png;
    try { png = encodePng(downscale(decodePng(src), width)); } catch { return src; }
    if (png.length >= src.length) png = src;   // a small render: the original is the thumbnail
    try { mkdirSync(THUMB_DIR, { recursive: true }); const tmp = `${out}.${process.pid}`; writeFileSync(tmp, png); renameSync(tmp, out); } catch {}
    return png;
}
