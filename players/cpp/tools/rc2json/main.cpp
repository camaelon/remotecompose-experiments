#include "rccore/WireBuffer.h"
#include "rccore/OpcodeRegistry.h"

#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include <cmath>
#include <cstring>
#include <functional>
#include <unordered_map>

using namespace rccore;

// Base64 encoder
static const char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static std::string base64Encode(const uint8_t* data, size_t len) {
    std::string out;
    out.reserve(((len + 2) / 3) * 4);
    for (size_t i = 0; i < len; i += 3) {
        uint32_t n = (uint32_t)data[i] << 16;
        if (i + 1 < len) n |= (uint32_t)data[i + 1] << 8;
        if (i + 2 < len) n |= data[i + 2];
        out += B64[(n >> 18) & 63];
        out += B64[(n >> 12) & 63];
        out += (i + 1 < len) ? B64[(n >> 6) & 63] : '=';
        out += (i + 2 < len) ? B64[n & 63] : '=';
    }
    return out;
}

// Format float to match Java's Float.toString() exactly
// Java uses shortest decimal representation that round-trips, with decimal notation
// (no scientific) for values in range [1e-3, 1e7)
static std::string formatFloat(float f) {
    uint32_t bits;
    memcpy(&bits, &f, sizeof(bits));

    // Check for NaN with encoded ID (Java's formatFloat checks 0xFF800000 pattern)
    if ((bits & 0xFF800000) == 0xFF800000) {
        int id = bits & 0x7FFFFF;
        return "NaN(" + std::to_string(id) + ")";
    }

    if (std::isnan(f)) return "NaN";
    if (std::isinf(f)) return f > 0 ? "Infinity" : "-Infinity";

    // Check for zero
    if (f == 0.0f) {
        return (bits & 0x80000000) ? "-0.0" : "0.0";
    }

    // Java uses scientific notation for |value| >= 1e7 or |value| < 1e-3
    float absf = f < 0 ? -f : f;
    if (absf >= 1e7f || absf < 1e-3f) {
        for (int digits = 1; digits <= 9; digits++) {
            char buf[64];
            snprintf(buf, sizeof(buf), "%.*E", digits - 1, (double)f);
            float parsed = strtof(buf, nullptr);
            uint32_t parsedBits;
            memcpy(&parsedBits, &parsed, sizeof(parsedBits));
            if (parsedBits == bits) {
                std::string es(buf);
                size_t epos = es.find('E');
                if (epos != std::string::npos) {
                    std::string mantissa = es.substr(0, epos);
                    std::string exponent = es.substr(epos + 1); // after 'E'
                    // Strip trailing zeros in mantissa but keep at least one decimal
                    size_t dot = mantissa.find('.');
                    if (dot != std::string::npos) {
                        size_t last = mantissa.find_last_not_of('0');
                        if (last > dot) mantissa.erase(last + 1);
                        else if (last == dot) mantissa.erase(dot + 2);
                    }
                    // Java uses compact exponent: E38 not E+038
                    if (!exponent.empty() && exponent[0] == '+') {
                        exponent = exponent.substr(1);
                    }
                    // Remove leading zeros from exponent
                    size_t firstNonZero = exponent.find_first_not_of('0');
                    if (firstNonZero != std::string::npos && firstNonZero > 0) {
                        // Keep the minus sign if negative
                        if (exponent[0] == '-') {
                            size_t fnz = exponent.find_first_not_of('0', 1);
                            if (fnz != std::string::npos) exponent = "-" + exponent.substr(fnz);
                        } else {
                            exponent = exponent.substr(firstNonZero);
                        }
                    }
                    return mantissa + "E" + exponent;
                }
                return es;
            }
        }
    }

    // Find shortest decimal representation that round-trips
    // Try increasing precision until round-trip matches
    char best[64];
    bool found = false;

    for (int digits = 1; digits <= 9; digits++) {
        char buf[64];
        snprintf(buf, sizeof(buf), "%.*f", digits, (double)f);

        // Check for unnecessary trailing zeros and clean up
        // But first check if it round-trips
        float parsed = strtof(buf, nullptr);
        uint32_t parsedBits;
        memcpy(&parsedBits, &parsed, sizeof(parsedBits));
        if (parsedBits == bits) {
            // Found a match - now strip trailing zeros but keep at least one after decimal
            std::string s(buf);
            size_t dot = s.find('.');
            if (dot != std::string::npos) {
                size_t last = s.find_last_not_of('0');
                if (last != std::string::npos && last > dot) {
                    s.erase(last + 1);
                } else if (last == dot) {
                    s.erase(dot + 2); // keep ".0"
                }
            }
            // Verify the stripped version still round-trips
            parsed = strtof(s.c_str(), nullptr);
            memcpy(&parsedBits, &parsed, sizeof(parsedBits));
            if (parsedBits == bits) {
                return s;
            }
            // If stripping broke it, use the unstripped version
            strcpy(best, buf);
            found = true;
            break;
        }
    }

    if (!found) {
        // Fall back to full precision
        snprintf(best, sizeof(best), "%.9g", (double)f);
    }

    std::string s(best);

    // Handle scientific notation - Java uses it for |value| >= 1e7 or |value| < 1e-3
    if (s.find('e') != std::string::npos || s.find('E') != std::string::npos) {
        // For very large or very small values, use Java-style scientific notation
        if (absf >= 1e7f || (absf > 0 && absf < 1e-3f)) {
            // Use Java's Float.toString() style: shortest E-notation that round-trips
            for (int digits = 1; digits <= 9; digits++) {
                char buf[64];
                snprintf(buf, sizeof(buf), "%.*E", digits - 1, (double)f);
                float parsed = strtof(buf, nullptr);
                uint32_t parsedBits;
                memcpy(&parsedBits, &parsed, sizeof(parsedBits));
                if (parsedBits == bits) {
                    // Format to match Java: strip trailing zeros in mantissa, keep at least one
                    std::string es(buf);
                    size_t epos = es.find('E');
                    if (epos != std::string::npos) {
                        std::string mantissa = es.substr(0, epos);
                        std::string exponent = es.substr(epos);
                        size_t dot = mantissa.find('.');
                        if (dot != std::string::npos) {
                            size_t last = mantissa.find_last_not_of('0');
                            if (last > dot) mantissa.erase(last + 1);
                            else if (last == dot) mantissa.erase(dot + 2);
                        }
                        // Java uses compact exponent: E38 not E+38
                        if (exponent.size() > 2 && exponent[1] == '+') {
                            exponent = "E" + exponent.substr(2);
                        }
                        // Remove leading zeros from exponent
                        return mantissa + exponent;
                    }
                    return es;
                }
            }
        }
        // For moderate ranges, try decimal format with enough digits
        for (int digits = 0; digits <= 20; digits++) {
            char buf[64];
            snprintf(buf, sizeof(buf), "%.*f", digits, (double)f);
            float parsed = strtof(buf, nullptr);
            uint32_t parsedBits;
            memcpy(&parsedBits, &parsed, sizeof(parsedBits));
            if (parsedBits == bits) {
                std::string ds(buf);
                size_t dot = ds.find('.');
                if (dot != std::string::npos) {
                    size_t last = ds.find_last_not_of('0');
                    if (last > dot) ds.erase(last + 1);
                    else if (last == dot) ds.erase(dot + 2);
                    parsed = strtof(ds.c_str(), nullptr);
                    memcpy(&parsedBits, &parsed, sizeof(parsedBits));
                    if (parsedBits == bits) return ds;
                }
                return std::string(buf);
            }
        }
    }

    // Ensure has decimal point
    if (s.find('.') == std::string::npos) s += ".0";

    return s;
}

