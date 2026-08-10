/**
 * Parsing stubs for operations the player does not implement.
 *
 * The wire format has no length prefix: each operation's reader must consume exactly its
 * own payload or the byte stream loses alignment. So an unregistered opcode is not merely
 * "a feature that does nothing" — the reader cannot skip it, and `RemoteComposeBuffer`
 * gives up on the rest of the document. Everything after the first unknown opcode is
 * dropped, which usually presents as a document that renders a prefix of itself.
 *
 * These stubs close that hole. Each one reads the *exact* fields the Java reference reads,
 * so the stream stays aligned, and then does nothing. The operation still has no effect —
 * a document using a bitmap font still will not show one — but the rest of the document
 * survives, and `deepToString` names what was skipped instead of leaving a silent gap.
 *
 * The layouts are taken from the reference readers (`remote-core`), not guessed. Where a
 * field is variable-length or conditional, the comment says which reference class to check:
 * a stub that mis-reads a length is worse than no stub, because it desynchronises the
 * stream while looking like support.
 *
 * Implementing one of these for real means replacing the stub, not editing around it.
 * Inventory and priorities: docs/TS_PLAYER_ISSUES.md, docs/MISSING_SUPPORT.md.
 */

import { Operation } from '../Operation';
import type { RemoteContext } from '../RemoteContext';
import type { WireBuffer } from '../WireBuffer';

/**
 * Base for an operation that is parsed but not executed.
 *
 * `apply` is deliberately empty rather than throwing: the document has already loaded, and
 * failing at paint time would turn a partially-supported document into a crashing one.
 */
abstract class UnsupportedOperation extends Operation {
    /** Opcode name, for deepToString — so a dump says what was skipped. */
    protected abstract readonly opName: string;

    write(_buffer: WireBuffer): void { /* stub: these are never re-serialised */ }

    apply(_context: RemoteContext): void { /* parsed, not executed */ }

    deepToString(indent: string): string {
        return `${indent}${this.opName} (unsupported, parsed only)`;
    }
}

/**
 * Several bitmap-font operations encode an optional glyph-spacing float in the sign bit of
 * their first int. The extra float is only present when that bit is set, so a reader that
 * assumes a fixed size desynchronises on exactly the documents that use letter spacing.
 */
function readGlyphSpacedId(buffer: WireBuffer): void {
    const first = buffer.readInt();
    if ((first & 0x80000000) !== 0) {
        buffer.readFloat();
    }
}

// ── Components and animation ──────────────────────────────────────────────────

/** COMPONENT_START (2) — `ComponentStart`: type, componentId, width, height. */
export class ComponentStartStub extends UnsupportedOperation {
    static readonly OP_CODE = 2;
    protected readonly opName = 'ComponentStart';
    static read(buffer: WireBuffer, operations: Operation[]): void {
        buffer.readInt();    // type
        buffer.readInt();    // componentId
        buffer.readFloat();  // width
        buffer.readFloat();  // height
        operations.push(new ComponentStartStub());
    }
}

/** ANIMATION_SPEC (14) — `AnimationSpec`: 7 fields, mixed int/float. */
export class AnimationSpecStub extends UnsupportedOperation {
    static readonly OP_CODE = 14;
    protected readonly opName = 'AnimationSpec';
    static read(buffer: WireBuffer, operations: Operation[]): void {
        buffer.readInt();    // animationId
        buffer.readFloat();  // motionDuration
        buffer.readInt();    // motionEasingType
        buffer.readFloat();  // visibilityDuration
        buffer.readInt();    // visibilityEasingType
        buffer.readInt();    // enterAnimation
        buffer.readInt();    // exitAnimation
        operations.push(new AnimationSpecStub());
    }
}

// ── Bitmap fonts ─────────────────────────────────────────────────────────────
// The largest coherent block of unreadable documents: a document with a custom font was
// previously truncated at its first font operation rather than merely unstyled.

