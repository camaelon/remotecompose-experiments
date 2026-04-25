#pragma once
#include "rccore/Operation.h"
#include "rccore/WireBuffer.h"

namespace rccore {

class PaintData : public Operation {
public:
    static constexpr int OP_CODE = 40;
    int length;
    std::vector<int32_t> paintValues;

    std::string name() const override { return "PAINT_VALUES"; }
    int opcode() const override { return OP_CODE; }
    std::vector<Field> fields() const override {
        return {{"length", "INT", std::to_string(length)}};
    }

    static void read(WireBuffer& buffer, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<PaintData>();
        int start = buffer.getIndex();
        op->length = buffer.readInt();
        op->paintValues.resize(op->length);
        for (int i = 0; i < op->length; i++) {
            op->paintValues[i] = buffer.readInt();
        }
        op->payload.assign(buffer.data() + start, buffer.data() + buffer.getIndex());
        ops.push_back(std::move(op));
    }
};

} // namespace rccore