// JSON string escape
static std::string jsonEscape(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 8);
    for (char c : s) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if ((unsigned char)c < 0x20) {
                    char buf[8];
                    snprintf(buf, sizeof(buf), "\\u%04x", (unsigned char)c);
                    out += buf;
                } else {
                    out += c;
                }
        }
    }
    return out;
}

// --- Operation readers: advance buffer correctly for EVERY opcode ---
// Returns the end position after reading the operation (after the opcode byte)
using AdvanceReader = std::function<void(WireBuffer&)>;
static std::unordered_map<int, AdvanceReader> sAdvanceReaders;
static std::unordered_map<int, std::string> sAdvanceNames;

// Compute how many bytes a fixed-length OpSpec consumes
static int computeFixedSize(const OpSpec& spec) {
    int size = 0;
    for (auto& f : spec.fields) {
        switch (f.type) {
            case FieldType::BYTE: size += 1; break;
            case FieldType::SHORT: size += 2; break;
            case FieldType::INT: size += 4; break;
            case FieldType::LONG: size += 8; break;
            case FieldType::FLOAT: size += 4; break;
            case FieldType::DOUBLE: size += 8; break;
            case FieldType::BOOLEAN: size += 1; break;
            default: return -1; // variable length
        }
    }
    return size;
}

// Advance buffer by reading fields from spec (works for non-variable specs)
static void advanceBySpec(WireBuffer& buf, const OpSpec& spec) {
    for (auto& f : spec.fields) {
        switch (f.type) {
            case FieldType::BYTE: buf.readByte(); break;
            case FieldType::SHORT: buf.readShort(); break;
            case FieldType::INT: buf.readInt(); break;
            case FieldType::LONG: buf.readLong(); break;
            case FieldType::FLOAT: buf.readFloat(); break;
            case FieldType::DOUBLE: buf.readDouble(); break;
            case FieldType::BOOLEAN: buf.readBoolean(); break;
            case FieldType::UTF8: buf.readUTF8(); break;
            case FieldType::BUFFER: buf.readBuffer(); break;
            default: break;
        }
    }
}

