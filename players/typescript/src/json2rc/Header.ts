/**
 * The Header op (opcode 0). Port of `rcj/header.py` / remote-core Header.apply, apiLevel >= 7.
 *
 *   start(0), int(MAJOR|MAGIC), int(MINOR), int(PATCH), int(tagCount), then the tag map.
 *
 * `apiLevel` and `orderedResources` are not tags — the parser special-cases them. Tags are
 * sorted by tag number before being written, which is load-bearing: the same header written
 * in a different key order must produce the same bytes.
 */
import { WireBuffer } from "./WireBuffer";

export const HEADER_OP = 0;
const MAGIC_NUMBER = 0x048c0000;
const MAJOR_VERSION = 1;
const MINOR_VERSION = 1;
const PATCH_VERSION = 0;

const DATA_TYPE_INT = 0;
const DATA_TYPE_FLOAT = 1;
const DATA_TYPE_STRING = 3;

/** JSON header key -> tag number (parseHeaderTagStatic). */
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

export type Tag = [number, number | string];

function writeMap(buffer: WireBuffer, tags: Tag[]): void {
    for (const [tag, value] of tags) {
        if (typeof value === "string") {
            buffer.writeShort((tag | (DATA_TYPE_STRING << 10)) & 0xffff);
            const data = new TextEncoder().encode(value);
            buffer.writeShort(data.length + 4);
            buffer.writeBuffer(data);
        } else if (Number.isInteger(value)) {
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

export function applyHeader(buffer: WireBuffer, apiLevel: number, tags: Tag[]): void {
    if (apiLevel < 7) throw new Error("only apiLevel >= 7 is implemented");
    const ordered = [...tags].sort((a, b) => a[0] - b[0]);
    buffer.start(HEADER_OP);
    buffer.writeInt(MAJOR_VERSION | MAGIC_NUMBER);
    buffer.writeInt(MINOR_VERSION);
    buffer.writeInt(PATCH_VERSION);
    buffer.writeInt(ordered.length);
    writeMap(buffer, ordered);
}
