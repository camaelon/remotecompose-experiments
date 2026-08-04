/**
 * WireBuffer — the write side of androidx `remote-core/WireBuffer.java`.
 *
 * Every multi-byte value is big-endian. That is the whole reason this file exists
 * separately: a document is only correct if it is byte-for-byte what the official
 * writer produces, and endianness is the easiest thing to get quietly wrong in a
 * language whose DataView defaults to little-endian.
 *
 *   writeShort  -> 2 bytes BE
 *   writeInt    -> 4 bytes BE
 *   writeLong   -> 8 bytes BE
 *   writeFloat  -> writeInt(floatToRawIntBits(value))
 *   writeBuffer -> writeInt(length) then the raw bytes
 *   string      -> writeBuffer(utf-8 bytes)
 */

export class WireBuffer {
    private buf: Uint8Array;
    private len = 0;

    constructor(capacity = 1024) {
        this.buf = new Uint8Array(capacity);
    }

    private need(n: number): void {
        if (this.len + n <= this.buf.length) return;
        let cap = this.buf.length * 2;
        while (cap < this.len + n) cap *= 2;
        const next = new Uint8Array(cap);
        next.set(this.buf.subarray(0, this.len));
        this.buf = next;
    }

    // ── primitives ───────────────────────────────────────────────────────

    writeByte(value: number): void {
        this.need(1);
        this.buf[this.len++] = value & 0xff;
    }

    writeBoolean(value: boolean): void {
        this.writeByte(value ? 1 : 0);
    }

    writeShort(value: number): void {
        this.need(2);
        this.buf[this.len++] = (value >>> 8) & 0xff;
        this.buf[this.len++] = value & 0xff;
    }

    writeInt(value: number): void {
        this.need(4);
        // `>>> 0` first: callers pass both signed ids and unsigned constants, and a
        // negative number shifted with >> keeps its sign bits.
        const v = value >>> 0;
        this.buf[this.len++] = (v >>> 24) & 0xff;
        this.buf[this.len++] = (v >>> 16) & 0xff;
        this.buf[this.len++] = (v >>> 8) & 0xff;
        this.buf[this.len++] = v & 0xff;
    }

    writeLong(value: bigint | number): void {
        let v = BigInt(value) & 0xffffffffffffffffn;
        this.need(8);
        for (let i = 7; i >= 0; i--) {
            this.buf[this.len + i] = Number(v & 0xffn);
            v >>= 8n;
        }
        this.len += 8;
    }

    writeFloat(value: number): void {
        const tmp = new DataView(new ArrayBuffer(4));
        tmp.setFloat32(0, value, false); // false == big-endian
        this.need(4);
        for (let i = 0; i < 4; i++) this.buf[this.len++] = tmp.getUint8(i);
    }

    /** Emit 32 bits verbatim — for NaN-encoded ids, whose bit pattern must survive. */
    writeIntBitsAsFloat(bits: number): void {
        this.writeInt(bits);
    }

    writeDouble(value: number): void {
        const tmp = new DataView(new ArrayBuffer(8));
        tmp.setFloat64(0, value, false);
        this.need(8);
        for (let i = 0; i < 8; i++) this.buf[this.len++] = tmp.getUint8(i);
    }

    writeBytes(bytes: Uint8Array): void {
        this.need(bytes.length);
        this.buf.set(bytes, this.len);
        this.len += bytes.length;
    }

    writeBuffer(bytes: Uint8Array): void {
        this.writeInt(bytes.length);
        this.writeBytes(bytes);
    }

    writeUtf8(s: string): void {
        this.writeBuffer(new TextEncoder().encode(s));
    }

    /** WireBuffer.start(type): records the start index, then writes the opcode byte. */
    start(opCode: number): void {
        this.writeByte(opCode);
    }

    overwriteInt(position: number, value: number): void {
        const v = value >>> 0;
        this.buf[position] = (v >>> 24) & 0xff;
        this.buf[position + 1] = (v >>> 16) & 0xff;
        this.buf[position + 2] = (v >>> 8) & 0xff;
        this.buf[position + 3] = v & 0xff;
    }

    /**
     * Move the tail `[beyond, size)` so it begins at `insertLocation`.
     *
     * This is how a `global` section gets hoisted in front of the root: the ops are
     * written in document order and then relocated. Mirrors `WireBuffer.moveBlock`,
     * including its silent no-op guards — those guards are load-bearing, because the
     * parser relies on a bad range doing nothing rather than throwing.
     */
    moveBlock(beyond: number, insertLocation: number): void {
        if (insertLocation < 0 || beyond > this.len || insertLocation >= beyond) return;
        const tail = this.buf.slice(beyond, this.len);
        const head = this.buf.slice(insertLocation, beyond);
        this.buf.set(tail, insertLocation);
        this.buf.set(head, insertLocation + tail.length);
    }

    get index(): number {
        return this.len;
    }

    toBytes(): Uint8Array {
        return this.buf.slice(0, this.len);
    }
}

/** IEEE-754 bit pattern of a float, as an unsigned 32-bit integer. */
export function floatToRawIntBits(f: number): number {
    const dv = new DataView(new ArrayBuffer(4));
    dv.setFloat32(0, f, false);
    return dv.getUint32(0, false);
}

/** The float a 32-bit pattern denotes. */
export function intBitsToFloat(bits: number): number {
    const dv = new DataView(new ArrayBuffer(4));
    dv.setUint32(0, bits >>> 0, false);
    return dv.getFloat32(0, false);
}

/**
 * `Utils.asNan(id)` — an id smuggled inside a NaN payload.
 *
 * RemoteCompose passes ids where floats are expected by hiding them in the mantissa of
 * a NaN. The value must travel as *bits* and never as a JS number: reading it as a
 * float and writing it back canonicalises the payload away, and the id is lost with it.
 */
export function asNanBits(id: number): number {
    return (id | 0xff800000) >>> 0;
}

/** The id inside a NaN-encoded float bit pattern. */
export function idFromNanBits(bits: number): number {
    return bits & 0x3fffff;
}
