"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HEADER_KEY_TO_TAG = exports.HEADER_OP = void 0;
exports.applyHeader = applyHeader;
exports.HEADER_OP = 0;
const MAGIC_NUMBER = 0x048c0000;
const MAJOR_VERSION = 1;
const MINOR_VERSION = 1;
const PATCH_VERSION = 0;
const DATA_TYPE_INT = 0;
const DATA_TYPE_FLOAT = 1;
const DATA_TYPE_STRING = 3;
/** JSON header key -> tag number (parseHeaderTagStatic). */
exports.HEADER_KEY_TO_TAG = {
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
function writeMap(buffer, tags) {
    for (const [tag, value] of tags) {
        if (typeof value === "string") {
            buffer.writeShort((tag | (DATA_TYPE_STRING << 10)) & 0xffff);
            const data = new TextEncoder().encode(value);
            buffer.writeShort(data.length + 4);
            buffer.writeBuffer(data);
        }
        else if (Number.isInteger(value)) {
            buffer.writeShort((tag | (DATA_TYPE_INT << 10)) & 0xffff);
            buffer.writeShort(4);
            buffer.writeInt(value);
        }
        else {
            buffer.writeShort((tag | (DATA_TYPE_FLOAT << 10)) & 0xffff);
            buffer.writeShort(4);
            buffer.writeFloat(value);
        }
    }
}
function applyHeader(buffer, apiLevel, tags) {
    if (apiLevel < 7)
        throw new Error("only apiLevel >= 7 is implemented");
    const ordered = [...tags].sort((a, b) => a[0] - b[0]);
    buffer.start(exports.HEADER_OP);
    buffer.writeInt(MAJOR_VERSION | MAGIC_NUMBER);
    buffer.writeInt(MINOR_VERSION);
    buffer.writeInt(PATCH_VERSION);
    buffer.writeInt(ordered.length);
    writeMap(buffer, ordered);
}
