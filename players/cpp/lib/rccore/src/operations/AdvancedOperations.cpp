#include "rccore/operations/AdvancedOperations.h"
#include "rccore/RemoteContext.h"
#include "rccore/PaintContext.h"
#include "rccore/ExpressionEvaluator.h"
#include "rccore/Utils.h"

#include <sstream>
#include <iomanip>
#include <cmath>
#include <chrono>
#include <ctime>
#include <algorithm>
#include <cctype>

namespace rccore {

// Thread-local evaluator
static ExpressionEvaluator& getEvaluator() {
    static ExpressionEvaluator eval;
    return eval;
}

// Simple CollectionsAccess backed by RemoteContext float lists
class ContextCollections : public CollectionsAccess {
public:
    explicit ContextCollections(const RemoteContext& ctx) : mCtx(ctx) {}
    const std::vector<float>* getFloats(int id) const override {
        return mCtx.getFloatList(id);
    }
private:
    const RemoteContext& mCtx;
};

// ── Resolve a NaN-encoded float to its value from context ─────────────
static float resolveExprVal(float v, const RemoteContext& ctx) {
    if (Utils::isVariable(v)) {
        return ctx.getFloat(Utils::idFromNan(v));
    }
    return v;
}

// ── Helper: scan expression array for NaN variable refs, register ─────
static void registerExpressionVars(const std::vector<float>& expr,
                                    RemoteContext& context, Operation* owner) {
    for (float v : expr) {
        if (std::isnan(v)
            && !ExpressionEvaluator::isMathOperator(v)
            && !ExpressionEvaluator::isDataVariable(v)) {
            int id = Utils::idFromNan(v);
            if (id > 0) {
                context.listensTo(id, owner);
            }
        }
    }
}

// ── registerListening implementations ────────────────────────────────

void FloatExpression::registerListening(RemoteContext& context) {
    registerExpressionVars(expression, context, this);
}

void ColorExpressionOp::registerListening(RemoteContext& context) {
    // Scan all NaN-encoded float fields
    auto reg = [&](float v) {
        if (std::isnan(v)) {
            context.listensTo(Utils::idFromNan(v), this);
        }
    };
    if (mode == 4) { // HSV
        reg(hue); reg(sat); reg(val);
    } else if (mode == 5) { // ARGB
        reg(argbAlpha); reg(argbRed); reg(argbGreen); reg(argbBlue);
    } else { // Interpolation modes
        reg(tween);
        // For ID modes, register color ID dependencies
        if ((mode & 1) == 1) context.listensTo(color1, this);
        if ((mode & 2) == 2) context.listensTo(color2, this);
    }
}

void IntegerExpressionOp::registerListening(RemoteContext& context) {
    for (size_t i = 0; i < srcValues.size(); i++) {
        if (IntegerExpressionEvaluator::isId(mask, (int)i, srcValues[i])) {
            context.listensTo(srcValues[i], this);
        }
    }
}

void TextFromFloat::registerListening(RemoteContext& context) {
    if (std::isnan(floatId)) {
        context.listensTo(Utils::idFromNan(floatId), this);
    }
}

void TouchExpressionOp::registerListening(RemoteContext& context) {
    // Register expression variable dependencies
    registerExpressionVars(expression, context, this);
    // Register min/max/defValue NaN refs
    if (std::isnan(max)) {
        context.listensTo(Utils::idFromNan(max), this);
    }
    if (std::isnan(min)) {
        context.listensTo(Utils::idFromNan(min), this);
    }
    if (std::isnan(startValue)) {
        context.listensTo(Utils::idFromNan(startValue), this);
    }
    // Register stop spec NaN refs
    for (float v : stopsData) {
        if (std::isnan(v)) {
            context.listensTo(Utils::idFromNan(v), this);
        }
    }
    // Register as a touch listener
    context.addTouchListener(this);
}

// ── FloatExpression ────────────────────────────────────────────────────
// Matches Java FloatExpression.updateVariables()
void FloatExpression::updateVariables(RemoteContext& context) {
    if (preCalcValues.size() != expression.size()) {
        preCalcValues.resize(expression.size());
    }

    bool value_changed = false;
    for (size_t i = 0; i < expression.size(); i++) {
        float v = expression[i];
        if (std::isnan(v)
            && !ExpressionEvaluator::isMathOperator(v)
            && !ExpressionEvaluator::isDataVariable(v)) {
            int vid = Utils::idFromNan(v);
            float newValue = context.getFloat(vid);
            // Match Java: density fallback
            if (vid == RemoteContext::ID_DENSITY && newValue == 0.0f) {
                newValue = 1.0f;
            }
            if (mFloatAnimation || mSpring) {
                if (preCalcValues[i] != newValue) {
                    value_changed = true;
                    preCalcValues[i] = newValue;
                }
            } else {
                preCalcValues[i] = newValue;
            }
        } else {
            preCalcValues[i] = expression[i];
        }
    }

    // If inputs changed, re-evaluate expression to see if output changed
    float v = mLastCalculatedValue;
    if (value_changed) {
        ContextCollections ca(context);
        v = getEvaluator().eval(context, &ca,
                                preCalcValues.data(), (int)preCalcValues.size());
        if (v != mLastCalculatedValue) {
            mLastChange = context.getAnimationTime();
            mLastCalculatedValue = v;
        } else {
            value_changed = false;
        }
    }

    // Trigger animation target update when expression output changes
    if (value_changed && mFloatAnimation) {
        if (std::isnan(mFloatAnimation->getTargetValue())) {
            mFloatAnimation->setInitialValue(v);
        } else {
            mFloatAnimation->setInitialValue(mFloatAnimation->getTargetValue());
        }
        mFloatAnimation->setTargetValue(v);
    } else if (value_changed && mSpring) {
        mSpring->setTargetValue(v);
    }
}

// Matches Java FloatExpression.apply()
void FloatExpression::apply(RemoteContext& context) {
    if (expression.empty()) return;

    float t = context.getAnimationTime();
    if (std::isnan(mLastChange)) {
        mLastChange = t;
    }

    if (mFloatAnimation) {
        // ── Path A: FloatAnimation (easing curve) ──
        if (std::isnan(mLastCalculatedValue)) {
            // Startup: evaluate expression for initial value
            if (preCalcValues.size() != expression.size()) {
                preCalcValues.resize(expression.size());
                for (size_t i = 0; i < expression.size(); i++) {
                    float v = expression[i];
                    if (std::isnan(v)
                        && !ExpressionEvaluator::isMathOperator(v)
                        && !ExpressionEvaluator::isDataVariable(v)) {
                        preCalcValues[i] = context.getFloat(Utils::idFromNan(v));
                    } else {
                        preCalcValues[i] = v;
                    }
                }
            }
            ContextCollections ca(context);
            mLastCalculatedValue = getEvaluator().eval(context, &ca,
                preCalcValues.data(), (int)preCalcValues.size());
            mFloatAnimation->setTargetValue(mLastCalculatedValue);
            if (std::isnan(mFloatAnimation->getInitialValue())) {
                mFloatAnimation->setInitialValue(mLastCalculatedValue);
            }
        }
        float lastComputedValue = mFloatAnimation->get(t - mLastChange);

        if (lastComputedValue != mLastAnimatedValue
                || t - mLastChange <= mFloatAnimation->getDuration()) {
            mLastAnimatedValue = lastComputedValue;
            context.loadFloat(id, lastComputedValue);
            context.needsRepaint();
            markDirty();
        }
    } else if (mSpring) {
        // ── Path B: SpringStopEngine (physics) ──
        float lastComputedValue = mSpring->get(t);
        float epsilon = 0.01f;
        if (lastComputedValue != mLastAnimatedValue
                || std::abs(mSpring->getTargetValue() - lastComputedValue) > epsilon) {
            mLastAnimatedValue = lastComputedValue;
            context.loadFloat(id, lastComputedValue);
            context.needsRepaint();
        }
    } else {
        // ── Path C: Static expression (no animation) ──
        if (preCalcValues.size() != expression.size()) {
            preCalcValues.resize(expression.size());
            for (size_t i = 0; i < expression.size(); i++) {
                float v = expression[i];
                if (std::isnan(v)
                    && !ExpressionEvaluator::isMathOperator(v)
                    && !ExpressionEvaluator::isDataVariable(v)) {
                    preCalcValues[i] = context.getFloat(Utils::idFromNan(v));
                } else {
                    preCalcValues[i] = v;
                }
            }
        }
        ContextCollections ca(context);
        float result = getEvaluator().eval(context, &ca,
                                            preCalcValues.data(), (int)preCalcValues.size());
        context.loadFloat(id, result);
    }
}

// ── ColorExpression ────────────────────────────────────────────────────
void ColorExpressionOp::updateVariables(RemoteContext& context) {
    if (mode == 4) { // HSV
        oHue = std::isnan(hue) ? context.getFloat(Utils::idFromNan(hue)) : hue;
        oSat = std::isnan(sat) ? context.getFloat(Utils::idFromNan(sat)) : sat;
        oVal = std::isnan(val) ? context.getFloat(Utils::idFromNan(val)) : val;
    }
    if (mode == 5) { // ARGB (including normalized IDARGB)
        oArgbAlpha = std::isnan(argbAlpha) ? context.getFloat(Utils::idFromNan(argbAlpha)) : argbAlpha;
        oArgbRed = std::isnan(argbRed) ? context.getFloat(Utils::idFromNan(argbRed)) : argbRed;
        oArgbGreen = std::isnan(argbGreen) ? context.getFloat(Utils::idFromNan(argbGreen)) : argbGreen;
        oArgbBlue = std::isnan(argbBlue) ? context.getFloat(Utils::idFromNan(argbBlue)) : argbBlue;
    }
    if (std::isnan(tween)) {
        oTween = context.getFloat(Utils::idFromNan(tween));
    } else {
        oTween = tween;
    }
    if ((mode & 1) == 1) {
        oColor1 = context.getColor(color1);
    } else {
        oColor1 = color1;
    }
    if ((mode & 2) == 2) {
        oColor2 = context.getColor(color2);
    } else {
        oColor2 = color2;
    }
}

void ColorExpressionOp::apply(RemoteContext& context) {
    // Resolve variables (in case updateVariables wasn't called)
    updateVariables(context);

    if (mode == 4) { // HSV
        context.loadColor(id, (alpha << 24) | (0xFFFFFF & Utils::hsvToRgb(oHue, oSat, oVal)));
        return;
    }
    if (mode == 5) { // ARGB
        context.loadColor(id, Utils::toARGB(oArgbAlpha, oArgbRed, oArgbGreen, oArgbBlue));
        return;
    }
    // Interpolation modes (0-3)
    if (oTween == 0.0f) {
        context.loadColor(id, oColor1);
    } else {
        context.loadColor(id, Utils::interpolateColor(oColor1, oColor2, oTween));
    }
}

// ── IntegerExpression ──────────────────────────────────────────────────
void IntegerExpressionOp::updateVariables(RemoteContext& context) {
    if (preCalcValues.size() != srcValues.size()) {
        preCalcValues.resize(srcValues.size());
    }
    for (size_t i = 0; i < srcValues.size(); i++) {
        if (IntegerExpressionEvaluator::isId(mask, (int)i, srcValues[i])) {
            preCalcValues[i] = context.getInteger(srcValues[i]);
        } else {
            preCalcValues[i] = srcValues[i];
        }
    }
}

void IntegerExpressionOp::apply(RemoteContext& context) {
    if (srcValues.empty()) return;
    updateVariables(context);
    // Build preMask: clear bits for resolved IDs so evaluator treats them as values
    int preMask = mask;
    for (size_t i = 0; i < srcValues.size(); i++) {
        if (IntegerExpressionEvaluator::isId(mask, (int)i, srcValues[i])) {
            preMask &= ~(1 << i);
        }
    }
    int result = mExp.eval(preMask, preCalcValues.data(), (int)preCalcValues.size());
    context.loadInteger(id, result);
}

// ── TextFromFloat ──────────────────────────────────────────────────────
void TextFromFloat::updateVariables(RemoteContext& context) {
    if (std::isnan(floatId)) {
        oValue = context.getFloat(Utils::idFromNan(floatId));
    }
}

// Flag bit layout (matching TS TextFromFloat.ts):
// AA (bits 0-1): PAD_AFTER  (0=SPACE, 1=NONE, 3=ZERO)
// PP (bits 2-3): PAD_PRE    (0=SPACE, 4=NONE, 12=ZERO)
// GG (bits 4-5): GROUPING   (0=NONE, 16=BY3, 32=BY4, 48=BY32)
// SS (bits 6-7): SEPARATOR  (0=COMMA_PERIOD, 64=PERIOD_COMMA, 128=SPACE_COMMA, 192=UNDER_PERIOD)
// OO (bits 8-9): OPTIONS    (256=NEG_PARENS, 512=ROUNDING)
// L  (bit 10):   LEGACY_MODE (1024)

static std::string floatToStringImpl(float value, int beforeDP, int afterDP,
                                     int pre, int post, int grouping, int separator, int options) {
    char groupSep = ',', decSep = '.';
    switch (separator) {
        case 1: groupSep = '.'; decSep = ','; break;
        case 2: groupSep = ' '; decSep = ','; break;
        case 3: groupSep = '_'; decSep = '.'; break;
    }
    bool useParens = (options & 1) != 0;
    bool isNeg = value < 0;
    if (isNeg) value = -value;

    // Separate integer and fractional parts
    int intPart = (int)value;
    float fracPart = value - intPart;

    // Convert integer part to string
    std::string intStr;
    if (intPart == 0) {
        intStr = "0";
    } else {
        int tmp = intPart;
        while (tmp > 0) {
            intStr = char('0' + (tmp % 10)) + intStr;
            tmp /= 10;
        }
    }

    // Apply grouping
    if (grouping > 0) {
        int step = (grouping == 1) ? 3 : (grouping == 2) ? 4 : 3;
        int len = (int)intStr.size();
        if (grouping == 3) {
            // BY32: first group of 3, then groups of 2
            for (int i = len - 3; i > 0; i -= 2) {
                intStr.insert(i, 1, groupSep);
            }
        } else {
            for (int i = len - step; i > 0; i -= step) {
                intStr.insert(i, 1, groupSep);
            }
        }
    }

    // Pad integer part
    int iLen = (int)intStr.size();
    if (iLen < beforeDP && pre != 0) {
        intStr = std::string(beforeDP - iLen, (char)pre) + intStr;
    } else if (iLen > beforeDP && beforeDP > 0) {
        intStr = intStr.substr(iLen - beforeDP);
    }

    if (afterDP == 0) {
        if (!isNeg) return intStr;
        if (useParens) return "(" + intStr + ")";
        return "-" + intStr;
    }

    // Convert fractional part — match TS/Java approach
    // Scale fractional part to integer, then extract digits
    float fracScaled = fracPart;
    for (int i = 0; i < afterDP; i++) fracScaled *= 10;
    int fracInt = (int)std::round(fracScaled);
    for (int i = 0; i < afterDP; i++) fracScaled *= 0.1f;

    // Use toString approach matching TS: float to string, extract after decimal
    std::string fact;
    {
        float ff = fracPart;
        for (int i = 0; i < afterDP; i++) ff *= 10;
        ff = std::round(ff);
        for (int i = 0; i < afterDP; i++) ff *= 0.1f;

        std::ostringstream oss;
        oss << ff;
        std::string fs = oss.str();
        auto dotPos = fs.find('.');
        if (dotPos != std::string::npos) {
            fact = fs.substr(dotPos + 1);
            if ((int)fact.size() > afterDP) fact = fact.substr(0, afterDP);
        } else {
            fact = "0";
        }
    }

    // Trim trailing zeros (keep at least 1 digit like TS full mode: i > 0)
    while (fact.size() > 1 && fact.back() == '0') {
        fact.pop_back();
    }

    // Pad after
    if (post != 0 && (int)fact.size() < afterDP) {
        fact += std::string(afterDP - fact.size(), (char)post);
    }

    std::string result;
    if (isNeg) {
        if (useParens) result = "(";
        else result = "-";
    }
    result += intStr + decSep + fact;
    if (isNeg && useParens) result += ")";
    return result;
}

void TextFromFloat::apply(RemoteContext& context) {
    // Runs in ALL modes (not just DATA) — TS apply() has no mode check.
    float val = oValue;

    // Decode flags
    int padAfter = 0;
    switch (flags & 3) {
        case 0: padAfter = 0x20; break; // PAD_SPACE
        case 1: padAfter = 0; break;    // PAD_NONE
        case 3: padAfter = 0x30; break; // PAD_ZERO
    }
    int padBefore = 0;
    switch (flags & 12) {
        case 0: padBefore = 0x20; break;  // PAD_SPACE
        case 4: padBefore = 0; break;     // PAD_NONE
        case 12: padBefore = 0x30; break; // PAD_ZERO
    }
    int group = 0;
    switch (flags & 48) {
        case 16: group = 1; break; // GROUPING_BY3
        case 32: group = 2; break; // GROUPING_BY4
        case 48: group = 3; break; // GROUPING_BY32
    }
    int sep = (flags >> 6) & 3;
    int opts = (flags >> 8) & 3;
    bool legacy = (flags & 1024) != 0;

    std::string result;
    if (legacy) {
        // Legacy mode: simpler formatting without grouping
        result = floatToStringImpl(val, digitsBefore, digitsAfter, padBefore, padAfter, 0, 0, 0);
    } else {
        result = floatToStringImpl(val, digitsBefore, digitsAfter, padBefore, padAfter, group, sep, opts);
    }
    context.loadText(textId, result);
}

// ── TextMerge ──────────────────────────────────────────────────────────
void TextMerge::apply(RemoteContext& context) {
    // TS: no mode check — runs in ALL modes
    std::string result = context.getText(srcId1) + context.getText(srcId2);
    context.loadText(destId, result);
}

// ── TextLookup ─────────────────────────────────────────────────────────
void TextLookupOp::apply(RemoteContext& context) {
    // TS: no mode check — runs in ALL modes
    float idx = Utils::isVariable(index) ? context.getFloat(Utils::idFromNan(index)) : index;
    // Look up the text ID from the DataListIds collection, then resolve to text
    const auto* list = context.getFloatList(dataSet);
    if (list) {
        int i = static_cast<int>(idx);
        if (i >= 0 && i < static_cast<int>(list->size())) {
            int textId = static_cast<int>((*list)[i]);
            if (textId >= 0) {
                std::string text = context.getText(textId);
                context.loadText(id, text);
                return;
            }
        }
    }
    // Fallback: just use the index as text
    context.loadText(id, std::to_string((int)idx));
}

// ── TextTransform ──────────────────────────────────────────────────────
void TextTransformOp::apply(RemoteContext& context) {
    std::string text = context.getText(srcId);

    // Apply start/len substring extraction (matching TS)
    int startIdx = std::isnan(start) ? 0 : (int)start;
    int length = (std::isnan(len) || len == -1.0f) ? (int)text.length() : (int)len;
    if (startIdx > 0 || length < (int)text.length()) {
        if (startIdx < (int)text.length()) {
            text = text.substr(startIdx, length);
        } else {
            text = "";
        }
    }

    switch (operation) {
        case 1: // TEXT_TO_LOWERCASE
            for (auto& c : text) c = std::tolower((unsigned char)c);
            break;
        case 2: // TEXT_TO_UPPERCASE
            for (auto& c : text) c = std::toupper((unsigned char)c);
            break;
        case 3: // TEXT_TRIM
            {
                size_t s = text.find_first_not_of(" \t\n\r");
                size_t e = text.find_last_not_of(" \t\n\r");
                text = (s == std::string::npos) ? "" : text.substr(s, e - s + 1);
            }
            break;
        case 4: // TEXT_CAPITALIZE (first char of each word)
            {
                bool wordStart = true;
                for (size_t i = 0; i < text.size(); i++) {
                    if (std::isspace((unsigned char)text[i])) {
                        wordStart = true;
                    } else if (wordStart) {
                        text[i] = std::toupper((unsigned char)text[i]);
                        wordStart = false;
                    }
                }
            }
            break;
        case 5: // TEXT_UPPERCASE_FIRST_CHAR
            if (!text.empty()) {
                text[0] = std::toupper((unsigned char)text[0]);
            }
            break;
        default:
            break;
    }
    context.loadText(destId, text);
}

// ── ComponentValue ─────────────────────────────────────────────────────
void ComponentValueOp::apply(RemoteContext& context) {
    // No mode check — runs in ALL modes matching TS
    {
        // Look up measured dimensions for the referenced component
        auto* dim = context.getComponentDimension(componentId);
        if (dim) {
            switch (type) {
                case 0: context.loadFloat(valueId, dim->w); break;   // WIDTH
                case 1: context.loadFloat(valueId, dim->h); break;   // HEIGHT
                case 2: context.loadFloat(valueId, dim->x); break;   // POS_X
                case 3: context.loadFloat(valueId, dim->y); break;   // POS_Y
                case 4: context.loadFloat(valueId, dim->x); break;   // POS_ROOT_X (simplified)
                case 5: context.loadFloat(valueId, dim->y); break;   // POS_ROOT_Y (simplified)
                case 6: context.loadFloat(valueId, dim->w); break;   // CONTENT_WIDTH
                case 7: context.loadFloat(valueId, dim->h); break;   // CONTENT_HEIGHT
                default: context.loadFloat(valueId, 0.0f); break;
            }
        } else {
            // No measurement yet - load 1.0f as placeholder
            context.loadFloat(valueId, 1.0f);
        }
    }
}

// ── DataListFloat ──────────────────────────────────────────────────────
void DataListFloat::apply(RemoteContext& context) {
    // No mode check — matches TS (runs in ALL modes)
    context.loadFloatList(id, data);
}

// ── DataListIds ────────────────────────────────────────────────────────
void DataListIds::apply(RemoteContext& context) {
    // No mode check — matches TS (runs in ALL modes)
    std::vector<float> floats(ids.begin(), ids.end());
    context.loadFloatList(id, floats);
}

// ── TouchExpression ────────────────────────────────────────────────────

void TouchExpressionOp::updateVariables(RemoteContext& context) {
    // Ensure preCalcValues and mOutStopSpec are sized
    if (preCalcValues.size() != expression.size()) {
        preCalcValues.resize(expression.size());
    }
    if (mOutStopSpec.size() != stopsData.size()) {
        mOutStopSpec.resize(stopsData.size());
    }

    // Resolve NaN refs in min/max/defValue
    if (std::isnan(max)) {
        mOutMax = context.getFloat(Utils::idFromNan(max));
    }
    if (std::isnan(min)) {
        mOutMin = context.getFloat(Utils::idFromNan(min));
    }
    if (std::isnan(startValue)) {
        mOutDefValue = context.getFloat(Utils::idFromNan(startValue));
    }

    // Resolve expression NaN refs → preCalcValues
    for (size_t i = 0; i < expression.size(); i++) {
        float v = expression[i];
        if (std::isnan(v)
            && !ExpressionEvaluator::isMathOperator(v)
            && !ExpressionEvaluator::isDataVariable(v)) {
            preCalcValues[i] = context.getFloat(Utils::idFromNan(v));
        } else {
            preCalcValues[i] = v;
        }
    }

    // Resolve stop spec NaN refs
    for (size_t i = 0; i < stopsData.size(); i++) {
        float v = stopsData[i];
        if (std::isnan(v)) {
            mOutStopSpec[i] = context.getFloat(Utils::idFromNan(v));
        } else {
            mOutStopSpec[i] = v;
        }
    }
}

float TouchExpressionOp::wrap(float pos) const {
    if (!mWrapMode) return pos;
    pos = std::fmod(pos, mOutMax);
    if (pos < 0) pos += mOutMax;
    return pos;
}

float TouchExpressionOp::getStopPosition(float pos, float slope) const {
    float target = pos + slope / 2.0f;
    float minVal = mWrapMode ? 0.0f : mOutMin;

    if (mWrapMode) {
        // wrap pos then compute target
        float wPos = std::fmod(pos, mOutMax);
        if (wPos < 0) wPos += mOutMax;
        target = wPos + slope / 2.0f;
    } else {
        target = std::max(std::min(target, mOutMax), mOutMin);
    }

    switch (stopMode) {
        case STOP_ENDS:
            return ((pos + slope) > (mOutMax + minVal) / 2.0f) ? mOutMax : minVal;

        case STOP_INSTANTLY:
            return pos;

        case STOP_NOTCHES_EVEN:
        case STOP_NOTCHES_SINGLE_EVEN: {
            int evenSpacing = static_cast<int>(mOutStopSpec[0]);
            float notchMax = (mOutStopSpec.size() > 1) ? mOutStopSpec[1] : mOutMax;
            float step = (notchMax - minVal) / static_cast<float>(evenSpacing);
            float notch = minVal + step * static_cast<int>(0.5f + (target - mOutMin) / step);
            if (stopMode == STOP_NOTCHES_SINGLE_EVEN) {
                notch = std::min(mMaxAtDown, notch);
                notch = std::max(mMinAtDown, notch);
            }
            if (!mWrapMode) {
                notch = std::max(std::min(notch, mOutMax), minVal);
            }
            return notch;
        }

        case STOP_NOTCHES_PERCENTS: {
            float minPos = minVal;
            float minPosDist = std::abs(mOutMin - target);
            for (size_t i = 0; i < stopsData.size(); i++) {
                float p = mOutMin + stopsData[i] * (mOutMax - mOutMin);
                float dist = std::abs(p - target);
                if (minPosDist > dist) {
                    minPosDist = dist;
                    minPos = p;
                }
            }
            return minPos;
        }

        case STOP_NOTCHES_ABSOLUTE: {
            float minPos = mOutMin;
            float minPosDist = std::abs(mOutMin - target);
            for (size_t i = 0; i < stopsData.size(); i++) {
                float dist = std::abs(stopsData[i] - target);
                if (minPosDist > dist) {
                    minPosDist = dist;
                    minPos = stopsData[i];
                }
            }
            return minPos;
        }

        case STOP_GENTLY:
        default:
            return target;
    }
}

void TouchExpressionOp::apply(RemoteContext& context) {
    // Update screen bounds from the current canvas bounds in the context.
    if (context.getMode() == ContextMode::PAINT) {
        auto& cb = context.currentCanvasBounds();
        mScrLeft = cb.x;
        mScrTop = cb.y;
        mScrRight = cb.x + cb.w;
        mScrBottom = cb.y + cb.h;
    }
    if (context.getMode() != ContextMode::DATA) return;


    // Path 1: unmodified — load default value
    if (mUnmodified) {
        mCurrentValue = mOutDefValue;
        context.loadFloat(id, wrap(mCurrentValue));
        return;
    }

    // Path 2: easing to stop after touch-up
    if (mEasingToStop) {
        float time = context.getAnimationTime() - mTouchUpTime;
        float value = mEasyTouch.getPos(time);
        mCurrentValue = value;
        if (mWrapMode) {
            value = wrap(value);
        } else {
            value = std::min(std::max(value, mOutMin), mOutMax);
        }
        context.loadFloat(id, value);
        if (mEasyTouch.getDuration() < time) {
            mEasingToStop = false;
        }
        context.needsRepaint();
        return;
    }

    // Path 3: touch down — evaluate expression
    if (mTouchDown) {
        // Refresh preCalcValues when dirty (touch pos changed) or uninitialized
        if (isDirty() || preCalcValues.size() != expression.size()) {
            updateVariables(context);
            markNotDirty();
        }
        ContextCollections ca(context);
        float value = mExp.eval(context, &ca, preCalcValues.data(),
                                static_cast<int>(preCalcValues.size()));
        if (mMode == 0) {
            // Delta mode: output = valueAtDown + (currentExpr - exprAtDown)
            value = mValueAtDown + (value - mDownTouchValue);
        }
        if (mWrapMode) {
            value = wrap(value);
        } else {
            value = std::min(std::max(value, mOutMin), mOutMax);
        }
        mCurrentValue = value;
    }

    // Single-step notch clamp
    if (stopMode == STOP_NOTCHES_SINGLE_EVEN) {
        mCurrentValue = std::min(mMaxAtDown, mCurrentValue);
        mCurrentValue = std::max(mMinAtDown, mCurrentValue);
    }
    if (!mWrapMode) {
        if (!std::isnan(mOutMin)) mCurrentValue = std::max(mCurrentValue, mOutMin);
        if (!std::isnan(mOutMax)) mCurrentValue = std::min(mCurrentValue, mOutMax);
    }
    context.loadFloat(id, wrap(mCurrentValue));
}

void TouchExpressionOp::touchDown(RemoteContext& context, float x, float y) {
    // Hit-test: only respond if touch is within the containing canvas bounds
    if (!(x >= mScrLeft && x <= mScrRight && y >= mScrTop && y <= mScrBottom)) {
        return;
    }
    mEasingToStop = false;
    mTouchDown = true;
    mUnmodified = false;

    // Ensure preCalcValues is populated and up-to-date
    if (isDirty() || preCalcValues.size() != expression.size()) {
        updateVariables(context);
        markNotDirty();
    }

    if (mMode == 0) {
        // Delta mode: remember current displayed value and expression value at down
        mValueAtDown = context.getFloat(id);

        if (stopMode == STOP_NOTCHES_SINGLE_EVEN && !mOutStopSpec.empty()) {
            float minVal = mWrapMode ? 0.0f : mOutMin;
            int evenSpacing = static_cast<int>(mOutStopSpec[0]);
            float notchMax = (mOutStopSpec.size() > 1) ? mOutStopSpec[1] : mOutMax;
            float step = (notchMax - minVal) / static_cast<float>(evenSpacing);
            mMaxAtDown = mValueAtDown + step;
            mMinAtDown = mValueAtDown - step;
        }

        ContextCollections ca(context);
        mDownTouchValue = mExp.eval(context, &ca, preCalcValues.data(),
                                    static_cast<int>(preCalcValues.size()));
    }
    context.needsRepaint();
}

void TouchExpressionOp::touchDrag(RemoteContext& context, float /*x*/, float /*y*/) {
    if (!mTouchDown) return;
    apply(context);
    context.needsRepaint();
}

void TouchExpressionOp::touchUp(RemoteContext& context, float x, float y,
                                 float dx, float dy) {
    if (!mTouchDown) return;
    mTouchDown = false;

    if (stopMode == STOP_INSTANTLY) return;

    // Ensure preCalcValues is populated and up-to-date
    if (isDirty() || preCalcValues.size() != expression.size()) {
        updateVariables(context);
        markNotDirty();
    }

    // Calculate current expression value
    ContextCollections ca(context);
    float v = mExp.eval(context, &ca, preCalcValues.data(),
                        static_cast<int>(preCalcValues.size()));

    // Perturb TOUCH_POS_X/Y in preCalcValues by small velocity delta to compute slope
    float dt = 0.0001f;
    std::vector<float> perturbedCalc = preCalcValues;
    for (size_t i = 0; i < perturbedCalc.size(); i++) {
        if (std::isnan(expression[i])) {
            int varId = Utils::idFromNan(expression[i]);
            if (varId == RemoteContext::ID_TOUCH_POS_X) {
                perturbedCalc[i] = x + dx * dt;
            } else if (varId == RemoteContext::ID_TOUCH_POS_Y) {
                perturbedCalc[i] = y + dy * dt;
            }
        }
    }
    float vdt = mExp.eval(context, &ca, perturbedCalc.data(),
                          static_cast<int>(perturbedCalc.size()));
    float slope = (vdt - v) / dt;
    float value = context.getFloat(id);

    mTouchUpTime = context.getAnimationTime();

    float dest = getStopPosition(value, slope);
    float time = std::min(2.0f, mMaxTime * std::abs(dest - value) / (2.0f * mMaxVelocity));
    mEasyTouch.config(value, dest, slope, time, mMaxAcceleration, mMaxVelocity);
    mEasingToStop = true;
    context.needsRepaint();
}

// ── PathExpression registerListening ────────────────────────────────────
void PathExpressionOp::registerListening(RemoteContext& context) {
    registerExpressionVars(expressionX, context, this);
    registerExpressionVars(expressionY, context, this);
    Utils::registerFloatVar(min, context, this);
    Utils::registerFloatVar(max, context, this);
    Utils::registerFloatVar(count, context, this);
}

// ── PathCreate registerListening ───────────────────────────────────────
void PathCreateOp::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(startX, context, this);
    Utils::registerFloatVar(startY, context, this);
}

