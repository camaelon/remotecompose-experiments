#pragma once
#include <string>
#include <vector>
#include <unordered_map>

namespace rccore {

enum class FieldType {
    BYTE, SHORT, INT, LONG, FLOAT, DOUBLE, UTF8, BUFFER, BOOLEAN,
    FLOAT_ARRAY, FLOAT_ARRAY_BASE64
};

struct FieldSpec {
    std::string name;
    FieldType type;
};

struct OpSpec {
    int opcode;
    std::string name;
    std::vector<FieldSpec> fields;
    bool isVariable = false;
    bool forceReconstruct = false;

    bool isFixedLength() const {
        if (isVariable) return false;
        for (auto& f : fields) {
            if (f.type == FieldType::UTF8 || f.type == FieldType::BUFFER
                || f.type == FieldType::FLOAT_ARRAY
                || f.type == FieldType::FLOAT_ARRAY_BASE64) {
                return false;
            }
        }
        return true;
    }
};

class OpcodeRegistry {
public:
    static void init();
    static const OpSpec* get(int opcode);

private:
    static void reg(OpSpec spec);
    static std::unordered_map<int, OpSpec> sSpecs;
    static bool sInitialized;
};

} // namespace rccore
