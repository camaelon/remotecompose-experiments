import { test, describe, beforeEach } from "node:test";
import assert from "node:assert";
import { setupMockEnvironment, loadSampleDocument } from "./test_helpers.js";
import * as compTreeModule from "../src/panels/ComponentTreePanel.js";

describe("ComponentTreePanel Tests", () => {
    beforeEach(() => {
        setupMockEnvironment();
    });

    test("renderComponentTree renders component hierarchy", async () => {
        const { renderComponentTree } = compTreeModule;
        const { doc } = await loadSampleDocument("02_ticker.rc");

        const container = document.getElementById("componentTreeContainer");
        renderComponentTree(doc);
        assert.ok(container.innerHTML.length > 0, "Component tree container should not be empty");
    });

    test("renderRunningOperationsTree renders running ops tree", async () => {
        const { renderRunningOperationsTree } = compTreeModule;
        const { doc } = await loadSampleDocument("02_ticker.rc");

        const container = document.getElementById("runningTreeContainer");
        renderRunningOperationsTree(doc);
        assert.ok(container.innerHTML.length > 0, "Running ops container should not be empty");
    });

    test("toggleTreeNode toggles node expanded state", () => {
        const { toggleTreeNode } = compTreeModule;
        const node = document.getElementById("tree-node-1-children");
        node.classList.add("nested-collapsed");
        const caret = { classList: { add(){}, remove(){}, contains(){ return false; } } };

        toggleTreeNode({ stopPropagation(){}, target: caret }, "tree-node-1");
        assert.ok(!node.classList.contains("nested-collapsed"), "Node should no longer be nested-collapsed");
    });

    test("getComponentIcon returns appropriate emoji for component names", () => {
        const { getComponentIcon } = compTreeModule;
        assert.strictEqual(getComponentIcon("BoxComponent"), "📦");
        assert.strictEqual(getComponentIcon("ColumnComponent"), "📊");
        assert.strictEqual(getComponentIcon("RowComponent"), "⏸️");
        assert.strictEqual(getComponentIcon("TextComponent"), "🔤");
    });

    test("buildTreeNodeHtml keeps CanvasLayout with only draw operations collapsed by default", () => {
        const { buildTreeNodeHtml } = compTreeModule;
        const mockCanvasLayout = {
            mId: 42,
            mWidth: 100,
            mHeight: 100,
            constructor: { name: "CanvasLayout" },
            getList() {
                return [
                    { constructor: { name: "DrawCircle" } },
                    { constructor: { name: "DrawLine" } }
                ];
            }
        };

        const html = buildTreeNodeHtml(mockCanvasLayout, 0);
        assert.ok(html.includes("CanvasLayout"), "Should render CanvasLayout tag");
        assert.ok(html.includes("nested-collapsed"), "Children container should be nested-collapsed by default");
        assert.ok(html.includes("2 draw ops"), "Should show draw ops badge");
    });

    test("updateComponentTreeLive dynamically updates element sizes per frame", () => {
        const { buildTreeNodeHtml, updateComponentTreeLive, __componentTreeOpRegistry } = compTreeModule;
        const mockOp = {
            mId: 99,
            mWidth: 120,
            mHeight: 40,
            constructor: { name: "BoxLayout" },
            getWidth() { return this.mWidth; },
            getHeight() { return this.mHeight; },
            getList() { return []; }
        };

        const html = buildTreeNodeHtml(mockOp, 0);
        assert.ok(html.includes("BoxLayout"), "Should render BoxLayout tag");
        assert.ok(html.includes("(120x40)"), "Should render initial dimensions in HTML");

        const match = html.match(/id="(ctDim-[^"]+)"/);
        assert.ok(match, "HTML should contain ctDim element id");
        const dimId = match[1];
        const dimEl = document.getElementById(dimId);
        dimEl.textContent = "(120x40)";

        // Mutate size dynamically (as happens during an animation frame)
        mockOp.mWidth = 240;
        mockOp.mHeight = 80;

        // Trigger live update
        updateComponentTreeLive();

        // Verify updated dimension
        assert.strictEqual(dimEl.textContent, "(240x80)", "Dimension text should update to match animated size");
    });

    test("FitBoxLayout children display min width and height on the same line", () => {
        const { buildTreeNodeHtml, getMinDimensions } = compTreeModule;
        const mockFitBox = {
            mId: 10,
            constructor: { name: "FitBoxLayout" },
            getList() { return []; }
        };

        const mockChild = {
            mId: 11,
            mWidth: 200,
            mHeight: 100,
            constructor: { name: "BoxLayout" },
            getWidthInModifier() {
                return { getMin() { return 170; } };
            },
            getHeightInModifier() {
                return { getMin() { return 50; } };
            },
            getList() { return []; }
        };

        const minDims = getMinDimensions(mockChild, mockFitBox);
        assert.deepStrictEqual(minDims, { minW: 170, minH: 50 });

        const html = buildTreeNodeHtml(mockChild, 1, mockFitBox);
        assert.ok(html.includes("min: 170×50"), "Should render min: 170×50 badge on the child line");
        assert.ok(html.includes("BoxLayout"), "Should render child name");
    });

    test("getVisibilityInfo accurately distinguishes VISIBLE, INVISIBLE, and GONE", () => {
        const { getVisibilityInfo, buildTreeNodeHtml } = compTreeModule;

        const visibleOp = { mVisibility: 1, constructor: { name: "BoxLayout" } };
        const invisibleOp = { mVisibility: 2, constructor: { name: "BoxLayout" } };
        const goneOp = { mVisibility: 17, constructor: { name: "BoxLayout" } };

        const visInfo = getVisibilityInfo(visibleOp);
        assert.strictEqual(visInfo.status, "VISIBLE");
        assert.strictEqual(visInfo.icon, "👁️");

        const invisInfo = getVisibilityInfo(invisibleOp);
        assert.strictEqual(invisInfo.status, "INVISIBLE");
        assert.strictEqual(invisInfo.icon, "🙈");

        const goneInfo = getVisibilityInfo(goneOp);
        assert.strictEqual(goneInfo.status, "GONE");
        assert.strictEqual(goneInfo.icon, "🚫");

        const htmlVis = buildTreeNodeHtml(visibleOp, 0);
        assert.ok(htmlVis.includes("👁️"), "HTML should include visible eye icon");

        const htmlGone = buildTreeNodeHtml(goneOp, 0);
        assert.ok(htmlGone.includes("🚫"), "HTML should include gone icon");
    });

    test("highlightStepOperation highlights active operation in Running Tree and updates status pill", async () => {
        const { renderRunningOperationsTree } = compTreeModule;
        const { highlightStepOperation } = await import("../src/panels/StagePanel.js");
        const { doc } = await loadSampleDocument("02_ticker.rc");

        const container = document.getElementById("runningTreeContainer");
        renderRunningOperationsTree(doc);

        const pill = document.getElementById("stepStatusPill");

        const ops = typeof doc.getOperations === "function" ? doc.getOperations() : doc.mOperations;
        const targetOp = ops[0];

        highlightStepOperation(targetOp, 0, ops.length);

        assert.strictEqual(pill.style.display, "inline-flex", "Step status pill should be displayed");
        assert.ok(pill.innerHTML.includes("Step 1/"), "Status pill should show current step index");
        assert.ok(pill.innerHTML.includes("<strong>"), "Status pill should format op name in bold");
    });

    test("updateVariableValuesLive updates variable inputs from RemoteContext and State during stepping", async () => {
        const { updateVariableValuesLive } = await import("../src/panels/VariablesPanel.js");
        const { highlightStepOperation } = await import("../src/panels/StagePanel.js");

        // Mock document and remote context with dynamic float variable #42
        let curVal = 100.5;
        const mockRemoteContext = {
            getFloat(id) { return id === 42 ? curVal : NaN; },
            getInteger(id) { return NaN; },
            getColor(id) { return 0; }
        };

        window.currentDocument = {
            getRemoteComposeState() {
                return {
                    getFloat(id) { return id === 42 ? curVal : NaN; },
                    getInteger(id) { return NaN; }
                };
            }
        };
        window.currentPlayer = {
            getRemoteContext() { return mockRemoteContext; }
        };

        // Create mock variable input in DOM
        const input = document.createElement("input");
        input.className = "var-input-field";
        input.dataset.varId = "42";
        input.value = "0";
        document.body.appendChild(input);

        // Update live values
        updateVariableValuesLive();
        assert.strictEqual(input.value, "100.50", "Input value should reflect live float from RemoteContext");

        // Mutate variable value during step playback
        curVal = 250.0;
        const mockOp = { mId: 42, OP_CODE: 81, constructor: { name: "FloatExpression" } };
        highlightStepOperation(mockOp, 1, 10);

        assert.strictEqual(input.value, "250", "Input value should update live to 250 on step highlight");
    });

    test("buildRunningTreeNodeHtml only displays visibility icon and layout dimensions for components", () => {
        const { buildRunningTreeNodeHtml } = compTreeModule;

        const paintDataOp = { OP_CODE: 39, mId: 10, constructor: { name: "PaintData" } };
        const textDataOp = { OP_CODE: 40, mId: 11, mText: "Hello", constructor: { name: "TextData" } };
        const drawPathOp = { OP_CODE: 125, mId: 12, constructor: { name: "DrawPath" } };
        const paddingOp = { OP_CODE: 54, mId: 13, constructor: { name: "PaddingModifier" } };
        const boxLayoutOp = {
            OP_CODE: 202,
            mId: 14,
            mWidth: 200,
            mHeight: 100,
            mVisibility: 1,
            getWidth() { return 200; },
            getHeight() { return 100; },
            getList() { return []; },
            constructor: { name: "BoxLayout" }
        };

        const paintHtml = buildRunningTreeNodeHtml(paintDataOp, 0, "0");
        assert.ok(!paintHtml.includes("rtVisIcon-"), "PaintData should NOT render a visibility icon");
        assert.ok(!paintHtml.includes("rtVis-"), "PaintData should NOT render a visibility text status");
        assert.ok(!paintHtml.includes("rtDim-"), "PaintData should NOT render dimension bounds");

        const textHtml = buildRunningTreeNodeHtml(textDataOp, 0, "1");
        assert.ok(!textHtml.includes("rtVisIcon-"), "TextData should NOT render a visibility icon");
        assert.ok(!textHtml.includes("rtVis-"), "TextData should NOT render a visibility text status");
        assert.ok(!textHtml.includes("rtDim-"), "TextData should NOT render dimension bounds");
        assert.ok(textHtml.includes('"Hello"'), "TextData should render text string preview");

        const pathHtml = buildRunningTreeNodeHtml(drawPathOp, 0, "2");
        assert.ok(!pathHtml.includes("rtVisIcon-"), "DrawPath should NOT render a visibility icon");
        assert.ok(!pathHtml.includes("rtDim-"), "DrawPath should NOT render dimension bounds");

        const modHtml = buildRunningTreeNodeHtml(paddingOp, 0, "3");
        assert.ok(!modHtml.includes("rtVisIcon-"), "PaddingModifier should NOT render a visibility icon");
        assert.ok(!modHtml.includes("rtDim-"), "PaddingModifier should NOT render dimension bounds");

        const boxHtml = buildRunningTreeNodeHtml(boxLayoutOp, 0, "4");
        assert.ok(boxHtml.includes("rtVisIcon-"), "BoxLayout component SHOULD render a visibility icon");
        assert.ok(boxHtml.includes("rtVis-"), "BoxLayout component SHOULD render visibility text status");
        assert.ok(boxHtml.includes("rtDim-"), "BoxLayout component SHOULD render layout dimension bounds");
        assert.ok(boxHtml.includes("(200×100)"), "BoxLayout component should display (200×100) dimensions");
    });

    test("updateComponentTreeLive dynamically updates visibility icons on resize and inherits parent GONE state", () => {
        const { buildTreeNodeHtml, updateComponentTreeLive, getVisibilityInfo } = compTreeModule;

        const parentOp = {
            mId: 100,
            mVisibility: 1,
            mWidth: 300,
            mHeight: 300,
            constructor: { name: "FitBoxLayout" },
            getList() { return []; }
        };

        const childOp = {
            mId: 101,
            mVisibility: 1,
            mWidth: 150,
            mHeight: 50,
            mParent: parentOp,
            constructor: { name: "BoxLayout" },
            getList() { return []; }
        };

        const grandChildOp = {
            mId: 102,
            mVisibility: 1,
            mWidth: 80,
            mHeight: 30,
            mParent: childOp,
            constructor: { name: "CoreText" },
            getList() { return []; }
        };

        // Render initially VISIBLE
        const childHtml = buildTreeNodeHtml(childOp, 1, parentOp);
        assert.ok(childHtml.includes("👁️"), "HTML should contain visible eye icon");
        const match = childHtml.match(/id="(ctVis-[^"]+)"/);
        assert.ok(match, "HTML should contain ctVis element id");
        const visId = match[1];
        const visEl = document.getElementById(visId);
        visEl.textContent = "👁️";

        // FitBoxLayout picks a different branch -> childOp becomes OVERRIDE_GONE (17)
        childOp.mVisibility = 17;
        assert.strictEqual(getVisibilityInfo(childOp).status, "GONE", "childOp should be GONE");
        assert.strictEqual(getVisibilityInfo(grandChildOp).status, "GONE", "grandChildOp should inherit GONE from childOp");

        // Trigger live update (as called on frame / resize)
        updateComponentTreeLive();

        assert.strictEqual(visEl.textContent, "🚫", "Visibility icon in component tree should update to 🚫 (GONE)");
    });

    test("selectLayoutComponent highlights selected component in Component Tree even without explicit IDs and expands collapsed ancestors", async () => {
        const { renderComponentTree, selectTreeNode, __componentTreeOpRegistry } = compTreeModule;
        const layoutModule = await import("../src/panels/LayoutInspectorPanel.js");
        const { selectLayoutComponent } = layoutModule;

        const { doc, player } = await loadSampleDocument("collapsible_fitness_widget.rc");
        player.repaint();

        const container = document.getElementById("componentTreeContainer");
        renderComponentTree(doc);

        assert.ok(__componentTreeOpRegistry.size > 10, "Op registry should contain components");

        // Pick a child component that has id = 0 or null
        const components = layoutModule.extractLayoutComponents(doc);
        const childComp = components.find(c => c.depth > 1 && (c.id === null || c.id === 0 || c.id === undefined));
        assert.ok(childComp, "Should find a nested component with id=0 or null");

        // Select it via selectLayoutComponent
        window.currentDocument = doc;
        selectLayoutComponent(childComp.op);

        // Find the node element in the component tree
        const selectedNodes = document.querySelectorAll(".tree-node-content.selected");
        assert.strictEqual(selectedNodes.length, 1, "Exactly one component tree node should have .selected class");

        // Verify that ancestors are expanded
        let parent = selectedNodes[0].parentElement;
        while (parent) {
            if (parent.id && parent.id.endsWith("-children")) {
                assert.strictEqual(parent.classList.contains("nested-collapsed"), false, "Ancestor container should not be collapsed");
            }
            parent = parent.parentElement;
        }

        // Test unselect
        selectLayoutComponent(null);
        const afterUnselectNodes = document.querySelectorAll(".tree-node-content.selected");
        assert.strictEqual(afterUnselectNodes.length, 0, "No nodes should be selected after selectLayoutComponent(null)");
    });

    test("buildTreeNodeHtml and buildRunningTreeNodeHtml render rich CoreText metadata badges", () => {
        const { buildTreeNodeHtml, buildRunningTreeNodeHtml } = compTreeModule;

        const coreTextOp = {
            OP_CODE: 239,
            mComponentId: 101,
            mText: "Activity Stats",
            mFontSizeValue: 18,
            mFontWeightValue: 600,
            mTextAlign: 5, // Start
            mOverflow: 3, // Ellipsis
            mMaxLines: 1,
            mColor: 0xFF00E676,
            mUnderline: false,
            mStrikethrough: false,
            mAutosize: true,
            constructor: { name: "CoreText" },
            getList() { return []; }
        };

        const treeHtml = buildTreeNodeHtml(coreTextOp, 0, null);
        assert.ok(treeHtml.includes("Activity Stats"), "Tree HTML should contain text string");
        assert.ok(treeHtml.includes("18sp • 600"), "Tree HTML should display font size and weight badge");
        assert.ok(treeHtml.includes("Start • 1L"), "Tree HTML should display text align and max lines");
        assert.ok(treeHtml.includes("auto"), "Tree HTML should display autosize badge");

        const runningHtml = buildRunningTreeNodeHtml(coreTextOp, 0, "0", null);
        assert.ok(runningHtml.includes("Activity Stats"), "Running Tree HTML should contain text string");
        assert.ok(runningHtml.includes("18sp • 600"), "Running Tree HTML should display font size and weight badge");
        assert.ok(runningHtml.includes("Start • 1L"), "Running Tree HTML should display text align and max lines");
    });

    test("buildTreeNodeHtml and buildRunningTreeNodeHtml render layout alignment badges for RowLayout and ColumnLayout", () => {
        const { buildTreeNodeHtml, buildRunningTreeNodeHtml } = compTreeModule;

        const rowLayoutOp = {
            OP_CODE: 203,
            mComponentId: 202,
            mHorizontalPositioning: 2, // Center
            mVerticalPositioning: 5, // Bottom
            mSpacedBy: 8,
            constructor: { name: "RowLayout" },
            getList() { return []; }
        };

        const treeHtml = buildTreeNodeHtml(rowLayoutOp, 0, null);
        assert.ok(treeHtml.includes("↔ Center ↕ Bottom"), "Tree HTML should render horizontal and vertical alignment");
        assert.ok(treeHtml.includes("8dp"), "Tree HTML should render spacedBy");

        const runningHtml = buildRunningTreeNodeHtml(rowLayoutOp, 0, "0", null);
        assert.ok(runningHtml.includes("↔ Center ↕ Bottom"), "Running Tree HTML should render horizontal and vertical alignment");
        assert.ok(runningHtml.includes("8dp"), "Running Tree HTML should render spacedBy");
    });

    test("selectTreeNode finds and selects the corresponding command in the command list panel", async () => {
        const { renderComponentTree, selectTreeNode, __componentTreeOpRegistry } = compTreeModule;
        const { renderCommandsList } = await import("../src/panels/CommandListPanel.js");
        const { doc } = await loadSampleDocument("02_ticker.rc");

        const ops = typeof doc.getOperations === "function" ? doc.getOperations() : doc.mOperations;
        window.currentParsedOps = ops;
        window.currentDocument = doc;

        const cmdContainer = document.getElementById("commandsContainer");
        renderCommandsList(ops, null);
        renderComponentTree(doc);

        assert.ok(__componentTreeOpRegistry.size > 0, "Op registry should contain tree components");

        // Pick a registered node from the component tree
        const [nodeId, targetOp] = Array.from(__componentTreeOpRegistry.entries())[0];
        assert.ok(nodeId, "Should have a registered node id");
        assert.ok(targetOp, "Should have a registered component operation");

        selectTreeNode(nodeId);

        // Verify the tree node is selected
        const treeNodeEl = document.getElementById(nodeId);
        if (treeNodeEl) {
            assert.ok(treeNodeEl.classList.contains("selected"), "Tree node should have .selected class");
        }

        // Verify corresponding command card is selected in command list
        const targetIdx = ops.indexOf(targetOp);
        if (targetIdx >= 0) {
            const cardEl = document.getElementById(`cmdCard-${targetIdx}`);
            assert.ok(cardEl, `Command card for op index ${targetIdx} should exist in DOM`);
            assert.ok(cardEl.classList.contains("selected"), "Command card in command list should be selected");
        }
    });

    test("findMatchingCommandIndex matches operations by componentId, textId, direct reference, and id", async () => {
        const { findMatchingCommandIndex } = await import("../src/panels/CommandListPanel.js");

        const mockOps = [
            { OP_CODE: 0, mId: 1, constructor: { name: "Header" } },
            { OP_CODE: 203, mComponentId: 100, constructor: { name: "BoxLayout" } },
            { OP_CODE: 16, mComponentId: 100, mType: 1, constructor: { name: "WidthModifier" } },
            { OP_CODE: 239, mComponentId: 101, mTextId: 50, constructor: { name: "CoreText" } },
            { OP_CODE: 204, mComponentId: 102, mBitmapId: 77, constructor: { name: "ImageLayout" } }
        ];

        // 1. Direct match
        assert.strictEqual(findMatchingCommandIndex(mockOps[1], null, mockOps), 1, "Direct object match should return index 1");

        // 2. Component ID match for CoreText
        const queryCoreText = { mComponentId: 101, constructor: { name: "CoreText" } };
        assert.strictEqual(findMatchingCommandIndex(queryCoreText, null, mockOps), 3, "CoreText with mComponentId 101 should match index 3");

        // 3. Text ID match
        const queryText = { mTextId: 50, constructor: { name: "TextLayout" } };
        assert.strictEqual(findMatchingCommandIndex(queryText, null, mockOps), 3, "Text with mTextId 50 should match index 3");

        // 4. Bitmap ID match
        const queryImage = { mBitmapId: 77, constructor: { name: "ImageLayout" } };
        assert.strictEqual(findMatchingCommandIndex(queryImage, null, mockOps), 4, "Image with mBitmapId 77 should match index 4");

        // 5. Op ID match
        assert.strictEqual(findMatchingCommandIndex(null, 1, mockOps), 0, "Op ID 1 should match Header at index 0");
    });
});