// ── PathAppend registerListening ───────────────────────────────────────
void PathAppendOp::registerListening(RemoteContext& context) {
    for (float v : data) {
        if (std::isnan(v)) {
            int32_t bits;
            memcpy(&bits, &v, sizeof(bits));
            int nanid = bits & 0x3FFFFF;
            // Skip path commands (10-16)
            if (nanid < 10 || nanid > 16) {
                if (nanid > 0) context.listensTo(nanid, this);
            }
        }
    }
}

// ── MatrixExpression registerListening ──────────────────────────────────
void MatrixExpressionOp::registerListening(RemoteContext& context) {
    registerExpressionVars(expression, context, this);
}

// ── MatrixVectorMath registerListening ──────────────────────────────────
void MatrixVectorMathOp::registerListening(RemoteContext& context) {
    for (float v : inValues) {
        Utils::registerFloatVar(v, context, this);
    }
}

// ── MatrixFromPath registerListening ───────────────────────────────────
void MatrixFromPathOp::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(percent, context, this);
    Utils::registerFloatVar(vOffset, context, this);
}

// ── TextLookup registerListening ───────────────────────────────────────
void TextLookupOp::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(index, context, this);
}

// ── TextTransform registerListening ────────────────────────────────────
void TextTransformOp::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(start, context, this);
    Utils::registerFloatVar(len, context, this);
}