static void initAdvanceReaders() {
    // HEADER (0): legacy or modern
    sAdvanceReaders[0] = [](WireBuffer& buf) {
        int major = buf.readInt();
        buf.readInt(); // minor
        buf.readInt(); // patch
        if (major < 0x10000) {
            buf.readInt(); // width
            buf.readInt(); // height
            buf.readLong(); // capabilities
        } else {
            int len = buf.readInt();
            for (int i = 0; i < len; i++) {
                int16_t tag = static_cast<int16_t>(buf.readShort());
                buf.readShort(); // itemLen
                int dataType = tag >> 10;
                switch (dataType) {
                    case 0: buf.readInt(); break;
                    case 1: buf.readFloat(); break;
                    case 2: buf.readLong(); break;
                    case 3: buf.readUTF8(); break;
                    default: break; // no bytes for unknown types (matches Java)
                }
            }
        }
    };

    // PAINT_VALUES (40): INT(length) + length * INT
    sAdvanceReaders[40] = [](WireBuffer& buf) {
        int len = buf.readInt();
        for (int i = 0; i < len; i++) buf.readInt();
    };

    // ANIMATED_FLOAT (81): INT + SHORT + SHORT + expressionLen*FLOAT + animationLen*FLOAT
    sAdvanceReaders[81] = [](WireBuffer& buf) {
        buf.readInt(); // id
        int animLen = buf.readShort();
        int exprLen = buf.readShort();
        for (int i = 0; i < exprLen; i++) buf.readFloat();
        buf.setIndex(buf.getIndex() + animLen * 4); // raw float data
    };

    // DATA_BITMAP_FONT (167): variable
    sAdvanceReaders[167] = [](WireBuffer& buf) {
        buf.readInt(); // id
        int vngl = buf.readInt(); // versionAndNumGlyphs
        int numGlyphs = vngl & 0xFFFF;
        for (int i = 0; i < numGlyphs; i++) {
            buf.readInt(); // charCode
            buf.readBuffer(); // glyphData
        }
    };

    // COLOR_EXPRESSIONS (134): variable with expression arrays
    sAdvanceReaders[134] = [](WireBuffer& buf) {
        buf.readInt(); // id
        buf.readInt(); buf.readInt(); buf.readInt(); buf.readInt(); // p1-p4
    };

    // MATRIX_CONSTANT (186): variable
    sAdvanceReaders[186] = [](WireBuffer& buf) {
        buf.readInt(); // id
        int type = buf.readInt();
        // Type determines what follows
        // From Java: no extra data after id and type for the basic case
    };

    // DRAW_BITMAP_FONT_TEXT_RUN (48): DrawBitmapFontText.java
    // readInt(text) with 0x80000000 high-bit flag, then bitmapFont, start, end, x, y
    sAdvanceReaders[48] = [](WireBuffer& buf) {
        int text = buf.readInt();
        if ((text & (int)0x80000000u) != 0) {
            buf.readFloat(); // glyphSpacing
        }
        buf.readInt(); // bitmapFont
        buf.readInt(); // start
        buf.readInt(); // end
        buf.readFloat(); // x
        buf.readFloat(); // y
    };

    // PathData (123): readInt(idAndWinding) + readInt(len) + len * readFloat
    sAdvanceReaders[123] = [](WireBuffer& buf) {
        buf.readInt();
        int len = buf.readInt();
        for (int i = 0; i < len; i++) buf.readFloat();
    };
    sAdvanceNames[123] = "PathData";

    // ShaderData (45): readInt(shaderID) + readInt(shaderTextId) + readInt(sizes)
    //   then floatSize uniforms, intSize uniforms, bitmapSize uniforms
    sAdvanceReaders[45] = [](WireBuffer& buf) {
        buf.readInt(); // shaderID
        buf.readInt(); // shaderTextId
        int sizes = buf.readInt();
        int floatSize = sizes & 0xFF;
        int intSize = (sizes >> 8) & 0xFF;
        int bitmapSize = (sizes >> 16) & 0xFF;
        for (int i = 0; i < floatSize; i++) {
            buf.readUTF8(); // name
            int len = buf.readInt();
            for (int j = 0; j < len; j++) buf.readFloat();
        }
        for (int i = 0; i < intSize; i++) {
            buf.readUTF8(); // name
            int len = buf.readInt();
            for (int j = 0; j < len; j++) buf.readInt();
        }
        for (int i = 0; i < bitmapSize; i++) {
            buf.readUTF8(); // name
            buf.readInt(); // value
        }
    };
    sAdvanceNames[45] = "ShaderData";

    // TextFromFloat (135)
    sAdvanceReaders[135] = [](WireBuffer& buf) {
        buf.readInt(); buf.readInt(); buf.readInt(); buf.readInt();
    };
    sAdvanceNames[135] = "TextFromFloat";

    // TextMerge (136): readInt(textId) + readInt(srcId1) + readInt(srcId2)
    sAdvanceReaders[136] = [](WireBuffer& buf) {
        buf.readInt(); buf.readInt(); buf.readInt();
    };
    sAdvanceNames[136] = "TextMerge";

    // TextTransform (199): readInt(textId) + readInt(srcId1) + readFloat(start) + readFloat(len) + readInt(operation)
    sAdvanceReaders[199] = [](WireBuffer& buf) {
        buf.readInt(); buf.readInt(); buf.readFloat(); buf.readFloat(); buf.readInt();
    };
    sAdvanceNames[199] = "TextTransform";

    // DrawContent (139): no fields
    sAdvanceReaders[139] = [](WireBuffer&) {};
    sAdvanceNames[139] = "DrawContent";

    // IntegerExpression (144): readInt(id) + readInt(mask) + readInt(len) + len*readInt(values)
    sAdvanceReaders[144] = [](WireBuffer& buf) {
        buf.readInt(); // id
        buf.readInt(); // mask
        int len = buf.readInt();
        for (int i = 0; i < len; i++) buf.readInt();
    };
    sAdvanceNames[144] = "IntegerExpression";

    // DataListIds (146)
    sAdvanceReaders[146] = [](WireBuffer& buf) {
        buf.readInt();
        int count = buf.readInt();
        for (int i = 0; i < count; i++) buf.readInt();
    };
    sAdvanceNames[146] = "DataListIds";

    // DataListFloat (147)
    sAdvanceReaders[147] = [](WireBuffer& buf) {
        buf.readInt();
        int count = buf.readInt();
        for (int i = 0; i < count; i++) buf.readFloat();
    };
    sAdvanceNames[147] = "DataListFloat";

    // DataDynamicListFloat (197): readInt(id) + readFloat(nbValues) -- just 2 fields, no array
    sAdvanceReaders[197] = [](WireBuffer& buf) {
        buf.readInt(); buf.readFloat();
    };
    sAdvanceNames[197] = "DataDynamicListFloat";

    // TouchExpression (157): readInt(id) + readFloat(startValue) + readFloat(min) + readFloat(max)
    //   + readFloat(velocityId) + readInt(touchEffects) + readInt(len)
    //   + (len & 0xFFFF)*readFloat(expression) + readInt(stopLogic)
    //   + (stopLogic & 0xFFFF)*readFloat(stopsData) + readInt(easingLen) + easingLen*readFloat
    sAdvanceReaders[157] = [](WireBuffer& buf) {
        buf.readInt();   // id
        buf.readFloat(); // startValue
        buf.readFloat(); // min
        buf.readFloat(); // max
        buf.readFloat(); // velocityId
        buf.readInt();   // touchEffects
        int len = buf.readInt();
        int exprLen = len & 0xFFFF;
        for (int i = 0; i < exprLen; i++) buf.readFloat();
        int stopLogic = buf.readInt();
        int stopLen = stopLogic & 0xFFFF;
        for (int i = 0; i < stopLen; i++) buf.readFloat();
        int easingLen = buf.readInt();
        for (int i = 0; i < easingLen; i++) buf.readFloat();
    };
    sAdvanceNames[157] = "TouchExpression";

    // PathAppend (160): readInt(id) + readInt(len) + len*readFloat(data)
    sAdvanceReaders[160] = [](WireBuffer& buf) {
        buf.readInt(); // id
        int len = buf.readInt();
        for (int i = 0; i < len; i++) buf.readFloat();
    };
    sAdvanceNames[160] = "PathAppend";

    // PathExpression (193): readInt(id) + readInt(flags) + readFloat(min) + readFloat(max)
    //   + readFloat(count) + readInt(lenX) + lenX*readFloat + readInt(lenY) + lenY*readFloat
    sAdvanceReaders[193] = [](WireBuffer& buf) {
        buf.readInt();   // id
        buf.readInt();   // flags
        buf.readFloat(); // min
        buf.readFloat(); // max
        buf.readFloat(); // count
        int lenX = buf.readInt();
        for (int i = 0; i < lenX; i++) buf.readFloat();
        int lenY = buf.readInt();
        for (int i = 0; i < lenY; i++) buf.readFloat();
    };
    sAdvanceNames[193] = "PathExpression";

    // CanvasOperations (173): container marker, reads nothing
    sAdvanceReaders[173] = [](WireBuffer&) {};
    sAdvanceNames[173] = "CanvasOperations";

    // ConditionalOperations (178): readByte(type) + readFloat(a) + readFloat(b)
    sAdvanceReaders[178] = [](WireBuffer& buf) {
        buf.readByte(); buf.readFloat(); buf.readFloat();
    };
    sAdvanceNames[178] = "ConditionalOperations";

    // MatrixConstant (186): readInt(id) + readInt(type) + readInt(len) + len*readFloat
    sAdvanceReaders[186] = [](WireBuffer& buf) {
        buf.readInt(); // id
        buf.readInt(); // type
        int len = buf.readInt();
        for (int i = 0; i < len; i++) buf.readFloat();
    };
    sAdvanceNames[186] = "MatrixConstant";

    // MatrixExpression (187)
    sAdvanceReaders[187] = [](WireBuffer& buf) {
        buf.readInt(); buf.readInt();
        int len = buf.readInt();
        for (int i = 0; i < len; i++) buf.readFloat();
    };
    sAdvanceNames[187] = "MatrixExpression";

    // MatrixVectorMath (188): readShort(type) + readInt(matrixId) + readInt(lenOut) + lenOut*readInt + readInt(lenIn) + lenIn*readFloat
    sAdvanceReaders[188] = [](WireBuffer& buf) {
        buf.readShort(); // type
        buf.readInt();   // matrixId
        int lenOut = buf.readInt();
        for (int i = 0; i < lenOut; i++) buf.readInt();
        int lenIn = buf.readInt();
        for (int i = 0; i < lenIn; i++) buf.readFloat();
    };
    sAdvanceNames[188] = "MatrixVectorMath";

    // LoopOperation (215): readInt(indexId) + readFloat(from) + readFloat(step) + readFloat(until)
    sAdvanceReaders[215] = [](WireBuffer& buf) {
        buf.readInt(); buf.readFloat(); buf.readFloat(); buf.readFloat();
    };
    sAdvanceNames[215] = "LoopOperation";

    // RootContentBehavior (65): readInt(scroll) + readInt(alignment) + readInt(sizing) + readInt(mode)
    sAdvanceReaders[65] = [](WireBuffer& buf) {
        buf.readInt(); buf.readInt(); buf.readInt(); buf.readInt();
    };
    sAdvanceNames[65] = "RootContentBehavior";

    // ClipRectModifierOperation (108): marker, reads nothing
    sAdvanceReaders[108] = [](WireBuffer&) {};
    sAdvanceNames[108] = "ClipRectModifierOperation";

    // RoundedClipRectModifierOperation (54): DrawBase4 pattern, 4 floats
    sAdvanceReaders[54] = [](WireBuffer& buf) {
        buf.readFloat(); buf.readFloat(); buf.readFloat(); buf.readFloat();
    };
    sAdvanceNames[54] = "RoundedClipRectModifierOperation";

    // LayoutComponentContent (201)
    sAdvanceReaders[201] = [](WireBuffer& buf) { buf.readInt(); };
    sAdvanceNames[201] = "LayoutComponentContent";

    // CanvasContent (207): only 1 int (componentId)
    sAdvanceReaders[207] = [](WireBuffer& buf) { buf.readInt(); };
    sAdvanceNames[207] = "CanvasContent";

    // CoreText (239): readInt(textId) + readShort(paramsLength) + paramsLength * CommandParameters.read()
    // CommandParameters types: 1=P_INT(4), 2=P_FLOAT(4), 3=P_SHORT(2), 4=P_BYTE(1), 5=P_BOOLEAN(1), 6=PA_INT, 7=PA_FLOAT, 8=PA_STRING
    // CoreText param types by id: 18,19,22=BOOLEAN(1byte); 20=PA_INT; 21=PA_FLOAT; all others=INT/FLOAT(4bytes)
    sAdvanceReaders[239] = [](WireBuffer& buf) {
        buf.readInt(); // textId
        int paramsLength = buf.readShort();
        for (int i = 0; i < paramsLength; i++) {
            int id = buf.readByte();
            switch (id) {
                case 18: case 19: case 22: // BOOLEAN params (underline, strikethrough, autosize)
                    buf.readBoolean();
                    break;
                case 20: { // PA_INT (fontAxis) - readShort(count) + count*readInt
                    int count = buf.readShort();
                    for (int j = 0; j < count; j++) buf.readInt();
                    break;
                }
                case 21: { // PA_FLOAT (fontAxisValues) - readShort(count) + count*readFloat
                    int count = buf.readShort();
                    for (int j = 0; j < count; j++) buf.readFloat();
                    break;
                }
                default: // INT or FLOAT params (all 4 bytes)
                    buf.readInt();
                    break;
            }
        }
    };
    sAdvanceNames[239] = "CoreText";

    // ScrollModifierOperation (226): readInt(direction) + readFloat(position) + readFloat(max) + readFloat(notchMax)
    sAdvanceReaders[226] = [](WireBuffer& buf) {
        buf.readInt(); buf.readFloat(); buf.readFloat(); buf.readFloat();
    };
    sAdvanceNames[226] = "ScrollModifierOperation";

    // ValueFloatExpressionChangeActionOperation (227): readInt(valueId) + readInt(value)
    sAdvanceReaders[227] = [](WireBuffer& buf) {
        buf.readInt(); buf.readInt();
    };
    sAdvanceNames[227] = "ValueFloatExpressionChangeActionOperation";

    // HostActionMetadataOperation (216): readInt(actionId) + readInt(metadataId)
    sAdvanceReaders[216] = [](WireBuffer& buf) {
        buf.readInt(); buf.readInt();
    };
    sAdvanceNames[216] = "HostActionMetadataOperation";

    // TextAttribute (170): readInt(id) + readInt(textId) + readShort(type) + readShort(unused)
    sAdvanceReaders[170] = [](WireBuffer& buf) {
        buf.readInt(); buf.readInt(); buf.readShort(); buf.readShort();
    };
    sAdvanceNames[170] = "TextAttribute";

    // DataMapIds (145)
    sAdvanceReaders[145] = [](WireBuffer& buf) {
        buf.readInt();
        int count = buf.readInt();
        for (int i = 0; i < count; i++) { buf.readInt(); buf.readInt(); }
    };
    sAdvanceNames[145] = "DataMapIds";

    // ImpulseOperation (164)
    sAdvanceReaders[164] = [](WireBuffer& buf) {
        buf.readFloat(); buf.readFloat();
    };
    sAdvanceNames[164] = "ImpulseOperation";

    // ImpulseProcess (165): container marker, reads nothing
    sAdvanceReaders[165] = [](WireBuffer&) {};
    sAdvanceNames[165] = "ImpulseProcess";

    // ParticlesCreate (161)
    sAdvanceReaders[161] = [](WireBuffer& buf) {
        buf.readInt();
        int count = buf.readInt();
        for (int i = 0; i < count; i++) {
            buf.readInt();
            buf.readFloat();
        }
    };
    sAdvanceNames[161] = "ParticlesCreate";

    // ParticlesLoop (163)
    sAdvanceReaders[163] = [](WireBuffer& buf) {
        buf.readInt();
    };
    sAdvanceNames[163] = "ParticlesLoop";

    // ParticlesCompare (194)
    sAdvanceReaders[194] = [](WireBuffer& buf) {
        buf.readInt(); buf.readInt(); buf.readFloat(); buf.readInt();
    };
    sAdvanceNames[194] = "ParticlesCompare";

    // IdLookup (192)
    sAdvanceReaders[192] = [](WireBuffer& buf) {
        buf.readInt(); buf.readInt(); buf.readFloat();
    };
    sAdvanceNames[192] = "IdLookup";

    // DrawToBitmap (190)
    sAdvanceReaders[190] = [](WireBuffer& buf) {
        buf.readInt(); buf.readInt(); buf.readInt();
    };
    sAdvanceNames[190] = "DrawToBitmap";

    // PathTween (158): already in OpcodeRegistry

    // HostActionList (210)
    sAdvanceReaders[210] = [](WireBuffer& buf) {
        buf.readInt();
        int count = buf.readInt();
        for (int i = 0; i < count; i++) buf.readInt();
    };
    sAdvanceNames[210] = "HostActionList";

    // ValueIntegerExpressionChangeActionOperation (218): readLong(valueId) + readLong(value)
    sAdvanceReaders[218] = [](WireBuffer& buf) {
        buf.readLong(); buf.readLong();
    };
    sAdvanceNames[218] = "ValueIntegerExpressionChangeAction";

    // GraphicsLayerModifier (224): readInt(len) + len*(readInt(tag) + readFloat or readInt based on dataType)
    sAdvanceReaders[224] = [](WireBuffer& buf) {
        int len = buf.readInt();
        for (int i = 0; i < len; i++) {
            int tag = buf.readInt();
            int dataType = (tag >> 10) & 0x3;
            if (dataType == 1) { // DATA_TYPE_FLOAT
                buf.readFloat();
            } else {
                buf.readInt(); // DATA_TYPE_INT or other
            }
        }
    };
    sAdvanceNames[224] = "GraphicsLayerModifier";

    // MarqueeModifier (228): readInt(iterations) + readInt(animationMode) + readFloat*4
    sAdvanceReaders[228] = [](WireBuffer& buf) {
        buf.readInt(); buf.readInt();
        buf.readFloat(); buf.readFloat(); buf.readFloat(); buf.readFloat();
    };
    sAdvanceNames[228] = "MarqueeModifier";

    // CollapsibleRowLayout (230)
    sAdvanceReaders[230] = [](WireBuffer& buf) {
        buf.readInt(); buf.readInt(); buf.readInt(); buf.readInt(); buf.readFloat();
    };
    sAdvanceNames[230] = "CollapsibleRowLayout";

    // CollapsibleColumnLayout (233)
    sAdvanceReaders[233] = [](WireBuffer& buf) {
        buf.readInt(); buf.readInt(); buf.readInt(); buf.readInt(); buf.readFloat();
    };
    sAdvanceNames[233] = "CollapsibleColumnLayout";

    // FitBoxLayout (176): readInt(componentId) + readInt(animationId) + readInt(horizontal) + readInt(vertical)
    sAdvanceReaders[176] = [](WireBuffer& buf) {
        buf.readInt(); buf.readInt(); buf.readInt(); buf.readInt();
    };
    sAdvanceNames[176] = "FitBoxLayout";

    // DrawContentModifier (174)
    sAdvanceReaders[174] = [](WireBuffer&) {};
    sAdvanceNames[174] = "DrawContentModifier";

    // DrawBitmapFontTextOnPath (49): high-bit flag pattern
    sAdvanceReaders[49] = [](WireBuffer& buf) {
        int text = buf.readInt();
        if ((text & (int)0x80000000u) != 0) {
            buf.readFloat(); // glyphSpacing
        }
        buf.readInt(); // bitmapFont
        buf.readInt(); // path
        buf.readInt(); // start
        buf.readInt(); // end
        buf.readFloat(); // yAdj
    };
    sAdvanceNames[49] = "DrawBitmapFontTextOnPath";

    // FloatFunctionDefine (168)
    sAdvanceReaders[168] = [](WireBuffer& buf) {
        buf.readInt(); // id
        int varLen = buf.readInt();
        for (int i = 0; i < varLen; i++) buf.readInt();
    };
    sAdvanceNames[168] = "FloatFunctionDefine";

    // ImageAttribute (171)
    sAdvanceReaders[171] = [](WireBuffer& buf) {
        buf.readInt(); // id
        buf.readInt(); // imageId
        buf.readShort(); // type
        int len = buf.readShort();
        for (int i = 0; i < len; i++) buf.readInt();
    };
    sAdvanceNames[171] = "ImageAttribute";

    // TimeAttribute (172)
    sAdvanceReaders[172] = [](WireBuffer& buf) {
        buf.readInt(); // id
        buf.readInt(); // textId
        buf.readShort(); // type
        int len = buf.readShort();
        for (int i = 0; i < len; i++) buf.readInt();
    };
    sAdvanceNames[172] = "TimeAttribute";

    // ColorAttribute (180)
    sAdvanceReaders[180] = [](WireBuffer& buf) {
        buf.readInt(); // id
        buf.readInt(); // textId
        buf.readShort(); // type
    };
    sAdvanceNames[180] = "ColorAttribute";

    // BitmapTextMeasure (183)
    sAdvanceReaders[183] = [](WireBuffer& buf) {
        int id = buf.readInt();
        if ((id & (int)0x80000000u) != 0) {
            buf.readFloat(); // glyphSpacing
        }
        buf.readInt(); // textId
        buf.readInt(); // bitmapFontId
        buf.readInt(); // type
    };
    sAdvanceNames[183] = "BitmapTextMeasure";

    // DrawBitmapTextAnchored (184)
    sAdvanceReaders[184] = [](WireBuffer& buf) {
        int text = buf.readInt();
        if ((text & (int)0x80000000u) != 0) {
            buf.readFloat(); // glyphSpacing
        }
        buf.readInt(); // bitmapFont
        buf.readFloat(); // start
        buf.readFloat(); // end
        buf.readFloat(); // x
        buf.readFloat(); // y
        buf.readFloat(); // panX
        buf.readFloat(); // panY
    };
    sAdvanceNames[184] = "DrawBitmapTextAnchored";

    // FontData (189)
    sAdvanceReaders[189] = [](WireBuffer& buf) {
        buf.readInt(); // imageId
        buf.readInt(); // type
        buf.readBuffer(); // fontData
    };
    sAdvanceNames[189] = "FontData";

    // StateLayout (217)
    sAdvanceReaders[217] = [](WireBuffer& buf) {
        buf.readInt(); // componentId
        buf.readInt(); // animationId
        buf.readInt(); // horizontal
        buf.readInt(); // vertical
        buf.readInt(); // indexId
    };
    sAdvanceNames[217] = "StateLayout";

    // CoreSemantics / ACCESSIBILITY_SEMANTICS (250)
    sAdvanceReaders[250] = [](WireBuffer& buf) {
        buf.readInt(); // contentDescriptionId
        buf.readByte(); // role
        buf.readInt(); // textId
        buf.readInt(); // stateDescriptionId
        buf.readByte(); // mode
        buf.readBoolean(); // enabled
        buf.readBoolean(); // clickable
    };
    sAdvanceNames[250] = "AccessibilitySemantics";
}

