// =========================================================================
// RemoteCompose Web Inspector - Main Application Orchestrator
// Modular Architecture: All panels and sub-engines imported as ES Modules
// =========================================================================

// 1. Profiler & Op Measurement Engine
import {
    armProfiler,
    drawProfiler,
    toggleProfilerMeasurement,
    resetProfilerTotals,
    setProfilerRank,
    selectRunningTreeNodeFromInstance
} from './panels/ProfilerPanel.js';

// 2. Expression Dependency Graph & Dead-Code Analyzer
import {
    buildExpressionGraphModel,
    getUnusedIslandsAnalysis,
    invalidateUnusedIslandsAnalysisCache,
    renderExpressionDependencyGraph,
    selectExprGraphNode,
    deselectExprGraphNode,
    setExprGraphDisplayMode,
    resetExprGraphZoom,
    toggleExprGraphSortUnused,
    toggleExprVariableSimulator,
    onExprSimulatorSliderChange,
    toggleExprCriticalPathTrace,
    toggleExprMinimapCollapse,
    updateExprGraphLiveValues
} from './panels/DependencyGraphPanel.js';
import { renderRepaintPanel, updateRepaintPanelLive, resetRepaintHistory } from './panels/RepaintPanel.js';
import { renderInteractionPanel, fireInteractionTarget } from './panels/InteractionPanel.js';
import { renderAccessibilityPanel } from './panels/AccessibilityPanel.js';
import { renderLayers3DPanel, resetLayers3DView, setLayerSpacing, setStackMode, toggleFlattenedLayers, toggleScrollOffset, toggleClipAreas, toggleTextContent, captureLayerContent, clearLayerContent, invalidateLayers3DModel, refreshLayers3DBounds } from './panels/Layers3DPanel.js';

// 3. Command List, Disassembly & Variable Usage Engine
import {
    KNOWN_OPCODES,
    getOpId,
    getOpName,
    isContainerOp,
    isModifierOp,
    isComponentOp,
    toRawBits,
    prettyPrintFloatExpression,
    prettyPrintIntegerExpression,
    getEffectiveChildren,
    toggleCmdDisplayMode,
    changeCmdSortMode,
    renderPathDataPreviewHtml,
    getVariableUsageInfo,
    getUnusedVariableDefIds,
    getReferencingOpsForVarId,
    renderReferencingOpsHtml,
    renderCommandsList,
    toggleCommandExpand,
    selectCommandCard,
    onCmdSearchInput,
    clearCmdSearch,
    filterUnusedVarsOnly,
    filterCommands,
    intBitsToFloat,
    getFloatProp,
    formatNumber,
    prettyPrintWidthModifier,
    prettyPrintHeightModifier,
    prettyPrintPaddingModifier,
    prettyPrintFloatConstant,
    prettyPrintColorConstant,
    prettyPrintNamedVariable,
    prettyPrintLoop,
    prettyPrintTextFromFloat,
    prettyPrintTextLookup,
    prettyPrintTextMerge,
    prettyPrintTextLength,
    prettyPrintLongConstant,
    prettyPrintTimeAttribute,
    prettyPrintTheme,
    prettyPrintColorTheme,
    prettyPrintColorExpression,
    prettyPrintHeader,
    parsePathDataOp,
    drawPathDataPreviewCanvas,
    renderPathCombinePreviewHtml,
    renderBitmapDataPreviewHtml,
    renderDrawBitmapReferenceHtml,
    getOpBitmapDataUrl,
    uint8ArrayToDataUrl,
    prettyPrintPathData,
    prettyPrintPathAppend,
    prettyPrintPathCreate,
    prettyPrintPathTween,
    prettyPrintPathCombine,
    prettyPrintDrawPath,
    prettyPrintDrawTweenPath,
    prettyPrintMatrixFromPath,
    prettyPrintPathExpression,
    DIMENSION_MODIFIER_TYPES,
    getDimensionModifierInfo,
    renderDimensionModifierDetailsHtml,
    findMatchingCommandIndex
} from './panels/CommandListPanel.js';