/** DRAW_BITMAP_FONT_TEXT_RUN (48) — `DrawBitmapFontText`. */
export class DrawBitmapFontTextStub extends UnsupportedOperation {
    static readonly OP_CODE = 48;
    protected readonly opName = 'DrawBitmapFontText';
    static read(buffer: WireBuffer, operations: Operation[]): void {
        readGlyphSpacedId(buffer);  // text id, optionally followed by glyphSpacing
        buffer.readInt();           // bitmapFont
        buffer.readInt();           // start
        buffer.readInt();           // end
        buffer.readFloat();         // x
        buffer.readFloat();         // y
        operations.push(new DrawBitmapFontTextStub());
    }
}

/** DRAW_BITMAP_FONT_TEXT_RUN_ON_PATH (49) — `DrawBitmapFontTextOnPath`. */
export class DrawBitmapFontTextOnPathStub extends UnsupportedOperation {
    static readonly OP_CODE = 49;
    protected readonly opName = 'DrawBitmapFontTextOnPath';
    static read(buffer: WireBuffer, operations: Operation[]): void {
        readGlyphSpacedId(buffer);  // text id (+ optional glyphSpacing)
        buffer.readInt();           // bitmapFont
        buffer.readInt();           // path
        buffer.readInt();           // start
        buffer.readInt();           // end
        buffer.readFloat();         // yAdj
        operations.push(new DrawBitmapFontTextOnPathStub());
    }
}

/** BITMAP_TEXT_MEASURE (183) — `BitmapTextMeasure`. */
export class BitmapTextMeasureStub extends UnsupportedOperation {
    static readonly OP_CODE = 183;
    protected readonly opName = 'BitmapTextMeasure';
    static read(buffer: WireBuffer, operations: Operation[]): void {
        readGlyphSpacedId(buffer);  // out id (+ optional glyphSpacing)
        buffer.readInt();           // textId
        buffer.readInt();           // bitmapFontId
        buffer.readInt();           // type
        operations.push(new BitmapTextMeasureStub());
    }
}

/** DRAW_BITMAP_TEXT_ANCHORED (184) — `DrawBitmapTextAnchored`. */
export class DrawBitmapTextAnchoredStub extends UnsupportedOperation {
    static readonly OP_CODE = 184;
    protected readonly opName = 'DrawBitmapTextAnchored';
    static read(buffer: WireBuffer, operations: Operation[]): void {
        readGlyphSpacedId(buffer);  // text id (+ optional glyphSpacing)
        buffer.readInt();           // bitmapFont
        buffer.readFloat();         // start
        buffer.readFloat();         // end
        buffer.readFloat();         // x
        buffer.readFloat();         // y
        buffer.readFloat();         // panX
        buffer.readFloat();         // panY
        operations.push(new DrawBitmapTextAnchoredStub());
    }
}

/**
 * DATA_BITMAP_FONT (167) — `BitmapFontData`.
 *
 * The most intricate layout of the fifteen, and the one where a guess would be most
 * damaging: a glyph count packed into the low half of an int with a *version* in the high
 * half, a variable-length glyph table, and — only from version 2 — a kerning table. Both
 * tables hold UTF-8 strings, so the size cannot be computed without walking them.
 */
export class BitmapFontDataStub extends UnsupportedOperation {
    static readonly OP_CODE = 167;
    static readonly VERSION_2 = 2;
    protected readonly opName = 'BitmapFontData';
    static read(buffer: WireBuffer, operations: Operation[]): void {
        buffer.readInt();                          // id
        const versionAndCount = buffer.readInt();
        const version = versionAndCount >>> 16;
        const numGlyphs = versionAndCount & 0xffff;
        for (let i = 0; i < numGlyphs; i++) {
            buffer.readUTF8();   // chars
            buffer.readInt();    // bitmapId
            buffer.readShort();  // marginLeft
            buffer.readShort();  // marginTop
            buffer.readShort();  // marginRight
            buffer.readShort();  // marginBottom
            buffer.readShort();  // bitmapWidth
            buffer.readShort();  // bitmapHeight
        }
        if (version >= BitmapFontDataStub.VERSION_2) {
            const numKerning = buffer.readShort();
            for (let i = 0; i < numKerning; i++) {
                buffer.readUTF8();   // glyph pair
                buffer.readShort();  // adjustment
            }
        }
        operations.push(new BitmapFontDataStub());
    }
}

