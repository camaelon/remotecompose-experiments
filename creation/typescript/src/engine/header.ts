/**
 * Header op (opcode 0) — `Header.apply` for apiLevel >= 7.
 *
 *   start(HEADER=0)
 *   writeInt(MAJOR_VERSION | MAGIC_NUMBER)
 *   writeInt(MINOR_VERSION)
 *   writeInt(PATCH_VERSION)
 *   writeInt(tagCount)
 *   writeMap(tags)            each: writeShort(tag | dataType<<10), writeShort(size), value
 *
 * Tags are emitted in ascending tag order, not in the order they appear in the JSON —
 * two documents with the same header written in a different key order must produce the
 * same bytes.
 *
 * `apiLevel` and `orderedResources` are not tags; the parser special-cases both.
 */

import { WireBuffer } from "./wire.js";

export const HEADER_OP = 0;
export const MAGIC_NUMBER = 0x048c0000;
export const MAJOR_VERSION = 1;
export const MINOR_VERSION = 1;
export const PATCH_VERSION = 0;

export const DATA_TYPE_INT = 0;
export const DATA_TYPE_FLOAT = 1;
export const DATA_TYPE_LONG = 2;
export const DATA_TYPE_STRING = 3;

/** JSON header key -> tag number (`parseHeaderTagStatic`). */
export const HEADER_KEY_TO_TAG: Record<string, number> = {
    width: 5,
    height: 6,
    desiredFPS: 8,
    fps: 8,
    contentDescription: 9,
    profiles: 14,
    featurePaintMeasure: 15,
    debug: 16,
    theme: 21,
    ltResize: 24,
    densityBehavior: 27,
};

export type HeaderValue = number | string | boolean;
export type HeaderTag = [number, HeaderValue];

/** Is this number meant to travel as an int rather than a float? */
function isIntLike(v: number): boolean {
    return Number.isInteger(v);
}

export function writeMap(buffer: WireBuffer, tags: HeaderTag[]): void {
    for (const [tag, value] of tags) {
        if (typeof value === "string") {
            buffer.writeShort((tag | (DATA_TYPE_STRING << 10)) & 0xffff);
            const data = new TextEncoder().encode(value);
            buffer.writeShort(data.length + 4);
            buffer.writeBuffer(data);
        } else if (typeof value === "boolean") {
            buffer.writeShort((tag | (DATA_TYPE_INT << 10)) & 0xffff);
            buffer.writeShort(4);
            buffer.writeInt(value ? 1 : 0);
        } else if (isIntLike(value)) {
            buffer.writeShort((tag | (DATA_TYPE_INT << 10)) & 0xffff);
            buffer.writeShort(4);
            buffer.writeInt(value);
        } else {
            buffer.writeShort((tag | (DATA_TYPE_FLOAT << 10)) & 0xffff);
            buffer.writeShort(4);
            buffer.writeFloat(value);
        }
    }
}

export function applyHeader(buffer: WireBuffer, apiLevel: number, tags: HeaderTag[]): void {
    if (apiLevel < 7) throw new Error("only apiLevel >= 7 is implemented");
    const ordered = [...tags].sort((a, b) => a[0] - b[0]);
    buffer.start(HEADER_OP);
    buffer.writeInt(MAJOR_VERSION | MAGIC_NUMBER);
    buffer.writeInt(MINOR_VERSION);
    buffer.writeInt(PATCH_VERSION);
    buffer.writeInt(ordered.length);
    writeMap(buffer, ordered);
}