// 4. JSON Editor & Document Decompiler
import {
    initJsonEditor,
    getJsonInputValue,
    setJsonInputValue,
    formatJsonInput,
    copyJsonInput,
    recompileJsonInput,
    loadSelectedDemo,
    decompileDocumentToJson,
    compileAndLoadJson,
    showCompileStatus,
    SAMPLE_DEMOS
} from './panels/JsonEditorPanel.js';

// 5. Stage, Density, Sizing & Step Execution Engine
import {
    customStageWidth,
    customStageHeight,
    currentDensity,
    canvasBgWhite,
    isPlayerPaused,
    stepTargetOp,
    setCustomStageSize,
    applyStagePreset,
    applyDensity,
    onDensitySelectChange,
    onCustomDensityInput,
    updateStageScale,
    setStageScaleMode,
    toggleStageAutoScale,
    onStageScaleSelectChange,
    onStageSetupScaleSelectChange,
    initStageLiveResize,
    applyStageDimensions,
    toggleCanvasBg,
    togglePlayPause,
    pausePlayer,
    stepOpBackward,
    stepOpForward,
    resetStepToStart,
    stepOpToEnd,
    selectAndRenderStepOp,
    highlightStepOperation,
    renderFrameUpToStepIndex,
    evaluateLoopParams,
    getRunningNodeChildren,
    buildExecutionTrace,
    formatDimensionNumber
} from './panels/StagePanel.js';

// 6. Component Tree & Running Operations Tree
import {
    __rtOpRegistry,
    renderComponentTree,
    buildTreeNodeHtml,
    getComponentIcon,
    toggleTreeNode,
    toggleModifiers,
    expandAllTree,
    selectTreeNode,
    renderRunningOperationsTree,
    buildRunningTreeNodeHtml,
    updateComponentTreeLive,
    updateRunningTreeLive,
    getRunningOpIcon,
    toggleRunningTreeNode,
    expandAllRunningTree,
    selectRunningTreeNode,
    onRunningTreeSearchInput,
    clearRunningTreeSearch,
    filterRunningTree
} from './panels/ComponentTreePanel.js';

// 7. Variables & State Inspector + Real-time Oscilloscope
import {
    SYSTEM_VARS,
    getSystemVarName,
    getReferencedVarIds,
    updateVariablesPanel,
    toggleGraphVariable,
    setGraphWindowDuration,
    clearGraphData,
    updateGraphLegend,
    renderGraphCanvas,
    updateVariableValuesLive,
    onVarValueEdit,
    getVarColor,
    selectedGraphVarIds,
    graphHistory
} from './panels/VariablesPanel.js';

// 8. Document Statistics & Op Breakdown Panel
import {
    renderDocumentStatistics,
    renderComponentsBreakdown,
    filterCommandsByType,
    renderOpTypesBreakdown,
    setSegment,
    setKpi,
    computeTreeMetrics,
    resetStatsUI
} from './panels/DocumentStatsPanel.js';

// 9. Workspace & Layout Manager (Resizers, Collapsible Panels, Key Nav)
import {
    lastPaneWidths,
    PANEL_META,
    CLUSTERS,
    PANEL_PUCKS,
    hidePanel,
    restorePanel,
    updateHeaderCollapsedBar,
    updateResizersVisibility,
    initPaneResizers,
    initKeyboardNavigation,
    toggleSectionCollapse,
    findOperationByInstanceId,
    applyWorkspace,
    initWorkspaces,
    renderPanelPucks,
    updatePanelPucks,
    togglePanelPuck,
    SafeStorage,
    checkLocalStorageAvailable,
    isLocalStorageAvailable,
    switchPanelTab,
    maximizePanel,
    initSplitDividers,
    toggleSplitSection,
    applyDefaultLayout
} from './panels/LayoutManager.js';

