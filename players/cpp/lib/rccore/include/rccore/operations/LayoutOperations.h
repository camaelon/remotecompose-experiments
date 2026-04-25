#pragma once
#include "rccore/Operation.h"
#include "rccore/WireBuffer.h"
#include <vector>
#include <cstring>

namespace rccore {

// ── ContainerEnd (214) ─────────────────────────────────────────────────
class ContainerEnd : public Operation {
public:
    std::string name() const override { return "CONTAINER_END"; }
    int opcode() const override { return 214; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        ops.push_back(std::make_unique<ContainerEnd>());
    }
};

// ── LayoutRoot (200) ───────────────────────────────────────────────────
class LayoutRoot : public Operation {
public:
    int componentId = 0;

    std::string name() const override { return "LAYOUT_ROOT"; }
    int opcode() const override { return 200; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    void apply(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<LayoutRoot>();
        op->componentId = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── LayoutComponentContent (201) ───────────────────────────────────────
class LayoutComponentContent : public Operation {
public:
    int componentId = 0;

    std::string name() const override { return "LayoutComponentContent"; }
    int opcode() const override { return 201; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    void apply(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<LayoutComponentContent>();
        op->componentId = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── LayoutBox (202) ────────────────────────────────────────────────────
class LayoutBox : public Operation {
public:
    int componentId = 0, animationId = 0;
    int horizontal = 0, vertical = 0;

    std::string name() const override { return "LAYOUT_BOX"; }
    int opcode() const override { return 202; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    void apply(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<LayoutBox>();
        op->componentId = buf.readInt();
        op->animationId = buf.readInt();
        op->horizontal = buf.readInt();
        op->vertical = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── LayoutRow (203) ────────────────────────────────────────────────────
class LayoutRow : public Operation {
public:
    int componentId = 0, animationId = 0;
    int horizontal = 0, vertical = 0;
    float spacedBy = 0;
    float oSpacedBy = 0;

    std::string name() const override { return "LAYOUT_ROW"; }
    int opcode() const override { return 203; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    void apply(RemoteContext& context) override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<LayoutRow>();
        op->componentId = buf.readInt();
        op->animationId = buf.readInt();
        op->horizontal = buf.readInt();
        op->vertical = buf.readInt();
        op->spacedBy = buf.readFloat();
        op->oSpacedBy = op->spacedBy;
        ops.push_back(std::move(op));
    }
};

// ── LayoutColumn (204) ─────────────────────────────────────────────────
class LayoutColumn : public Operation {
public:
    int componentId = 0, animationId = 0;
    int horizontal = 0, vertical = 0;
    float spacedBy = 0;
    float oSpacedBy = 0;

    std::string name() const override { return "LAYOUT_COLUMN"; }
    int opcode() const override { return 204; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    void apply(RemoteContext& context) override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<LayoutColumn>();
        op->componentId = buf.readInt();
        op->animationId = buf.readInt();
        op->horizontal = buf.readInt();
        op->vertical = buf.readInt();
        op->spacedBy = buf.readFloat();
        op->oSpacedBy = op->spacedBy;
        ops.push_back(std::move(op));
    }
};

// ── LayoutCanvas (205) ─────────────────────────────────────────────────
class LayoutCanvas : public Operation {
public:
    int componentId = 0, animationId = 0;

    std::string name() const override { return "LAYOUT_CANVAS"; }
    int opcode() const override { return 205; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    void apply(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<LayoutCanvas>();
        op->componentId = buf.readInt();
        op->animationId = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── CanvasContent (207) ────────────────────────────────────────────────
class CanvasContent : public Operation {
public:
    int componentId = 0;

    std::string name() const override { return "CanvasContent"; }
    int opcode() const override { return 207; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    void apply(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<CanvasContent>();
        op->componentId = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── LayoutText (208) ───────────────────────────────────────────────────
class LayoutText : public Operation {
public:
    int componentId = 0, animationId = 0;
    int textId = 0, color = 0;
    float fontSize = 14;
    int fontStyle = 0;
    float fontWeight = 400;
    int fontFamilyId = 0, textAlign = 0, overflow = 0, maxLines = 0;
    float oFontSize = 14, oFontWeight = 400;

    std::string name() const override { return "LAYOUT_TEXT"; }
    int opcode() const override { return 208; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    void apply(RemoteContext& context) override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<LayoutText>();
        op->componentId = buf.readInt();
        op->animationId = buf.readInt();
        op->textId = buf.readInt();
        op->color = buf.readInt();
        op->fontSize = buf.readFloat();
        op->fontStyle = buf.readInt();
        op->fontWeight = buf.readFloat();
        op->fontFamilyId = buf.readInt();
        op->textAlign = buf.readInt();
        op->overflow = buf.readInt();
        op->maxLines = buf.readInt();
        op->oFontSize = op->fontSize;
        op->oFontWeight = op->fontWeight;
        ops.push_back(std::move(op));
    }
};

// ── CoreText (239) ─────────────────────────────────────────────────────
class CoreTextOp : public Operation {
public:
    int textId = 0;
    // Parameters extracted from the parameter map (Java P_ constants are 1-based)
    int componentId = -1, animationId = -1;
    int color = static_cast<int>(0xFF000000);  // default black
    int colorId = -1;
    float fontSize = 16;
    int fontStyle = 0;
    float fontWeight = 400;
    int fontFamilyId = -1, textAlign = 1, overflow = 1, maxLines = 0x7FFFFFFF;
    int flags = 0;

    float oFontSize = 16, oFontWeight = 400;

    std::string name() const override { return "CoreText"; }
    int opcode() const override { return 239; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    void apply(RemoteContext& context) override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<CoreTextOp>();
        op->textId = buf.readInt();
        int paramsLength = buf.readShort();
        for (int i = 0; i < paramsLength; i++) {
            int id = buf.readByte();
            switch (id) {
                // Boolean params
                case 18: case 19: case 22:
                    buf.readBoolean();
                    break;
                // Int array (fontAxis)
                case 20: {
                    int count = buf.readShort();
                    for (int j = 0; j < count; j++) buf.readInt();
                    break;
                }
                // Float array (fontAxisValues)
                case 21: {
                    int count = buf.readShort();
                    for (int j = 0; j < count; j++) buf.readFloat();
                    break;
                }
                default: {
                    // All other params are 4 bytes (INT or FLOAT)
                    int val = buf.readInt();
                    switch (id) {
                        // INT params
                        case 1: op->componentId = val; break;
                        case 2: op->animationId = val; break;
                        case 3: op->color = val; break;
                        case 4: op->colorId = val; break;
                        case 6: op->fontStyle = val; break;
                        case 8: op->fontFamilyId = val; break;
                        case 9: op->textAlign = val; break;
                        case 10: op->overflow = val; break;
                        case 11: op->maxLines = val; break;
                        case 15: case 16: case 17: break; // break/hyphen/justify - skip
                        case 23: op->flags = val; break;
                        case 24: break; // textStyleId - skip
                        // FLOAT params (stored as int bits, decode via memcpy)
                        case 5: { float f; memcpy(&f, &val, sizeof(f)); op->fontSize = f; break; }
                        case 7: { float f; memcpy(&f, &val, sizeof(f)); op->fontWeight = f; break; }
                        case 12: case 13: case 14: break; // letterSpacing/lineHeight - skip
                        case 25: case 26: break; // min/maxFontSize - skip
                        default: break;
                    }
                    break;
                }
            }
        }
        ops.push_back(std::move(op));
    }
};

// ── LayoutFlow (240) ───────────────────────────────────────────────────
class LayoutFlow : public Operation {
public:
    int componentId = 0, animationId = 0;
    int horizontal = 0, vertical = 0;
    float spacedBy = 0;
    float oSpacedBy = 0;

    std::string name() const override { return "LAYOUT_FLOW"; }
    int opcode() const override { return 240; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    void apply(RemoteContext& context) override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<LayoutFlow>();
        op->componentId = buf.readInt();
        op->animationId = buf.readInt();
        op->horizontal = buf.readInt();
        op->vertical = buf.readInt();
        op->spacedBy = buf.readFloat();
        op->oSpacedBy = op->spacedBy;
        ops.push_back(std::move(op));
    }
};

// ── LayoutCompute (238) ────────────────────────────────────────────────
class LayoutCompute : public Operation {
public:
    int type = 0, boundsId = 0;
    bool animateChanges = false;

    std::string name() const override { return "LAYOUT_COMPUTE"; }
    int opcode() const override { return 238; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    void apply(RemoteContext& context) override {}

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<LayoutCompute>();
        op->type = buf.readInt();
        op->boundsId = buf.readInt();
        op->animateChanges = buf.readBoolean();
        ops.push_back(std::move(op));
    }
};

// ── StateLayout (217) ──────────────────────────────────────────────────
class StateLayout : public Operation {
public:
    int componentId = 0, animationId = 0;
    int horizontalPositioning = 0, verticalPositioning = 0;
    int indexId = 0;

    std::string name() const override { return "StateLayout"; }
    int opcode() const override { return 217; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    void apply(RemoteContext& context) override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<StateLayout>();
        op->componentId = buf.readInt();
        op->animationId = buf.readInt();
        op->horizontalPositioning = buf.readInt();
        op->verticalPositioning = buf.readInt();
        op->indexId = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── LoopOperation (215) ────────────────────────────────────────────────
class LoopOperationOp : public Operation {
public:
    int indexId = 0;
    float from = 0, step = 0, until = 0;

    std::string name() const override { return "LoopOperation"; }
    int opcode() const override { return 215; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    void apply(RemoteContext& context) override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<LoopOperationOp>();
        op->indexId = buf.readInt();
        op->from = buf.readFloat();
        op->step = buf.readFloat();
        op->until = buf.readFloat();
        ops.push_back(std::move(op));
    }
};

// ── ConditionalOperations (178) ────────────────────────────────────────
class ConditionalOp : public Operation {
public:
    int type = 0;  // comparison type: 0=EQ, 1=NEQ, 2=LT, 3=LTE, 4=GT, 5=GTE
    float a = 0, b = 0;  // comparison operands (may be NaN-encoded var refs)

    std::string name() const override { return "ConditionalOperations"; }
    int opcode() const override { return 178; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    void apply(RemoteContext& context) override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ConditionalOp>();
        op->type = buf.readByte();
        op->a = buf.readFloat();
        op->b = buf.readFloat();
        ops.push_back(std::move(op));
    }
};

// ── Modifier Operations ────────────────────────────────────────────────
class ModifierWidth : public Operation {
public:
    int type = 0; float width = 0;
    float oWidth = 0;
    std::string name() const override { return "MODIFIER_WIDTH"; }
    int opcode() const override { return 16; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ModifierWidth>();
        op->type = buf.readInt(); op->width = buf.readFloat();
        op->oWidth = op->width;
        ops.push_back(std::move(op));
    }
};

class ModifierHeight : public Operation {
public:
    int type = 0; float height = 0;
    float oHeight = 0;
    std::string name() const override { return "MODIFIER_HEIGHT"; }
    int opcode() const override { return 67; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ModifierHeight>();
        op->type = buf.readInt(); op->height = buf.readFloat();
        op->oHeight = op->height;
        ops.push_back(std::move(op));
    }
};

class ModifierBackground : public Operation {
public:
    int flags = 0, colorId = 0, reserve1 = 0, reserve2 = 0;
    float r = 0, g = 0, b = 0, a = 0;
    float oR = 0, oG = 0, oB = 0, oA = 0;
    int shapeType = 0;
    std::string name() const override { return "MODIFIER_BACKGROUND"; }
    int opcode() const override { return 55; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ModifierBackground>();
        op->flags = buf.readInt(); op->colorId = buf.readInt();
        op->reserve1 = buf.readInt(); op->reserve2 = buf.readInt();
        op->r = buf.readFloat(); op->g = buf.readFloat();
        op->b = buf.readFloat(); op->a = buf.readFloat();
        op->oR = op->r; op->oG = op->g; op->oB = op->b; op->oA = op->a;
        op->shapeType = buf.readInt();
        ops.push_back(std::move(op));
    }
};

class ModifierBorder : public Operation {
public:
    int flags = 0, colorId = 0, reserve1 = 0, reserve2 = 0;
    float borderWidth = 0, roundedCorner = 0;
    float r = 0, g = 0, b = 0, a = 0;
    float oBorderWidth = 0, oRoundedCorner = 0;
    float oR = 0, oG = 0, oB = 0, oA = 0;
    int shapeType = 0;
    std::string name() const override { return "MODIFIER_BORDER"; }
    int opcode() const override { return 107; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ModifierBorder>();
        op->flags = buf.readInt(); op->colorId = buf.readInt();
        op->reserve1 = buf.readInt(); op->reserve2 = buf.readInt();
        op->borderWidth = buf.readFloat(); op->roundedCorner = buf.readFloat();
        op->r = buf.readFloat(); op->g = buf.readFloat();
        op->b = buf.readFloat(); op->a = buf.readFloat();
        op->oBorderWidth = op->borderWidth; op->oRoundedCorner = op->roundedCorner;
        op->oR = op->r; op->oG = op->g; op->oB = op->b; op->oA = op->a;
        op->shapeType = buf.readInt();
        ops.push_back(std::move(op));
    }
};

class ModifierPadding : public Operation {
public:
    float left = 0, top = 0, right = 0, bottom = 0;
    float oLeft = 0, oTop = 0, oRight = 0, oBottom = 0;
    std::string name() const override { return "MODIFIER_PADDING"; }
    int opcode() const override { return 58; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ModifierPadding>();
        op->left = buf.readFloat(); op->top = buf.readFloat();
        op->right = buf.readFloat(); op->bottom = buf.readFloat();
        op->oLeft = op->left; op->oTop = op->top;
        op->oRight = op->right; op->oBottom = op->bottom;
        ops.push_back(std::move(op));
    }
};

class ModifierClick : public Operation {
public:
    std::string name() const override { return "MODIFIER_CLICK"; }
    int opcode() const override { return 59; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        ops.push_back(std::make_unique<ModifierClick>());
    }
};

class ModifierClipRect : public Operation {
public:
    std::string name() const override { return "ClipRectModifierOperation"; }
    int opcode() const override { return 108; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        ops.push_back(std::make_unique<ModifierClipRect>());
    }
};

class ModifierRoundedClipRect : public Operation {
public:
    float topStart = 0, topEnd = 0, bottomStart = 0, bottomEnd = 0;
    float oTopStart = 0, oTopEnd = 0, oBottomStart = 0, oBottomEnd = 0;
    std::string name() const override { return "RoundedClipRectModifierOperation"; }
    int opcode() const override { return 54; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ModifierRoundedClipRect>();
        op->topStart = buf.readFloat(); op->topEnd = buf.readFloat();
        op->bottomStart = buf.readFloat(); op->bottomEnd = buf.readFloat();
        op->oTopStart = op->topStart; op->oTopEnd = op->topEnd;
        op->oBottomStart = op->bottomStart; op->oBottomEnd = op->bottomEnd;
        ops.push_back(std::move(op));
    }
};

class ModifierVisibility : public Operation {
public:
    int visibilityId = 0;
    std::string name() const override { return "MODIFIER_VISIBILITY"; }
    int opcode() const override { return 211; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ModifierVisibility>();
        op->visibilityId = buf.readInt();
        ops.push_back(std::move(op));
    }
};

class ModifierAlignBy : public Operation {
public:
    float line = 0; int flags = 0;
    std::string name() const override { return "MODIFIER_ALIGN_BY"; }
    int opcode() const override { return 237; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ModifierAlignBy>();
        op->line = buf.readFloat(); op->flags = buf.readInt();
        ops.push_back(std::move(op));
    }
};

class ModifierWidthIn : public Operation {
public:
    float min = 0, max = 0;
    float oMin = 0, oMax = 0;
    std::string name() const override { return "MODIFIER_WIDTH_IN"; }
    int opcode() const override { return 231; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ModifierWidthIn>();
        op->min = buf.readFloat(); op->max = buf.readFloat();
        op->oMin = op->min; op->oMax = op->max;
        ops.push_back(std::move(op));
    }
};

class ModifierHeightIn : public Operation {
public:
    float min = 0, max = 0;
    float oMin = 0, oMax = 0;
    std::string name() const override { return "MODIFIER_HEIGHT_IN"; }
    int opcode() const override { return 232; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ModifierHeightIn>();
        op->min = buf.readFloat(); op->max = buf.readFloat();
        op->oMin = op->min; op->oMax = op->max;
        ops.push_back(std::move(op));
    }
};

class ModifierOffset : public Operation {
public:
    float x = 0, y = 0;
    float oX = 0, oY = 0;
    std::string name() const override { return "MODIFIER_OFFSET"; }
    int opcode() const override { return 221; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ModifierOffset>();
        op->x = buf.readFloat(); op->y = buf.readFloat();
        op->oX = op->x; op->oY = op->y;
        ops.push_back(std::move(op));
    }
};

class ModifierZIndex : public Operation {
public:
    float zIndex = 0;
    std::string name() const override { return "MODIFIER_ZINDEX"; }
    int opcode() const override { return 223; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ModifierZIndex>();
        op->zIndex = buf.readFloat();
        ops.push_back(std::move(op));
    }
};

class ModifierTouchDown : public Operation {
public:
    std::string name() const override { return "MODIFIER_TOUCH_DOWN"; }
    int opcode() const override { return 219; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        ops.push_back(std::make_unique<ModifierTouchDown>());
    }
};

class ModifierTouchUp : public Operation {
public:
    std::string name() const override { return "MODIFIER_TOUCH_UP"; }
    int opcode() const override { return 220; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        ops.push_back(std::make_unique<ModifierTouchUp>());
    }
};

class ModifierTouchCancel : public Operation {
public:
    std::string name() const override { return "MODIFIER_TOUCH_CANCEL"; }
    int opcode() const override { return 225; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        ops.push_back(std::make_unique<ModifierTouchCancel>());
    }
};

class ModifierScroll : public Operation {
public:
    int direction = 0;
    float position = 0, max = 0, notchMax = 0;
    float oPosition = 0, oMax = 0, oNotchMax = 0;
    std::string name() const override { return "ScrollModifierOperation"; }
    int opcode() const override { return 226; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    void apply(RemoteContext& context) override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ModifierScroll>();
        op->direction = buf.readInt();
        op->position = buf.readFloat();
        op->max = buf.readFloat();
        op->notchMax = buf.readFloat();
        op->oPosition = op->position; op->oMax = op->max; op->oNotchMax = op->notchMax;
        ops.push_back(std::move(op));
    }
};

class ModifierRipple : public Operation {
public:
    std::string name() const override { return "MODIFIER_RIPPLE"; }
    int opcode() const override { return 229; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        ops.push_back(std::make_unique<ModifierRipple>());
    }
};

class AnimationSpec : public Operation {
public:
    int animationId = 0;
    float motionDuration = 0;
    int motionEasingType = 0;
    float visibilityDuration = 0;
    int visibilityEasingType = 0;
    int enterAnimation = 0, exitAnimation = 0;

    std::string name() const override { return "ANIMATION_SPEC"; }
    int opcode() const override { return 14; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<AnimationSpec>();
        op->animationId = buf.readInt();
        op->motionDuration = buf.readFloat();
        op->motionEasingType = buf.readInt();
        op->visibilityDuration = buf.readFloat();
        op->visibilityEasingType = buf.readInt();
        op->enterAnimation = buf.readInt();
        op->exitAnimation = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── Skip (opcode 241) ─────────────────────────────────────────────────
// Conditional code-section skip. Reads three ints from the wire and, if
// the condition matches the player's SystemInfo, advances the buffer
// index past the next `skipLength` bytes — effectively excising the
// upcoming operations from the parsed stream. Skip itself is NOT pushed
// onto the operations list (it has no runtime presence).
class Skip {
public:
    static constexpr int OP_CODE = 241;
    static constexpr int SKIP_IF_API_LESS_THAN = 1;
    static constexpr int SKIP_IF_API_GREATER_THAN = 2;
    static constexpr int SKIP_IF_API_EQUAL_TO = 3;
    static constexpr int SKIP_IF_API_NOT_EQUAL_TO = 4;
    static constexpr int SKIP_IF_PROFILE_INCLUDES = 5;
    static constexpr int SKIP_IF_PROFILE_EXCLUDES = 6;

    // The default API level the C++ player advertises. Override at link
    // time by redefining sLibraryApiLevel / sProfile in your app, or set
    // them at runtime via setSystemInfo().
    static int sLibraryApiLevel;
    static int sProfile;
    static void setSystemInfo(int libraryApiLevel, int profile) {
        sLibraryApiLevel = libraryApiLevel;
        sProfile = profile;
    }

    static bool needsToSkip(int conditionType, int value) {
        switch (conditionType) {
            case SKIP_IF_API_LESS_THAN:    return sLibraryApiLevel < value;
            case SKIP_IF_API_GREATER_THAN: return sLibraryApiLevel > value;
            case SKIP_IF_API_EQUAL_TO:     return sLibraryApiLevel == value;
            case SKIP_IF_API_NOT_EQUAL_TO: return sLibraryApiLevel != value;
            case SKIP_IF_PROFILE_INCLUDES: return (sProfile & value) != 0;
            case SKIP_IF_PROFILE_EXCLUDES: return (sProfile & value) == 0;
            default: return false;
        }
    }

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& /*ops*/) {
        int conditionType = buf.readInt();
        int value = buf.readInt();
        int skipLength = buf.readInt();
        if (needsToSkip(conditionType, value)) {
            buf.setIndex(buf.getIndex() + skipLength);
        }
        // Intentionally does NOT push anything onto ops.
    }
};

// ── ModifierMultiClick (opcode 83) ────────────────────────────────────
// Like ModifierClick but with a clickType discriminant: 0=single,
// 1=long press, 2=double click. Container — children follow.
class ModifierMultiClick : public Operation {
public:
    static constexpr int CLICK_TYPE_SINGLE = 0;
    static constexpr int CLICK_TYPE_LONG = 1;
    static constexpr int CLICK_TYPE_DOUBLE = 2;

    int clickType = 0;

    std::string name() const override { return "MODIFIER_MULTI_CLICK"; }
    int opcode() const override { return 83; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ModifierMultiClick>();
        op->clickType = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── ModifierDimensionConstraints (opcode 243) ─────────────────────────
// Generic min/max dimension constraint with horizontal/vertical and
// soft/required variants. Wire format: BYTE type, FLOAT min, FLOAT max.
class ModifierDimensionConstraints : public Operation {
public:
    static constexpr int HORIZONTAL = 0;
    static constexpr int VERTICAL = 1;
    static constexpr int REQUIRED_HORIZONTAL = 2;
    static constexpr int REQUIRED_VERTICAL = 3;

    int constraintType = 0;
    float minVal = 0;
    float maxVal = 0;

    std::string name() const override { return "MODIFIER_DIMENSION_CONSTRAINTS"; }
    int opcode() const override { return 243; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ModifierDimensionConstraints>();
        op->constraintType = buf.readByte();
        op->minVal = buf.readFloat();
        op->maxVal = buf.readFloat();
        ops.push_back(std::move(op));
    }
};

// ── TextStyle (opcode 242) ────────────────────────────────────────────
// Sparse, inheritable text styling resource consumed by CoreText. Wire
// format: SHORT count, then `count` (BYTE tag, value) pairs where the
// value type depends on the tag. We parse all known tags and stash the
// values; the player can wire them into CoreText rendering later.
class TextStyleOp : public Operation {
public:
    // Parameter tag constants — must match TextStyle.java
    static constexpr int P_ID = 1;
    static constexpr int P_ANIMATION_ID = 2;
    static constexpr int P_COLOR = 3;
    static constexpr int P_COLOR_ID = 4;
    static constexpr int P_FONT_SIZE = 5;
    static constexpr int P_FONT_STYLE = 6;
    static constexpr int P_FONT_WEIGHT = 7;
    static constexpr int P_FONT_FAMILY = 8;
    static constexpr int P_TEXT_ALIGN = 9;
    static constexpr int P_OVERFLOW = 10;
    static constexpr int P_MAX_LINES = 11;
    static constexpr int P_LETTER_SPACING = 12;
    static constexpr int P_LINE_HEIGHT_ADD = 13;
    static constexpr int P_LINE_HEIGHT_MULTIPLIER = 14;
    static constexpr int P_BREAK_STRATEGY = 15;
    static constexpr int P_HYPHENATION_FREQUENCY = 16;
    static constexpr int P_JUSTIFICATION_MODE = 17;
    static constexpr int P_UNDERLINE = 18;
    static constexpr int P_STRIKETHROUGH = 19;
    static constexpr int P_FONT_AXIS = 20;
    static constexpr int P_FONT_AXIS_VALUES = 21;
    static constexpr int P_AUTOSIZE = 22;
    static constexpr int P_FLAGS = 23;
    static constexpr int P_PARENT_ID = 24;
    static constexpr int P_MIN_FONT_SIZE = 25;
    static constexpr int P_MAX_FONT_SIZE = 26;

    int id = -1;
    int parentId = -1;
    bool hasColor = false;       int color = 0;
    bool hasColorId = false;     int colorId = -1;
    bool hasFontSize = false;    float fontSize = 0;
    bool hasMinFontSize = false; float minFontSize = 0;
    bool hasMaxFontSize = false; float maxFontSize = 0;
    bool hasFontStyle = false;   int fontStyle = 0;
    bool hasFontWeight = false;  float fontWeight = 0;
    bool hasFontFamily = false;  int fontFamilyId = -1;
    bool hasTextAlign = false;   int textAlign = 0;
    bool hasOverflow = false;    int overflow = 0;
    bool hasMaxLines = false;    int maxLines = 0;
    bool hasLetterSpacing = false;        float letterSpacing = 0;
    bool hasLineHeightAdd = false;        float lineHeightAdd = 0;
    bool hasLineHeightMultiplier = false; float lineHeightMultiplier = 0;
    bool hasLineBreakStrategy = false;    int lineBreakStrategy = 0;
    bool hasHyphenationFrequency = false; int hyphenationFrequency = 0;
    bool hasJustificationMode = false;    int justificationMode = 0;
    bool hasUnderline = false;     bool underline = false;
    bool hasStrikethrough = false; bool strikethrough = false;
    bool hasAutosize = false;      bool autosize = false;
    std::vector<int> fontAxis;
    std::vector<float> fontAxisValues;

    std::string name() const override { return "TEXT_STYLE"; }
    int opcode() const override { return 242; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<TextStyleOp>();
        int count = buf.readShort();
        for (int i = 0; i < count; i++) {
            int tag = buf.readByte();
            switch (tag) {
                case P_ID:                    op->id = buf.readInt(); break;
                case P_ANIMATION_ID:          buf.readInt(); break;
                case P_COLOR:                 op->color = buf.readInt(); op->hasColor = true; break;
                case P_COLOR_ID:              op->colorId = buf.readInt(); op->hasColorId = true; break;
                case P_FONT_SIZE:             op->fontSize = buf.readFloat(); op->hasFontSize = true; break;
                case P_FONT_STYLE:            op->fontStyle = buf.readInt(); op->hasFontStyle = true; break;
                case P_FONT_WEIGHT:           op->fontWeight = buf.readFloat(); op->hasFontWeight = true; break;
                case P_FONT_FAMILY:           op->fontFamilyId = buf.readInt(); op->hasFontFamily = true; break;
                case P_TEXT_ALIGN:            op->textAlign = buf.readInt(); op->hasTextAlign = true; break;
                case P_OVERFLOW:              op->overflow = buf.readInt(); op->hasOverflow = true; break;
                case P_MAX_LINES:             op->maxLines = buf.readInt(); op->hasMaxLines = true; break;
                case P_LETTER_SPACING:        op->letterSpacing = buf.readFloat(); op->hasLetterSpacing = true; break;
                case P_LINE_HEIGHT_ADD:       op->lineHeightAdd = buf.readFloat(); op->hasLineHeightAdd = true; break;
                case P_LINE_HEIGHT_MULTIPLIER: op->lineHeightMultiplier = buf.readFloat(); op->hasLineHeightMultiplier = true; break;
                case P_BREAK_STRATEGY:        op->lineBreakStrategy = buf.readInt(); op->hasLineBreakStrategy = true; break;
                case P_HYPHENATION_FREQUENCY: op->hyphenationFrequency = buf.readInt(); op->hasHyphenationFrequency = true; break;
                case P_JUSTIFICATION_MODE:    op->justificationMode = buf.readInt(); op->hasJustificationMode = true; break;
                case P_UNDERLINE:             op->underline = buf.readBoolean(); op->hasUnderline = true; break;
                case P_STRIKETHROUGH:         op->strikethrough = buf.readBoolean(); op->hasStrikethrough = true; break;
                case P_FONT_AXIS: {
                    int len = buf.readShort();
                    op->fontAxis.resize(len);
                    for (int k = 0; k < len; k++) op->fontAxis[k] = buf.readInt();
                    break;
                }
                case P_FONT_AXIS_VALUES: {
                    int len = buf.readShort();
                    op->fontAxisValues.resize(len);
                    for (int k = 0; k < len; k++) op->fontAxisValues[k] = buf.readFloat();
                    break;
                }
                case P_AUTOSIZE:              op->autosize = buf.readBoolean(); op->hasAutosize = true; break;
                case P_FLAGS:                 buf.readInt(); break;
                case P_PARENT_ID:             op->parentId = buf.readInt(); break;
                case P_MIN_FONT_SIZE:         op->minFontSize = buf.readFloat(); op->hasMinFontSize = true; break;
                case P_MAX_FONT_SIZE:         op->maxFontSize = buf.readFloat(); op->hasMaxFontSize = true; break;
                default:
                    // Unknown tag — wire stream is unrecoverable from here.
                    // Push what we have and stop.
                    ops.push_back(std::move(op));
                    return;
            }
        }
        ops.push_back(std::move(op));
    }
};

} // namespace rccore
