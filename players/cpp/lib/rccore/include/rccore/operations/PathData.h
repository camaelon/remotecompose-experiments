#pragma once
#include "rccore/Operation.h"
#include "rccore/WireBuffer.h"

namespace rccore {

// PathData uses startWithSize encoding and is output as "opaque" in JSON
class PathData : public Operation {
public:
    static constexpr int OP_CODE = 123;

    std::string name() const override { return "PathData"; }
    int opcode() const override { return OP_CODE; }
    std::vector<Field> fields() const override { return {}; } // opaque - no parsed fields

    static void read(WireBuffer& buffer, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<PathData>();
        // PathData uses startWithSize: first 4 bytes after opcode is the total size
        int startPos = buffer.getIndex();
        int size = buffer.readInt();
        // size includes the size field itself and the opcode byte
        // The data after the size int spans (size - 5) bytes (1 byte opcode + 4 bytes size)
        int dataBytes = size - 5; // size counts from the opcode byte
        // Skip the remaining data
        buffer.setIndex(startPos + size - 1); // -1 because opcode was already read
        // Payload is everything from startPos to current
        op->payload.assign(buffer.data() + startPos, buffer.data() + buffer.getIndex());
        ops.push_back(std::move(op));
    }
};

} // namespace rccore
