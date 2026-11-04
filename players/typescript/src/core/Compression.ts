// Compressed documents (Header.COMPRESS, androidx remote-core Header.decompressDocument).
//
// A document whose header carries the property COMPRESS (key 31, INT) = 1 (DEFLATE) has every
// byte after the header as ONE zlib stream (RFC 1950) that inflates to its operations. The
// header itself is never compressed. Decompressing gives back the uncompressed original byte for
// byte: the header without its COMPRESS property, then the inflated operations. Any other value
// is unsupported; a truncated or corrupt stream, bytes after it, or more than 32 MB inflated is
// an error, as upstream.
//
// The inflater is our own (RFC 1951) rather than the platform's: every loading path is
// synchronous, and a browser only offers the asynchronous DecompressionStream.

export const COMPRESS = 31;
export const COMPRESSION_NONE = 0;
export const COMPRESSION_DEFLATE = 1;
/** Limits.MAX_DECOMPRESSED_SIZE. */
export const MAX_DECOMPRESSED_SIZE = 32 * 1024 * 1024;

const MAGIC = 0x048c0000;
const PROPERTY_COUNT_OFFSET = 1 + 3 * 4;
const PROPERTIES_OFFSET = PROPERTY_COUNT_OFFSET + 4;

const int32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) | 0;
const uint16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];

/** The modern header's extent and its COMPRESS value: null when the bytes have no property header. */
function headerInfo(b: Uint8Array): { end: number; compression: number | null; count: number } | null {
    if (b.length < PROPERTIES_OFFSET || b[0] !== 0) return null;
    if ((int32(b, 1) & 0xffff0000) !== MAGIC) return null;
    const count = int32(b, PROPERTY_COUNT_OFFSET);
    let at = PROPERTIES_OFFSET, compression: number | null = null;
    for (let i = 0; i < count; i++) {
        if (at + 4 > b.length) throw new Error("Malformed header properties");
        const tag = uint16(b, at), len = uint16(b, at + 2);
        const end = at + 4 + len;
        if (end > b.length) throw new Error("Malformed header properties");
        if ((tag & 0x3f) === COMPRESS && (tag >> 10) === 0 && len === 4) compression = int32(b, at + 4);
        at = end;
    }
    return { end: at, compression, count };
}

/** Whether these document bytes are compressed (COMPRESS present and not NONE). */
export function isCompressed(bytes: Uint8Array): boolean {
    try {
        const h = headerInfo(bytes);
        return !!h && h.compression !== null && h.compression !== COMPRESSION_NONE;
    } catch { return false; }
}

/**
 * The document uncompressed: the same bytes when it is not compressed, else its header without
 * COMPRESS followed by the inflated operations. Throws on an unsupported or damaged stream.
 */
export function decompressDocument(bytes: Uint8Array): Uint8Array {
    const h = headerInfo(bytes);
    if (!h || h.compression === null || h.compression === COMPRESSION_NONE) return bytes;
    if (h.compression !== COMPRESSION_DEFLATE) throw new Error(`Unsupported document compression ${h.compression}`);
    // The header, less its COMPRESS property.
    const head: number[] = [];
    for (let i = 0; i < PROPERTY_COUNT_OFFSET; i++) head.push(bytes[i]);
    const props: number[] = [];
    let kept = 0;
    for (let i = 0, at = PROPERTIES_OFFSET; i < h.count; i++) {
        const tag = uint16(bytes, at), end = at + 4 + uint16(bytes, at + 2);
        if ((tag & 0x3f) !== COMPRESS) { for (let j = at; j < end; j++) props.push(bytes[j]); kept++; }
        at = end;
    }
    const body = inflateZlib(bytes.subarray(h.end), MAX_DECOMPRESSED_SIZE);
    const out = new Uint8Array(head.length + 4 + props.length + body.length);
    out.set(head, 0);
    out.set([(kept >>> 24) & 255, (kept >>> 16) & 255, (kept >>> 8) & 255, kept & 255], head.length);
    out.set(props, head.length + 4);
    out.set(body, head.length + 4 + props.length);
    return out;
}

// ── zlib (RFC 1950) around DEFLATE (RFC 1951) ──

/** Inflates one complete zlib stream; it must end exactly at the end of `data`. */
export function inflateZlib(data: Uint8Array, maxOut = MAX_DECOMPRESSED_SIZE): Uint8Array {
    if (data.length < 6) throw new Error("Truncated compressed document");
    const cmf = data[0], flg = data[1];
    if ((cmf & 0x0f) !== 8 || (cmf >> 4) > 7 || ((cmf << 8) | flg) % 31 !== 0) throw new Error("Corrupted compressed document");
    if (flg & 0x20) throw new Error("Corrupted compressed document");   // a preset dictionary
    const inf = new Inflater(data, 2, maxOut);
    inf.run();
    const end = inf.byteEnd();
    if (end + 4 > data.length) throw new Error("Truncated compressed document");
    const out = inf.result();
    if ((int32(data, end) >>> 0) !== adler32(out)) throw new Error("Corrupted compressed document");
    if (end + 4 !== data.length) throw new Error("Unexpected data after the compressed document");
    return out;
}