// ── DrawBitmapScaled registerListening + updateVariables ───────────────
void DrawBitmapScaled::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(srcL, context, this);
    Utils::registerFloatVar(srcT, context, this);
    Utils::registerFloatVar(srcR, context, this);
    Utils::registerFloatVar(srcB, context, this);
    Utils::registerFloatVar(dstL, context, this);
    Utils::registerFloatVar(dstT, context, this);
    Utils::registerFloatVar(dstR, context, this);
    Utils::registerFloatVar(dstB, context, this);
    Utils::registerFloatVar(scaleFactor, context, this);
}

void DrawBitmapScaled::updateVariables(RemoteContext& context) {
    oSrcL = Utils::resolveFloat(srcL, context);
    oSrcT = Utils::resolveFloat(srcT, context);
    oSrcR = Utils::resolveFloat(srcR, context);
    oSrcB = Utils::resolveFloat(srcB, context);
    oDstL = Utils::resolveFloat(dstL, context);
    oDstT = Utils::resolveFloat(dstT, context);
    oDstR = Utils::resolveFloat(dstR, context);
    oDstB = Utils::resolveFloat(dstB, context);
    oScaleFactor = Utils::resolveFloat(scaleFactor, context);
}

// ── PathAppend ─────────────────────────────────────────────────────────
void PathAppendOp::updateVariables(RemoteContext& context) {
    oData.resize(data.size());
    for (size_t i = 0; i < data.size(); i++) {
        float v = data[i];
        if (std::isnan(v)) {
            int32_t bits;
            memcpy(&bits, &v, sizeof(bits));
            int nanid = bits & 0x3FFFFF;
            // Path commands (10-17) stay as-is
            if (nanid >= 10 && nanid <= 17) {
                oData[i] = v;
            } else {
                oData[i] = context.getFloat(nanid);
            }
        } else {
            oData[i] = v;
        }
    }
}

