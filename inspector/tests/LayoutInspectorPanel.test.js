import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import { setupMockEnvironment, loadSampleDocument } from "./test_helpers.js";
import * as layoutModule from "../src/panels/LayoutInspectorPanel.js";

describe("LayoutInspectorPanel Tests", () => {
    beforeEach(() => {
        setupMockEnvironment();
        // Add layoutInspectorContainer to DOM mock
        const container = document.createElement("div");
        container.id = "layoutInspectorContainer";
        document.body.appendChild(container);
    });

    test("extractLayoutComponents extracts components and geometry from fitness_activity_widget.rc", async () => {
        const { doc } = await loadSampleDocument("fitness_activity_widget.rc");
        const { extractLayoutComponents } = layoutModule;

        const components = extractLayoutComponents(doc);
        assert.ok(components.length > 0, "Should extract layout components");
        
        // Root container check
        const root = components[0];
        assert.ok(root.name.includes("Box") || root.name.includes("Layout") || root.name.includes("Row") || root.name.includes("Column"), "Root should be a container");
        assert.ok(typeof root.width === "number", "Root should have width");
        assert.ok(typeof root.height === "number", "Root should have height");
        assert.ok(root.padding !== undefined, "Root should have padding object");
        assert.ok(root.margin !== undefined, "Root should have margin object");
    });

    test("extractLayoutComponents extracts components from weather_demo.rc", async () => {
        const { doc } = await loadSampleDocument("weather_demo.rc");
        const { extractLayoutComponents } = layoutModule;

        const components = extractLayoutComponents(doc);
        assert.ok(components.length > 0, "Weather demo should contain layout components");

        // Verify images and text components are properly captured
        const hasTextOrImage = components.some(c => c.text || c.imageId !== null || c.name.includes("Image") || c.name.includes("Text"));
        assert.ok(hasTextOrImage, "Should capture text or image metadata");
    });

    test("runLayoutDiagnostics detects zero-size, small touch targets, and deep nesting", () => {
        const { runLayoutDiagnostics } = layoutModule;

        const mockComponents = [
            { key: "c1", name: "EmptyBox", id: 1, width: 0, height: 0, depth: 0, childCount: 0, drawOpCount: 0, isClickable: false },
            { key: "c2", name: "TinyButton", id: 2, width: 24, height: 24, depth: 2, childCount: 1, drawOpCount: 0, isClickable: true },
            { key: "c3", name: "DeepNode", id: 3, width: 100, height: 50, depth: 10, childCount: 1, drawOpCount: 0, isClickable: false },
            { key: "c4", name: "ValidCard", id: 4, width: 200, height: 100, depth: 3, childCount: 2, drawOpCount: 1, isClickable: true }
        ];

        const issues = runLayoutDiagnostics(mockComponents);
        assert.ok(issues.length >= 3, "Should detect multiple diagnostics");

        const hasZeroSize = issues.some(i => i.type === "zero_size");
        const hasTouchTarget = issues.some(i => i.type === "touch_target");
        const hasDeepNesting = issues.some(i => i.type === "deep_nesting");

        assert.ok(hasZeroSize, "Should flag zero-size element");
        assert.ok(hasTouchTarget, "Should flag touch target < 48dp");
        assert.ok(hasDeepNesting, "Should flag deep nesting > 8 levels");
    });

    test("renderBoxModelDiagram generates concentric box HTML with correct dimensions", () => {
        const { renderBoxModelDiagram } = layoutModule;

        const mockComp = {
            name: "Card",
            width: 220,
            height: 120,
            localX: 10,
            localY: 20,
            margin: { top: 8, right: 8, bottom: 8, left: 8 },
            padding: { top: 12, right: 16, bottom: 12, left: 16 },
            border: { width: 2, color: "#38bdf8", radius: 8 }
        };

        const html = renderBoxModelDiagram(mockComp, 1.0);
        assert.ok(html.includes("box-model-margin"), "Should render margin layer");
        assert.ok(html.includes("box-model-border"), "Should render border layer");
        assert.ok(html.includes("box-model-padding"), "Should render padding layer");
        assert.ok(html.includes("box-model-content"), "Should render content layer");
        // Inner content: 220 - 16 - 16 = 188, 120 - 12 - 12 = 96
        assert.ok(html.includes("188"), "Should compute inner content width");
        assert.ok(html.includes("96"), "Should compute inner content height");
    });

    test("renderModifierChain outputs step-by-step modifier breakdown", () => {
        const { renderModifierChain } = layoutModule;

        const mockComp = {
            name: "Button",
            modifiers: [
                { name: "PaddingModifier", desc: "Padding(16dp)" },
                { name: "BackgroundModifier", desc: "Background(#10b981)" },
                { name: "ClickModifier", desc: "Click(action=1)" }
            ]
        };

        const html = renderModifierChain(mockComp);
        assert.ok(html.includes("#1"), "Should show step #1");
        assert.ok(html.includes("#2"), "Should show step #2");
        assert.ok(html.includes("#3"), "Should show step #3");
        assert.ok(html.includes("PaddingModifier"), "Should show modifier name");
        assert.ok(html.includes("Spacing / Inset"), "Should classify spacing role");
        assert.ok(html.includes("Interaction"), "Should classify click interaction role");
    });

    test("renderLayoutInspectorPanel populates container and handles selection", async () => {
        const { renderLayoutInspectorPanel, selectLayoutComponent, getSelectedComponentKey, extractLayoutComponents } = layoutModule;
        const { doc } = await loadSampleDocument("fitness_activity_widget.rc");

        renderLayoutInspectorPanel(doc);
        const container = document.getElementById("layoutInspectorContainer");
        assert.ok(container.innerHTML.includes("Visual Box Model"), "Should render Box Model section");
        assert.ok(container.innerHTML.includes("Modifier Execution Chain"), "Should render Modifier Chain section");
        assert.ok(container.innerHTML.includes("Layout Sandbox & Tweaker"), "Should render Tweaker section");

        // Verify dropdown pull menu is removed
        assert.strictEqual(container.querySelector("#layoutCompSelect"), null, "Dropdown pull menu should be removed");

        // Test selection by compKey
        selectLayoutComponent("comp_1");
        assert.strictEqual(getSelectedComponentKey(), "comp_1", "Selected component key should match comp_1");

        // Test selection by componentId (cid) or op
        const components = extractLayoutComponents(doc);
        const secondComp = components.find(c => c.key === "comp_2");
        if (secondComp) {
            if (secondComp.cid !== null && secondComp.cid !== undefined) {
                selectLayoutComponent(secondComp.cid);
                assert.strictEqual(getSelectedComponentKey(), "comp_2", "Selecting by cid should update selectedComponentKey");
            }
            if (secondComp.op) {
                selectLayoutComponent(secondComp.op);
                assert.strictEqual(getSelectedComponentKey(), "comp_2", "Selecting by op object should update selectedComponentKey");
            }
        }
    });

    test("extractLayoutComponents extracts all deep levels below FitBoxLayout with valid coordinates", async () => {
        const { extractLayoutComponents, getComponentGlobalPosition, getSafeFloat } = layoutModule;
        const { doc, player } = await loadSampleDocument("fitness_activity_widget.rc");
        player.repaint();

        const components = extractLayoutComponents(doc);
        const fitBox = components.find(c => c.name === "FitBoxLayout");
        assert.ok(fitBox, "Should find FitBoxLayout");

        // Direct children of FitBoxLayout (Level 1)
        const level1 = components.filter(c => c.parentKey === fitBox.key);
        assert.ok(level1.length > 1, "FitBoxLayout should have multiple resolution branches");

        // Active Level 1 child
        const activeL1 = level1.find(c => c.width > 0);
        assert.ok(activeL1, "Should find active Level 1 child");

        // Children of Level 1 (Level 2)
        const level2 = components.filter(c => c.parentKey === activeL1.key);
        assert.ok(level2.length > 0, "Active branch should have Level 2 children");

        // Grandchildren of Level 1 (Level 3)
        const level3 = components.filter(c => level2.some(l2 => c.parentKey === l2.key));
        assert.ok(level3.length > 0, "Active branch should have Level 3 children");

        // Verify all components have finite, on-screen global coordinates (< 50000, not NaN or variable ID bits)
        components.forEach(comp => {
            assert.ok(comp.globalX >= 0 && comp.globalX < 10000, `Component ${comp.name} globalX (${comp.globalX}) should be valid finite coordinate`);
            assert.ok(comp.globalY >= 0 && comp.globalY < 10000, `Component ${comp.name} globalY (${comp.globalY}) should be valid finite coordinate`);
        });

        // Test getSafeFloat
        assert.strictEqual(getSafeFloat(1096810496, 0), 0, "Should discard variable ID bit pattern > 50000");
        assert.strictEqual(getSafeFloat(14.5, 0), 14.5, "Should keep valid dp float 14.5");
        assert.strictEqual(getSafeFloat(NaN, 5), 5, "Should return fallback for NaN");
    });

    test("extractLayoutComponents extracts all deep children under CollapsibleColumnLayout and CollapsibleRowLayout in collapsible_fitness_widget.rc", async () => {
        const { extractLayoutComponents, selectLayoutComponent, getSelectedComponentKey, drawLayoutBoundsOverlay } = layoutModule;
        const { doc, player } = await loadSampleDocument("collapsible_fitness_widget.rc");
        player.repaint();

        const components = extractLayoutComponents(doc);
        assert.ok(components.length > 50, `Should extract deep component hierarchy (found ${components.length})`);

        const collapsibleCols = components.filter(c => c.name === "CollapsibleColumnLayout");
        const collapsibleRows = components.filter(c => c.name === "CollapsibleRowLayout");
        const coreTexts = components.filter(c => c.name === "CoreText");
        const canvasLayouts = components.filter(c => c.name === "CanvasLayout");

        assert.ok(collapsibleCols.length > 0, "Should extract CollapsibleColumnLayout components");
        assert.ok(collapsibleRows.length > 0, "Should extract CollapsibleRowLayout components");
        assert.ok(coreTexts.length > 0, "Should extract CoreText components");
        assert.ok(canvasLayouts.length > 0, "Should extract CanvasLayout components");

        // Verify selecting a deep child component by op object works
        const textComp = coreTexts[0];
        selectLayoutComponent(textComp.op);
        assert.strictEqual(getSelectedComponentKey(), textComp.key, "Selecting deep child by op should set selectedComponentKey");

        // Verify resetting selection
        selectLayoutComponent(null);
        assert.strictEqual(getSelectedComponentKey(), null, "Passing null should clear selection");

        // Set up stage wrapper and canvas in DOM mock for overlay
        const stageWrapper = document.createElement("div");
        stageWrapper.id = "canvasStageWrapper";
        const previewCanvas = document.createElement("canvas");
        previewCanvas.id = "previewCanvas";
        previewCanvas.width = 300;
        previewCanvas.height = 300;
        stageWrapper.appendChild(previewCanvas);
        document.body.appendChild(stageWrapper);

        // Select component and draw overlay
        selectLayoutComponent(textComp.op);
        drawLayoutBoundsOverlay();

        const overlayCanvas = document.getElementById("layoutBoundsOverlayCanvas");
        assert.ok(overlayCanvas, "Overlay canvas should be created and attached to stage wrapper");
        assert.strictEqual(overlayCanvas.style.display, "block", "Overlay canvas should be displayed");

        // Unselect and verify bounds overlay is hidden
        selectLayoutComponent(null);
        assert.strictEqual(getSelectedComponentKey(), null, "Selection should be null");
        assert.strictEqual(overlayCanvas.style.display, "none", "Overlay canvas should be hidden after unselect");
    });

    test("clicking outside the document in the stage workspace unselects components and clears bounds", async () => {
        const { selectLayoutComponent, getSelectedComponentKey, drawLayoutBoundsOverlay } = layoutModule;
        const { initStageLiveResize } = await import("../src/panels/StagePanel.js");

        // Set up DOM elements for stage workspace
        const workspace = document.createElement("div");
        workspace.id = "stageWorkspaceContainer";

        const stageWrapper = document.createElement("div");
        stageWrapper.id = "canvasStageWrapper";

        const previewCanvas = document.createElement("canvas");
        previewCanvas.id = "previewCanvas";
        previewCanvas.width = 300;
        previewCanvas.height = 300;

        const treeNode = document.createElement("div");
        treeNode.className = "tree-node-content selected";

        stageWrapper.appendChild(previewCanvas);
        workspace.appendChild(stageWrapper);
        document.body.appendChild(workspace);
        document.body.appendChild(treeNode);

        // Attach global selectLayoutComponent
        window.selectLayoutComponent = selectLayoutComponent;

        // Initialize stage listeners
        initStageLiveResize();

        // Select a component and show bounds
        selectLayoutComponent("comp_1");
        drawLayoutBoundsOverlay();
        assert.strictEqual(getSelectedComponentKey(), "comp_1", "Should have comp_1 selected");

        const overlayCanvas = document.getElementById("layoutBoundsOverlayCanvas");
        assert.ok(overlayCanvas, "Overlay canvas should exist");

        // Simulate click on stage workspace outside the canvas
        workspace.dispatchEvent({ type: "pointerdown", target: workspace, preventDefault() {}, stopPropagation() {} });

        // Verify unselected
        assert.strictEqual(getSelectedComponentKey(), null, "Component should be unselected after clicking outside document");
        assert.strictEqual(overlayCanvas.style.display, "none", "Bounds overlay should be hidden");
        assert.strictEqual(treeNode.classList.contains("selected"), false, "Tree node selected class should be removed");
    });

    test("renderCoreTextInspectorSection generates complete typography and parameter dashboard for CoreText with live editing controls", () => {
        const { renderCoreTextInspectorSection } = layoutModule;

        const selectedComp = {
            name: "CoreText",
            key: "comp_coretext_1",
            op: {
                OP_CODE: 239,
                mComponentId: 55,
                mText: "Daily Steps: 8,420",
                mFontSizeValue: 20,
                mFontWeightValue: 700,
                mFontStyle: 0, // Normal
                mTextAlign: 3, // Center
                mOverflow: 3, // Ellipsis
                mMaxLines: 1,
                mLetterSpacing: 0.25,
                mLineHeightMultiplier: 1.15,
                mLineHeightAdd: 2,
                mLineBreakStrategy: 2, // Balanced
                mHyphenationFrequency: 1, // Normal
                mJustificationMode: 0, // None
                mColor: 0xFFFFFFFF,
                mColorId: -1,
                mUnderline: true,
                mStrikethrough: false,
                mAutosize: true,
                mFlags: 0x02
            }
        };

        const html = renderCoreTextInspectorSection(selectedComp);
        assert.ok(html.includes("CoreText Typography &amp; Parameters") || html.includes("CoreText Typography & Parameters"), "HTML should contain CoreText section title");
        assert.ok(html.includes("Daily Steps: 8,420"), "HTML should contain resolved text content");
        assert.ok(html.includes("tweakCoreTextFontSize"), "HTML should contain font size input");
        assert.ok(html.includes("tweakCoreTextFontWeight"), "HTML should contain font weight select");
        assert.ok(html.includes("tweakCoreTextTextAlign"), "HTML should contain text align select");
        assert.ok(html.includes("tweakCoreTextOverflow"), "HTML should contain overflow mode select");
        assert.ok(html.includes("tweakCoreTextLineBreak"), "HTML should contain line break strategy select");
        assert.ok(html.includes("tweakCoreTextHyphenation"), "HTML should contain hyphenation frequency select");
        assert.ok(html.includes("tweakCoreTextAutosize"), "HTML should contain autosize checkbox");
        assert.ok(html.includes("tweakCoreTextUnderline"), "HTML should contain underline checkbox");
        assert.ok(html.includes("Live Editable"), "HTML should contain Live Editable badge");
    });

    test("extractLayoutComponents and renderLayoutAlignmentInspectorSection surface horizontal and vertical alignments with live editing controls", () => {
        const { extractLayoutComponents, renderLayoutAlignmentInspectorSection } = layoutModule;

        const rowOp = {
            OP_CODE: 203,
            mComponentId: 50,
            mHorizontalPositioning: 6, // SpaceBetween
            mVerticalPositioning: 2, // Center
            mSpacedBy: 16,
            constructor: { name: "RowLayout" },
            getList() { return []; }
        };

        const rootDoc = {
            getRootLayoutComponent: () => rowOp
        };

        const comps = extractLayoutComponents(rootDoc);
        assert.strictEqual(comps.length, 1);
        assert.strictEqual(comps[0].horizontalAlignment, "SpaceBetween");
        assert.strictEqual(comps[0].verticalAlignment, "Center");
        assert.strictEqual(comps[0].spacing, 16);

        const html = renderLayoutAlignmentInspectorSection(comps[0]);
        assert.ok(html.includes("Layout Alignment &amp; Distribution") || html.includes("Layout Alignment & Distribution"), "HTML should contain layout alignment section");
        assert.ok(html.includes("tweakHorizontalAlign"), "HTML should contain horizontal alignment select");
        assert.ok(html.includes("tweakVerticalAlign"), "HTML should contain vertical alignment select");
        assert.ok(html.includes("tweakSpacedBy"), "HTML should contain spacedBy input");
        assert.ok(html.includes("Space Between (6)"), "HTML should contain Space Between option");
        assert.ok(html.includes("Center (2)"), "HTML should contain Center option");
        assert.ok(html.includes("Live Editable"), "HTML should contain Live Editable badge");
    });

    test("applyLayoutTweaks and applyCoreTextTweaks mutate operation properties live", async () => {
        const { selectLayoutComponent, applyLayoutTweaks, applyCoreTextTweaks, handleCoreTextColorPicker, renderLayoutInspectorPanel, extractLayoutComponents } = layoutModule;
        const { doc, player } = await loadSampleDocument("fitness_activity_widget.rc");

        renderLayoutInspectorPanel(doc);
        selectLayoutComponent("comp_1");

        // Set up mock DOM elements for layout tweaking
        const hAlignSelect = document.createElement("select");
        hAlignSelect.id = "tweakHorizontalAlign";
        hAlignSelect.value = "2"; // Center
        document.body.appendChild(hAlignSelect);

        const vAlignSelect = document.createElement("select");
        vAlignSelect.id = "tweakVerticalAlign";
        vAlignSelect.value = "5"; // Bottom
        document.body.appendChild(vAlignSelect);

        const spacedByInput = document.createElement("input");
        spacedByInput.id = "tweakSpacedBy";
        spacedByInput.value = "24";
        document.body.appendChild(spacedByInput);

        applyLayoutTweaks();

        const comp1 = doc.getRootLayoutComponent();
        assert.strictEqual(comp1.mHorizontalPositioning, 2, "mHorizontalPositioning should be updated to Center (2)");
        assert.strictEqual(comp1.mVerticalPositioning, 5, "mVerticalPositioning should be updated to Bottom (5)");
        assert.strictEqual(comp1.mSpacedBy, 24, "mSpacedBy should be updated to 24");

        // Test CoreText tweaking on real component from doc
        const components = extractLayoutComponents(doc);
        const textComp = components.find(c => c.name === "CoreText" || c.op?.mTextId !== undefined || c.op?.OP_CODE === 239);
        assert.ok(textComp, "Should find a CoreText component in fitness_activity_widget.rc");

        // Select the text component
        selectLayoutComponent(textComp.key);

        const textStringInput = document.createElement("input");
        textStringInput.id = "tweakCoreTextString";
        textStringInput.value = "Updated Live Text";
        document.body.appendChild(textStringInput);

        const fontSizeInput = document.createElement("input");
        fontSizeInput.id = "tweakCoreTextFontSize";
        fontSizeInput.value = "28";
        document.body.appendChild(fontSizeInput);

        const fontWeightSelect = document.createElement("select");
        fontWeightSelect.id = "tweakCoreTextFontWeight";
        fontWeightSelect.value = "800";
        document.body.appendChild(fontWeightSelect);

        const colorHexInput = document.createElement("input");
        colorHexInput.id = "tweakCoreTextColorHex";
        colorHexInput.value = "#FFFF0000";
        document.body.appendChild(colorHexInput);

        const underlineInput = document.createElement("input");
        underlineInput.id = "tweakCoreTextUnderline";
        underlineInput.type = "checkbox";
        underlineInput.checked = true;
        document.body.appendChild(underlineInput);

        applyCoreTextTweaks();

        assert.strictEqual(textComp.op.mText, "Updated Live Text", "Text string should be updated");
        assert.strictEqual(textComp.op.mFontSizeValue, 28, "Font size should be updated to 28");
        assert.strictEqual(textComp.op.mFontWeightValue, 800, "Font weight should be updated to 800");
        assert.strictEqual(textComp.op.mColor, 0xFFFF0000, "Color should be updated to red");
        assert.strictEqual(textComp.op.mUnderline, true, "Underline should be true");

        // Test color picker handler
        handleCoreTextColorPicker("#00FF00");
        assert.strictEqual(colorHexInput.value, "#FF00FF00", "Color hex input should be updated with alpha prefix");
        assert.strictEqual(textComp.op.mColor, 0xFF00FF00, "Color should be updated to green");
    });

    test("DIMENSION_MODIFIER_TYPES, renderDimensionModifiersInspectorSection, and renderModifierChain render enum meanings and live controls", () => {
        const {
            DIMENSION_MODIFIER_TYPES,
            renderDimensionModifiersInspectorSection,
            renderModifierChain
        } = layoutModule;

        // Verify enum definitions
        assert.strictEqual(Object.keys(DIMENSION_MODIFIER_TYPES).length, 9);
        assert.strictEqual(DIMENSION_MODIFIER_TYPES[6].name, "EXACT_DP");
        assert.strictEqual(DIMENSION_MODIFIER_TYPES[1].name, "FILL");
        assert.strictEqual(DIMENSION_MODIFIER_TYPES[3].name, "WEIGHT");

        const mockComp = {
            key: "comp_mock",
            name: "RowLayout",
            width: 200,
            height: 100,
            op: {
                mWidth: 200,
                mHeight: 100,
                mNeedsMeasure: false
            },
            modifiers: [
                {
                    name: "WidthModifier",
                    desc: "width: 150dp",
                    op: {
                        OP_CODE: 16,
                        mType: 6, // EXACT_DP
                        mOutValue: 150,
                        mValue: 150
                    }
                },
                {
                    name: "HeightModifier",
                    desc: "fillMaxHeight",
                    op: {
                        OP_CODE: 67,
                        mType: 1, // FILL
                        mOutValue: 1.0,
                        mValue: 1.0
                    }
                }
            ]
        };

        // Render modifier chain
        const chainHtml = renderModifierChain(mockComp);
        assert.ok(chainHtml.includes("WidthModifier"), "Chain should include WidthModifier");
        assert.ok(chainHtml.includes("HeightModifier"), "Chain should include HeightModifier");
        assert.ok(chainHtml.includes("tweakModType_0"), "Chain should include inline type select for modifier #0");
        assert.ok(chainHtml.includes("tweakModValue_0"), "Chain should include inline value input for modifier #0");
        assert.ok(chainHtml.includes("EXACT_DP (6)"), "Chain should display EXACT_DP option");
        assert.ok(chainHtml.includes("Fixed size in density-independent pixels"), "Chain should display enum description");

        // Render dimension modifier section
        const dimSectionHtml = renderDimensionModifiersInspectorSection(mockComp);
        assert.ok(dimSectionHtml.includes("Dimension Modifiers (WidthModifier &amp; HeightModifier)"), "Section should contain title");
        assert.ok(dimSectionHtml.includes("tweakDimType_width"), "Section should contain width type select");
        assert.ok(dimSectionHtml.includes("tweakDimValue_width"), "Section should contain width value input");
        assert.ok(dimSectionHtml.includes("tweakDimType_height"), "Section should contain height type select");
        assert.ok(dimSectionHtml.includes("tweakDimValue_height"), "Section should contain height value input");
        assert.ok(dimSectionHtml.includes("Dimension Modifier Enum Values Reference (0–8)"), "Section should contain reference guide");
        assert.ok(dimSectionHtml.includes("FILL_PARENT_MAX_WIDTH"), "Section should contain FILL_PARENT_MAX_WIDTH enum");
        assert.ok(dimSectionHtml.includes("FILL_PARENT_MAX_HEIGHT"), "Section should contain FILL_PARENT_MAX_HEIGHT enum");
    });

    test("applyModifierTweaks and applyDimensionTweaks mutate modifier operation type and value live", async () => {
        const {
            selectLayoutComponent,
            applyModifierTweaks,
            applyDimensionTweaks,
            renderLayoutInspectorPanel,
            getCachedLayoutComponents
        } = layoutModule;

        const { doc, player } = await loadSampleDocument("fitness_activity_widget.rc");
        renderLayoutInspectorPanel(doc);

        const components = getCachedLayoutComponents();
        const comp = components[0];
        assert.ok(comp, "Should have a component");

        selectLayoutComponent(comp.key);

        const selected = getCachedLayoutComponents().find(c => c.key === comp.key);

        // Attach a mock WidthModifier to selected if not present
        const mockWidthOp = {
            OP_CODE: 16,
            mType: 6, // EXACT_DP
            mOutValue: 100,
            mValue: 100,
            mValueBits: 0,
            setType: function(t) { this.mType = t; },
            setValue: function(v) { this.mOutValue = v; this.mValue = v; }
        };
        selected.modifiers.push({
            name: "WidthModifier",
            desc: "width: 100dp",
            op: mockWidthOp
        });
        selected.op.mWidthMod = mockWidthOp;

        // Test applyModifierTweaks
        const modTypeSelect = document.createElement("select");
        modTypeSelect.id = `tweakModType_${selected.modifiers.length - 1}`;
        modTypeSelect.value = "1"; // FILL
        document.body.appendChild(modTypeSelect);

        const modValInput = document.createElement("input");
        modValInput.id = `tweakModValue_${selected.modifiers.length - 1}`;
        modValInput.value = "0.75";
        document.body.appendChild(modValInput);

        applyModifierTweaks(selected.modifiers.length - 1);

        assert.strictEqual(mockWidthOp.mType, 1, "mType should be updated to FILL (1)");
        assert.strictEqual(mockWidthOp.mOutValue, 0.75, "mOutValue should be updated to 0.75");

        // Test applyDimensionTweaks for width
        const dimTypeSelect = document.createElement("select");
        dimTypeSelect.id = "tweakDimType_width";
        dimTypeSelect.value = "3"; // WEIGHT
        document.body.appendChild(dimTypeSelect);

        const dimValInput = document.createElement("input");
        dimValInput.id = "tweakDimValue_width";
        dimValInput.value = "2.0";
        document.body.appendChild(dimValInput);

        applyDimensionTweaks("width");

        assert.strictEqual(mockWidthOp.mType, 3, "mType should be updated to WEIGHT (3)");
        assert.strictEqual(mockWidthOp.mOutValue, 2.0, "mOutValue should be updated to 2.0");
    });

    test("issue.rc CoreText with autosize, fill width, and center alignment centers correctly in player", async () => {
        const { loadSampleDocument } = await import("./test_helpers.js");
        const { doc, player } = await loadSampleDocument("issue.rc");
        assert.ok(doc, "Document should load");

        let ct59 = null;
        function find(c) {
            if (c.mComponentId === -59) { ct59 = c; return; }
            for (const child of (c.mChildren || c.getList?.() || [])) find(child);
        }
        find(doc.getRootLayoutComponent());
        assert.ok(ct59, "Should find CoreText -59");
        assert.strictEqual(ct59.mAutosize, true, "Should have autosize enabled");
        assert.strictEqual(ct59.mTextAlign, 3, "Should have TEXT_ALIGN_CENTER (3)");
        assert.strictEqual(ct59.mWidth, 195, "Should have fill width of 195");
        assert.ok(ct59.mComputedTextLayout, "Should have computed text layout");
        assert.strictEqual(ct59.mComputedTextLayout.alignment, 3, "Computed text layout alignment should be 3");
    });

    test("ScreenshotTest_screenshotTest_pixel_6_night.rc ColumnLayout and RowLayout correctly fill available content width inside padded container", async () => {
        const { loadSampleDocument } = await import("./test_helpers.js");
        const { doc, player } = await loadSampleDocument("ScreenshotTest_screenshotTest_pixel_6_night.rc");
        assert.ok(doc, "Document should load");
        player.repaint();

        function findComp(c, cid) {
            if (!c) return null;
            if (c.mComponentId === cid) return c;
            for (const child of (c.mChildrenComponents || c.getList?.() || [])) {
                const res = findComp(child, cid);
                if (res) return res;
            }
            return null;
        }

        const root = doc.getRootLayoutComponent();
        const b22 = findComp(root, -22); // Outer Box with 31.5 horizontal padding
        const b24 = findComp(root, -24); // Inner Box
        const c26 = findComp(root, -26); // ColumnLayout (Op #470)
        const r28 = findComp(root, -28); // RowLayout (Op #479)

        assert.ok(b22, "Should find BoxLayout -22");
        assert.ok(b24, "Should find BoxLayout -24");
        assert.ok(c26, "Should find ColumnLayout -26");
        assert.ok(r28, "Should find RowLayout -28");

        assert.strictEqual(b22.mWidth, 300, "Outer box width should be 300");
        assert.strictEqual(b22.mPaddingLeft, 31.5, "Outer box left padding should be 31.5");
        assert.strictEqual(b22.mPaddingRight, 31.5, "Outer box right padding should be 31.5");

        // Available content width is 300 - 63 = 237
        assert.strictEqual(b24.mWidth, 237, "Inner box width should be 237");
        assert.strictEqual(c26.mWidth, 237, "ColumnLayout width should be 237");
        assert.strictEqual(r28.mWidth, 237, "RowLayout width should be 237");
    });

    test("loading.rc does not continuously request repaints when only referencing animationTime without active animations", async () => {
        const { loadSampleDocument } = await import("./test_helpers.js");
        const { doc, player } = await loadSampleDocument("loading.rc");
        assert.ok(doc, "Document should load");
        player.repaint();

        // In Java and TypeScript, documents without active animations or continuous time listeners
        // must return -1 (no repaint needed) rather than looping continuously.
        assert.strictEqual(doc.needsRepaint(), -1, "doc.needsRepaint() should be -1 for loading.rc");
    });
});
