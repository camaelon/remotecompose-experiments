#pragma once
#include "rccore/Operation.h"
#include "rccore/WireBuffer.h"
#include "rccore/operations/FloatFormat.h"

namespace rccore {

class DrawOval : public Operation {
public:
    static constexpr int OP_CODE = 56;
    float left, top, right, bottom;

    std::string name() const override { return "DRAW_OVAL"; }
    int opcode() const override { return OP_CODE; }
    std::vector<Field> fields() const override {
        return {
            {"left", "FLOAT", formatFloat(left)},
            {"top", "FLOAT", formatFloat(top)},
            {"right", "FLOAT", formatFloat(right)},
            {"bottom", "FLOAT", formatFloat(bottom)},
        };
    }

    static void read(WireBuffer& buffer, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<DrawOval>();
        op->left = buffer.readFloat();
        op->top = buffer.readFloat();
        op->right = buffer.readFloat();
        op->bottom = buffer.readFloat();
        ops.push_back(std::move(op));
    }
};

} // namespace rccore