void PathAppendOp::apply(RemoteContext& context) {
    if (context.getMode() != ContextMode::PAINT) return;

    // Check for reset command (NaN id 17)
    if (!oData.empty()) {
        float first = oData[0];
        if (std::isnan(first)) {
            int32_t bits;
            memcpy(&bits, &first, sizeof(bits));
            if ((bits & 0x3FFFFF) == 17) {
                // Reset path
                std::vector<float> empty;
                context.loadPathData(id, 0, empty);
                return;
            }
        }
    }
    context.appendPathData(id, oData);
}

// ── PathExpression ─────────────────────────────────────────────────────

// Helper for spline tangent smoothing (matching TS smoothTan)
static void smoothTan(std::vector<float>& d, const std::vector<float>& delta,
                      const std::vector<float>& h, bool loop) {
    int segs = (int)delta.size();
    int n = loop ? segs : segs + 1;
    d.resize(n);
    if (loop) {
        for (int i = 0; i < n; i++) {
            int im = (i - 1 + segs) % segs;
            int ip = i % segs;
            float denom = h[im] + h[ip];
            d[i] = denom > 0 ? (h[im] * delta[ip] + h[ip] * delta[im]) / denom : 0;
        }
    } else {
        d[0] = delta[0];
        d[n - 1] = delta[segs - 1];
        for (int i = 1; i < n - 1; i++) {
            float denom = h[i - 1] + h[i];
            d[i] = denom > 0 ? (h[i - 1] * delta[i] + h[i] * delta[i - 1]) / denom : 0;
        }
    }
}

