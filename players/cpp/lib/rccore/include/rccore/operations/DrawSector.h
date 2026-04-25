#pragma once
#include "rccore/Operation.h"
#include "rccore/WireBuffer.h"
#include "rccore/operations/FloatFormat.h"

namespace rccore {

class DrawSector : public Operation {
public:
    static constexpr int OP_CODE = 52;
    float left, top, right, bottom, startAngle, sweepAngle;

    std::string name() const override { return "DRAW_SECTOR"; }
    int opcode() const override { return OP_CODE; }
    std::vector<Field> fields() const override {
        return {
            {"left", "FLOAT", formatFloat(left)},
            {"top", "FLOAT", formatFloat(top)},
            {"right", "FLOAT", formatFloat(right)},
            {"bottom", "FLOAT", formatFloat(bottom)},
            {"startAngle", "FLOAT", formatFloat(startAngle)},
            {"sweepAngle", "FLOAT", formatFloat(sweepAngle)},
        };
    }

    static void read(WireBuffer& buffer, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<DrawSector>();
        op->left = buffer.readFloat();
        op->top = buffer.readFloat();
        op->right = buffer.readFloat();
        op->bottom = buffer.readFloat();
        op->startAngle = buffer.readFloat();
        op->sweepAngle = buffer.readFloat();
        ops.push_back(std::move(op));
    }
};

} // namespace rccore