// 10. Document Loader & IO Engine (Drag-and-Drop, URL Loader, Binary Parsing)
import {
    currentPlayer,
    currentDocument,
    currentBuffer,
    currentParsedOps,
    initDropZone,
    handleFileSelect,
    processFile,
    getAllOperationsFlat,
    loadRcArrayBuffer,
    exportRcFile,
    fetchArrayBuffer,
    loadDocumentFromUrlParam
} from './panels/DocumentLoader.js';

// 11. Binary Treemap & Byte Allocation Visualizer
import {
    buildBinaryTreemapModel,
    renderBinaryTreemapPanel,
    updateTreemapUI,
    renderSquarifiedTreemapSvg,
    renderAllocationTable,
    onTreemapItemClick,
    setTreemapZoom,
    setTreemapViewMode,
    onTreemapSearchInput,
    clearTreemapSearch,
    onTreemapMinSizeChange,
    resetTreemapFilters,
    highlightTreemapOp
} from './panels/BinaryTreemapPanel.js';

// 12. System Theme & Environment Matrix Switcher
import {
    THEME_MODES,
    THEME_LABELS,
    PRESET_PALETTES,
    getActiveThemeMode,
    intToHexColor,
    intToRgbaString,
    hexToArgbInt,
    categorizeColorToken,
    extractDocumentThemeTokens,
    setDocumentTheme,
    overrideNamedColor,
    resetAllThemeOverrides,
    generateM3TonalPalette,
    applyPresetPalette,
    applyCustomSeedPalette,
    renderThemeEnvironmentPanel,
    updateThemePanelUI
} from './panels/ThemeEnvironmentPanel.js';

// 13. Responsive Matrix (Size Buckets Multi-Player Grid)
import {
    MATRIX_PRESETS,
    MATRIX_THEMES,
    getMatrixPlayers,
    stopMatrixPlayers,
    setMatrixTheme,
    setMatrixDensity,
    toggleMatrixPlayPause,
    loadMatrixPreset,
    loadQuickSample,
    inspectMatrixCell,
    renderResponsiveMatrixPanel
} from './panels/ResponsiveMatrixPanel.js';

// 14. Layout & Box Model Inspector
import {
    extractLayoutComponents,
    runLayoutDiagnostics,
    renderBoxModelDiagram,
    renderModifierChain,
    renderLayoutInspectorPanel,
    selectLayoutComponent,
    jumpToCommandCard,
    toggleLayoutBoundsOverlay,
    drawLayoutBoundsOverlay,
    applyLayoutTweaks,
    resetLayoutTweaks,
    getSelectedComponentKey,
    getShowLayoutBoundsOverlay,
    getCachedLayoutComponents,
    getSafeFloat,
    getComponentPadding,
    getComponentGlobalPosition,
    applyModifierTweaks,
    applyDimensionTweaks,
    renderDimensionModifiersInspectorSection,
    renderLayoutAlignmentInspectorSection,
    renderCoreTextInspectorSection,
    applyCoreTextTweaks,
    handleCoreTextColorPicker
} from './panels/LayoutInspectorPanel.js';