void PathExpressionOp::apply(RemoteContext& context) {
    // TS: no mode check — runs in ALL modes

    bool loop = (flags & 0x1) != 0;
    bool polar = (flags & 0x8) != 0;
    int countSize = (int)resolveExprVal(count, context);
    if (countSize <= 0) return;

    int winding = (flags & 0x3000000) >> 24;

    // Pre-resolve expressions (like FloatExpression does)
    std::vector<float> resolvedX(expressionX.size());
    for (size_t i = 0; i < expressionX.size(); i++) {
        float v = expressionX[i];
        if (std::isnan(v)
            && !ExpressionEvaluator::isMathOperator(v)
            && !ExpressionEvaluator::isDataVariable(v)) {
            resolvedX[i] = context.getFloat(Utils::idFromNan(v));
        } else {
            resolvedX[i] = v;
        }
    }

    std::vector<float> resolvedY(expressionY.size());
    for (size_t i = 0; i < expressionY.size(); i++) {
        float v = expressionY[i];
        if (std::isnan(v)
            && !ExpressionEvaluator::isMathOperator(v)
            && !ExpressionEvaluator::isDataVariable(v)) {
            resolvedY[i] = context.getFloat(Utils::idFromNan(v));
        } else {
            resolvedY[i] = v;
        }
    }

    // Evaluate X and Y at each point
    float minVal = resolveExprVal(min, context);
    float maxVal = resolveExprVal(max, context);
    float gap = maxVal - minVal;
    float step = loop ? (gap / (float)countSize) : (gap / (float)(countSize - 1));

    auto& eval = getEvaluator();
    ContextCollections ca(context);

    std::vector<float> xData(countSize), yData(countSize);

    if (polar) {
        // Polar mode: exprX is radius function, exprY[0]/[1] are center (cx, cy)
        float cx = resolvedY.size() > 0 ? resolvedY[0] : 0;
        float cy = resolvedY.size() > 1 ? resolvedY[1] : 0;
        for (int i = 0; i < countSize; i++) {
            float angle = minVal + i * step;
            eval.setVar1(angle);
            float r = eval.eval(context, &ca, resolvedX.data(), (int)resolvedX.size());
            xData[i] = cx + r * std::cos(angle);
            yData[i] = cy + r * std::sin(angle);
        }
    } else {
        for (int i = 0; i < countSize; i++) {
            float val = minVal + i * step;
            eval.setVar1(val);
            if (!resolvedX.empty()) {
                xData[i] = eval.eval(context, &ca, resolvedX.data(), (int)resolvedX.size());
            }
            if (!resolvedY.empty()) {
                yData[i] = eval.eval(context, &ca, resolvedY.data(), (int)resolvedY.size());
            }
        }
    }

    // Generate spline path data with proper smoothing (matching TS splinePath)
    // Helper to create NaN-encoded path command
    auto nanCmd = [](int cmd) -> float {
        int32_t bits = 0x7FC00000 | (cmd & 0x3FFFFF);
        float f;
        memcpy(&f, &bits, sizeof(f));
        return f;
    };

    int n = countSize;
    if (n == 0) return;
    int segs = loop ? n : n - 1;
    std::vector<float> pathData;
    pathData.reserve(3 + segs * 9 + (loop ? 1 : 0));

    // MOVE to first point
    pathData.push_back(nanCmd(10)); // PATH_MOVE
    pathData.push_back(xData[0]);
    pathData.push_back(yData[0]);

    if (n <= 1) {
        context.loadPathData(id, winding, pathData);
        return;
    }

    // Compute segment lengths and normalized deltas
    std::vector<float> h(segs), dxS(segs), dyS(segs);
    for (int i = 0; i < segs; i++) {
        int i1 = (i + 1) % n;
        float sx = xData[i1] - xData[i], sy = yData[i1] - yData[i];
        float d = std::hypot(sx, sy);
        if (d == 0) d = 1e-12f;
        h[i] = d;
        dxS[i] = sx / d;
        dyS[i] = sy / d;
    }

    // Compute smooth tangents
    std::vector<float> dxT, dyT;
    smoothTan(dxT, dxS, h, loop);
    smoothTan(dyT, dyS, h, loop);

    // Generate cubic Bezier segments with spline control points
    float cx = xData[0], cy = yData[0];
    for (int i = 0; i < segs; i++) {
        int i1 = (i + 1) % n;
        int ti1 = loop ? (i + 1) % segs : i + 1;
        float hi = h[i];
        pathData.push_back(nanCmd(14)); // PATH_CUBIC
        pathData.push_back(cx);
        pathData.push_back(cy);
        // Control point 1: point[i] + tangent * h/3
        pathData.push_back(xData[i] + dxT[i] * hi / 3.0f);
        pathData.push_back(yData[i] + dyT[i] * hi / 3.0f);
        // Control point 2: point[i+1] - tangent * h/3
        pathData.push_back(xData[i1] - dxT[ti1] * hi / 3.0f);
        pathData.push_back(yData[i1] - dyT[ti1] * hi / 3.0f);
        // End point
        pathData.push_back(xData[i1]);
        pathData.push_back(yData[i1]);
        cx = xData[i1];
        cy = yData[i1];
    }

    if (loop) {
        pathData.push_back(nanCmd(15)); // PATH_CLOSE
    }

    context.loadPathData(id, winding, pathData);
}

// ── PathCreate ─────────────────────────────────────────────────────────
void PathCreateOp::updateVariables(RemoteContext& context) {
    oStartX = Utils::isVariable(startX) ? context.getFloat(Utils::idFromNan(startX)) : startX;
    oStartY = Utils::isVariable(startY) ? context.getFloat(Utils::idFromNan(startY)) : startY;
}

