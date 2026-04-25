#include "rccore/PaintBundle.h"
#include "rccore/WireBuffer.h"
#include "rccore/RemoteContext.h"
#include "rccore/Utils.h"
#include "rccore/Operation.h"
#include <stdexcept>
#include <cmath>

namespace rccore {

void PaintBundle::readBundle(WireBuffer& buf) {
    int len = buf.readInt();
    if (len <= 0 || len > 1024) {
        throw std::runtime_error("PaintBundle: invalid length " + std::to_string(len));
    }
    mArray.resize(len);
    for (int i = 0; i < len; i++) {
        mArray[i] = buf.readInt();
    }
}

// ── Helper: check if int bits represent a NaN float ───────────────────
static bool isNanBits(int32_t bits) {
    float f;
    memcpy(&f, &bits, sizeof(f));
    return std::isnan(f);
}

static void registerFloat(int32_t iv, RemoteContext& context, Operation* owner) {
    float v;
    memcpy(&v, &iv, sizeof(v));
    if (std::isnan(v)) {
        context.listensTo(Utils::idFromNan(v), owner);
    }
}

// ── Scan mArray for NaN-encoded variable refs, register listeners ─────
void PaintBundle::registerVars(RemoteContext& context, Operation* owner) {
    int i = 0;
    int len = static_cast<int>(mArray.size());
    while (i < len) {
        int32_t cmd = mArray[i++];
        int tag = cmd & 0xFFFF;
        int upper = (cmd >> 16) & 0xFFFF;

        switch (tag) {
            case STROKE_MITER:
            case STROKE_WIDTH:
            case ALPHA:
            case TEXT_SIZE:
                if (i < len) registerFloat(mArray[i++], context, owner);
                break;

            case COLOR_FILTER_ID:
            case COLOR_ID:
                if (i < len) context.listensTo(mArray[i++], owner);
                break;

            case COLOR:
            case TYPEFACE:
            case COLOR_FILTER:
            case SHADER:
            case SHADER_MATRIX:
                i++; // skip value
                break;

            case FALLBACK_TYPEFACE:
                i++; // fontType
                break;

            case FONT_AXIS: {
                int count = upper;
                for (int j = 0; j < count && i + 1 < len; j++) {
                    i++; // tag text id
                    registerFloat(mArray[i++], context, owner);
                }
                break;
            }

            case GRADIENT: {
                if (i >= len) break;
                int32_t control = mArray[i++];
                int numColors = control & 0xFF;
                int regBits = (control >> 16) & 0xFFFF;
                // Register color IDs flagged in the register bitmask
                for (int j = 0; j < numColors && i < len; j++) {
                    if ((regBits & (1 << j)) != 0) {
                        context.listensTo(mArray[i], owner);
                    }
                    i++;
                }
                if (i >= len) break;
                int numStops = mArray[i++];
                for (int j = 0; j < numStops && i < len; j++) {
                    registerFloat(mArray[i++], context, owner);
                }
                int gradType = upper;
                if (gradType == LINEAR_GRADIENT) {
                    for (int j = 0; j < 4 && i < len; j++)
                        registerFloat(mArray[i++], context, owner);
                    if (i < len) i++; // tile mode
                } else if (gradType == RADIAL_GRADIENT) {
                    for (int j = 0; j < 3 && i < len; j++)
                        registerFloat(mArray[i++], context, owner);
                    if (i < len) i++; // tile mode
                } else if (gradType == SWEEP_GRADIENT) {
                    for (int j = 0; j < 2 && i < len; j++)
                        registerFloat(mArray[i++], context, owner);
                }
                break;
            }

            case PATH_EFFECT: {
                int count = upper;
                for (int j = 0; j < count && i < len; j++) {
                    registerFloat(mArray[i++], context, owner);
                }
                if (i < len) registerFloat(mArray[i++], context, owner); // phase
                break;
            }

            case TEXTURE:
                i += 3; // bitmapId, tileModes, filter
                break;

            // Single-int tags (value packed in upper bits, no extra data):
            case STYLE:
            case STROKE_CAP:
            case STROKE_JOIN:
            case ANTI_ALIAS:
            case BLEND_MODE:
            case IMAGE_FILTER_QUALITY:
            case FILTER_BITMAP:
            case CLEAR_COLOR_FILTER:
                break;

            default:
                break;
        }
    }
}

// ── Copy mArray → mOutArray, resolve NaN floats and color IDs ─────────
void PaintBundle::updateVariables(RemoteContext& context) {
    int len = static_cast<int>(mArray.size());
    mOutArray.resize(len);
    // Copy entire array first
    for (int k = 0; k < len; k++) mOutArray[k] = mArray[k];

    int i = 0;
    while (i < len) {
        int32_t cmd = mArray[i++];
        int tag = cmd & 0xFFFF;
        int upper = (cmd >> 16) & 0xFFFF;

        switch (tag) {
            case STROKE_MITER:
            case STROKE_WIDTH:
            case ALPHA:
            case TEXT_SIZE:
                if (i < len) {
                    mOutArray[i] = fixFloatVar(mArray[i], context);
                    i++;
                }
                break;

            case COLOR_FILTER_ID:
            case COLOR_ID:
                if (i < len) {
                    mOutArray[i] = context.getColor(mArray[i]);
                    i++;
                }
                break;

            case COLOR:
            case TYPEFACE:
            case COLOR_FILTER:
            case SHADER:
            case SHADER_MATRIX:
                i++;
                break;

            case FALLBACK_TYPEFACE:
                i++;
                break;

            case FONT_AXIS: {
                int count = upper;
                for (int j = 0; j < count && i + 1 < len; j++) {
                    i++; // tag text id
                    mOutArray[i] = fixFloatVar(mArray[i], context);
                    i++;
                }
                break;
            }

            case GRADIENT: {
                if (i >= len) break;
                int32_t control = mArray[i++]; // control (copied as-is)
                int numColors = control & 0xFF;
                int regBits = (control >> 16) & 0xFFFF;
                // Resolve color IDs flagged in the register bitmask
                for (int j = 0; j < numColors && i < len; j++) {
                    if ((regBits & (1 << j)) != 0) {
                        mOutArray[i] = context.getColor(mArray[i]);
                    }
                    i++;
                }
                if (i >= len) break;
                int numStops = mArray[i++]; // numStops (copied as-is)
                for (int j = 0; j < numStops && i < len; j++) {
                    mOutArray[i] = fixFloatVar(mArray[i], context);
                    i++;
                }
                int gradType = upper;
                if (gradType == LINEAR_GRADIENT) {
                    for (int j = 0; j < 4 && i < len; j++) {
                        mOutArray[i] = fixFloatVar(mArray[i], context);
                        i++;
                    }
                    if (i < len) i++; // tile mode
                } else if (gradType == RADIAL_GRADIENT) {
                    for (int j = 0; j < 3 && i < len; j++) {
                        mOutArray[i] = fixFloatVar(mArray[i], context);
                        i++;
                    }
                    if (i < len) i++; // tile mode
                } else if (gradType == SWEEP_GRADIENT) {
                    for (int j = 0; j < 2 && i < len; j++) {
                        mOutArray[i] = fixFloatVar(mArray[i], context);
                        i++;
                    }
                }
                break;
            }

            case PATH_EFFECT: {
                int count = upper;
                for (int j = 0; j < count && i < len; j++) {
                    mOutArray[i] = fixFloatVar(mArray[i], context);
                    i++;
                }
                if (i < len) { // phase
                    mOutArray[i] = fixFloatVar(mArray[i], context);
                    i++;
                }
                break;
            }

            case TEXTURE:
                i += 3;
                break;

            case STYLE:
            case STROKE_CAP:
            case STROKE_JOIN:
            case ANTI_ALIAS:
            case BLEND_MODE:
            case IMAGE_FILTER_QUALITY:
            case FILTER_BITMAP:
            case CLEAR_COLOR_FILTER:
                break;

            default:
                break;
        }
    }
}

// ── Resolve a single float variable: NaN → context.getFloat(id) ───────
int32_t PaintBundle::fixFloatVar(int32_t val, RemoteContext& context) {
    float v;
    memcpy(&v, &val, sizeof(v));
    if (std::isnan(v)) {
        int id = Utils::idFromNan(v);
        float resolved = context.getFloat(id);
        int32_t bits;
        memcpy(&bits, &resolved, sizeof(bits));
        return bits;
    }
    return val;
}

} // namespace rccore
