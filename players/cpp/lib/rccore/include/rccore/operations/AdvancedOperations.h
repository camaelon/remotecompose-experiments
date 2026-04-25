#pragma once
#include "rccore/Operation.h"
#include "rccore/RemoteContext.h"
#include "rccore/WireBuffer.h"
#include "rccore/ExpressionEvaluator.h"
#include "rccore/IntegerExpressionEvaluator.h"
#include "rccore/Utils.h"
#include "rccore/easing/FloatAnimation.h"
#include "rccore/easing/SpringStopEngine.h"
#include "rccore/easing/VelocityEasing.h"
#include <vector>
#include <string>
#include <memory>
#include <cmath>

namespace rccore {

// ── FloatExpression / ANIMATED_FLOAT (81) ─────────────────────────────
// Matches Java: FloatExpression.java
// Supports three modes:
//   1. Static expression (no animation array)
//   2. FloatAnimation (easing curve interpolation)
//   3. SpringStopEngine (damped spring physics)
class FloatExpression : public Operation {
public:
    int id = 0;
    std::vector<float> expression;       // RPN expression array (mSrcValue)
    std::vector<float> animationSpec;    // Animation spec array (mSrcAnimation)

    // Pre-resolved expression values (mPreCalcValue)
    std::vector<float> preCalcValues;

    // Animation objects (one or neither will be set)
    std::unique_ptr<FloatAnimation> mFloatAnimation;
    std::unique_ptr<SpringStopEngine> mSpring;

    // State tracking
    float mLastChange = NAN;            // Animation time when expression output last changed
    float mLastCalculatedValue = NAN;   // Last expression evaluation result (target value)
    float mLastAnimatedValue = NAN;     // Last value loaded into context (for change detection)

    std::string name() const override { return "ANIMATED_FLOAT"; }
    int opcode() const override { return 81; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<FloatExpression>();
        op->id = buf.readInt();
        int packed = buf.readInt();
        int exprLen = packed & 0xFFFF;
        int animLen = (packed >> 16) & 0xFFFF;
        op->expression.resize(exprLen);
        for (int i = 0; i < exprLen; i++) op->expression[i] = buf.readFloat();
        op->animationSpec.resize(animLen);
        for (int i = 0; i < animLen; i++) op->animationSpec[i] = buf.readFloat();

        // Initialize animation objects based on animation spec
        if (animLen > 0) {
            if (animLen > 4 && op->animationSpec[0] == 0.0f) {
                op->mSpring = std::make_unique<SpringStopEngine>(op->animationSpec.data());
            } else {
                op->mFloatAnimation = std::make_unique<FloatAnimation>(
                    op->animationSpec.data(), animLen);
            }
        }

        ops.push_back(std::move(op));
    }
};

// ── ColorExpression (134) ──────────────────────────────────────────────
// Modes: 0=COLOR_COLOR_INTERP, 1=ID_COLOR_INTERP, 2=COLOR_ID_INTERP,
//        3=ID_ID_INTERP, 4=HSV, 5=ARGB, 6=IDARGB
class ColorExpressionOp : public Operation {
public:
    int id = 0;
    int p1 = 0, p2 = 0, p3 = 0, p4 = 0; // raw wire values (for JSON)

    // Decoded fields
    int mode = 0;
    // Interpolation modes (0-3)
    int color1 = 0, color2 = 0;
    float tween = 0.0f;
    // HSV mode (4)
    int alpha = 0xFF;
    float hue = 0, sat = 0, val = 0;
    // ARGB mode (5/6)
    float argbAlpha = 0, argbRed = 0, argbGreen = 0, argbBlue = 0;

    // Resolved output values
    float oTween = 0.0f;
    int oColor1 = 0, oColor2 = 0;
    float oHue = 0, oSat = 0, oVal = 0;
    float oArgbAlpha = 0, oArgbRed = 0, oArgbGreen = 0, oArgbBlue = 0;

    std::string name() const override { return "COLOR_EXPRESSIONS"; }
    int opcode() const override { return 134; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ColorExpressionOp>();
        op->id = buf.readInt();
        op->p1 = buf.readInt(); op->p2 = buf.readInt();
        op->p3 = buf.readInt(); op->p4 = buf.readInt();

        op->mode = op->p1 & 0xFF;
        switch (op->mode) {
            case 6: // IDARGB - alpha is NaN-encoded ID
                op->argbAlpha = Utils::asNan(op->p1 >> 16);
                op->argbRed = Utils::intBitsToFloat(op->p2);
                op->argbGreen = Utils::intBitsToFloat(op->p3);
                op->argbBlue = Utils::intBitsToFloat(op->p4);
                op->mode = 5; // normalize to ARGB
                break;
            case 5: // ARGB
                op->argbAlpha = (op->p1 >> 16) / 1024.0f;
                op->argbRed = Utils::intBitsToFloat(op->p2);
                op->argbGreen = Utils::intBitsToFloat(op->p3);
                op->argbBlue = Utils::intBitsToFloat(op->p4);
                break;
            case 4: // HSV
                op->alpha = (op->p1 >> 16) & 0xFF;
                op->hue = Utils::intBitsToFloat(op->p2);
                op->sat = Utils::intBitsToFloat(op->p3);
                op->val = Utils::intBitsToFloat(op->p4);
                break;
            default: // 0-3: interpolation modes
                op->color1 = op->p2;
                op->color2 = op->p3;
                op->tween = Utils::intBitsToFloat(op->p4);
                break;
        }
        ops.push_back(std::move(op));
    }
};

// ── IntegerExpression (144) ────────────────────────────────────────────
class IntegerExpressionOp : public Operation {
public:
    int id = 0, mask = 0;
    std::vector<int> srcValues;      // Original wire data (values, IDs, operators)
    std::vector<int> preCalcValues;   // Resolved values for evaluation
    IntegerExpressionEvaluator mExp;