void PathCreateOp::apply(RemoteContext& context) {
    if (context.getMode() != ContextMode::PAINT) return;
    auto nanCmd = [](int cmd) -> float {
        int32_t bits = 0x7FC00000 | (cmd & 0x3FFFFF);
        float f;
        memcpy(&f, &bits, sizeof(f));
        return f;
    };
    std::vector<float> pathData;
    pathData.push_back(nanCmd(10)); // PATH_MOVE
    pathData.push_back(oStartX);
    pathData.push_back(oStartY);
    context.loadPathData(id, 0, pathData);
}

// ── PathTween ──────────────────────────────────────────────────────────
void PathTweenOp::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(tween, context, this);
}

void PathTweenOp::updateVariables(RemoteContext& context) {
    oTween = Utils::resolveFloat(tween, context);
}

void PathTweenOp::apply(RemoteContext& context) {
    if (context.getMode() != ContextMode::PAINT) return;
    auto* pc = context.getPaintContext();
    if (pc) pc->tweenPath(outId, pathId1, pathId2, oTween);
}

// ── PathCombine (175) ─────────────────────────────────────────────────
void PathCombineOp::apply(RemoteContext& context) {
    if (context.getMode() != ContextMode::PAINT) return;
    auto* pc = context.getPaintContext();
    if (pc) pc->combinePath(outId, pathId1, pathId2, operation);
}

// ── TextMeasure (155) ─────────────────────────────────────────────────
static constexpr int MEASURE_WIDTH  = 0;
static constexpr int MEASURE_HEIGHT = 1;
static constexpr int MEASURE_LEFT   = 2;
static constexpr int MEASURE_RIGHT  = 3;
static constexpr int MEASURE_TOP    = 4;
static constexpr int MEASURE_BOTTOM = 5;

void TextMeasureOp::apply(RemoteContext& context) {
    if (context.getMode() != ContextMode::PAINT) return;
    auto* pc = context.getPaintContext();
    if (!pc) return;

    int val = type & 0xFF;
    int flags = type >> 8;
    pc->getTextBounds(textId, 0, -1, flags, mBounds);

    float result = 0;
    switch (val) {
        case MEASURE_WIDTH:  result = mBounds[2] - mBounds[0]; break;
        case MEASURE_HEIGHT: result = mBounds[3] - mBounds[1]; break;
        case MEASURE_LEFT:   result = mBounds[0]; break;
        case MEASURE_RIGHT:  result = mBounds[2]; break;
        case MEASURE_TOP:    result = mBounds[1]; break;
        case MEASURE_BOTTOM: result = mBounds[3]; break;
    }
    context.loadFloat(id, result);
}

// ── TextAttribute (170) ───────────────────────────────────────────────
static constexpr int TEXT_LENGTH_TYPE = 6;

void TextAttributeOp::apply(RemoteContext& context) {
    if (context.getMode() != ContextMode::PAINT) return;
    auto* pc = context.getPaintContext();
    if (!pc) return;

    int val = type & 0xFF;
    int flags = type >> 8;

    if (val <= MEASURE_BOTTOM) {
        pc->getTextBounds(textId, 0, -1, flags, mBounds);
    }

    float result = 0;
    switch (val) {
        case MEASURE_WIDTH:  result = mBounds[2] - mBounds[0]; break;
        case MEASURE_HEIGHT: result = mBounds[3] - mBounds[1]; break;
        case MEASURE_LEFT:   result = mBounds[0]; break;
        case MEASURE_RIGHT:  result = mBounds[2]; break;
        case MEASURE_TOP:    result = mBounds[1]; break;
        case MEASURE_BOTTOM: result = mBounds[3]; break;
        case TEXT_LENGTH_TYPE: {
            std::string text = context.getText(textId);
            result = (float)text.size();
            break;
        }
    }
    context.loadFloat(id, result);
}

// ── TextLength (156) ──────────────────────────────────────────────────
void TextLengthOp::apply(RemoteContext& context) {
    std::string text = context.getText(textId);
    context.loadFloat(lengthId, (float)text.size());
}

void TextLengthOp::registerListening(RemoteContext& context) {
    context.listensTo(textId, this);
}

// ── TextSubtext (182) ─────────────────────────────────────────────────
void TextSubtextOp::apply(RemoteContext& context) {
    std::string str = context.getText(srcId);
    if (str.empty()) {
        context.loadText(textId, "");
        return;
    }
    int s = (int)oStart;
    if (s < 0) s = 0;
    if (s > (int)str.size()) s = (int)str.size();
    std::string out;
    if (oLen == -1) {
        out = str.substr(s);
    } else {
        int e = s + (int)oLen;
        if (e > (int)str.size()) e = (int)str.size();
        out = str.substr(s, e - s);
    }
    context.loadText(textId, out);
}

void TextSubtextOp::registerListening(RemoteContext& context) {
    context.listensTo(srcId, this);
    if (std::isnan(start)) {
        context.listensTo(Utils::idFromNan(start), this);
    }
    if (std::isnan(len)) {
        context.listensTo(Utils::idFromNan(len), this);
    }
}

void TextSubtextOp::updateVariables(RemoteContext& context) {
    if (std::isnan(start)) {
        oStart = context.getFloat(Utils::idFromNan(start));
    }
    if (std::isnan(len)) {
        oLen = context.getFloat(Utils::idFromNan(len));
    }
}

// ═══════════════════════════════════════════════════════════════════════
// Matrix4x4 utility — matches TS Matrix.ts (row-major, post-multiply)
// ═══════════════════════════════════════════════════════════════════════

struct Matrix4x4 {
    float m[16];

    void setIdentity() {
        for (int i = 0; i < 16; i++) m[i] = 0;
        m[0] = m[5] = m[10] = m[15] = 1;
    }

    void copyFrom(const float* src, int len) {
        if (len == 16) {
            for (int i = 0; i < 16; i++) m[i] = src[i];
        } else if (len == 9) {
            // 3x3 → 4x4 (matching TS Matrix.copyFrom)
            m[0] = src[0]; m[1] = src[1]; m[2] = 0;     m[3] = src[2];
            m[4] = src[3]; m[5] = src[4]; m[6] = src[5]; m[7] = 0;
            m[8] = src[6]; m[9] = src[7]; m[10]= src[8]; m[11]= 0;
            m[12]= 0;      m[13]= 0;      m[14]= 0;      m[15]= 1;
        }
    }

    void putValues(float* dest, int len) const {
        for (int i = 0; i < len && i < 16; i++) dest[i] = m[i];
    }

    static void multiply(const Matrix4x4& a, const Matrix4x4& b, Matrix4x4& dest) {
        for (int i = 0; i < 4; i++) {
            for (int j = 0; j < 4; j++) {
                float sum = 0;
                for (int k = 0; k < 4; k++) {
                    sum += a.m[i * 4 + k] * b.m[k * 4 + j];
                }
                dest.m[i * 4 + j] = sum;
            }
        }
    }

    // Post-multiply: this = this * R
    void postMultiply(const Matrix4x4& rhs) {
        Matrix4x4 tmp;
        multiply(*this, rhs, tmp);
        for (int i = 0; i < 16; i++) m[i] = tmp.m[i];
    }

    void rotateX(float degrees) {
        float rad = degrees * 3.14159265358979323846f / 180.0f;
        float c = std::cos(rad), s = std::sin(rad);
        Matrix4x4 r; r.setIdentity();
        r.m[5] = c;  r.m[6] = -s;
        r.m[9] = s;  r.m[10] = c;
        postMultiply(r);
    }

    void rotateY(float degrees) {
        float rad = degrees * 3.14159265358979323846f / 180.0f;
        float c = std::cos(rad), s = std::sin(rad);
        Matrix4x4 r; r.setIdentity();
        r.m[0] = c;  r.m[2] = s;
        r.m[8] = -s; r.m[10] = c;
        postMultiply(r);
    }

    void rotateZ(float degrees) {
        float rad = degrees * 3.14159265358979323846f / 180.0f;
        float c = std::cos(rad), s = std::sin(rad);
        Matrix4x4 r; r.setIdentity();
        r.m[0] = c;  r.m[1] = -s;
        r.m[4] = s;  r.m[5] = c;
        postMultiply(r);
    }

