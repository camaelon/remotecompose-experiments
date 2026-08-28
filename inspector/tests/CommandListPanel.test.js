import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import { setupMockEnvironment, loadSampleDocument } from "./test_helpers.js";
import * as cmdListModule from "../src/panels/CommandListPanel.js";

describe("CommandListPanel Tests", () => {
    beforeEach(() => {
        setupMockEnvironment();
    });

    test("KNOWN_OPCODES contains RemoteCompose opcodes", () => {
        const { KNOWN_OPCODES } = cmdListModule;
        assert.strictEqual(KNOWN_OPCODES[0], "Header");
        assert.strictEqual(KNOWN_OPCODES[123], "PathData");
        assert.strictEqual(KNOWN_OPCODES[124], "DrawPath");
        assert.strictEqual(KNOWN_OPCODES[125], "DrawTweenPath");
        assert.strictEqual(KNOWN_OPCODES[175], "PathCombine");
        assert.strictEqual(KNOWN_OPCODES[81], "FloatExpression");
        assert.strictEqual(KNOWN_OPCODES[200], "RootLayoutComponent");
        assert.strictEqual(KNOWN_OPCODES[214], "ContainerEnd");
    });

    test("getOpName correctly identifies opcode objects and classes", () => {
        const { getOpName } = cmdListModule;
        assert.strictEqual(getOpName({ OP_CODE: 0 }), "Header");
        assert.strictEqual(getOpName({ OP_CODE: 123 }), "PathData");
        assert.strictEqual(getOpName({ OP_CODE: 175 }), "PathCombine");
        assert.strictEqual(getOpName({ OP_CODE: 81 }), "FloatExpression");
        assert.strictEqual(getOpName({ constructor: { OP_CODE: 200 } }), "RootLayoutComponent");
        assert.strictEqual(getOpName({ constructor: { name: "CustomOp" } }), "CustomOp");
    });

    test("intBitsToFloat and formatNumber conversion", () => {
        const { intBitsToFloat, formatNumber } = cmdListModule;
        assert.strictEqual(intBitsToFloat(1065353216), 1.0);
        assert.strictEqual(intBitsToFloat(0), 0.0);
        assert.strictEqual(formatNumber(10), "10");
        assert.strictEqual(formatNumber(10.5), "10.50");
        assert.strictEqual(formatNumber(NaN), "NaN");
    });

    test("parsePathDataOp handles MOVE, LINE, QUAD, CUBIC, and CLOSE with dummy slots", () => {
        const { parsePathDataOp } = cmdListModule;
        function floatToBits(f) {
            const buf = new ArrayBuffer(4);
            new Float32Array(buf)[0] = f;
            return new Int32Array(buf)[0];
        }
        function asNanBits(id) {
            return (id & 0x00ffffff) | 0xff800000;
        }

        const rawBits = new Int32Array([
            asNanBits(10), floatToBits(10), floatToBits(20),
            asNanBits(11), 0, 0, floatToBits(30), floatToBits(40),
            asNanBits(12), 0, 0, floatToBits(35), floatToBits(45), floatToBits(50), floatToBits(60),
            asNanBits(14), 0, 0, floatToBits(1), floatToBits(2), floatToBits(3), floatToBits(4), floatToBits(5), floatToBits(6),
            asNanBits(15)
        ]);

        const parsed = parsePathDataOp({ mOutputPath: rawBits });
        assert.ok(parsed, "Parsed path should not be null");
        assert.strictEqual(parsed.cmdCount, 5);
        assert.strictEqual(parsed.segments.length, 5);
        assert.strictEqual(parsed.segments[0].type, "MoveTo");
        assert.strictEqual(parsed.segments[1].type, "LineTo");
        assert.strictEqual(parsed.segments[2].type, "QuadTo");
        assert.strictEqual(parsed.segments[3].type, "CubicTo");
        assert.strictEqual(parsed.segments[4].type, "Close");

        assert.ok(parsed.d.startsWith("M 10 20 L 30 40 Q 35 45 50 60 C 1 2 3 4 5 6 Z"));
        assert.strictEqual(parsed.minX, 1);
        assert.strictEqual(parsed.minY, 2);
        assert.strictEqual(parsed.maxX, 50);
        assert.strictEqual(parsed.maxY, 60);
    });

    test("renderPathDataPreviewHtml generates valid SVG preview", () => {
        const { renderPathDataPreviewHtml } = cmdListModule;
        function floatToBits(f) {
            const buf = new ArrayBuffer(4);
            new Float32Array(buf)[0] = f;
            return new Int32Array(buf)[0];
        }
        const rawBits = new Int32Array([
            (10 & 0x00ffffff) | 0xff800000, floatToBits(0), floatToBits(0),
            (11 & 0x00ffffff) | 0xff800000, 0, 0, floatToBits(100), floatToBits(100),
            (15 & 0x00ffffff) | 0xff800000
        ]);
        const html = renderPathDataPreviewHtml({ mOutputPath: rawBits }, 0);
        assert.ok(html.includes("<svg"), "HTML should contain <svg");
        assert.ok(html.includes("Vector Path Data"), "HTML should contain Vector Path Data title");
        assert.ok(html.includes("3 commands"), "HTML should reflect command count");
    });

    test("renderPathCombinePreviewHtml generates dual path CAG preview", () => {
        const { renderPathCombinePreviewHtml } = cmdListModule;
        const op = {
            OP_CODE: 175,
            mOutId: 99,
            mPath1: 10,
            mPath2: 20,
            mMode: 3
        };
        const html = renderPathCombinePreviewHtml(op, 1);
        assert.ok(html.includes("Constructive Area Geometry"), "HTML should contain CAG title");
        assert.ok(html.includes("UNION"), "HTML should display UNION mode");
        assert.ok(html.includes("Path #10"), "HTML should link to Path #10");
        assert.ok(html.includes("Path #20"), "HTML should link to Path #20");
    });

    test("pretty print utilities produce expected human readable strings", () => {
        const {
            prettyPrintPathCreate,
            prettyPrintPathTween,
            prettyPrintPathCombine,
            prettyPrintFloatExpression
        } = cmdListModule;
        assert.strictEqual(prettyPrintPathCreate({ mId: 5, mStartX: 10, mStartY: 20 }), "create Path #5 (start: x=10, y=20)");
        assert.strictEqual(prettyPrintPathTween({ mOutId: 3, mPathId1: 1, mPathId2: 2, mTween: 0.5 }), "Path #3 = tween(Path #1 ➔ Path #2, fraction=0.50)");
        assert.strictEqual(prettyPrintPathCombine({ mOutId: 7, mPath1: 4, mPath2: 5, mMode: 1 }), "Path #7 = combine(Path #4 Intersect Path #5)");
        assert.strictEqual(prettyPrintFloatExpression([1065353216]), "1");
    });

    test("renderCommandsList populates commands container", async () => {
        const { renderCommandsList } = cmdListModule;
        const { doc, arrayBuffer } = await loadSampleDocument("02_ticker.rc");
        const ops = typeof doc.getOperations === "function" ? doc.getOperations() : doc.mOps;
        const u8 = new Uint8Array(arrayBuffer);

        const container = document.getElementById("commandsListContainer");
        renderCommandsList(ops, u8);
        assert.ok(container.innerHTML.length > 0, "commandsListContainer should have rendered content");
    });

    test("renderBitmapDataPreviewHtml renders inline PNG and metadata", () => {
        const { renderBitmapDataPreviewHtml, getOpBitmapDataUrl } = cmdListModule;
        // Sample 1x1 valid PNG bytes
        const pngBytes = new Uint8Array([
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
            0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
            0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89
        ]);

        const op = {
            OP_CODE: 101,
            mImageId: 42,
            mWidth: 108,
            mHeight: 108,
            mType: 1, // PNG
            mEncoding: 0, // Inline
            mBitmap: pngBytes
        };

        const dataUrl = getOpBitmapDataUrl(op);
        assert.ok(dataUrl && dataUrl.startsWith("data:image/png;base64,"), "dataUrl should start with png base64 prefix");

        const html = renderBitmapDataPreviewHtml(op, 0);
        assert.ok(html.includes("Bitmap Image Data"), "HTML should contain Bitmap Image Data title");
        assert.ok(html.includes("ID: 42"), "HTML should display Image ID 42");
        assert.ok(html.includes("108 × 108 px"), "HTML should display dimensions");
        assert.ok(html.includes("PNG"), "HTML should display PNG type");
        assert.ok(html.includes("Inline"), "HTML should display Inline encoding");
        assert.ok(html.includes("<img src=\"data:image/png;base64,"), "HTML should contain img with base64 data");
    });

    test("renderBitmapDataPreviewHtml handles empty target buffer", () => {
        const { renderBitmapDataPreviewHtml } = cmdListModule;
        const op = {
            OP_CODE: 101,
            mImageId: 10,
            mWidth: 64,
            mHeight: 64,
            mType: 3,
            mEncoding: 3, // Empty buffer
            mBitmap: new Uint8Array(0)
        };

        const html = renderBitmapDataPreviewHtml(op, 1);
        assert.ok(html.includes("Bitmap Image Data"), "HTML should contain title");
        assert.ok(html.includes("ID: 10"), "HTML should display ID");
        assert.ok(html.includes("64 × 64 px"), "HTML should display dimensions");
        assert.ok(html.includes("Empty Buffer"), "HTML should display Empty Buffer encoding");
    });

    test("renderDrawBitmapReferenceHtml references source BitmapData", () => {
        const { renderDrawBitmapReferenceHtml } = cmdListModule;
        window.currentParsedOps = [
            {
                OP_CODE: 101,
                mImageId: 42,
                mWidth: 100,
                mHeight: 100,
                mType: 1,
                mEncoding: 0,
                mBitmap: new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
            },
            {
                OP_CODE: 44,
                mImageId: 42,
                mLeft: 0,
                mTop: 0,
                mRight: 100,
                mBottom: 100
            }
        ];

        const drawOp = window.currentParsedOps[1];
        const html = renderDrawBitmapReferenceHtml(drawOp, 1);
        assert.ok(html.includes("Source Image:"), "HTML should contain Source Image label");
        assert.ok(html.includes("Bitmap #42"), "HTML should reference Bitmap #42");
        assert.ok(html.includes("100×100 px"), "HTML should display source bitmap dimensions");
    });

    test("weather_demo.rc with BitmapData renders thumbnails in command list", async () => {
        const { renderCommandsList, toggleCmdDisplayMode } = cmdListModule;
        const docLoader = await import("../src/panels/DocumentLoader.js");
        const { doc, arrayBuffer } = await loadSampleDocument("weather_demo.rc");
        const u8 = new Uint8Array(arrayBuffer);
        const flatOps = docLoader.getAllOperationsFlat(doc, u8);

        // Test in full card mode
        toggleCmdDisplayMode(); // switch from compact to full card mode
        const container = document.getElementById("commandsListContainer");
        renderCommandsList(flatOps, u8);
        assert.ok(container.innerHTML.includes("Bitmap Image Data"), "weather_demo.rc should render Bitmap Image Data cards");
        assert.ok(container.innerHTML.includes("<img src=\"data:image/png;base64,"), "weather_demo.rc should render PNG thumbnails");

        // Test in compact mode
        toggleCmdDisplayMode(); // switch back to compact
        renderCommandsList(flatOps, u8);
        assert.ok(container.innerHTML.includes("108×108 px"), "weather_demo.rc compact row should display bitmap dimensions");
    });

    test("getCoreTextParameters and renderCoreTextDetailsHtml accurately extract and render all CoreText parameters", () => {
        const { getCoreTextParameters, prettyPrintCoreText, renderCoreTextDetailsHtml } = cmdListModule;

        const dummyDoc = {
            getText: (id) => {
                if (id === 10) return "Hello Jetpack Compose";
                if (id === 20) return "Roboto";
                return null;
            }
        };

        const coreTextOp = {
            OP_CODE: 239,
            mComponentId: 101,
            mAnimationId: 4,
            mTextId: 10,
            mFontSizeValue: 24,
            mFontWeightValue: 700,
            mFontStyle: 1, // Italic
            mFontFamilyId: 20,
            mTextAlign: 3, // Center
            mOverflow: 3, // Ellipsis
            mMaxLines: 2,
            mLetterSpacing: 0.5,
            mLineHeightMultiplier: 1.2,
            mLineHeightAdd: 4,
            mLineBreakStrategy: 1, // High Quality
            mHyphenationFrequency: 2, // Full
            mJustificationMode: 1, // Inter-Word
            mUnderline: true,
            mStrikethrough: false,
            mAutosize: true,
            mColor: 0xFF1E88E5,
            mColorId: -1,
            mFlags: 0x01
        };

        const params = getCoreTextParameters(coreTextOp, dummyDoc);
        assert.strictEqual(params.text, "Hello Jetpack Compose");
        assert.strictEqual(params.fontSize, 24);
        assert.strictEqual(params.fontWeight, 700);
        assert.strictEqual(params.fontWeightName, "Bold (700)");
        assert.strictEqual(params.fontStyleName, "Italic");
        assert.strictEqual(params.fontFamily, "Roboto");
        assert.strictEqual(params.textAlignName, "Center");
        assert.strictEqual(params.overflowName, "Ellipsis");
        assert.strictEqual(params.maxLines, 2);
        assert.strictEqual(params.letterSpacing, 0.5);
        assert.strictEqual(params.lineHeightMultiplier, 1.2);
        assert.strictEqual(params.lineBreakName, "High Quality");
        assert.strictEqual(params.hyphenationName, "Full");
        assert.strictEqual(params.justificationName, "Inter-Word");
        assert.strictEqual(params.underline, true);
        assert.strictEqual(params.autosize, true);

        const prettyStr = prettyPrintCoreText(coreTextOp, dummyDoc);
        assert.ok(prettyStr.includes("24sp"), "pretty string should include font size");
        assert.ok(prettyStr.includes("w700"), "pretty string should include font weight");
        assert.ok(prettyStr.includes("italic"), "pretty string should include italic");
        assert.ok(prettyStr.includes("Center"), "pretty string should include alignment");
        assert.ok(prettyStr.includes("max 2L"), "pretty string should include max lines");

        const html = renderCoreTextDetailsHtml(coreTextOp, 0, dummyDoc);
        assert.ok(html.includes("CoreText Parameters"), "HTML should have header");
        assert.ok(html.includes("Hello Jetpack Compose"), "HTML should display text string");
        assert.ok(html.includes("24 sp"), "HTML should display font size");
        assert.ok(html.includes("Bold (700)"), "HTML should display font weight");
        assert.ok(html.includes("Roboto"), "HTML should display font family");
        assert.ok(html.includes("Autosize"), "HTML should display autosize badge");
        assert.ok(html.includes("Underline"), "HTML should display underline badge");
    });

    test("getLayoutAlignmentInfo, prettyPrintLayoutAlignment, and renderLayoutAlignmentDetailsHtml accurately parse and format layout alignments", () => {
        const { getLayoutAlignmentInfo, prettyPrintLayoutAlignment, renderLayoutAlignmentDetailsHtml } = cmdListModule;

        const rowOp = {
            OP_CODE: 203,
            mHorizontalPositioning: 6, // SPACE_BETWEEN
            mVerticalPositioning: 2, // CENTER
            mSpacedBy: 12
        };

        const align = getLayoutAlignmentInfo(rowOp);
        assert.strictEqual(align.hName, "SpaceBetween");
        assert.strictEqual(align.vName, "Center");
        assert.strictEqual(align.spacedBy, 12);

        const prettyStr = prettyPrintLayoutAlignment(rowOp);
        assert.strictEqual(prettyStr, "H: SpaceBetween, V: Center, spacedBy: 12dp");

        const html = renderLayoutAlignmentDetailsHtml(rowOp, 0);
        assert.ok(html.includes("Layout Alignment &amp; Positioning") || html.includes("Layout Alignment & Positioning"), "HTML should contain section title");
        assert.ok(html.includes("SpaceBetween"), "HTML should contain horizontal alignment");
        assert.ok(html.includes("Center"), "HTML should contain vertical alignment");
        assert.ok(html.includes("12 dp"), "HTML should contain spacing");

        const columnOp = {
            OP_CODE: 204,
            mHorizontalPositioning: 1, // START
            mVerticalPositioning: 5, // BOTTOM
            mSpacedBy: 0
        };

        const colAlign = getLayoutAlignmentInfo(columnOp);
        assert.strictEqual(colAlign.hName, "Start");
        assert.strictEqual(colAlign.vName, "Bottom");
        assert.strictEqual(colAlign.spacedBy, 0);
    });

    test("DIMENSION_MODIFIER_TYPES, getDimensionModifierInfo, prettyPrintWidthModifier, prettyPrintHeightModifier, and renderDimensionModifierDetailsHtml accurately parse and display modifier constraints", () => {
        const {
            DIMENSION_MODIFIER_TYPES,
            getDimensionModifierInfo,
            prettyPrintWidthModifier,
            prettyPrintHeightModifier,
            renderDimensionModifierDetailsHtml
        } = cmdListModule;

        // Verify all 9 enum types are present and documented
        assert.strictEqual(Object.keys(DIMENSION_MODIFIER_TYPES).length, 9);
        assert.strictEqual(DIMENSION_MODIFIER_TYPES[0].name, "EXACT");
        assert.strictEqual(DIMENSION_MODIFIER_TYPES[1].name, "FILL");
        assert.strictEqual(DIMENSION_MODIFIER_TYPES[2].name, "WRAP");
        assert.strictEqual(DIMENSION_MODIFIER_TYPES[3].name, "WEIGHT");
        assert.strictEqual(DIMENSION_MODIFIER_TYPES[4].name, "INTRINSIC_MIN");
        assert.strictEqual(DIMENSION_MODIFIER_TYPES[5].name, "INTRINSIC_MAX");
        assert.strictEqual(DIMENSION_MODIFIER_TYPES[6].name, "EXACT_DP");
        assert.strictEqual(DIMENSION_MODIFIER_TYPES[7].name, "FILL_PARENT_MAX_WIDTH");
        assert.strictEqual(DIMENSION_MODIFIER_TYPES[8].name, "FILL_PARENT_MAX_HEIGHT");

        // Test WidthModifier with EXACT_DP (6)
        const widthOp = {
            OP_CODE: 16,
            mType: 6,
            mOutValue: 120
        };
        const widthInfo = getDimensionModifierInfo(widthOp);
        assert.strictEqual(widthInfo.dimension, "Width");
        assert.strictEqual(widthInfo.type, 6);
        assert.strictEqual(widthInfo.typeName, "EXACT_DP");
        assert.strictEqual(widthInfo.value, 120);

        const widthStr = prettyPrintWidthModifier(widthOp);
        assert.ok(widthStr.includes("120 dp") && widthStr.includes("EXACT_DP: 6"));

        const widthHtml = renderDimensionModifierDetailsHtml(widthOp, 0);
        assert.ok(widthHtml.includes("WidthModifier Constraint"));
        assert.ok(widthHtml.includes("EXACT_DP (6)"));
        assert.ok(widthHtml.includes("120 dp"));
        assert.ok(widthHtml.includes("Fixed size in density-independent pixels"));

        // Test HeightModifier with FILL (1)
        const heightOp = {
            OP_CODE: 67,
            mType: 1,
            mOutValue: 1.0
        };
        const heightInfo = getDimensionModifierInfo(heightOp);
        assert.strictEqual(heightInfo.dimension, "Height");
        assert.strictEqual(heightInfo.type, 1);
        assert.strictEqual(heightInfo.typeName, "FILL");

        const heightStr = prettyPrintHeightModifier(heightOp);
        assert.ok(heightStr.includes("fillMaxHeight") && heightStr.includes("FILL: 1"));

        const heightHtml = renderDimensionModifierDetailsHtml(heightOp, 1);
        assert.ok(heightHtml.includes("HeightModifier Constraint"));
        assert.ok(heightHtml.includes("FILL (1)"));
        assert.ok(heightHtml.includes("Fill available parent space"));

        // Test WEIGHT (3)
        const weightOp = {
            OP_CODE: 16,
            mType: 3,
            mOutValue: 2.5
        };
        const weightStr = prettyPrintWidthModifier(weightOp);
        assert.ok(weightStr.includes("weight(2.50)") && weightStr.includes("WEIGHT: 3"));
    });
});