/** DATA_FONT (189) — `FontData`: ids then a length-prefixed blob. */
export class FontDataStub extends UnsupportedOperation {
    static readonly OP_CODE = 189;
    protected readonly opName = 'FontData';
    static read(buffer: WireBuffer, operations: Operation[]): void {
        buffer.readInt();     // imageId
        buffer.readInt();     // type
        buffer.readBuffer();  // font bytes
        operations.push(new FontDataStub());
    }
}

// ── Functions ────────────────────────────────────────────────────────────────

/** FUNCTION_CALL (166) — `FloatFunctionCall`: id then a counted float array. */
export class FloatFunctionCallStub extends UnsupportedOperation {
    static readonly OP_CODE = 166;
    protected readonly opName = 'FloatFunctionCall';
    static read(buffer: WireBuffer, operations: Operation[]): void {
        buffer.readInt();                     // id
        const argLen = buffer.readInt();
        for (let i = 0; i < argLen; i++) {
            buffer.readFloat();               // arg
        }
        operations.push(new FloatFunctionCallStub());
    }
}

/** FUNCTION_DEFINE (168) — `FloatFunctionDefine`: id then a counted int array. */
export class FloatFunctionDefineStub extends UnsupportedOperation {
    static readonly OP_CODE = 168;
    protected readonly opName = 'FloatFunctionDefine';
    static read(buffer: WireBuffer, operations: Operation[]): void {
        buffer.readInt();                     // id
        const varLen = buffer.readInt();
        for (let i = 0; i < varLen; i++) {
            buffer.readInt();                 // varId
        }
        operations.push(new FloatFunctionDefineStub());
    }
}

// ── Data, images, paths ──────────────────────────────────────────────────────

/** TEXT_LOOKUP_INT (153) — `TextLookupInt`: textId, dataSetId, indexId. */
export class TextLookupIntStub extends UnsupportedOperation {
    static readonly OP_CODE = 153;
    protected readonly opName = 'TextLookupInt';
    static read(buffer: WireBuffer, operations: Operation[]): void {
        buffer.readInt();  // textId
        buffer.readInt();  // dataSetId
        buffer.readInt();  // indexId
        operations.push(new TextLookupIntStub());
    }
}

/** ATTRIBUTE_IMAGE (171) — `ImageAttribute`: a short-counted int array. */
export class ImageAttributeStub extends UnsupportedOperation {
    static readonly OP_CODE = 171;
    protected readonly opName = 'ImageAttribute';
    static read(buffer: WireBuffer, operations: Operation[]): void {
        buffer.readInt();                  // id
        buffer.readInt();                  // imageId
        buffer.readShort();                // type
        const len = buffer.readShort();
        for (let i = 0; i < len; i++) {
            buffer.readInt();              // arg
        }
        operations.push(new ImageAttributeStub());
    }
}

/** PATH_COMBINE (175) — `PathCombine`: three ids and a single operator byte. */
export class PathCombineStub extends UnsupportedOperation {
    static readonly OP_CODE = 175;
    protected readonly opName = 'PathCombine';
    static read(buffer: WireBuffer, operations: Operation[]): void {
        buffer.readInt();   // outId
        buffer.readInt();   // pathId1
        buffer.readInt();   // pathId2
        buffer.readByte();  // combine operator
        operations.push(new PathCombineStub());
    }
}

/** REM (185) — `Rem`: a comment. A single UTF-8 string, no effect by design. */
export class RemStub extends UnsupportedOperation {
    static readonly OP_CODE = 185;
    protected readonly opName = 'Rem';
    private mText: string;
    constructor(text: string) { super(); this.mText = text; }
    static read(buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new RemStub(buffer.readUTF8()));
    }
    // The one stub that can show something useful: a REM is a comment, so print it.
    deepToString(indent: string): string { return `${indent}Rem("${this.mText}")`; }
}
