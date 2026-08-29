import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import { setupMockEnvironment, loadSampleDocument } from "./test_helpers.js";
import {
    isVarRefBits,
    varIdFromBits,
    walkPaintBundle,
    getOpParameters,
    getOpVarReferences,
    getOpVarOutputs,
    formatOpParameters
} from "../src/panels/OpParameters.js";

describe("OpParameters Tests", () => {
    beforeEach(() => {
        setupMockEnvironment();
    });

    test("NaN-boxed float bits are recognised as variable references", () => {
        // 0x7F800000 | id, and the sign bit set is still a reference.
        assert.ok(isVarRefBits(0x7f80002a | 0), "positive NaN pattern is a reference");
        assert.ok(isVarRefBits(0xff80002a | 0), "sign bit set is still a reference");
        assert.strictEqual(varIdFromBits(0xff80002a | 0), 42);

        assert.ok(!isVarRefBits(0x43480000 | 0), "an ordinary float is not a reference");
        assert.ok(!isVarRefBits(0x7f800000 | 0), "infinity has an empty mantissa, so it is not a reference");
        assert.ok(!isVarRefBits(1.5), "a non-integer is not raw bits");
    });

    test("a paint colour that matches the NaN pattern is read as a colour, not a variable", () => {
        // This is the trap that makes a blind NaN scan wrong: 0xFFFFC46B is an opaque ARGB
        // colour whose bits also satisfy the NaN-boxing test. Only the tag grammar can tell
        // the two apart, and COLOR (4) carries a literal.
        const bundle = { mArray: [4, 0xffffc46b | 0, 8], mPos: 3 };
        const params = walkPaintBundle(bundle);
        const colour = params.find(p => p.label === "color");

        assert.ok(colour, "the colour parameter is decoded");
        assert.strictEqual(colour.kind, "color");
        assert.strictEqual(colour.varId, undefined, "a literal colour must not be reported as a variable");
        assert.strictEqual(colour.value, "#FFFFC46B");
    });

    test("paint float slots do carry variable references", () => {
        // STROKE_WIDTH (5) is a float slot, so a NaN-boxed value there really is a variable.
        const bundle = { mArray: [5, 0xff80002c | 0], mPos: 2 };
        const [width] = walkPaintBundle(bundle);
        assert.strictEqual(width.label, "strokeWidth");
        assert.strictEqual(width.varId, 44);
    });

    test("paint enum tags carry their value in the command's high half", () => {
        // style=stroke is encoded as (1 << 16) | 8, not as a following word.
        const bundle = { mArray: [(1 << 16) | 8, (1 << 16) | 7], mPos: 2 };
        const params = walkPaintBundle(bundle);
        assert.deepStrictEqual(params.map(p => [p.label, p.value]),
            [["style", "stroke"], ["strokeCap", "round"]]);
    });

    test("an unknown paint tag stops the walk instead of emitting garbage", () => {
        const params = walkPaintBundle({ mArray: [4, 0x11223344, 9999, 1, 2, 3], mPos: 6 });
        assert.strictEqual(params.length, 1, "decoding stops at the tag it cannot interpret");
    });

    test("draw parameters are labelled and resolve their variable references", () => {
        // A DrawCircle shape: raw bits in mVnBits, the value resolved this frame in mVn.
        const drawCircle = {
            OP_CODE: 46,
            mV1Bits: 0x43480000 | 0, mV1: 200,
            mV2Bits: 0x43480000 | 0, mV2: 200,
            mV3Bits: 0xff80002e | 0, mV3: 25.8
        };
        const params = getOpParameters(drawCircle);
        assert.deepStrictEqual(params.map(p => p.label), ["cx", "cy", "radius"]);
        assert.strictEqual(params[2].varId, 46, "the radius is driven by var 46");
        assert.strictEqual(params[0].varId, undefined, "a literal centre is not a reference");
        assert.match(formatOpParameters(drawCircle), /radius=var_46/);
    });

    test("matrix operations keep raw bits in their named fields", () => {
        // MatrixRotate has no mAngleBits: the NaN-boxed value is in mAngle itself, which is
        // why deepToString printed it as -8388563.
        const params = getOpParameters({ OP_CODE: 129, mAngle: 0xff80002d | 0, mPivotX: 0x43480000 | 0, mPivotY: 0x43480000 | 0 });
        assert.strictEqual(params[0].label, "angle");
        assert.strictEqual(params[0].varId, 45);
        assert.strictEqual(params[1].value, 200);
    });

    test("ComponentValue reports the variable it defines rather than one it reads", () => {
        const componentValue = { OP_CODE: 150, mType: 0, mComponentId: -5, mValueId: 42 };
        assert.deepStrictEqual(getOpVarOutputs(componentValue), [42]);
        assert.deepStrictEqual(getOpVarReferences(componentValue), [],
            "an output must never be reported as an input");
        const params = getOpParameters(componentValue);
        assert.strictEqual(params.find(p => p.label === "value").value, "width");
    });

    test("layout geometry is tagged as measured, not as payload", () => {
        const component = { OP_CODE: 200, mComponentId: -2, mWidth: 400, mHeight: 800, mX: 0, mY: 0 };
        const width = getOpParameters(component).find(p => p.label === "width");
        assert.strictEqual(width.kind, "measured",
            "a component's measured size is not part of its binary payload");
    });

    test("a real document's DrawRect reads its dimensions from componentWidth/Height", async () => {
        const { doc } = await loadSampleDocument("02_ticker.rc");
        assert.ok(doc, "sample document loads");
        const ops = [];
        (function walk(list) {
            (list || []).forEach(op => {
                ops.push(op);
                if (typeof op.getList === "function") walk(op.getList());
            });
        })(doc.getOperations());

        const withRefs = ops.filter(op => getOpVarReferences(op).length > 0);
        assert.ok(withRefs.length > 0, "the document has operations driven by expressions");
        withRefs.forEach(op => {
            getOpVarReferences(op).forEach(id => {
                assert.ok(Number.isInteger(id) && id > 0, `variable id ${id} is a positive integer`);
            });
        });
    });
});