    void rotateZWithPivot(float pivotX, float pivotY, float degrees) {
        float rad = degrees * 3.14159265358979323846f / 180.0f;
        float c = std::cos(rad), s = std::sin(rad);
        float omc = 1.0f - c;
        float tx = pivotX * omc + pivotY * s;
        float ty = pivotY * omc - pivotX * s;
        // Build combined rotation+pivot matrix and pre-multiply
        float result[16];
        for (int i = 0; i < 4; i++) {
            for (int j = 0; j < 4; j++) {
                float sum = 0;
                for (int k = 0; k < 4; k++) {
                    float m_ik;
                    if (i == 0) {
                        if (k == 0) m_ik = c;
                        else if (k == 1) m_ik = -s;
                        else if (k == 3) m_ik = tx;
                        else m_ik = 0;
                    } else if (i == 1) {
                        if (k == 0) m_ik = s;
                        else if (k == 1) m_ik = c;
                        else if (k == 3) m_ik = ty;
                        else m_ik = 0;
                    } else if (i == 2) {
                        m_ik = (k == 2) ? 1.0f : 0.0f;
                    } else {
                        m_ik = (k == 3) ? 1.0f : 0.0f;
                    }
                    sum += m_ik * this->m[k * 4 + j];
                }
                result[i * 4 + j] = sum;
            }
        }
        for (int i = 0; i < 16; i++) m[i] = result[i];
    }

    void rotateAroundAxis(float vx, float vy, float vz, float degrees) {
        float rad = degrees * 3.14159265358979323846f / 180.0f;
        float lenSq = vx*vx + vy*vy + vz*vz;
        if (lenSq == 0) return;
        float len = std::sqrt(lenSq);
        float ux = vx/len, uy = vy/len, uz = vz/len;
        float c = std::cos(rad), s = std::sin(rad), omc = 1-c;
        float r00=c+ux*ux*omc, r01=ux*uy*omc-uz*s, r02=ux*uz*omc+uy*s;
        float r10=uy*ux*omc+uz*s, r11=c+uy*uy*omc, r12=uy*uz*omc-ux*s;
        float r20=uz*ux*omc-uy*s, r21=uz*uy*omc+ux*s, r22=c+uz*uz*omc;
        float result[16];
        for (int i = 0; i < 4; i++) {
            for (int j = 0; j < 4; j++) {
                float sum = 0;
                for (int k = 0; k < 4; k++) {
                    float r_ik;
                    if (i==0) r_ik = (k==0)?r00:(k==1)?r01:(k==2)?r02:0;
                    else if (i==1) r_ik = (k==0)?r10:(k==1)?r11:(k==2)?r12:0;
                    else if (i==2) r_ik = (k==0)?r20:(k==1)?r21:(k==2)?r22:0;
                    else r_ik = (k==3)?1.0f:0.0f;
                    sum += r_ik * this->m[k * 4 + j];
                }
                result[i * 4 + j] = sum;
            }
        }
        for (int i = 0; i < 16; i++) m[i] = result[i];
    }

    void translate(float x, float y, float z) {
        Matrix4x4 t; t.setIdentity();
        t.m[3] = x; t.m[7] = y; t.m[11] = z;
        postMultiply(t);
    }

    void setScale(float sx, float sy, float sz) {
        m[0] *= sx; m[5] *= sy; m[10] *= sz;
    }

    void projection(float fovDegrees, float aspectRatio, float near, float far) {
        float fovRad = fovDegrees * 3.14159265358979323846f / 180.0f;
        float f = 1.0f / std::tan(fovRad / 2.0f);
        float rangeInv = 1.0f / (near - far);
        Matrix4x4 p;
        p.m[0] = f / aspectRatio; p.m[1] = 0; p.m[2] = 0; p.m[3] = 0;
        p.m[4] = 0; p.m[5] = f; p.m[6] = 0; p.m[7] = 0;
        p.m[8] = 0; p.m[9] = 0; p.m[10] = (far+near)*rangeInv; p.m[11] = -1;
        p.m[12] = 0; p.m[13] = 0; p.m[14] = 2*far*near*rangeInv; p.m[15] = 0;
        postMultiply(p);
    }

    // Matrix × vector (affine): out[j] = sum(m[i+j*4]*input[i]) + m[3+j*4]
    void multiplyVec(const float* input, int inLen, float* out, int outLen) const {
        for (int j = 0; j < outLen; j++) {
            float tmp = 0;
            for (int i = 0; i < inLen; i++) {
                tmp += m[i + j * 4] * input[i];
            }
            out[j] = tmp + m[3 + j * 4];
        }
    }

    // Perspective transform: full 4x4 multiply with w-divide
    void evalPerspective(const float* input, int inLen, float* out, int outLen) const {
        float inVec[4] = {0, 0, 0, 1};
        float outVec[4] = {0, 0, 0, 0};
        for (int i = 0; i < inLen && i < 4; i++) inVec[i] = input[i];
        for (int j = 0; j < 4; j++) {
            float tmp = 0;
            for (int i = 0; i < 4; i++) {
                tmp += m[i + j * 4] * inVec[i];
            }
            outVec[j] = tmp;
        }
        if (outVec[3] != 0) {
            for (int i = 0; i < outLen && i < 4; i++) {
                outVec[i] /= outVec[3];
            }
        }
        for (int i = 0; i < outLen && i < 4; i++) out[i] = outVec[i];
    }
};

// ═══════════════════════════════════════════════════════════════════════
// Matrix RPN Evaluator — matches TS MatrixOperations.ts
// ═══════════════════════════════════════════════════════════════════════

static constexpr int MATRIX_OP_OFFSET = 0x320000;

static bool isMatrixOperator(float v) {
    if (!std::isnan(v)) return false;
    int32_t bits;
    memcpy(&bits, &v, sizeof(bits));
    int id = bits & 0x3FFFFF;
    return id > MATRIX_OP_OFFSET && id <= MATRIX_OP_OFFSET + 54;
}

static std::vector<float> evalMatrixExpression(const std::vector<float>& expr) {
    Matrix4x4 matrices[10];
    Matrix4x4 tmpMatrix;
    int matrixIndex = 0;
    matrices[0].setIdentity();

    for (int sp = 0; sp < (int)expr.size(); sp++) {
        float v = expr[sp];
        if (!std::isnan(v)) continue;

        int32_t bits;
        memcpy(&bits, &v, sizeof(bits));
        int id = bits & 0x3FFFFF;
        if (id <= MATRIX_OP_OFFSET || id > MATRIX_OP_OFFSET + 54) continue;

        const float* s = expr.data();
        Matrix4x4* m = matrices;
        int mi = matrixIndex;

        switch (id - MATRIX_OP_OFFSET) {
            case 1: // IDENTITY
                m[++matrixIndex].setIdentity();
                break;
            case 2: // ROT_X
                m[mi].rotateX(s[sp - 1]);
                break;
            case 3: // ROT_Y
                m[mi].rotateY(s[sp - 1]);
                break;
            case 4: // ROT_Z
                m[mi].rotateZ(s[sp - 1]);
                break;
            case 5: // TRANSLATE_X
                m[mi].translate(s[sp - 1], 0, 0);
                break;
            case 6: // TRANSLATE_Y
                m[mi].translate(0, s[sp - 1], 0);
                break;
            case 7: // TRANSLATE_Z
                m[mi].translate(0, 0, s[sp - 1]);
                break;
            case 8: // TRANSLATE2
                m[mi].translate(s[sp - 2], s[sp - 1], 0);
                break;
            case 9: // TRANSLATE3
                m[mi].translate(s[sp - 3], s[sp - 2], s[sp - 1]);
                break;
            case 10: // SCALE_X
                m[mi].setScale(s[sp - 1], 1, 1);
                break;
            case 11: // SCALE_Y
                m[mi].setScale(1, s[sp - 1], 1);
                break;
            case 12: // SCALE_Z
                m[mi].setScale(1, 1, s[sp - 1]);
                break;
            case 13: // SCALE2
                m[mi].setScale(s[sp - 2], s[sp - 1], 0);
                break;
            case 14: // SCALE3
                m[mi].setScale(s[sp - 3], s[sp - 2], s[sp - 1]);
                break;
            case 15: // MUL
                Matrix4x4::multiply(m[mi - 1], m[mi], tmpMatrix);
                for (int i = 0; i < 16; i++) m[mi - 1].m[i] = tmpMatrix.m[i];
                matrixIndex--;
                break;
            case 16: // ROT_PZ (angle, pivotX, pivotY, ROT_PZ)
                m[mi].rotateZWithPivot(s[sp - 2], s[sp - 1], s[sp - 3]);
                break;
            case 17: // ROT_AXIS (angle, x, y, z, ROT_AXIS)
                m[mi].rotateAroundAxis(s[sp - 3], s[sp - 2], s[sp - 1], s[sp - 4]);
                break;
            case 18: // PROJECTION (fov, aspect, near, far, PROJECTION)
                m[mi].projection(s[sp - 4], s[sp - 3], s[sp - 2], s[sp - 1]);
                break;
        }
    }

    // Return the resulting 16-element matrix
    std::vector<float> result(16);
    for (int i = 0; i < 16; i++) result[i] = matrices[0].m[i];
    return result;
}

// ── MatrixConstant ─────────────────────────────────────────────────────
void MatrixConstantOp::apply(RemoteContext& context) {
    context.putObjectMatrix(id, values);
}