// Read file into byte array
static std::vector<uint8_t> readFile(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) {
        std::cerr << "Cannot open: " << path << std::endl;
        exit(1);
    }
    return std::vector<uint8_t>(
        std::istreambuf_iterator<char>(f),
        std::istreambuf_iterator<char>()
    );
}

// Find int value in already-parsed fields
static int findFieldInt(const std::vector<std::pair<std::string, std::string>>& parsedFields,
                        const std::string& name) {
    for (auto& [n, v] : parsedFields) {
        if (n == name) return std::stoi(v);
    }
    return 0;
}

// Detect API level
static int peekApiLevel(WireBuffer& buffer) {
    if (buffer.getIndex() != 0) return -1;
    int headerOpId = buffer.readByte();
    if (headerOpId != 0) { buffer.setIndex(0); return -1; }
    int majorVersion = buffer.readInt();
    int minorVersion = buffer.readInt();
    buffer.setIndex(0);
    if (majorVersion >= 0x10000) {
        if ((majorVersion & (int)0xFFFF0000u) != (int)0x048C0000u) return -1;
        majorVersion &= 0xFFFF;
    }
    if (majorVersion == 1 && minorVersion == 2) return 8;
    if (majorVersion == 1 && minorVersion == 1) return 7;
    if (majorVersion == 1 && minorVersion == 0) return 6;
    if (majorVersion == 0 && minorVersion <= 3) return 6;
    if (majorVersion == 0 && minorVersion == 0) return 6;
    return -1;
}

