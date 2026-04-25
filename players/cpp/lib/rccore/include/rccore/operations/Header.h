#pragma once
#include "rccore/Operation.h"
#include "rccore/WireBuffer.h"
#include <map>
#include <variant>

namespace rccore {

class Header : public Operation {
public:
    static constexpr int OP_CODE = 0;
    static constexpr int32_t MAGIC_NUMBER = 0x52430000; // "RC" prefix

    // Legacy header
    int majorVersion;
    int minorVersion;
    int patchVersion;
    int width = 0;
    int height = 0;
    int64_t capabilities = 0;
    bool isModern = false;

    // Modern header map
    using MapValue = std::variant<int32_t, float, int64_t, std::string>;
    std::map<int, MapValue> headerMap;

    std::string name() const override { return "HEADER"; }
    int opcode() const override { return OP_CODE; }
    std::vector<Field> fields() const override;
    void apply(RemoteContext& context) override;

    static void read(WireBuffer& buffer, std::vector<std::unique_ptr<Operation>>& operations);
};

} // namespace rccore
