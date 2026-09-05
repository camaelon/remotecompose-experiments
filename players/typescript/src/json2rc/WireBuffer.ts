/**
 * WireBuffer — the write side of the RemoteCompose wire format.
 *
 * A byte-for-byte port of `rcj/wire.py`, which is itself a port of remote-core's
 * WireBuffer.java. Everything is big-endian. The only subtlety is that a "float" field may
 * carry a NaN-boxed variable id rather than a number, so there are two ways in: `writeFloat`
 * for a real value and `writeIntBitsAsFloat` for a bit pattern that must survive untouched.
 */
export class WireBuffer {
    private buf: Uint8Array = new Uint8Array(1024);
    private len = 0;

    private ensure(n: number): void {
        if (this.len + n <= this.buf.length) return;
        let cap = this.buf.length * 2;
        while (cap < this.len + n) cap *= 2;
        const next = new Uint8Array(cap);
        next.set(this.buf.subarray(0, this.len));
        this.buf = next;
    }

    writeByte(value: number): void {
        this.ensure(1);
        this.buf[this.len++] = value & 0xff;
    }

    writeBoolean(value: boolean): void {
        this.writeByte(value ? 1 : 0);
    }

    writeShort(value: number): void {
        this.ensure(2);
        this.buf[this.len++] = (value >>> 8) & 0xff;
        this.buf[this.len++] = value & 0xff;
    }

    writeInt(value: number): void {
        this.ensure(4);
        // >>> 0 first: ids are written as signed ints and constants as unsigned, and both
        // have to land as the same 32 bits.
        const v = value >>> 0;
        this.buf[this.len++] = (v >>> 24) & 0xff;
        this.buf[this.len++] = (v >>> 16) & 0xff;
        this.buf[this.len++] = (v >>> 8) & 0xff;
        this.buf[this.len++] = v & 0xff;
    }

    writeLong(value: bigint | number): void {
        let v = BigInt(value) & 0xffffffffffffffffn;
        this.ensure(8);
        for (let i = 7; i >= 0; i--) {
            this.buf[this.len + i] = Number(v & 0xffn);
            v >>= 8n;
        }
        this.len += 8;
    }

    writeFloat(value: number): void {
        const dv = new DataView(new ArrayBuffer(4));
        dv.setFloat32(0, value, false);
        this.writeInt(dv.getUint32(0, false));
    }

    /** A raw 32-bit pattern — a NaN-boxed id must not be round-tripped through a float. */
    writeIntBitsAsFloat(bits: number): void {
        this.writeInt(bits);
    }

    writeDouble(value: number): void {
        const dv = new DataView(new ArrayBuffer(8));
        dv.setFloat64(0, value, false);
        this.writeLong(dv.getBigUint64(0, false));
    }

    write(bytes: Uint8Array): void {
        this.ensure(bytes.length);
        this.buf.set(bytes, this.len);
        this.len += bytes.length;
    }

    writeBuffer(bytes: Uint8Array): void {
        this.writeInt(bytes.length);
        this.write(bytes);
    }

    writeUtf8(s: string): void {
        this.writeBuffer(new TextEncoder().encode(s));
    }

    /** WireBuffer.start(type): the opcode byte, nothing else — there is no length field. */
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
     * Move the tail `[beyond, size)` so it starts at `insertLocation`.
     *
     * How a `global` section is hoisted ahead of the root: the ops are written in place and
     * then relocated. The guards are silent no-ops in the reference, so they are here too.
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

/** Raw IEEE-754 bits of a float32, as an unsigned 32-bit number. */
export function floatToRawIntBits(f: number): number {
    const dv = new DataView(new ArrayBuffer(4));
    dv.setFloat32(0, f, false);
    return dv.getUint32(0, false);
}

/** Utils.asNan(id) — the id smuggled into a NaN payload. */
export function asNanBits(id: number): number {
    return (id | 0xff800000) >>> 0;
}

/** The id back out of a NaN-boxed float's bits. */
export function idFromNanBits(bits: number): number {
    return bits & 0x007fffff;
}

/** The float a 32-bit pattern denotes — the inverse of floatToRawIntBits. */
export function f32FromBits(bits: number): number {
    const b = new ArrayBuffer(4);
    new DataView(b).setUint32(0, bits >>> 0);
    return new DataView(b).getFloat32(0);
}