// =========================================================================
// HTML / Window Global Bindings (For DOM inline event handlers & scripts)
// =========================================================================
if (typeof window !== 'undefined') {
    // Layout & Box Model Inspector
    window.extractLayoutComponents = extractLayoutComponents;
    window.runLayoutDiagnostics = runLayoutDiagnostics;
    window.renderBoxModelDiagram = renderBoxModelDiagram;
    window.renderModifierChain = renderModifierChain;
    window.renderLayoutInspectorPanel = renderLayoutInspectorPanel;
    window.selectLayoutComponent = selectLayoutComponent;
    window.jumpToCommandCard = jumpToCommandCard;
    window.toggleLayoutBoundsOverlay = toggleLayoutBoundsOverlay;
    window.drawLayoutBoundsOverlay = drawLayoutBoundsOverlay;
    window.applyLayoutTweaks = applyLayoutTweaks;
    window.resetLayoutTweaks = resetLayoutTweaks;
    window.getSelectedComponentKey = getSelectedComponentKey;
    window.getShowLayoutBoundsOverlay = getShowLayoutBoundsOverlay;
    window.getCachedLayoutComponents = getCachedLayoutComponents;
    window.getSafeFloat = getSafeFloat;
    window.getComponentPadding = getComponentPadding;
    window.getComponentGlobalPosition = getComponentGlobalPosition;
    window.applyModifierTweaks = applyModifierTweaks;
    window.applyDimensionTweaks = applyDimensionTweaks;
    window.renderDimensionModifiersInspectorSection = renderDimensionModifiersInspectorSection;
    window.renderLayoutAlignmentInspectorSection = renderLayoutAlignmentInspectorSection;
    window.renderCoreTextInspectorSection = renderCoreTextInspectorSection;
    window.applyCoreTextTweaks = applyCoreTextTweaks;
    window.handleCoreTextColorPicker = handleCoreTextColorPicker;

    // Responsive Matrix Multi-Player Grid
    window.MATRIX_PRESETS = MATRIX_PRESETS;
    window.MATRIX_THEMES = MATRIX_THEMES;
    window.getMatrixPlayers = getMatrixPlayers;
    window.stopMatrixPlayers = stopMatrixPlayers;
    window.setMatrixTheme = setMatrixTheme;
    window.setMatrixDensity = setMatrixDensity;
    window.toggleMatrixPlayPause = toggleMatrixPlayPause;
    window.loadMatrixPreset = loadMatrixPreset;
    window.loadQuickSample = loadQuickSample;
    window.inspectMatrixCell = inspectMatrixCell;
    window.renderResponsiveMatrixPanel = renderResponsiveMatrixPanel;

    // System Theme & Environment Matrix
    window.THEME_MODES = THEME_MODES;
    window.THEME_LABELS = THEME_LABELS;
    window.PRESET_PALETTES = PRESET_PALETTES;
    window.getActiveThemeMode = getActiveThemeMode;
    window.intToHexColor = intToHexColor;
    window.intToRgbaString = intToRgbaString;
    window.hexToArgbInt = hexToArgbInt;
    window.categorizeColorToken = categorizeColorToken;
    window.extractDocumentThemeTokens = extractDocumentThemeTokens;
    window.setDocumentTheme = setDocumentTheme;
    window.overrideNamedColor = overrideNamedColor;
    window.resetAllThemeOverrides = resetAllThemeOverrides;
    window.generateM3TonalPalette = generateM3TonalPalette;
    window.applyPresetPalette = applyPresetPalette;
    window.applyCustomSeedPalette = applyCustomSeedPalette;
    window.renderThemeEnvironmentPanel = renderThemeEnvironmentPanel;
    window.updateThemePanelUI = updateThemePanelUI;
    // Stage & Player Controls
    window.setCustomStageSize = setCustomStageSize;
    window.applyStagePreset = applyStagePreset;
    window.applyDensity = applyDensity;
    window.onDensitySelectChange = onDensitySelectChange;
    window.onCustomDensityInput = onCustomDensityInput;
    window.applyStageDimensions = applyStageDimensions;
    window.toggleCanvasBg = toggleCanvasBg;
    window.togglePlayPause = togglePlayPause;
    window.stepOpBackward = stepOpBackward;
    window.stepOpForward = stepOpForward;
    window.resetStepToStart = resetStepToStart;
    window.stepOpToEnd = stepOpToEnd;
    window.selectAndRenderStepOp = selectAndRenderStepOp;
    window.renderFrameUpToOperation = selectAndRenderStepOp;
    window.highlightStepOperation = highlightStepOperation;
    window.renderFrameUpToStepIndex = renderFrameUpToStepIndex;

    // Component & Running Trees
    window.renderComponentTree = renderComponentTree;
    window.toggleTreeNode = toggleTreeNode;
    window.toggleModifiers = toggleModifiers;
    window.expandAllTree = expandAllTree;
    window.selectTreeNode = selectTreeNode;
    window.renderRunningOperationsTree = renderRunningOperationsTree;
    window.updateComponentTreeLive = updateComponentTreeLive;
    window.updateRunningTreeLive = updateRunningTreeLive;
    window.toggleRunningTreeNode = toggleRunningTreeNode;
    window.expandAllRunningTree = expandAllRunningTree;
    window.selectRunningTreeNode = selectRunningTreeNode;
    window.onRunningTreeSearchInput = onRunningTreeSearchInput;
    window.clearRunningTreeSearch = clearRunningTreeSearch;
    window.filterRunningTree = filterRunningTree;

    // Commands & Disassembly
    window.KNOWN_OPCODES = KNOWN_OPCODES;
    window.isComponentOp = isComponentOp;
    window.isContainerOp = isContainerOp;
    window.isModifierOp = isModifierOp;
    window.toggleCmdDisplayMode = toggleCmdDisplayMode;
    window.changeCmdSortMode = changeCmdSortMode;
    window.renderCommandsList = renderCommandsList;
    window.toggleCommandExpand = toggleCommandExpand;
    window.selectCommandCard = selectCommandCard;
    window.findMatchingCommandIndex = findMatchingCommandIndex;
    window.onCmdSearchInput = onCmdSearchInput;
    window.clearCmdSearch = clearCmdSearch;
    window.filterUnusedVarsOnly = filterUnusedVarsOnly;
    window.filterCommands = filterCommands;
    window.filterCommandsByType = filterCommandsByType;
    window.drawPathDataPreviewCanvas = drawPathDataPreviewCanvas;
    window.renderPathDataPreviewHtml = renderPathDataPreviewHtml;
    window.renderPathCombinePreviewHtml = renderPathCombinePreviewHtml;
    window.renderBitmapDataPreviewHtml = renderBitmapDataPreviewHtml;
    window.renderDrawBitmapReferenceHtml = renderDrawBitmapReferenceHtml;
    window.getOpBitmapDataUrl = getOpBitmapDataUrl;
    window.uint8ArrayToDataUrl = uint8ArrayToDataUrl;
    window.prettyPrintPathData = prettyPrintPathData;

    // JSON Editor & Demos
    window.getJsonInputValue = getJsonInputValue;
    window.setJsonInputValue = setJsonInputValue;
    window.formatJsonInput = formatJsonInput;
    window.copyJsonInput = copyJsonInput;
    window.recompileJsonInput = recompileJsonInput;
    window.loadSelectedDemo = loadSelectedDemo;
    window.showCompileStatus = showCompileStatus;

    // Variables & Graphing
    window.updateVariablesPanel = updateVariablesPanel;
    window.toggleGraphVariable = toggleGraphVariable;
    window.setGraphWindowDuration = setGraphWindowDuration;
    window.clearGraphData = clearGraphData;
    window.updateGraphLegend = updateGraphLegend;
    window.renderGraphCanvas = renderGraphCanvas;
    window.updateVariableValuesLive = updateVariableValuesLive;
    window.onVarValueEdit = onVarValueEdit;

    // Dependency Graph
    window.renderExpressionDependencyGraph = renderExpressionDependencyGraph;
    window.selectExprGraphNode = selectExprGraphNode;
    window.deselectExprGraphNode = deselectExprGraphNode;
    window.setExprGraphDisplayMode = setExprGraphDisplayMode;
    window.resetExprGraphZoom = resetExprGraphZoom;
    window.toggleExprGraphSortUnused = toggleExprGraphSortUnused;
    window.toggleExprVariableSimulator = toggleExprVariableSimulator;
    window.onExprSimulatorSliderChange = onExprSimulatorSliderChange;
    window.toggleExprCriticalPathTrace = toggleExprCriticalPathTrace;
    window.toggleExprMinimapCollapse = toggleExprMinimapCollapse;
    window.updateExprGraphLiveValues = updateExprGraphLiveValues;

    // Profiler
    window.armProfiler = armProfiler;
    window.drawProfiler = drawProfiler;
    window.renderRepaintPanel = renderRepaintPanel;
    window.updateRepaintPanelLive = updateRepaintPanelLive;
    window.resetRepaintHistory = resetRepaintHistory;
    window.switchPanelTab = switchPanelTab;
    window.maximizePanel = maximizePanel;
    window.initSplitDividers = initSplitDividers;
    window.toggleSplitSection = toggleSplitSection;
    window.applyDefaultLayout = applyDefaultLayout;
    initSplitDividers();
    window.renderInteractionPanel = renderInteractionPanel;
    window.fireInteractionTarget = fireInteractionTarget;
    window.renderAccessibilityPanel = renderAccessibilityPanel;
    window.renderLayers3DPanel = renderLayers3DPanel;
    window.resetLayers3DView = resetLayers3DView;
    window.setLayerSpacing = setLayerSpacing;
    window.setStackMode = setStackMode;
    window.toggleFlattenedLayers = toggleFlattenedLayers;
    window.toggleScrollOffset = toggleScrollOffset;
    window.toggleClipAreas = toggleClipAreas;
    window.toggleTextContent = toggleTextContent;
    window.captureLayerContent = captureLayerContent;
    window.clearLayerContent = clearLayerContent;
    window.toggleScrollOffset = toggleScrollOffset;
    window.invalidateLayers3DModel = invalidateLayers3DModel;
    window.refreshLayers3DBounds = refreshLayers3DBounds;
    window.toggleProfilerMeasurement = toggleProfilerMeasurement;
    window.resetProfilerTotals = resetProfilerTotals;
    window.setProfilerRank = setProfilerRank;
    window.selectRunningTreeNodeFromInstance = selectRunningTreeNodeFromInstance;

    // Layout & Panes
    window.hidePanel = hidePanel;
    window.restorePanel = restorePanel;
    window.updateHeaderCollapsedBar = updateHeaderCollapsedBar;
    window.updateResizersVisibility = updateResizersVisibility;
    window.toggleSectionCollapse = toggleSectionCollapse;
    window.findOperationByInstanceId = findOperationByInstanceId;
    window.applyWorkspace = applyWorkspace;
    window.initWorkspaces = initWorkspaces;
    window.renderPanelPucks = renderPanelPucks;
    window.updatePanelPucks = updatePanelPucks;
    window.togglePanelPuck = togglePanelPuck;
    window.SafeStorage = SafeStorage;
    window.checkLocalStorageAvailable = checkLocalStorageAvailable;
    window.isLocalStorageAvailable = isLocalStorageAvailable;
    window.CLUSTERS = CLUSTERS;
    window.PANEL_PUCKS = PANEL_PUCKS;

    // Document IO
    window.processFile = processFile;
    window.handleFileSelect = handleFileSelect;
    window.loadRcArrayBuffer = loadRcArrayBuffer;
    window.exportRcFile = exportRcFile;
    window.loadDocumentFromUrlParam = loadDocumentFromUrlParam;
    window.getAllOperationsFlat = getAllOperationsFlat;

    // Binary Treemap & Allocation
    window.renderBinaryTreemapPanel = renderBinaryTreemapPanel;
    window.setTreemapZoom = setTreemapZoom;
    window.setTreemapViewMode = setTreemapViewMode;
    window.onTreemapSearchInput = onTreemapSearchInput;
    window.clearTreemapSearch = clearTreemapSearch;
    window.onTreemapMinSizeChange = onTreemapMinSizeChange;
    window.resetTreemapFilters = resetTreemapFilters;
    window.onTreemapItemClick = onTreemapItemClick;
    window.highlightTreemapOp = highlightTreemapOp;

    // Utilities
    window.escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// =========================================================================
// Startup Initialization
// =========================================================================
window.addEventListener('DOMContentLoaded', () => {
    initDropZone();
    initPaneResizers();
    initKeyboardNavigation();
    initJsonEditor();
    initStageLiveResize();
    initWorkspaces();
    updateHeaderCollapsedBar();
    updateResizersVisibility();
    loadDocumentFromUrlParam();
});

window.addEventListener('hashchange', loadDocumentFromUrlParam);