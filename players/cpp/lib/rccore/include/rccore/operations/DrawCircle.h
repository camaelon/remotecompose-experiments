#pragma once
#include "rccore/Operation.h"
#include "rccore/WireBuffer.h"
#include "rccore/operations/FloatFormat.h"

namespace rccore {

class DrawCircle : public Operation {
public:
    static constexpr int OP_CODE = 46;
    float centerX, centerY, radius;

    std::string name() const override { return "DRAW_CIRCLE"; }
    int opcode() const override { return OP_CODE; }
    std::vector<Field> fields() const override {
        return {
            {"centerX", "FLOAT", formatFloat(centerX)},
            {"centerY", "FLOAT", formatFloat(centerY)},
            {"radius", "FLOAT", formatFloat(radius)},
        };
    }

    static void read(WireBuffer& buffer, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<DrawCircle>();
        op->centerX = buffer.readFloat();
        op->centerY = buffer.readFloat();
        op->radius = buffer.readFloat();
        ops.push_back(std::move(op));
    }
};

} // namespace rccore