// ── MatrixVectorMath ───────────────────────────────────────────────────
void MatrixVectorMathOp::updateVariables(RemoteContext& context) {
    resolvedInputs.resize(inValues.size());
    for (size_t i = 0; i < inValues.size(); i++) {
        float v = inValues[i];
        if (std::isnan(v)) {
            resolvedInputs[i] = context.getFloat(Utils::idFromNan(v));
        } else {
            resolvedInputs[i] = v;
        }
    }
}

void MatrixVectorMathOp::apply(RemoteContext& context) {
    // Resolve inputs if not yet done
    if (resolvedInputs.size() != inValues.size()) {
        updateVariables(context);
    }

    auto* matValues = context.getObjectMatrix(matrixId);
    if (!matValues || matValues->empty()) return;

    Matrix4x4 mat;
    mat.copyFrom(matValues->data(), (int)matValues->size());

    int outLen = (int)outIds.size();
    int inLen = (int)resolvedInputs.size();
    float tempOut[4] = {0, 0, 0, 0};

    if (type == 0) {
        mat.multiplyVec(resolvedInputs.data(), inLen, tempOut, outLen);
    } else {
        mat.evalPerspective(resolvedInputs.data(), inLen, tempOut, outLen);
    }

    for (int i = 0; i < outLen; i++) {
        context.loadFloat(outIds[i], tempOut[i]);
    }
}

// ── MatrixExpression ───────────────────────────────────────────────────
void MatrixExpressionOp::updateVariables(RemoteContext& context) {
    outExpression.resize(expression.size());
    for (size_t i = 0; i < expression.size(); i++) {
        float v = expression[i];
        if (std::isnan(v) && !isMatrixOperator(v)) {
            // It's a variable reference, not a matrix operator
            int32_t bits;
            memcpy(&bits, &v, sizeof(bits));
            int vid = bits & 0x3FFFFF;
            // Skip data variables (array refs)
            if ((vid & 0x700000) == 0x200000) {
                outExpression[i] = v;
            } else {
                outExpression[i] = context.getFloat(vid);
            }
        } else {
            outExpression[i] = v;
        }
    }
}

void MatrixExpressionOp::apply(RemoteContext& context) {
    // Resolve variables in expression
    updateVariables(context);

    // Evaluate matrix RPN expression
    std::vector<float> result = evalMatrixExpression(outExpression);

    // Store in context
    context.putObjectMatrix(id, result);
    // Notify listeners (use loadFloat to trigger, matching TS)
    context.loadFloat(id, 0.0f);
}

// ── MatrixFromPath ─────────────────────────────────────────────────────
void MatrixFromPathOp::apply(RemoteContext& context) {
    // Set matrix from path position - stub
}

// ── ColorTheme ─────────────────────────────────────────────────────────
void ColorThemeOp::apply(RemoteContext& context) {
    int theme = context.getPaintTheme();
    if (theme == -3) {  // THEME_LIGHT
        context.loadColor(id, lightFallback);
    } else {
        context.loadColor(id, darkFallback);
    }
}

// ── DataDynamicListFloat ───────────────────────────────────────────────
void DataDynamicListFloat::apply(RemoteContext& context) {
    // No mode check — runs in ALL modes matching TS
    int len = (int)length;
    std::vector<float> data(len, 0.0f);
    context.loadFloatList(id, data);
}

// ── UpdateDynamicFloatList ────────────────────────────────────────────
void UpdateDynamicFloatListOp::registerListening(RemoteContext& context) {
    Utils::registerFloatVar(index, context, this);
    Utils::registerFloatVar(value, context, this);
}

void UpdateDynamicFloatListOp::updateVariables(RemoteContext& context) {
    oIndex = Utils::resolveFloat(index, context);
    oValue = Utils::resolveFloat(value, context);
}

void UpdateDynamicFloatListOp::apply(RemoteContext& context) {
    auto* list = context.getFloatListMutable(id);
    if (!list) return;
    int idx = (int)oIndex;
    if (idx >= 0 && idx < (int)list->size()) {
        (*list)[idx] = oValue;
    }
}

// ── DrawBitmapScaled ───────────────────────────────────────────────────
void DrawBitmapScaled::apply(RemoteContext& context) {
    if (context.getMode() == ContextMode::PAINT) {
        auto* pc = context.getPaintContext();
        if (pc) pc->drawBitmap(imageId, oDstL, oDstT, oDstR, oDstB);
    }
}

// ── DrawToBitmap ─────────────────────────────────────────────────────
void DrawToBitmapOp::apply(RemoteContext& context) {
    if (context.getMode() != ContextMode::PAINT) return;
    auto* pc = context.getPaintContext();
    if (!pc) return;

    if (bitmapId == 0) {
        // Switch back to the main canvas and finalize the offscreen bitmap
        pc->endDrawToBitmap();
    } else {
        // Switch to an offscreen bitmap canvas
        pc->beginDrawToBitmap(bitmapId, mode, color);
    }
}

// ── TimeAttribute (172) ───────────────────────────────────────────────
void TimeAttributeOp::apply(RemoteContext& context) {
    using namespace std::chrono;
    int val = type & 255;

    auto now = system_clock::now();
    int64_t nowMillis = duration_cast<milliseconds>(now.time_since_epoch()).count();

    // Get the time value referenced by timeId (epoch millis stored as a long constant)
    int64_t valueMillis = context.getLong(timeId);
    if (valueMillis == 0) {
        valueMillis = nowMillis;  // fallback to "now" if no long constant stored
    }

    // Compute delta for TIME_FROM_NOW_* and TIME_FROM_ARG_* types
    int64_t delta = 0;
    switch (val) {
        case TIME_FROM_NOW_SEC:
        case TIME_FROM_NOW_MIN:
        case TIME_FROM_NOW_HR:
            delta = valueMillis - nowMillis;
            break;
        case TIME_FROM_ARG_SEC:
        case TIME_FROM_ARG_MIN:
        case TIME_FROM_ARG_HR:
            if (!args.empty()) {
                int64_t argMillis = context.getLong(args[0]);
                delta = valueMillis - argMillis;
            }
            break;
        default:
            break;
    }

    // Break down the value time into calendar fields
    auto valueTimePoint = system_clock::time_point(milliseconds(valueMillis));
    std::time_t valueTime = system_clock::to_time_t(valueTimePoint);
    std::tm valueTm{};
#if defined(_WIN32)
    localtime_s(&valueTm, &valueTime);
#else
    localtime_r(&valueTime, &valueTm);
#endif

    switch (val) {
        case TIME_FROM_NOW_SEC:
        case TIME_FROM_ARG_SEC:
            context.loadFloat(id, static_cast<float>(delta * 1E-3));
            context.needsRepaint();
            break;
        case TIME_FROM_NOW_MIN:
        case TIME_FROM_ARG_MIN:
            context.loadFloat(id, static_cast<float>(delta * 1E-3 / 60.0));
            context.needsRepaint();
            break;
        case TIME_FROM_NOW_HR:
        case TIME_FROM_ARG_HR:
            context.loadFloat(id, static_cast<float>(delta * 1E-3 / 3600.0));
            break;
        case TIME_IN_SEC:
            context.loadFloat(id, static_cast<float>(valueTm.tm_sec));
            break;
        case TIME_IN_MIN:
            context.loadFloat(id, static_cast<float>(valueTm.tm_min));
            break;
        case TIME_IN_HR:
            context.loadFloat(id, static_cast<float>(valueTm.tm_hour));
            break;
        case TIME_DAY_OF_MONTH:
            context.loadFloat(id, static_cast<float>(valueTm.tm_mday));
            break;
        case TIME_DAY_OF_YEAR:
            // tm_yday is 0-based, Java expects 1-based
            context.loadFloat(id, static_cast<float>(valueTm.tm_yday + 1));
            break;
        case TIME_MONTH_VALUE:
            // Java: month 0-indexed (0..11), tm_mon is already 0-based
            context.loadFloat(id, static_cast<float>(valueTm.tm_mon));
            break;
        case TIME_DAY_OF_WEEK:
            // Java: dayOfWeek 0-indexed (0..6), tm_wday is already 0-based (0=Sunday)
            context.loadFloat(id, static_cast<float>(valueTm.tm_wday));
            break;
        case TIME_YEAR:
            context.loadFloat(id, static_cast<float>(valueTm.tm_year + 1900));
            break;
        case TIME_FROM_LOAD_SEC: {
            int64_t loadTime = context.getDocLoadTime();
            context.loadFloat(id, static_cast<float>((valueMillis - loadTime) * 1E-3));
            context.needsRepaint();
            break;
        }
    }
}

} // namespace rccore
