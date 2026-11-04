// Compressed documents (Header.COMPRESS = DEFLATE): the fixture was compressed by androidx
// remote-core's own Header.compressDocument, so this checks the player against the reference.
//
//   node tests/compression_test.mjs      (after building build-node/node-entry.js)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { decompressDocument, inflateZlib, isCompressed, RemoteComposeBuffer, CoreDocument } =
    await import(pathToFileURL(path.join(here, "..", "build-node", "node-entry.js")).href);
const fixture = (n) => new Uint8Array(readFileSync(path.join(here, "fixtures", n)));
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// The reference's compressed document decompresses to the original, byte for byte.
const plain = fixture("analog-clock.rc"), packed = fixture("analog-clock.deflate.rc");
assert.equal(isCompressed(packed), true);
assert.equal(isCompressed(plain), false);
assert.ok(packed.length < plain.length);
assert.ok(same(decompressDocument(packed), plain), "decompresses to the uncompressed original");
assert.equal(decompressDocument(plain), plain, "an uncompressed document is passed through");

// The player loads it: same operations as the original.
const ops = (bytes) => {
    const doc = new CoreDocument();
    doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(bytes.slice().buffer));
    return doc.getOperations().map((o) => o.constructor.name);
};
assert.deepEqual(ops(packed), ops(plain));

// Every DEFLATE block type: stored (level 0), fixed and dynamic codes, long matches.
for (const data of [new Uint8Array(0), new Uint8Array(70000).fill(3), Uint8Array.from({ length: 90000 }, (_, i) => (i * 2654435761) >>> 24), plain]) {
    for (const opts of [{ level: 0 }, { level: 1 }, { level: 9 }, { strategy: 2 }, { strategy: 4 }]) {
        assert.ok(same(inflateZlib(new Uint8Array(deflateSync(data, opts))), data), JSON.stringify(opts));
    }
}

// Damaged or unsupported documents are refused with the reference's reasons, never misread.
const bad = (f) => { const c = packed.slice(); f(c); return c; };
const at = packed.findIndex((_, j) => j > 16 && packed[j] === 0 && packed[j + 1] === 31 && packed[j + 2] === 0 && packed[j + 3] === 4);
for (const [bytes, message] of [
    [packed.slice(0, packed.length - 10), /Truncated/],
    [Uint8Array.from([...packed, 0]), /Unexpected data after/],
    [bad((c) => { c[c.length - 1] ^= 1; }), /Corrupted/],
    [bad((c) => { c[at + 7] = 2; }), /Unsupported document compression 2/],
]) assert.throws(() => decompressDocument(bytes), message);

console.log("compression_test: ok");