function adler32(b: Uint8Array): number {
    let a = 1, s = 0;
    for (let i = 0; i < b.length;) {
        const n = Math.min(b.length, i + 3800);
        for (; i < n; i++) { a += b[i]; s += a; }
        a %= 65521; s %= 65521;
    }
    return ((s << 16) | a) >>> 0;
}

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** A canonical Huffman code: how many codes of each length, and the symbols in code order. */
class Huffman {
    counts = new Uint16Array(16);
    symbols: Uint16Array;
    constructor(lengths: ArrayLike<number>, n: number) {
        this.symbols = new Uint16Array(n);
        for (let i = 0; i < n; i++) this.counts[lengths[i]]++;
        this.counts[0] = 0;
        // Over-subscribed is corrupt; incomplete is allowed (a single distance code).
        let left = 1;
        for (let len = 1; len < 16; len++) { left = (left << 1) - this.counts[len]; if (left < 0) throw new Error("Corrupted compressed document"); }
        const offs = new Uint16Array(16);
        for (let len = 1; len < 15; len++) offs[len + 1] = offs[len] + this.counts[len];
        for (let i = 0; i < n; i++) if (lengths[i]) this.symbols[offs[lengths[i]]++] = i;
    }
}

let FIXED: [Huffman, Huffman] | null = null;
function fixedCodes(): [Huffman, Huffman] {
    if (!FIXED) {
        const l = new Uint8Array(288);
        l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
        FIXED = [new Huffman(l, 288), new Huffman(new Uint8Array(30).fill(5), 30)];
    }
    return FIXED;
}

class Inflater {
    private pos: number;
    private bitBuf = 0;
    private bitCnt = 0;
    private out: Uint8Array;
    private n = 0;
    constructor(private src: Uint8Array, start: number, private max: number) {
        this.pos = start;
        this.out = new Uint8Array(Math.min(max, Math.max(1024, src.length * 4)));
    }
    private bits(need: number): number {
        while (this.bitCnt < need) {
            if (this.pos >= this.src.length) throw new Error("Truncated compressed document");
            this.bitBuf |= this.src[this.pos++] << this.bitCnt;
            this.bitCnt += 8;
        }
        const v = this.bitBuf & ((1 << need) - 1);
        this.bitBuf >>>= need;
        this.bitCnt -= need;
        return v;
    }
    private decode(h: Huffman): number {
        let code = 0, first = 0, index = 0;
        for (let len = 1; len < 16; len++) {
            code |= this.bits(1);
            const count = h.counts[len];
            if (code - count < first) return h.symbols[index + (code - first)];
            index += count;
            first = (first + count) << 1;
            code <<= 1;
        }
        throw new Error("Corrupted compressed document");
    }
    private put(b: number): void {
        if (this.n >= this.out.length) {
            if (this.n >= this.max) throw new Error(`Decompressed document exceeds ${this.max} bytes`);
            const bigger = new Uint8Array(Math.min(this.max, this.out.length * 2));
            bigger.set(this.out);
            this.out = bigger;
        }
        this.out[this.n++] = b;
    }
    run(): void {
        let last = 0;
        while (!last) {
            last = this.bits(1);
            const type = this.bits(2);
            if (type === 0) this.stored();
            else if (type === 1) { const [l, d] = fixedCodes(); this.codes(l, d); }
            else if (type === 2) this.dynamic();
            else throw new Error("Corrupted compressed document");
        }
    }
    private stored(): void {
        this.bitBuf = 0; this.bitCnt = 0;   // to a byte boundary
        if (this.pos + 4 > this.src.length) throw new Error("Truncated compressed document");
        const len = this.src[this.pos] | (this.src[this.pos + 1] << 8);
        const nlen = this.src[this.pos + 2] | (this.src[this.pos + 3] << 8);
        this.pos += 4;
        if (len !== (~nlen & 0xffff)) throw new Error("Corrupted compressed document");
        if (this.pos + len > this.src.length) throw new Error("Truncated compressed document");
        for (let i = 0; i < len; i++) this.put(this.src[this.pos++]);
    }
    private dynamic(): void {
        const nlen = this.bits(5) + 257, ndist = this.bits(5) + 1, ncode = this.bits(4) + 4;
        if (nlen > 286 || ndist > 30) throw new Error("Corrupted compressed document");
        const lengths = new Uint8Array(320);
        for (let i = 0; i < ncode; i++) lengths[CL_ORDER[i]] = this.bits(3);
        const cl = new Huffman(lengths, 19);
        lengths.fill(0);
        for (let i = 0; i < nlen + ndist;) {
            const sym = this.decode(cl);
            if (sym < 16) { lengths[i++] = sym; continue; }
            let len = 0, rep: number;
            if (sym === 16) { if (i === 0) throw new Error("Corrupted compressed document"); len = lengths[i - 1]; rep = 3 + this.bits(2); }
            else if (sym === 17) rep = 3 + this.bits(3);
            else rep = 11 + this.bits(7);
            if (i + rep > nlen + ndist) throw new Error("Corrupted compressed document");
            while (rep--) lengths[i++] = len;
        }
        if (!lengths[256]) throw new Error("Corrupted compressed document");
        this.codes(new Huffman(lengths, nlen), new Huffman(lengths.subarray(nlen), ndist));
    }
    private codes(lit: Huffman, dist: Huffman): void {
        for (;;) {
            let sym = this.decode(lit);
            if (sym < 256) { this.put(sym); continue; }
            if (sym === 256) return;
            sym -= 257;
            if (sym >= 29) throw new Error("Corrupted compressed document");
            const len = LEN_BASE[sym] + this.bits(LEN_EXTRA[sym]);
            const ds = this.decode(dist);
            if (ds >= 30) throw new Error("Corrupted compressed document");
            const d = DIST_BASE[ds] + this.bits(DIST_EXTRA[ds]);
            if (d > this.n) throw new Error("Corrupted compressed document");
            for (let i = 0; i < len; i++) this.put(this.out[this.n - d]);
        }
    }
    /** Where the DEFLATE data ended: the next whole byte. */
    byteEnd(): number { return this.pos - (this.bitCnt >> 3); }
    result(): Uint8Array { return this.out.slice(0, this.n); }
}