// Extract profiles from modern header property map
static int extractProfiles(const std::vector<uint8_t>& data) {
    WireBuffer buffer(data.data(), data.size());
    int opcode = buffer.readByte();
    if (opcode != 0) return 0;
    int major = buffer.readInt();
    buffer.readInt(); // minor
    buffer.readInt(); // patch
    if (major < 0x10000) return 0; // legacy format
    int len = buffer.readInt();
    for (int i = 0; i < len; i++) {
        int16_t tag = static_cast<int16_t>(buffer.readShort());
        buffer.readShort(); // itemLen
        int dataType = tag >> 10;
        int key = tag & 0x3F;
        switch (dataType) {
            case 0: { // INT
                int val = buffer.readInt();
                if (key == 14) return val; // DOC_PROFILES = 14
                break;
            }
            case 1: buffer.readFloat(); break;
            case 2: buffer.readLong(); break;
            case 3: buffer.readUTF8(); break;
            default: break; // no bytes read for unknown types (matches Java)
        }
    }
    return 0;
}

static bool sDebugTrace = false;

static std::string rc2json(const std::vector<uint8_t>& data) {
    OpcodeRegistry::init();
    initAdvanceReaders();

    WireBuffer buffer(data.data(), data.size());
    int apiLevel = peekApiLevel(buffer);
    int profiles = (apiLevel >= 7) ? extractProfiles(data) : 0;

    std::ostringstream out;
    out << "{\n";
    out << "  \"rc\": {\n";
    out << "    \"ops\": [\n";

    bool firstOp = true;

    int startIdx = 0, opcode = 0;
    while (buffer.available()) {
      try {
        startIdx = buffer.getIndex();
        opcode = buffer.readByte();

        // First, advance the buffer to find the end position
        int afterOpcode = buffer.getIndex();
        const OpSpec* spec = OpcodeRegistry::get(opcode);
        int endIdx;

        // Prefer explicit advance readers (handle all variable-length patterns correctly)
        auto advIt = sAdvanceReaders.find(opcode);
        if (advIt != sAdvanceReaders.end()) {
            advIt->second(buffer);
            endIdx = buffer.getIndex();
        } else if (spec) {
            // Use spec to advance (works for fixed-length and UTF8/BUFFER fields)
            advanceBySpec(buffer, *spec);
            endIdx = buffer.getIndex();
        } else {
            std::cerr << "Unknown opcode " << opcode << " at index " << startIdx << std::endl;
            exit(1);
        }

        if (sDebugTrace) {
            std::string name = spec ? spec->name : (sAdvanceNames.count(opcode) ? sAdvanceNames[opcode] : "?");
            std::cerr << "  [" << startIdx << "-" << endIdx << "] op=" << opcode << " " << name << std::endl;
        }

        if (!firstOp) out << ",\n";
        firstOp = false;

        int payloadLen = endIdx - startIdx - 1;
        const uint8_t* payloadData = data.data() + startIdx + 1;

        if (spec) {
            // Re-read fields for JSON output
            buffer.setIndex(afterOpcode);
            std::vector<std::pair<std::string, std::string>> parsedFieldValues;

            for (auto& fSpec : spec->fields) {
                std::string value;
                switch (fSpec.type) {
                    case FieldType::BYTE:
                        value = std::to_string(buffer.readByte()); break;
                    case FieldType::SHORT:
                        value = std::to_string(buffer.readShort()); break;
                    case FieldType::INT:
                        value = std::to_string(buffer.readInt()); break;
                    case FieldType::LONG:
                        value = std::to_string(buffer.readLong()); break;
                    case FieldType::FLOAT:
                        value = formatFloat(buffer.readFloat()); break;
                    case FieldType::DOUBLE: {
                        double d = buffer.readDouble();
                        if (std::isnan(d)) {
                            uint64_t bits;
                            memcpy(&bits, &d, sizeof(bits));
                            int64_t id = bits & 0xFFFFFFFFFFFFFL;
                            value = "NaN(" + std::to_string(id) + ")";
                        } else {
                            value = std::to_string(d);
                        }
                        break;
                    }
                    case FieldType::UTF8:
                        value = buffer.readUTF8(); break;
                    case FieldType::BOOLEAN:
                        value = buffer.readBoolean() ? "true" : "false"; break;
                    case FieldType::BUFFER: {
                        auto buf = buffer.readBuffer();
                        value = base64Encode(buf.data(), buf.size());
                        break;
                    }
                    case FieldType::FLOAT_ARRAY: {
                        int len = findFieldInt(parsedFieldValues, "expressionLen");
                        std::string arr = "[";
                        for (int i = 0; i < len; i++) {
                            if (i > 0) arr += ", ";
                            arr += "\"" + formatFloat(buffer.readFloat()) + "\"";
                        }
                        arr += "]";
                        value = arr;
                        break;
                    }
                    case FieldType::FLOAT_ARRAY_BASE64: {
                        int len = findFieldInt(parsedFieldValues, "animationLen");
                        int nbytes = len * 4;
                        value = base64Encode(data.data() + buffer.getIndex(), nbytes);
                        buffer.setIndex(buffer.getIndex() + nbytes);
                        break;
                    }
                }
                parsedFieldValues.push_back({fSpec.name, value});
            }

            // Restore buffer to correct end position
            buffer.setIndex(endIdx);

            bool isFixed = spec->isFixedLength() || spec->forceReconstruct;

            // Output JSON
            out << "      {\n";
            out << "        \"kind\": \"op\",\n";
            out << "        \"name\": \"" << spec->name << "\",\n";
            out << "        \"opcode\": " << opcode << ",\n";
            out << "        \"fields\": [";

            for (size_t i = 0; i < parsedFieldValues.size(); i++) {
                auto& [fname, fval] = parsedFieldValues[i];
                auto& ftype = spec->fields[i].type;
                std::string typeStr;
                switch (ftype) {
                    case FieldType::BYTE: typeStr = "BYTE"; break;
                    case FieldType::SHORT: typeStr = "SHORT"; break;
                    case FieldType::INT: typeStr = "INT"; break;
                    case FieldType::LONG: typeStr = "LONG"; break;
                    case FieldType::FLOAT: typeStr = "FLOAT"; break;
                    case FieldType::DOUBLE: typeStr = "DOUBLE"; break;
                    case FieldType::UTF8: typeStr = "UTF8"; break;
                    case FieldType::BUFFER: typeStr = "BUFFER"; break;
                    case FieldType::BOOLEAN: typeStr = "BOOLEAN"; break;
                    case FieldType::FLOAT_ARRAY: typeStr = "FLOAT_ARRAY"; break;
                    case FieldType::FLOAT_ARRAY_BASE64: typeStr = "FLOAT_ARRAY_BASE64"; break;
                }

                bool singleField = (parsedFieldValues.size() == 1);

                if (singleField) {
                    out << "{";
                } else {
                    if (i == 0) out << "\n";
                    out << "          {";
                }

                out << "\n";
                out << "            \"name\": \"" << fname << "\",\n";
                out << "            \"type\": \"" << typeStr << "\",\n";

                if (ftype == FieldType::FLOAT_ARRAY) {
                    out << "            \"value\": " << fval << "\n";
                } else if (ftype == FieldType::UTF8 || ftype == FieldType::BUFFER
                           || ftype == FieldType::FLOAT_ARRAY_BASE64) {
                    out << "            \"value\": \"" << jsonEscape(fval) << "\"\n";
                } else {
                    out << "            \"value\": \"" << fval << "\"\n";
                }

                if (singleField) {
                    out << "          }]";
                } else {
                    out << "          }";
                    if (i < parsedFieldValues.size() - 1) out << ",";
                    if (i == parsedFieldValues.size() - 1) out << "\n        ]";
                    out << "\n";
                }
            }

            if (parsedFieldValues.empty()) {
                out << "]";
            }

            // Java logic: two independent checks (not mutually exclusive)
            bool hasReconstruct = spec->isFixedLength() || spec->forceReconstruct;
            bool needsPayload = !spec->isFixedLength();

            if (hasReconstruct && needsPayload) {
                out << ",\n        \"reconstructFromFields\": true,\n";
                out << "        \"payloadBase64\": \""
                    << base64Encode(payloadData, payloadLen) << "\"\n";
            } else if (hasReconstruct) {
                out << ",\n        \"reconstructFromFields\": true\n";
            } else {
                out << ",\n        \"payloadBase64\": \""
                    << base64Encode(payloadData, payloadLen) << "\"\n";
            }

            out << "      }";

        } else {
            // Opaque operation
            std::string opName = "Unknown";
            auto nameIt = sAdvanceNames.find(opcode);
            if (nameIt != sAdvanceNames.end()) opName = nameIt->second;

            out << "      {\n";
            out << "        \"kind\": \"opaque\",\n";
            out << "        \"name\": \"" << opName << "\",\n";
            out << "        \"opcode\": " << opcode << ",\n";
            out << "        \"payloadBase64\": \""
                << base64Encode(payloadData, payloadLen) << "\"\n";
            out << "      }";

            buffer.setIndex(endIdx);
        }
      } catch (const std::exception& e) {
          std::cerr << "Error parsing opcode " << opcode << " at index " << startIdx
                    << " (buf pos " << buffer.getIndex() << "): " << e.what() << std::endl;
          exit(1);
      }
    }

    out << "\n    ],\n";
    out << "    \"profiles\": " << profiles << ",\n";
    out << "    \"apiLevel\": " << apiLevel << "\n";
    out << "  },\n";
    out << "  \"format\": \"androidx.compose.remote.rc.json\",\n";
    out << "  \"version\": 1\n";
    out << "}";

    return out.str();
}

