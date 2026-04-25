#pragma once
#include "rccore/Operation.h"
#include "rccore/WireBuffer.h"
#include "rccore/operations/FloatFormat.h"

namespace rccore {

class DrawLine : public Operation {
public:
    static constexpr int OP_CODE = 47;
    float x1, y1, x2, y2;

    std::string name() const override { return "DRAW_LINE"; }
    int opcode() const override { return OP_CODE; }
    std::vector<Field> fields() const override {
        return {
            {"x1", "FLOAT", formatFloat(x1)},
            {"y1", "FLOAT", formatFloat(y1)},
            {"x2", "FLOAT", formatFloat(x2)},
            {"y2", "FLOAT", formatFloat(y2)},
        };
    }

    static void read(WireBuffer& buffer, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<DrawLine>();
        op->x1 = buffer.readFloat();
        op->y1 = buffer.readFloat();
        op->x2 = buffer.readFloat();
        op->y2 = buffer.readFloat();
        ops.push_back(std::move(op));
    }
};

} // namespace rccore
