#pragma once
#include "rccore/Operation.h"
#include "rccore/WireBuffer.h"

namespace rccore {

class RootContentDescription : public Operation {
public:
    static constexpr int OP_CODE = 103;
    int contentDescriptionId;

    std::string name() const override { return "ROOT_CONTENT_DESCRIPTION"; }
    int opcode() const override { return OP_CODE; }
    std::vector<Field> fields() const override {
        return {{"contentDescriptionId", "INT", std::to_string(contentDescriptionId)}};
    }

    static void read(WireBuffer& buffer, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<RootContentDescription>();
        op->contentDescriptionId = buffer.readInt();
        ops.push_back(std::move(op));
    }
};

} // namespace rccore