int main(int argc, char* argv[]) {
    if (argc < 2) {
        std::cerr << "Usage: rc2json <command> [args...]\n"
                  << "  rc2json rc2json <in.rc> <out.json>\n"
                  << "  rc2json report\n";
        return 1;
    }

    std::string cmd = argv[1];

    if (cmd == "report") {
        std::cout << "Opcode Registry Report\n======================\n"
                  << "(Report not yet implemented in C++)" << std::endl;
        return 0;
    }

    if (std::getenv("RC2JSON_DEBUG")) sDebugTrace = true;

    if (cmd == "rc2json") {
        if (argc < 4) {
            std::cerr << "Usage: rc2json rc2json <in.rc> <out.json>" << std::endl;
            return 1;
        }
        auto data = readFile(argv[2]);
        std::string json = rc2json(data);

        std::ofstream outFile(argv[3]);
        if (!outFile) {
            std::cerr << "Cannot write: " << argv[3] << std::endl;
            return 1;
        }
        outFile << json;
        outFile.close();

        std::string inPath = argv[2];
        auto pos = inPath.find_last_of("/\\");
        std::string filename = (pos != std::string::npos) ? inPath.substr(pos + 1) : inPath;
        std::cout << "Success: Binary -> JSON (" << filename << ")" << std::endl;
        return 0;
    }

    std::cerr << "Unknown command: " << cmd << std::endl;
    return 1;
}