    std::string name() const override { return "IntegerExpression"; }
    int opcode() const override { return 144; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<IntegerExpressionOp>();
        op->id = buf.readInt();
        op->mask = buf.readInt();
        int len = buf.readInt();
        op->srcValues.resize(len);
        for (int i = 0; i < len; i++) op->srcValues[i] = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── TextFromFloat (135) ────────────────────────────────────────────────
class TextFromFloat : public Operation {
public:
    int textId = 0;
    float floatId = 0;  // NaN-encoded variable reference
    float oValue = 0;   // resolved output value
    int digitsBefore = 0, digitsAfter = 0;
    int flags = 0;

    std::string name() const override { return "TextFromFloat"; }
    int opcode() const override { return 135; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<TextFromFloat>();
        op->textId = buf.readInt();
        op->floatId = buf.readFloat();
        int tmp = buf.readInt();
        op->digitsAfter = tmp & 0xFFFF;
        op->digitsBefore = (tmp >> 16) & 0xFFFF;
        op->flags = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── TextMerge (136) ────────────────────────────────────────────────────
class TextMerge : public Operation {
public:
    int destId = 0;
    int srcId1 = 0, srcId2 = 0;

    std::string name() const override { return "TextMerge"; }
    int opcode() const override { return 136; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<TextMerge>();
        op->destId = buf.readInt();
        op->srcId1 = buf.readInt();
        op->srcId2 = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── TextLookup (151) ──────────────────────────────────────────────────
class TextLookupOp : public Operation {
public:
    int id = 0, dataSet = 0;
    float index = 0;

    std::string name() const override { return "TEXT_LOOKUP"; }
    int opcode() const override { return 151; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<TextLookupOp>();
        op->id = buf.readInt();
        op->dataSet = buf.readInt();
        op->index = buf.readFloat();
        ops.push_back(std::move(op));
    }
};

// ── TextTransform (199) ────────────────────────────────────────────────
class TextTransformOp : public Operation {
public:
    int destId = 0, srcId = 0;
    float start = 0, len = 0;
    int operation = 0;

    std::string name() const override { return "TextTransform"; }
    int opcode() const override { return 199; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<TextTransformOp>();
        op->destId = buf.readInt();
        op->srcId = buf.readInt();
        op->start = buf.readFloat();
        op->len = buf.readFloat();
        op->operation = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── ComponentValue (150) ───────────────────────────────────────────────
class ComponentValueOp : public Operation {
public:
    int type = 0, componentId = 0, valueId = 0;

    std::string name() const override { return "COMPONENT_VALUE"; }
    int opcode() const override { return 150; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ComponentValueOp>();
        op->type = buf.readInt();
        op->componentId = buf.readInt();
        op->valueId = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── DataListFloat (147) ────────────────────────────────────────────────
class DataListFloat : public Operation {
public:
    int id = 0;
    std::vector<float> data;

    std::string name() const override { return "DataListFloat"; }
    int opcode() const override { return 147; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<DataListFloat>();
        op->id = buf.readInt();
        int len = buf.readInt();
        op->data.resize(len);
        for (int i = 0; i < len; i++) op->data[i] = buf.readFloat();
        ops.push_back(std::move(op));
    }
};

// ── DataListIds (146) ──────────────────────────────────────────────────
class DataListIds : public Operation {
public:
    int id = 0;
    std::vector<int> ids;

    std::string name() const override { return "DataListIds"; }
    int opcode() const override { return 146; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<DataListIds>();
        op->id = buf.readInt();
        int len = buf.readInt();
        op->ids.resize(len);
        for (int i = 0; i < len; i++) op->ids[i] = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── TouchExpression (157) ──────────────────────────────────────────────
// Full touch state machine port from Java TouchExpression.java.
// Stop mode constants:
//   0=STOP_GENTLY, 1=STOP_INSTANTLY, 2=STOP_ENDS, 3=STOP_NOTCHES_EVEN,
//   4=STOP_NOTCHES_PERCENTS, 5=STOP_NOTCHES_ABSOLUTE, 6=STOP_ABSOLUTE_POS,
//   7=STOP_NOTCHES_SINGLE_EVEN
class TouchExpressionOp : public Operation {
public:
    static constexpr int STOP_GENTLY = 0;
    static constexpr int STOP_INSTANTLY = 1;
    static constexpr int STOP_ENDS = 2;
    static constexpr int STOP_NOTCHES_EVEN = 3;
    static constexpr int STOP_NOTCHES_PERCENTS = 4;
    static constexpr int STOP_NOTCHES_ABSOLUTE = 5;
    static constexpr int STOP_ABSOLUTE_POS = 6;
    static constexpr int STOP_NOTCHES_SINGLE_EVEN = 7;

    // Wire format fields
    int id = 0;
    float startValue = 0;        // mDefValue (default / initial value)
    float min = 0, max = 0;      // raw wire min/max (may be NaN refs)
    float velocityId = 0;
    int touchEffects = 0;
    std::vector<float> expression;   // mSrcExp — RPN expression
    std::vector<float> stopsData;    // mStopSpec — raw wire stop spec
    int stopMode = 0;
    std::vector<float> easingData;

    // Resolved output values
    float mOutDefValue = 0;
    float mOutMin = 0, mOutMax = 1;
    std::vector<float> mOutStopSpec;

    // Pre-resolved expression values
    std::vector<float> preCalcValues;

    // Touch state machine
    bool mTouchDown = false;
    bool mUnmodified = true;
    bool mEasingToStop = false;
    float mCurrentValue = NAN;
    float mValueAtDown = 0;       // displayed value at touch-down
    float mDownTouchValue = 0;    // expression value at touch-down
    float mTouchUpTime = 0;
    float mMaxAtDown = NAN;
    float mMinAtDown = NAN;

    // Mode: 0=delta, 1=absolute
    int mMode = 1;
    bool mWrapMode = false;

    // Easing parameters
    float mMaxTime = 1.0f;
    float mMaxAcceleration = 5.0f;
    float mMaxVelocity = 7.0f;
    VelocityEasing mEasyTouch;

    // Screen bounds of the containing canvas (captured during apply for hit-testing)
    float mScrLeft = 0, mScrTop = 0, mScrRight = 99999, mScrBottom = 99999;

    // Expression evaluator (reuse per instance for preCalcValues eval)
    ExpressionEvaluator mExp;

    std::string name() const override { return "TouchExpression"; }
    int opcode() const override { return 157; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;

    // Touch event handlers (called from CoreDocument touch dispatch)
    void touchDown(RemoteContext& context, float x, float y);
    void touchDrag(RemoteContext& context, float x, float y);
    void touchUp(RemoteContext& context, float x, float y, float dx, float dy);

    float getStopPosition(float pos, float slope) const;
    float wrap(float value) const;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<TouchExpressionOp>();
        op->id = buf.readInt();
        op->startValue = buf.readFloat();
        op->min = buf.readFloat();
        op->max = buf.readFloat();
        op->velocityId = buf.readFloat();
        op->touchEffects = buf.readInt();
        int len = buf.readInt();
        int exprLen = len & 0xFFFF;
        op->expression.resize(exprLen);
        for (int i = 0; i < exprLen; i++) op->expression[i] = buf.readFloat();
        int stopLogic = buf.readInt();
        int stopLen = stopLogic & 0xFFFF;
        op->stopMode = stopLogic >> 16;
        op->stopsData.resize(stopLen);
        for (int i = 0; i < stopLen; i++) op->stopsData[i] = buf.readFloat();
        int easingLen = buf.readInt();
        op->easingData.resize(easingLen);
        for (int i = 0; i < easingLen; i++) op->easingData[i] = buf.readFloat();

        // Initialize resolved fields from wire values (matching Java constructor)
        op->mOutDefValue = op->startValue;
        op->mOutMax = op->max;
        op->mMode = (op->stopMode == STOP_ABSOLUTE_POS) ? 1 : 0;
        op->mOutStopSpec = op->stopsData;

        // Check for wrap mode: min is NaN with id==0
        if (std::isnan(op->min) && Utils::idFromNan(op->min) == 0) {
            op->mWrapMode = true;
        } else {
            op->mOutMin = op->min;
        }

        // Parse easing spec
        if (op->easingData.size() >= 4) {
            uint32_t bits;
            float f0 = op->easingData[0];
            std::memcpy(&bits, &f0, sizeof(bits));
            if (bits == 0) {
                op->mMaxTime = op->easingData[1];
                op->mMaxAcceleration = op->easingData[2];
                op->mMaxVelocity = op->easingData[3];
            }
        }

        ops.push_back(std::move(op));
    }
};

// ── PathAppend (160) ───────────────────────────────────────────────────
class PathAppendOp : public Operation {
public:
    int id = 0;
    std::vector<float> data;
    std::vector<float> oData;  // resolved output

    std::string name() const override { return "PathAppend"; }
    int opcode() const override { return 160; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<PathAppendOp>();
        op->id = buf.readInt();
        int len = buf.readInt();
        op->data.resize(len);
        for (int i = 0; i < len; i++) op->data[i] = buf.readFloat();
        op->oData = op->data;
        ops.push_back(std::move(op));
    }
};

// ── PathExpression (193) ───────────────────────────────────────────────
class PathExpressionOp : public Operation {
public:
    int id = 0, flags = 0;
    float min = 0, max = 0, count = 0;
    std::vector<float> expressionX;
    std::vector<float> expressionY;

    std::string name() const override { return "PathExpression"; }
    int opcode() const override { return 193; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<PathExpressionOp>();
        op->id = buf.readInt();
        op->flags = buf.readInt();
        op->min = buf.readFloat();
        op->max = buf.readFloat();
        op->count = buf.readFloat();
        int lenX = buf.readInt();
        op->expressionX.resize(lenX);
        for (int i = 0; i < lenX; i++) op->expressionX[i] = buf.readFloat();
        int lenY = buf.readInt();
        op->expressionY.resize(lenY);
        for (int i = 0; i < lenY; i++) op->expressionY[i] = buf.readFloat();
        ops.push_back(std::move(op));
    }
};

// ── PathCreate (159) ───────────────────────────────────────────────────
class PathCreateOp : public Operation {
public:
    int id = 0;
    float startX = 0, startY = 0;
    float oStartX = 0, oStartY = 0;  // resolved output

    std::string name() const override { return "PATH_CREATE"; }
    int opcode() const override { return 159; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<PathCreateOp>();
        op->id = buf.readInt();
        op->startX = buf.readFloat();
        op->startY = buf.readFloat();
        op->oStartX = op->startX;
        op->oStartY = op->startY;
        ops.push_back(std::move(op));
    }
};

// ── PathTween (158) ────────────────────────────────────────────────────
class PathTweenOp : public Operation {
public:
    int outId = 0, pathId1 = 0, pathId2 = 0;
    float tween = 0;
    float oTween = 0;

    std::string name() const override { return "PATH_TWEEN"; }
    int opcode() const override { return 158; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isPaintOperation() const override { return true; }
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<PathTweenOp>();
        op->outId = buf.readInt();
        op->pathId1 = buf.readInt();
        op->pathId2 = buf.readInt();
        op->tween = buf.readFloat();
        op->oTween = op->tween;
        ops.push_back(std::move(op));
    }
};

// ── PathCombine (175) ──────────────────────────────────────────────────
// Boolean path operation: combines two paths using DIFFERENCE, INTERSECT,
// REVERSE_DIFFERENCE, UNION, or XOR.
class PathCombineOp : public Operation {
public:
    int outId = 0, pathId1 = 0, pathId2 = 0;
    int operation = 0;

    std::string name() const override { return "PATH_COMBINE"; }
    int opcode() const override { return 175; }
    std::vector<Field> fields() const override { return {}; }
    bool isPaintOperation() const override { return true; }
    void apply(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<PathCombineOp>();
        op->outId = buf.readInt();
        op->pathId1 = buf.readInt();
        op->pathId2 = buf.readInt();
        op->operation = buf.readByte();
        ops.push_back(std::move(op));
    }
};

// ── MatrixConstant (186) ───────────────────────────────────────────────
class MatrixConstantOp : public Operation {
public:
    int id = 0, type = 0;
    std::vector<float> values;

    std::string name() const override { return "MATRIX_CONSTANT"; }
    int opcode() const override { return 186; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<MatrixConstantOp>();
        op->id = buf.readInt();
        op->type = buf.readInt();
        int len = buf.readInt();
        op->values.resize(len);
        for (int i = 0; i < len; i++) op->values[i] = buf.readFloat();
        ops.push_back(std::move(op));
    }
};

// ── MatrixVectorMath (188) ─────────────────────────────────────────────
class MatrixVectorMathOp : public Operation {
public:
    int type = 0, matrixId = 0;
    std::vector<int> outIds;
    std::vector<float> inValues;
    std::vector<float> resolvedInputs;

    std::string name() const override { return "MatrixVectorMath"; }
    int opcode() const override { return 188; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<MatrixVectorMathOp>();
        op->type = buf.readShort();
        op->matrixId = buf.readInt();
        int lenOut = buf.readInt();
        op->outIds.resize(lenOut);
        for (int i = 0; i < lenOut; i++) op->outIds[i] = buf.readInt();
        int lenIn = buf.readInt();
        op->inValues.resize(lenIn);
        for (int i = 0; i < lenIn; i++) op->inValues[i] = buf.readFloat();
        ops.push_back(std::move(op));
    }
};

// ── MatrixExpression (187) ─────────────────────────────────────────────
class MatrixExpressionOp : public Operation {
public:
    int id = 0, type = 0;
    std::vector<float> expression;
    std::vector<float> outExpression; // resolved (variables → values, ops stay as NaN)

    std::string name() const override { return "MatrixExpression"; }
    int opcode() const override { return 187; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<MatrixExpressionOp>();
        op->id = buf.readInt();
        op->type = buf.readInt();
        int len = buf.readInt();
        op->expression.resize(len);
        for (int i = 0; i < len; i++) op->expression[i] = buf.readFloat();
        ops.push_back(std::move(op));
    }
};

// ── MatrixFromPath (181) ───────────────────────────────────────────────
class MatrixFromPathOp : public Operation {
public:
    int pathId = 0;
    float percent = 0, vOffset = 0;
    int flags = 0;

    std::string name() const override { return "MATRIX_FROM_PATH"; }
    int opcode() const override { return 181; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isPaintOperation() const override { return true; }
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<MatrixFromPathOp>();
        op->pathId = buf.readInt();
        op->percent = buf.readFloat();
        op->vOffset = buf.readFloat();
        op->flags = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── DebugMessage (179) ─────────────────────────────────────────────────
class DebugMessageOp : public Operation {
public:
    int textId = 0;
    float value = 0;
    int flags = 0;

    std::string name() const override { return "DEBUG_MESSAGE"; }
    int opcode() const override { return 179; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<DebugMessageOp>();
        op->textId = buf.readInt();
        op->value = buf.readFloat();
        op->flags = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── ColorTheme (196) ───────────────────────────────────────────────────
class ColorThemeOp : public Operation {
public:
    int id = 0, groupId = 0;
    int lightModeIndex = 0, darkModeIndex = 0;
    int lightFallback = 0, darkFallback = 0;

    std::string name() const override { return "COLOR_THEME"; }
    int opcode() const override { return 196; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ColorThemeOp>();
        op->id = buf.readInt();
        op->groupId = buf.readInt();
        op->lightModeIndex = buf.readShort();
        op->darkModeIndex = buf.readShort();
        op->lightFallback = buf.readInt();
        op->darkFallback = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── DataDynamicListFloat (197) ─────────────────────────────────────────
class DataDynamicListFloat : public Operation {
public:
    int id = 0;
    float length = 0;  // number of array elements (stored as float)

    std::string name() const override { return "DataDynamicListFloat"; }
    int opcode() const override { return 197; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<DataDynamicListFloat>();
        op->id = buf.readInt();
        op->length = buf.readFloat();
        ops.push_back(std::move(op));
    }
};

// ── UpdateDynamicFloatList (198) ───────────────────────────────────────
class UpdateDynamicFloatListOp : public Operation {
public:
    int id = 0;
    float index = 0, value = 0;
    float oIndex = 0, oValue = 0;

    std::string name() const override { return "UPDATE_DYNAMIC_FLOAT_LIST"; }
    int opcode() const override { return 198; }
    std::vector<Field> fields() const override { return {}; }
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;
    void apply(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<UpdateDynamicFloatListOp>();
        op->id = buf.readInt();
        op->index = buf.readFloat();
        op->value = buf.readFloat();
        op->oIndex = op->index;
        op->oValue = op->value;
        ops.push_back(std::move(op));
    }
};

// ── DrawBitmapScaled (149) ─────────────────────────────────────────────
class DrawBitmapScaled : public Operation {
public:
    int imageId = 0;
    float srcL = 0, srcT = 0, srcR = 0, srcB = 0;
    float dstL = 0, dstT = 0, dstR = 0, dstB = 0;
    float oSrcL = 0, oSrcT = 0, oSrcR = 0, oSrcB = 0;
    float oDstL = 0, oDstT = 0, oDstR = 0, oDstB = 0;
    int scaleType = 0;
    float scaleFactor = 1, oScaleFactor = 1;
    int descriptionId = 0;

    std::string name() const override { return "DRAW_BITMAP_SCALED"; }
    int opcode() const override { return 149; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isPaintOperation() const override { return true; }
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<DrawBitmapScaled>();
        op->imageId = buf.readInt();
        op->srcL = buf.readFloat(); op->srcT = buf.readFloat();
        op->srcR = buf.readFloat(); op->srcB = buf.readFloat();
        op->dstL = buf.readFloat(); op->dstT = buf.readFloat();
        op->dstR = buf.readFloat(); op->dstB = buf.readFloat();
        op->oSrcL = op->srcL; op->oSrcT = op->srcT;
        op->oSrcR = op->srcR; op->oSrcB = op->srcB;
        op->oDstL = op->dstL; op->oDstT = op->dstT;
        op->oDstR = op->dstR; op->oDstB = op->dstB;
        op->scaleType = buf.readInt();
        op->scaleFactor = buf.readFloat();
        op->oScaleFactor = op->scaleFactor;
        op->descriptionId = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── DrawContent (139) ──────────────────────────────────────────────────
class DrawContentOp : public Operation {
public:
    std::string name() const override { return "DrawContent"; }
    int opcode() const override { return 139; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    bool isPaintOperation() const override { return true; }

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        ops.push_back(std::make_unique<DrawContentOp>());
    }
};

// ── CanvasOperations (173) ─────────────────────────────────────────────
class CanvasOperationsOp : public Operation {
public:
    std::string name() const override { return "CanvasOperations"; }
    int opcode() const override { return 173; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    void apply(RemoteContext& context) override {
        for (auto& child : mChildren) child->apply(context);
    }

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        ops.push_back(std::make_unique<CanvasOperationsOp>());
    }
};

// ── Action Operations (209, 210, 212, 213, 218, 222, 227, 236) ───────
class HostActionOp : public Operation {
public:
    int actionId = 0;
    std::string name() const override { return "HOST_ACTION"; }
    int opcode() const override { return 209; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<HostActionOp>();
        op->actionId = buf.readInt();
        ops.push_back(std::move(op));
    }
};

class ValueFloatChangeOp : public Operation {
public:
    int targetId = 0;
    float value = 0;
    std::string name() const override { return "ValueFloatExpressionChangeActionOperation"; }
    int opcode() const override { return 222; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ValueFloatChangeOp>();
        op->targetId = buf.readInt();
        op->value = buf.readFloat();
        ops.push_back(std::move(op));
    }
};

class ValueIntChangeOp : public Operation {
public:
    int targetId = 0, value = 0;
    std::string name() const override { return "VALUE_INTEGER_CHANGE_ACTION"; }
    int opcode() const override { return 212; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ValueIntChangeOp>();
        op->targetId = buf.readInt(); op->value = buf.readInt();
        ops.push_back(std::move(op));
    }
};

class ValueStringChangeOp : public Operation {
public:
    int targetId = 0;
    std::string value;
    std::string name() const override { return "VALUE_STRING_CHANGE_ACTION"; }
    int opcode() const override { return 213; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ValueStringChangeOp>();
        op->targetId = buf.readInt(); op->value = buf.readUTF8();
        ops.push_back(std::move(op));
    }
};

class RunActionOp : public Operation {
public:
    std::string name() const override { return "RUN_ACTION"; }
    int opcode() const override { return 236; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        ops.push_back(std::make_unique<RunActionOp>());
    }
};

// ── HostActionMetadata (216) ──────────────────────────────────────────
class HostActionMetadataOp : public Operation {
public:
    int actionId = 0, metadataId = 0;
    std::string name() const override { return "HostActionMetadataOperation"; }
    int opcode() const override { return 216; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<HostActionMetadataOp>();
        op->actionId = buf.readInt();
        op->metadataId = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── HostActionList (210) ──────────────────────────────────────────────
class HostActionListOp : public Operation {
public:
    int id = 0;
    std::vector<int> actionIds;
    std::string name() const override { return "HostActionList"; }
    int opcode() const override { return 210; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<HostActionListOp>();
        op->id = buf.readInt();
        int count = buf.readInt();
        op->actionIds.resize(count);
        for (int i = 0; i < count; i++) op->actionIds[i] = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── ValueBooleanChange (227) ──────────────────────────────────────────
class ValueBooleanChangeOp : public Operation {
public:
    int targetId = 0, value = 0;
    std::string name() const override { return "ValueFloatExpressionChangeActionOperation"; }
    int opcode() const override { return 227; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ValueBooleanChangeOp>();
        op->targetId = buf.readInt();
        op->value = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── ValueLongChange (218) ─────────────────────────────────────────────
class ValueLongChangeOp : public Operation {
public:
    int64_t targetId = 0, value = 0;
    std::string name() const override { return "ValueIntegerExpressionChangeAction"; }
    int opcode() const override { return 218; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ValueLongChangeOp>();
        op->targetId = buf.readLong();
        op->value = buf.readLong();
        ops.push_back(std::move(op));
    }
};

// ── TextAttribute (170) ───────────────────────────────────────────────
// PaintOperation: measures text and stores result as a float.
// type low 8 bits: 0=width, 1=height, 2=left, 3=right, 4=top, 5=bottom, 6=length
// type upper 8 bits: flags for getTextBounds
class TextAttributeOp : public Operation {
public:
    int id = 0, textId = 0, type = 0;
    float mBounds[4] = {};

    std::string name() const override { return "TextAttribute"; }
    int opcode() const override { return 170; }
    std::vector<Field> fields() const override { return {}; }
    bool isPaintOperation() const override { return true; }
    void apply(RemoteContext& context) override;
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<TextAttributeOp>();
        op->id = buf.readInt();
        op->textId = buf.readInt();
        op->type = buf.readShort();
        buf.readShort(); // unused
        ops.push_back(std::move(op));
    }
};

// ── GraphicsLayerModifier (224) ───────────────────────────────────────
class ModifierGraphicsLayer : public Operation {
public:
    std::string name() const override { return "GraphicsLayerModifier"; }
    int opcode() const override { return 224; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ModifierGraphicsLayer>();
        int len = buf.readInt();
        for (int i = 0; i < len; i++) {
            int tag = buf.readInt();
            int dataType = (tag >> 10) & 0x3;
            if (dataType == 1) buf.readFloat();
            else buf.readInt();
        }
        ops.push_back(std::move(op));
    }
};

// ── DataMapIds (145) ──────────────────────────────────────────────────
class DataMapIdsOp : public Operation {
public:
    int id = 0;
    std::string name() const override { return "DataMapIds"; }
    int opcode() const override { return 145; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<DataMapIdsOp>();
        op->id = buf.readInt();
        int count = buf.readInt();
        for (int i = 0; i < count; i++) { buf.readUTF8(); buf.readByte(); buf.readInt(); }
        ops.push_back(std::move(op));
    }
};

// ── DataMapLookup (154) ───────────────────────────────────────────────
class DataMapLookupOp : public Operation {
public:
    int id = 0, mapId = 0, stringId = 0;
    std::string name() const override { return "DataMapLookup"; }
    int opcode() const override { return 154; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<DataMapLookupOp>();
        op->id = buf.readInt();
        op->mapId = buf.readInt();
        op->stringId = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── TextMeasure (155) ─────────────────────────────────────────────────
// PaintOperation: measures text dimensions and stores result as a float.
// type low 8 bits: 0=width, 1=height, 2=left, 3=right, 4=top, 5=bottom
// type upper 8 bits: flags for getTextBounds
class TextMeasureOp : public Operation {
public:
    int id = 0, textId = 0, type = 0;
    float mBounds[4] = {};

    std::string name() const override { return "TextMeasure"; }
    int opcode() const override { return 155; }
    std::vector<Field> fields() const override { return {}; }
    bool isPaintOperation() const override { return true; }
    void apply(RemoteContext& context) override;
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<TextMeasureOp>();
        op->id = buf.readInt();
        op->textId = buf.readInt();
        op->type = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── TextLength (156) ──────────────────────────────────────────────────
// Stores the length of a text string as a float.
class TextLengthOp : public Operation {
public:
    int lengthId = 0, textId = 0;
    std::string name() const override { return "TextLength"; }
    int opcode() const override { return 156; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<TextLengthOp>();
        op->lengthId = buf.readInt();
        op->textId = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── TextSubtext (182) ─────────────────────────────────────────────────
// Extracts a substring and stores it as a text variable.
// start and len can be NaN-encoded variable references.
class TextSubtextOp : public Operation {
public:
    int textId = 0, srcId = 0;
    float start = 0, len = 0;
    float oStart = 0, oLen = 0; // resolved values

    std::string name() const override { return "TextSubtext"; }
    int opcode() const override { return 182; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override;
    bool isVariableSupport() const override { return true; }
    void registerListening(RemoteContext& context) override;
    void updateVariables(RemoteContext& context) override;
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<TextSubtextOp>();
        op->textId = buf.readInt();
        op->srcId = buf.readInt();
        op->start = buf.readFloat();
        op->len = buf.readFloat();
        op->oStart = op->start;
        op->oLen = op->len;
        ops.push_back(std::move(op));
    }
};

// ── IdLookup (192) ────────────────────────────────────────────────────
class IdLookupOp : public Operation {
public:
    int id = 0, dataMapId = 0;
    float index = 0;
    std::string name() const override { return "IdLookup"; }
    int opcode() const override { return 192; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<IdLookupOp>();
        op->id = buf.readInt();
        op->dataMapId = buf.readInt();
        op->index = buf.readFloat();
        ops.push_back(std::move(op));
    }
};

// ── ParticlesCreate (161) ─────────────────────────────────────────────
// Creates a particle system: N particles, each with M variables.
// Each variable has an initialization equation (RPN).
// VAR1 in equations is substituted with the particle index.
class ParticlesCreateOp : public Operation {
public:
    std::string name() const override { return "ParticlesCreate"; }
    int opcode() const override { return 161; }
    std::vector<Field> fields() const override { return {}; }
    bool isPaintOperation() const override { return true; }
    bool isVariableSupport() const override { return true; }

    void registerListening(RemoteContext& context) override {
        context.putObject(mId, this);
        for (auto& eq : mEquations) {
            for (float v : eq) {
                if (std::isnan(v)
                    && !ExpressionEvaluator::isMathOperator(v)
                    && !ExpressionEvaluator::isDataVariable(v)) {
                    context.listensTo(Utils::idFromNan(v), this);
                }
            }
        }
    }

    void updateVariables(RemoteContext& context) override {
        for (size_t i = 0; i < mEquations.size(); i++) {
            for (size_t j = 0; j < mEquations[i].size(); j++) {
                float v = mEquations[i][j];
                mOutEquations[i][j] =
                    (std::isnan(v)
                     && !ExpressionEvaluator::isMathOperator(v)
                     && !ExpressionEvaluator::isDataVariable(v))
                    ? context.getFloat(Utils::idFromNan(v))
                    : v;
            }
        }
    }

    void apply(RemoteContext& context) override {
        if (context.getMode() != ContextMode::PAINT) return;
        // Only initialize particles once (first paint pass).
        // The Java player uses an Impulse wrapper for this; the C++ player
        // doesn't implement Impulse, so we guard with a flag instead.
        if (!mInitialized) {
            for (int i = 0; i < mParticleCount; i++) {
                initializeParticle(i);
            }
            mInitialized = true;
        }
    }

    void initializeParticle(int pNo) {
        int varCount = static_cast<int>(mVarId.size());
        for (int j = 0; j < varCount; j++) {
            // Substitute VAR1 with particle index in out equations
            for (int idx : mIndexVars) {
                int jIdx = idx / varCount;
                int kIdx = idx % varCount;
                if (jIdx < static_cast<int>(mOutEquations.size())
                    && kIdx < static_cast<int>(mOutEquations[jIdx].size())) {
                    mOutEquations[jIdx][kIdx] = static_cast<float>(pNo);
                }
            }
            mParticles[pNo][j] = mExp.eval(mOutEquations[j].data(),
                                            static_cast<int>(mOutEquations[j].size()));
        }
    }

    // Accessors for ParticlesLoop/ParticlesCompare
    std::vector<std::vector<float>>& getParticles() { return mParticles; }
    const std::vector<int>& getVariableIds() const { return mVarId; }

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ParticlesCreateOp>();
        op->mId = buf.readInt();
        op->mParticleCount = buf.readInt();
        int varLen = buf.readInt();
        op->mVarId.resize(varLen);
        op->mEquations.resize(varLen);
        op->mOutEquations.resize(varLen);
        for (int i = 0; i < varLen; i++) {
            op->mVarId[i] = buf.readInt();
            int equLen = buf.readInt();
            op->mEquations[i].resize(equLen);
            op->mOutEquations[i].resize(equLen);
            for (int j = 0; j < equLen; j++) {
                float v = buf.readFloat();
                op->mEquations[i][j] = v;
                op->mOutEquations[i][j] = v;
            }
        }
        op->mParticles.resize(op->mParticleCount, std::vector<float>(varLen, 0.0f));

        // Find positions where VAR1 appears in equations
        float var1 = ExpressionEvaluator::toNaN(ExpressionEvaluator::VAR1);
        int32_t var1Bits;
        memcpy(&var1Bits, &var1, sizeof(var1Bits));
        for (int j = 0; j < varLen; j++) {
            for (int k = 0; k < static_cast<int>(op->mEquations[j].size()); k++) {
                float v = op->mEquations[j][k];
                if (std::isnan(v)) {
                    int32_t vBits;
                    memcpy(&vBits, &v, sizeof(vBits));
                    if (vBits == var1Bits) {
                        op->mIndexVars.push_back(j * varLen + k);
                    }
                }
            }
        }
        ops.push_back(std::move(op));
    }

private:
    // Simple evaluator that doesn't need context (for init equations)
    struct SimpleEval {
        ExpressionEvaluator evaluator;
        float eval(const float* expr, int len) {
            // Use a dummy context - init equations only reference VAR1 and literals
            static RemoteContext dummyCtx;
            return evaluator.eval(dummyCtx, nullptr, expr, len);
        }
    };
    SimpleEval mExp;
    int mId = 0;
    int mParticleCount = 0;
    bool mInitialized = false;
    std::vector<int> mVarId;
    std::vector<std::vector<float>> mEquations;    // original equations
    std::vector<std::vector<float>> mOutEquations;  // with variables resolved
    std::vector<std::vector<float>> mParticles;     // [particleCount][varCount]
    std::vector<int> mIndexVars;  // positions of VAR1 in equations
};

// ── ParticlesLoop (163) ───────────────────────────────────────────────
// Updates particle state each frame using update equations, then
// executes child operations for each particle (to draw it).
// If restart equation evaluates > 0, the particle is reinitialized.
class ParticlesLoopOp : public Operation {
public:
    std::string name() const override { return "ParticlesLoop"; }
    int opcode() const override { return 163; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    bool isPaintOperation() const override { return true; }
    bool isVariableSupport() const override { return true; }

    void registerListening(RemoteContext& context) override {
        // Link to the ParticlesCreate by ID
        mSource = dynamic_cast<ParticlesCreateOp*>(context.getObject(mId));
        if (mSource) {
            mParticles = &mSource->getParticles();
            mVarId = &mSource->getVariableIds();
        }
        if (!mRestart.empty()) {
            for (float v : mRestart) {
                if (std::isnan(v)
                    && !ExpressionEvaluator::isMathOperator(v)
                    && !ExpressionEvaluator::isDataVariable(v)) {
                    context.listensTo(Utils::idFromNan(v), this);
                }
            }
        }
        for (auto& eq : mEquations) {
            for (float v : eq) {
                if (std::isnan(v)
                    && !ExpressionEvaluator::isMathOperator(v)
                    && !ExpressionEvaluator::isDataVariable(v)) {
                    context.listensTo(Utils::idFromNan(v), this);
                }
            }
        }
    }

    void updateVariables(RemoteContext& context) override {
        for (size_t i = 0; i < mRestart.size(); i++) {
            float v = mRestart[i];
            mOutRestart[i] = (std::isnan(v)
                && !ExpressionEvaluator::isMathOperator(v)
                && !ExpressionEvaluator::isDataVariable(v))
                ? context.getFloat(Utils::idFromNan(v)) : v;
        }
        for (size_t i = 0; i < mEquations.size(); i++) {
            for (size_t j = 0; j < mEquations[i].size(); j++) {
                float v = mEquations[i][j];
                mOutEquations[i][j] = (std::isnan(v)
                    && !ExpressionEvaluator::isMathOperator(v)
                    && !ExpressionEvaluator::isDataVariable(v))
                    ? context.getFloat(Utils::idFromNan(v)) : v;
            }
        }
    }

    void apply(RemoteContext& context) override {
        if (context.getMode() != ContextMode::PAINT) return;
        if (!mParticles || !mVarId) return;
        ContextCollectionsLocal ca(context);

        auto& particles = *mParticles;
        auto& varId = *mVarId;
        int varCount = static_cast<int>(varId.size());

        for (size_t i = 0; i < particles.size(); i++) {
            // Load particle values into context and resolve equations
            // (Java calls updateVariables inside inner loop)
            for (int j = 0; j < varCount; j++) {
                context.loadFloat(varId[j], particles[i][j]);
                updateVariables(context);
            }

            // Evaluate update equations
            for (int j = 0; j < varCount; j++) {
                particles[i][j] = mExp.eval(context, &ca,
                    mOutEquations[j].data(),
                    static_cast<int>(mOutEquations[j].size()));
                context.loadFloat(varId[j], particles[i][j]);
            }

            // Test for restart
            if (!mOutRestart.empty()) {
                // Re-resolve restart with current particle values
                for (size_t k = 0; k < mRestart.size(); k++) {
                    float v = mRestart[k];
                    mOutRestart[k] = (std::isnan(v)
                        && !ExpressionEvaluator::isMathOperator(v)
                        && !ExpressionEvaluator::isDataVariable(v))
                        ? context.getFloat(Utils::idFromNan(v)) : v;
                }
                float restartVal = mExp.eval(context, &ca,
                    mOutRestart.data(),
                    static_cast<int>(mOutRestart.size()));
                if (restartVal > 0 && mSource) {
                    mSource->initializeParticle(static_cast<int>(i));
                }
            }

            // Execute child operations (drawing)
            for (auto& child : mChildren) {
                if (child->isVariableSupport()) {
                    child->updateVariables(context);
                }
                context.incrementOpCount();
                child->apply(context);
            }
        }
        context.needsRepaint();
    }

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ParticlesLoopOp>();
        op->mId = buf.readInt();
        int restartLen = buf.readInt();
        if (restartLen > 0) {
            op->mRestart.resize(restartLen);
            op->mOutRestart.resize(restartLen);
            for (int i = 0; i < restartLen; i++) {
                float v = buf.readFloat();
                op->mRestart[i] = v;
                op->mOutRestart[i] = v;
            }
        }
        int varLen = buf.readInt();
        op->mEquations.resize(varLen);
        op->mOutEquations.resize(varLen);
        for (int i = 0; i < varLen; i++) {
            int equLen = buf.readInt();
            op->mEquations[i].resize(equLen);
            op->mOutEquations[i].resize(equLen);
            for (int j = 0; j < equLen; j++) {
                float v = buf.readFloat();
                op->mEquations[i][j] = v;
                op->mOutEquations[i][j] = v;
            }
        }
        ops.push_back(std::move(op));
    }

private:
    // Inline CollectionsAccess for eval
    struct ContextCollectionsLocal : public CollectionsAccess {
        const RemoteContext& ctx;
        explicit ContextCollectionsLocal(const RemoteContext& c) : ctx(c) {}
        const std::vector<float>* getFloats(int id) const override {
            return ctx.getFloatList(id);
        }
    };

    ExpressionEvaluator mExp;
    int mId = 0;
    std::vector<float> mRestart;
    std::vector<float> mOutRestart;
    std::vector<std::vector<float>> mEquations;
    std::vector<std::vector<float>> mOutEquations;
    ParticlesCreateOp* mSource = nullptr;
    std::vector<std::vector<float>>* mParticles = nullptr;
    const std::vector<int>* mVarId = nullptr;
};

// ── ParticlesCompare (194) ────────────────────────────────────────────
// Conditional logic for particles. Two modes:
// - Single mode (equations2 == null): evaluate condition per particle,
//   if > 0 apply equations1 and run children.
// - Dual mode (both equations): nested loop over particle pairs,
//   if condition > 0 apply equations1 to particle1 and equations2 to particle2.
class ParticlesCompareOp : public Operation {
public:
    std::string name() const override { return "ParticlesCompare"; }
    int opcode() const override { return 194; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    bool isPaintOperation() const override { return true; }
    bool isVariableSupport() const override { return true; }

    void registerListening(RemoteContext& context) override {
        mSource = dynamic_cast<ParticlesCreateOp*>(context.getObject(mId));
        if (mSource) {
            mParticles = &mSource->getParticles();
            mVarId = &mSource->getVariableIds();
        }
        auto regArr = [&](const std::vector<float>& arr) {
            for (float v : arr) {
                if (std::isnan(v)
                    && !ExpressionEvaluator::isMathOperator(v)
                    && !ExpressionEvaluator::isDataVariable(v)) {
                    context.listensTo(Utils::idFromNan(v), this);
                }
            }
        };
        regArr(mExpression);
        for (auto& eq : mEquations1) regArr(eq);
        for (auto& eq : mEquations2) regArr(eq);
    }

    void updateVariables(RemoteContext& context) override {
        mOutMin = std::isnan(mMin) ? context.getFloat(Utils::idFromNan(mMin)) : mMin;
        mOutMax = std::isnan(mMax) ? context.getFloat(Utils::idFromNan(mMax)) : mMax;
        resolveArr(context, mExpression, mOutExpression);
        resolveArr2D(context, mEquations1, mOutEquations1);
        resolveArr2D(context, mEquations2, mOutEquations2);
    }

    void apply(RemoteContext& context) override {
        if (context.getMode() != ContextMode::PAINT) return;
        if (!mParticles || !mVarId) return;

        if (!mEquations1.empty() && !mEquations2.empty()) {
            condition2Body(context);
        } else {
            condition1Body(context);
        }
    }

    static std::vector<float> readFloatsVec(WireBuffer& buf) {
        int len = buf.readInt();
        std::vector<float> result;
        if (len > 0) {
            result.resize(len);
            for (int i = 0; i < len; i++) result[i] = buf.readFloat();
        }
        return result;
    }

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ParticlesCompareOp>();
        op->mId = buf.readInt();
        op->mFlags = static_cast<short>(buf.readShort());
        op->mMin = buf.readFloat();
        op->mMax = buf.readFloat();
        op->mOutMin = op->mMin;
        op->mOutMax = op->mMax;
        op->mExpression = readFloatsVec(buf);
        op->mOutExpression = op->mExpression;

        int r1Len = buf.readInt();
        op->mEquations1.resize(r1Len);
        op->mOutEquations1.resize(r1Len);
        for (int i = 0; i < r1Len; i++) {
            op->mEquations1[i] = readFloatsVec(buf);
            op->mOutEquations1[i] = op->mEquations1[i];
        }

        int r2Len = buf.readInt();
        op->mEquations2.resize(r2Len);
        op->mOutEquations2.resize(r2Len);
        for (int i = 0; i < r2Len; i++) {
            op->mEquations2[i] = readFloatsVec(buf);
            op->mOutEquations2[i] = op->mEquations2[i];
        }
        ops.push_back(std::move(op));
    }

private:
    struct ContextCollectionsLocal : public CollectionsAccess {
        const RemoteContext& ctx;
        explicit ContextCollectionsLocal(const RemoteContext& c) : ctx(c) {}
        const std::vector<float>* getFloats(int id) const override {
            return ctx.getFloatList(id);
        }
    };

    void resolveArr(RemoteContext& ctx, const std::vector<float>& src, std::vector<float>& dst) {
        for (size_t i = 0; i < src.size(); i++) {
            float v = src[i];
            dst[i] = (std::isnan(v)
                && !ExpressionEvaluator::isMathOperator(v)
                && !ExpressionEvaluator::isDataVariable(v))
                ? ctx.getFloat(Utils::idFromNan(v)) : v;
        }
    }
    void resolveArr2D(RemoteContext& ctx,
                      const std::vector<std::vector<float>>& src,
                      std::vector<std::vector<float>>& dst) {
        for (size_t i = 0; i < src.size(); i++) resolveArr(ctx, src[i], dst[i]);
    }

    void setupForParticle(RemoteContext& ctx, const std::vector<float>& particle) {
        for (size_t j = 0; j < particle.size(); j++) {
            ctx.loadFloat((*mVarId)[j], particle[j]);
        }
    }

    void runChildren(RemoteContext& ctx) {
        for (auto& child : mChildren) {
            if (child->isVariableSupport()) child->updateVariables(ctx);
            ctx.incrementOpCount();
            child->apply(ctx);
        }
    }

    // Single-particle mode: for each particle, test condition, apply equations1
    void condition1Body(RemoteContext& ctx) {
        ContextCollectionsLocal ca(ctx);
        bool needsRepaint = false;
        int start = (mOutMin < 0) ? 0 : static_cast<int>(mOutMin);
        int end = (mOutMax < 0) ? static_cast<int>(mParticles->size()) : static_cast<int>(mOutMax);
        auto& particles = *mParticles;
        auto& varId = *mVarId;

        for (int i = start; i < end; i++) {
            setupForParticle(ctx, particles[i]);
            resolveArr(ctx, mExpression, mOutExpression);
            float value = mExp.eval(ctx, &ca, mOutExpression.data(),
                                    static_cast<int>(mOutExpression.size()));
            if (value > 0) {
                resolveArr2D(ctx, mEquations1, mOutEquations1);
                for (size_t j = 0; j < particles[i].size(); j++) {
                    particles[i][j] = mExp.eval(ctx, &ca, mOutEquations1[j].data(),
                        static_cast<int>(mOutEquations1[j].size()));
                    ctx.loadFloat(varId[j], particles[i][j]);
                }
                runChildren(ctx);
                needsRepaint = true;
                ctx.incrementOpCount();
            }
        }
        if (needsRepaint) ctx.needsRepaint();
    }

    // Resolve an expression array with CMD1/CMD2 support for dual-particle mode.
    // CMD1 (after a var ref) substitutes particle1's value; CMD2 substitutes particle2's.
    // Without CMD, a variable reference resolves to particle1 (default).
    void resolve2Body(RemoteContext& ctx,
                      const std::vector<float>& src, std::vector<float>& dst,
                      const std::vector<float>& particle1,
                      const std::vector<float>& particle2,
                      bool reverse = false) {
        auto& varId = *mVarId;
        static const float CMD1_BITS = ExpressionEvaluator::toNaN(
            EXPR_OFFSET + 64);
        static const float CMD2_BITS = ExpressionEvaluator::toNaN(
            EXPR_OFFSET + 65);
        static const float NOP_BITS = ExpressionEvaluator::toNaN(
            EXPR_OFFSET + 55);

        for (size_t j = 0; j < src.size(); j++) {
            float v = src[j];
            if (std::isnan(v)
                && !ExpressionEvaluator::isMathOperator(v)
                && !ExpressionEvaluator::isDataVariable(v)) {
                int id = Utils::idFromNan(v);
                // Check if this is a particle variable
                bool isVar = false;
                for (size_t k = 0; k < varId.size(); k++) {
                    if (id == varId[k]) {
                        isVar = true;
                        // Check for CMD1/CMD2 token following
                        if (j + 1 < src.size()) {
                            int32_t nextBits;
                            float nextV = src[j + 1];
                            memcpy(&nextBits, &nextV, sizeof(nextBits));
                            int32_t cmd1Bits;
                            memcpy(&cmd1Bits, &CMD1_BITS, sizeof(cmd1Bits));
                            int32_t cmd2Bits;
                            memcpy(&cmd2Bits, &CMD2_BITS, sizeof(cmd2Bits));
                            if (nextBits == cmd1Bits) {
                                dst[j] = particle1[k];
                                dst[j + 1] = NOP_BITS;
                                j++;
                                break;
                            } else if (nextBits == cmd2Bits) {
                                dst[j] = particle2[k];
                                dst[j + 1] = NOP_BITS;
                                j++;
                                break;
                            }
                        }
                        // No CMD — use default (particle1 or reversed)
                        dst[j] = reverse ? particle2[k] : particle1[k];
                        break;
                    }
                }
                if (!isVar) {
                    dst[j] = ctx.getFloat(id);
                }
            } else {
                dst[j] = v;
            }
        }
    }
    void resolve2Body2D(RemoteContext& ctx,
                        const std::vector<std::vector<float>>& src,
                        std::vector<std::vector<float>>& dst,
                        const std::vector<float>& p1,
                        const std::vector<float>& p2,
                        bool reverse = false) {
        for (size_t i = 0; i < src.size(); i++)
            resolve2Body(ctx, src[i], dst[i], p1, p2, reverse);
    }

    // Dual-particle mode: nested loop, apply equations1 to p1 and equations2 to p2
    void condition2Body(RemoteContext& ctx) {
        ContextCollectionsLocal ca(ctx);
        bool needsRepaint = false;
        int start = (mOutMin < 0) ? 0 : static_cast<int>(mOutMin);
        int end = (mOutMax < 0) ? static_cast<int>(mParticles->size()) : static_cast<int>(mOutMax);
        auto& particles = *mParticles;
        auto& varId = *mVarId;

        for (int k = start; k < end; k++) {
            for (int i = k + 1; i < end; i++) {
                setupForParticle(ctx, particles[i]);
                // Resolve condition with CMD1/CMD2 support
                resolve2Body(ctx, mExpression, mOutExpression,
                             particles[i], particles[k]);
                float value = mExp.eval(ctx, &ca, mOutExpression.data(),
                                        static_cast<int>(mOutExpression.size()));
                ctx.incrementOpCount();
                if (value > 0) {
                    // Resolve equations with both particles available
                    resolve2Body2D(ctx, mEquations1, mOutEquations1,
                                   particles[i], particles[k]);
                    resolve2Body2D(ctx, mEquations2, mOutEquations2,
                                   particles[i], particles[k], true);

                    for (size_t j = 0; j < particles[i].size(); j++) {
                        particles[i][j] = mExp.eval(ctx, &ca, mOutEquations1[j].data(),
                            static_cast<int>(mOutEquations1[j].size()));
                        ctx.loadFloat(varId[j], particles[i][j]);
                    }
                    runChildren(ctx);

                    for (size_t j = 0; j < particles[k].size(); j++) {
                        particles[k][j] = mExp.eval(ctx, &ca, mOutEquations2[j].data(),
                            static_cast<int>(mOutEquations2[j].size()));
                        ctx.loadFloat(varId[j], particles[k][j]);
                    }
                    runChildren(ctx);
                    needsRepaint = true;
                }
            }
        }
        if (needsRepaint) ctx.needsRepaint();
    }

    ExpressionEvaluator mExp;
    int mId = 0;
    short mFlags = 0;
    float mMin = -1, mMax = -1;
    float mOutMin = -1, mOutMax = -1;
    std::vector<float> mExpression;
    std::vector<float> mOutExpression;
    std::vector<std::vector<float>> mEquations1, mOutEquations1;
    std::vector<std::vector<float>> mEquations2, mOutEquations2;
    ParticlesCreateOp* mSource = nullptr;
    std::vector<std::vector<float>>* mParticles = nullptr;
    const std::vector<int>* mVarId = nullptr;
};

// ── ImpulseProcess (165) ──────────────────────────────────────────────
// Container for operations executed repeatedly during an active impulse.
class ImpulseProcessOp : public Operation {
public:
    std::string name() const override { return "ImpulseProcess"; }
    int opcode() const override { return 165; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    bool isPaintOperation() const override { return true; }
    bool isVariableSupport() const override { return true; }

    void registerListening(RemoteContext& context) override {
        for (auto& child : mChildren) {
            if (child->isVariableSupport()) {
                child->registerListening(context);
            }
        }
    }

    void updateVariables(RemoteContext& context) override {
        for (auto& child : mChildren) {
            if (child->isVariableSupport()) {
                child->updateVariables(context);
            }
        }
    }

    void apply(RemoteContext& context) override {
        if (context.getMode() != ContextMode::PAINT) return;
        for (auto& child : mChildren) {
            if (child->isVariableSupport() && child->isDirty()) {
                child->updateVariables(context);
            }
            context.incrementOpCount();
            child->apply(context);
        }
    }

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        ops.push_back(std::make_unique<ImpulseProcessOp>());
    }
};

// ── ImpulseOperation (164) ────────────────────────────────────────────
// Triggers a timed event. On the first frame within [startAt, startAt+duration],
// executes initial actions (mChildren minus last ImpulseProcess).
// On subsequent frames, executes the ImpulseProcess.
class ImpulseOperationOp : public Operation {
public:
    std::string name() const override { return "ImpulseOperation"; }
    int opcode() const override { return 164; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    bool isPaintOperation() const override { return true; }
    bool isVariableSupport() const override { return true; }

    void registerListening(RemoteContext& context) override {
        // Extract the ImpulseProcess from the end of children
        if (!mProcessExtracted && !mChildren.empty()) {
            auto* lastChild = mChildren.back().get();
            if (dynamic_cast<ImpulseProcessOp*>(lastChild)) {
                mProcess = dynamic_cast<ImpulseProcessOp*>(lastChild);
                mProcessIdx = static_cast<int>(mChildren.size()) - 1;
            }
            mProcessExtracted = true;
        }
        if (std::isnan(mStartAt)) context.listensTo(Utils::idFromNan(mStartAt), this);
        if (std::isnan(mDuration)) context.listensTo(Utils::idFromNan(mDuration), this);
        // Register children
        for (size_t i = 0; i < mChildren.size(); i++) {
            if (static_cast<int>(i) == mProcessIdx) continue;
            if (mChildren[i]->isVariableSupport()) {
                mChildren[i]->registerListening(context);
            }
        }
        if (mProcess) mProcess->registerListening(context);
    }

    void updateVariables(RemoteContext& context) override {
        mOutDuration = std::isnan(mDuration)
            ? context.getFloat(Utils::idFromNan(mDuration)) : mDuration;
        mOutStartAt = std::isnan(mStartAt)
            ? context.getFloat(Utils::idFromNan(mStartAt)) : mStartAt;
        if (mProcess) mProcess->updateVariables(context);
    }

    void apply(RemoteContext& context) override {
        if (context.getMode() != ContextMode::PAINT) return;
        float animTime = context.getAnimationTime();

        if (animTime <= mOutStartAt + mOutDuration) {
            if (mInitialPass) {
                // Execute initial actions (all children except ImpulseProcess)
                for (size_t i = 0; i < mChildren.size(); i++) {
                    if (static_cast<int>(i) == mProcessIdx) continue;
                    auto& op = mChildren[i];
                    if (op->isVariableSupport() && op->isDirty()) {
                        op->updateVariables(context);
                    }
                    context.incrementOpCount();
                    op->apply(context);
                }
                mInitialPass = false;
            } else {
                // Execute process block
                context.incrementOpCount();
                if (mProcess) mProcess->apply(context);
            }
        } else {
            mInitialPass = true;
        }
    }

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ImpulseOperationOp>();
        op->mDuration = buf.readFloat();
        op->mStartAt = buf.readFloat();
        op->mOutDuration = op->mDuration;
        op->mOutStartAt = op->mStartAt;
        ops.push_back(std::move(op));
    }

private:
    float mDuration = 0, mStartAt = 0;
    float mOutDuration = 0, mOutStartAt = 0;
    bool mInitialPass = true;
    bool mProcessExtracted = false;
    int mProcessIdx = -1;
    ImpulseProcessOp* mProcess = nullptr;
};

// ── DrawToBitmap (190) ────────────────────────────────────────────────
// NOT a container — Java treats this as a flat state-change operation.
// DrawToBitmap(bitmapId) switches the paint canvas to an offscreen bitmap.
// DrawToBitmap(0) switches back to the main canvas.
class DrawToBitmapOp : public Operation {
public:
    int bitmapId = 0;
    int mode = 0;
    int color = 0;

    std::string name() const override { return "DrawToBitmap"; }
    int opcode() const override { return 190; }
    std::vector<Field> fields() const override { return {}; }
    bool isPaintOperation() const override { return true; }
    void apply(RemoteContext& context) override;
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<DrawToBitmapOp>();
        op->bitmapId = buf.readInt();
        op->mode = buf.readInt();
        op->color = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── CollapsibleRowLayout (230) ────────────────────────────────────────
class CollapsibleRowLayout : public Operation {
public:
    int componentId = 0, animationId = 0;
    int horizontal = 0, vertical = 0;
    float spacedBy = 0;

    std::string name() const override { return "CollapsibleRowLayout"; }
    int opcode() const override { return 230; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    void apply(RemoteContext& context) override {
        for (auto& child : mChildren) child->apply(context);
    }
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<CollapsibleRowLayout>();
        op->componentId = buf.readInt();
        op->animationId = buf.readInt();
        op->horizontal = buf.readInt();
        op->vertical = buf.readInt();
        op->spacedBy = buf.readFloat();
        ops.push_back(std::move(op));
    }
};

// ── CollapsibleColumnLayout (233) ─────────────────────────────────────
class CollapsibleColumnLayout : public Operation {
public:
    int componentId = 0, animationId = 0;
    int horizontal = 0, vertical = 0;
    float spacedBy = 0;

    std::string name() const override { return "CollapsibleColumnLayout"; }
    int opcode() const override { return 233; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    void apply(RemoteContext& context) override {
        for (auto& child : mChildren) child->apply(context);
    }
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<CollapsibleColumnLayout>();
        op->componentId = buf.readInt();
        op->animationId = buf.readInt();
        op->horizontal = buf.readInt();
        op->vertical = buf.readInt();
        op->spacedBy = buf.readFloat();
        ops.push_back(std::move(op));
    }
};

// ── FitBoxLayout (176) ────────────────────────────────────────────────
class FitBoxLayout : public Operation {
public:
    int componentId = 0, animationId = 0;
    int horizontal = 0, vertical = 0;

    std::string name() const override { return "FitBoxLayout"; }
    int opcode() const override { return 176; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    void apply(RemoteContext& context) override {
        for (auto& child : mChildren) child->apply(context);
    }
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<FitBoxLayout>();
        op->componentId = buf.readInt();
        op->animationId = buf.readInt();
        op->horizontal = buf.readInt();
        op->vertical = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── DrawContentModifier (174) ─────────────────────────────────────────
class DrawContentModifierOp : public Operation {
public:
    std::string name() const override { return "DrawContentModifier"; }
    int opcode() const override { return 174; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        ops.push_back(std::make_unique<DrawContentModifierOp>());
    }
};

// ── ModifierCollapsiblePriority (235) ─────────────────────────────────
class ModifierCollapsiblePriority : public Operation {
public:
    int orientation = 0;
    float priority = 0;
    std::string name() const override { return "MODIFIER_COLLAPSIBLE_PRIORITY"; }
    int opcode() const override { return 235; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ModifierCollapsiblePriority>();
        op->orientation = buf.readInt();
        op->priority = buf.readFloat();
        ops.push_back(std::move(op));
    }
};

// ── MarqueeModifier (228) ─────────────────────────────────────────────
class ModifierMarquee : public Operation {
public:
    std::string name() const override { return "MarqueeModifier"; }
    int opcode() const override { return 228; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ModifierMarquee>();
        buf.readInt(); buf.readInt();
        buf.readFloat(); buf.readFloat(); buf.readFloat(); buf.readFloat();
        ops.push_back(std::move(op));
    }
};

// ── LayoutImage (234) ─────────────────────────────────────────────────
class LayoutImage : public Operation {
public:
    int componentId = 0, animationId = 0;
    int imageId = 0, contentScale = 0;
    float aspectRatio = 1.0f;

    std::string name() const override { return "LAYOUT_IMAGE"; }
    int opcode() const override { return 234; }
    std::vector<Field> fields() const override { return {}; }
    bool isContainer() const override { return true; }
    void apply(RemoteContext& context) override {
        for (auto& child : mChildren) child->apply(context);
    }
    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<LayoutImage>();
        op->componentId = buf.readInt();
        op->animationId = buf.readInt();
        op->imageId = buf.readInt();
        op->contentScale = buf.readInt();
        op->aspectRatio = buf.readFloat();
        ops.push_back(std::move(op));
    }
};

// ── ColorAttribute (180) ──────────────────────────────────────────────
// Extracts color components (hue, saturation, brightness, RGBA) from a
// color variable and stores the result as a float variable.
class ColorAttributeOp : public Operation {
public:
    int mId = 0;         // output variable ID
    int mColorId = 0;    // source color ID
    int mType = 0;       // component type

    static constexpr int COLOR_HUE = 0;
    static constexpr int COLOR_SATURATION = 1;
    static constexpr int COLOR_BRIGHTNESS = 2;
    static constexpr int COLOR_RED = 3;
    static constexpr int COLOR_GREEN = 4;
    static constexpr int COLOR_BLUE = 5;
    static constexpr int COLOR_ALPHA = 6;

    std::string name() const override { return "ColorAttribute"; }
    int opcode() const override { return 180; }
    std::vector<Field> fields() const override { return {}; }

    void apply(RemoteContext& context) override {
        int color = context.getColor(mColorId);
        int a = (color >> 24) & 0xFF;
        int r = (color >> 16) & 0xFF;
        int g = (color >> 8) & 0xFF;
        int b = color & 0xFF;
        float result = 0.0f;
        int val = mType & 255;
        switch (val) {
            case COLOR_HUE: {
                // Convert to HSB and extract hue
                float rf = r / 255.0f, gf = g / 255.0f, bf = b / 255.0f;
                float maxC = std::max({rf, gf, bf});
                float minC = std::min({rf, gf, bf});
                float delta = maxC - minC;
                if (delta == 0) { result = 0; }
                else if (maxC == rf) { result = 60.0f * std::fmod((gf - bf) / delta, 6.0f); }
                else if (maxC == gf) { result = 60.0f * ((bf - rf) / delta + 2.0f); }
                else { result = 60.0f * ((rf - gf) / delta + 4.0f); }
                if (result < 0) result += 360.0f;
                break;
            }
            case COLOR_SATURATION: {
                float rf = r / 255.0f, gf = g / 255.0f, bf = b / 255.0f;
                float maxC = std::max({rf, gf, bf});
                float minC = std::min({rf, gf, bf});
                result = (maxC == 0) ? 0 : (maxC - minC) / maxC;
                break;
            }
            case COLOR_BRIGHTNESS: {
                result = std::max({r, g, b}) / 255.0f;
                break;
            }
            case COLOR_RED:   result = r / 255.0f; break;
            case COLOR_GREEN: result = g / 255.0f; break;
            case COLOR_BLUE:  result = b / 255.0f; break;
            case COLOR_ALPHA: result = a / 255.0f; break;
        }
        context.loadFloat(mId, result);
    }

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ColorAttributeOp>();
        op->mId = buf.readInt();
        op->mColorId = buf.readInt();
        op->mType = buf.readShort();
        ops.push_back(std::move(op));
    }
};

// ── BitmapFontData (167) ──────────────────────────────────────────────
// Stores bitmap font glyph data. Currently a parse-only stub.
class BitmapFontDataOp : public Operation {
public:
    std::string name() const override { return "BitmapFontData"; }
    int opcode() const override { return 167; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<BitmapFontDataOp>();
        buf.readInt();  // id
        int versionAndCount = buf.readInt();
        int numGlyphs = versionAndCount & 0xFFFF;
        int version = (versionAndCount >> 16) & 0xFFFF;
        for (int i = 0; i < numGlyphs; i++) {
            buf.readUTF8();   // chars
            buf.readInt();    // bitmapId
            buf.readShort();  // marginLeft
            buf.readShort();  // marginTop
            buf.readShort();  // marginRight
            buf.readShort();  // marginBottom
            buf.readShort();  // bitmapWidth
            buf.readShort();  // bitmapHeight
        }
        if (version >= 1) {  // VERSION_2 has kerning table
            int numKerning = buf.readShort();
            for (int i = 0; i < numKerning; i++) {
                buf.readUTF8();   // glyph pair
                buf.readShort();  // adjustment
            }
        }
        ops.push_back(std::move(op));
    }
};

// ── DrawBitmapFontText (48) ───────────────────────────────────────────
// Draws text using a bitmap font. Currently a parse-only stub.
class DrawBitmapFontTextOp : public Operation {
public:
    std::string name() const override { return "DrawBitmapFontText"; }
    int opcode() const override { return 48; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<DrawBitmapFontTextOp>();
        int textId = buf.readInt();
        if ((textId & 0x80000000) != 0) {
            buf.readFloat();  // glyphSpacing (conditional)
        }
        buf.readInt();    // bitmapFontID
        buf.readInt();    // start
        buf.readInt();    // end
        buf.readFloat();  // x
        buf.readFloat();  // y
        ops.push_back(std::move(op));
    }
};

// ── HapticFeedback (177) ──────────────────────────────────────────────
// Parse-only stub — haptic feedback is a host-side effect, no rendering.
class HapticFeedbackOp : public Operation {
public:
    int type = 0;
    std::string name() const override { return "HAPTIC_FEEDBACK"; }
    int opcode() const override { return 177; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<HapticFeedbackOp>();
        op->type = buf.readInt();
        ops.push_back(std::move(op));
    }
};

// ── WakeIn (191) ──────────────────────────────────────────────────────
// Parse-only stub — wake timer is a host-side scheduling effect.
class WakeInOp : public Operation {
public:
    float wake = 0;
    std::string name() const override { return "WAKE_IN"; }
    int opcode() const override { return 191; }
    std::vector<Field> fields() const override { return {}; }
    void apply(RemoteContext& context) override {}

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<WakeInOp>();
        op->wake = buf.readFloat();
        ops.push_back(std::move(op));
    }
};

// ── ImageAttribute (171) ──────────────────────────────────────────────
// PaintOperation: extracts image metadata (width, height) into float variables.
class ImageAttributeOp : public Operation {
public:
    static constexpr int IMAGE_WIDTH = 0;
    static constexpr int IMAGE_HEIGHT = 1;

    int id = 0, imageId = 0;
    int16_t type = 0;
    std::vector<int> args;

    std::string name() const override { return "ImageAttribute"; }
    int opcode() const override { return 171; }
    std::vector<Field> fields() const override { return {}; }
    bool isPaintOperation() const override { return true; }

    void apply(RemoteContext& context) override {
        auto* dim = context.getBitmapDim(imageId);
        if (!dim) return;
        switch (type) {
            case IMAGE_WIDTH:
                context.loadFloat(id, static_cast<float>(dim->width));
                break;
            case IMAGE_HEIGHT:
                context.loadFloat(id, static_cast<float>(dim->height));
                break;
        }
    }

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<ImageAttributeOp>();
        op->id = buf.readInt();
        op->imageId = buf.readInt();
        op->type = static_cast<int16_t>(buf.readShort());
        int len = buf.readShort();
        for (int i = 0; i < len; i++) {
            op->args.push_back(buf.readInt());
        }
        ops.push_back(std::move(op));
    }
};

// ── TimeAttribute (172) ───────────────────────────────────────────────
// PaintOperation: extracts time components into float variables.
class TimeAttributeOp : public Operation {
public:
    static constexpr int TIME_FROM_NOW_SEC = 0;
    static constexpr int TIME_FROM_NOW_MIN = 1;
    static constexpr int TIME_FROM_NOW_HR  = 2;
    static constexpr int TIME_FROM_ARG_SEC = 3;
    static constexpr int TIME_FROM_ARG_MIN = 4;
    static constexpr int TIME_FROM_ARG_HR  = 5;
    static constexpr int TIME_IN_SEC       = 6;
    static constexpr int TIME_IN_MIN       = 7;
    static constexpr int TIME_IN_HR        = 8;
    static constexpr int TIME_DAY_OF_MONTH = 9;
    static constexpr int TIME_MONTH_VALUE  = 10;
    static constexpr int TIME_DAY_OF_WEEK  = 11;
    static constexpr int TIME_YEAR         = 12;
    static constexpr int TIME_FROM_LOAD_SEC = 14;
    static constexpr int TIME_DAY_OF_YEAR  = 15;

    int id = 0, timeId = 0;
    int16_t type = 0;
    std::vector<int> args;
    std::string name() const override { return "TIME_ATTRIBUTE"; }
    int opcode() const override { return 172; }
    std::vector<Field> fields() const override { return {}; }
    bool isPaintOperation() const override { return true; }
    void apply(RemoteContext& context) override;

    static void read(WireBuffer& buf, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<TimeAttributeOp>();
        op->id = buf.readInt();
        op->timeId = buf.readInt();
        op->type = static_cast<int16_t>(buf.readShort());
        int len = buf.readShort();
        for (int i = 0; i < len; i++) {
            op->args.push_back(buf.readInt());
        }
        ops.push_back(std::move(op));
    }
};

} // namespace rccore
