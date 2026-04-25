#pragma once
#include "rccore/Operation.h"
#include "rccore/WireBuffer.h"

namespace rccore {

class TextData : public Operation {
public:
    static constexpr int OP_CODE = 102;
    int textId;
    std::string text;

    std::string name() const override { return "DATA_TEXT"; }
    int opcode() const override { return OP_CODE; }
    std::vector<Field> fields() const override {
        return {
            {"textId", "INT", std::to_string(textId)},
            {"text", "UTF8", text},
        };
    }

    static void read(WireBuffer& buffer, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<TextData>();
        int start = buffer.getIndex();
        op->textId = buffer.readInt();
        op->text = buffer.readUTF8();
        op->payload.assign(buffer.data() + start, buffer.data() + buffer.getIndex());
        ops.push_back(std::move(op));
    }
};

} // namespace rccore
