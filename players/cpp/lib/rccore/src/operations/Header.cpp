#include "rccore/operations/Header.h"
#include "rccore/RemoteContext.h"

namespace rccore {

void Header::apply(RemoteContext& context) {
    // Only set context header in DATA mode (dimensions are set by the render host)
    if (context.getMode() == ContextMode::DATA) {
        context.header(majorVersion, minorVersion, patchVersion,
                       width, height, capabilities);
    }
}

static constexpr int DATA_TYPE_INT = 0;
static constexpr int DATA_TYPE_FLOAT = 1;
static constexpr int DATA_TYPE_LONG = 2;
static constexpr int DATA_TYPE_STRING = 3;

std::vector<Field> Header::fields() const {
    if (!isModern) {
        return {
            {"major", "INT", std::to_string(majorVersion)},
            {"minor", "INT", std::to_string(minorVersion)},
            {"patch", "INT", std::to_string(patchVersion)},
            {"width", "INT", std::to_string(width)},
            {"height", "INT", std::to_string(height)},
            {"capabilities", "LONG", std::to_string(capabilities)},
        };
    }
    // Modern header: output map entries as fields
    std::vector<Field> result;
    result.push_back({"major", "INT", std::to_string(majorVersion)});
    result.push_back({"minor", "INT", std::to_string(minorVersion)});
    result.push_back({"patch", "INT", std::to_string(patchVersion)});
    for (auto& [tag, val] : headerMap) {
        std::string tagName = "tag_" + std::to_string(tag);
        if (std::holds_alternative<int32_t>(val)) {
            result.push_back({tagName, "INT", std::to_string(std::get<int32_t>(val))});
        } else if (std::holds_alternative<float>(val)) {
            result.push_back({tagName, "FLOAT", std::to_string(std::get<float>(val))});
        } else if (std::holds_alternative<int64_t>(val)) {
            result.push_back({tagName, "LONG", std::to_string(std::get<int64_t>(val))});
        } else if (std::holds_alternative<std::string>(val)) {
            result.push_back({tagName, "UTF8", std::get<std::string>(val)});
        }
    }
    return result;
}

static void readMap(WireBuffer& buffer, int len,
                    std::map<int, Header::MapValue>& map) {
    for (int i = 0; i < len; i++) {
        int16_t tag = static_cast<int16_t>(buffer.readShort());
        buffer.readShort(); // itemLen
        int dataType = tag >> 10;
        int key = tag & 0x3F;
        switch (dataType) {
            case DATA_TYPE_INT:
                map[key] = buffer.readInt();
                break;
            case DATA_TYPE_FLOAT:
                map[key] = buffer.readFloat();
                break;
            case DATA_TYPE_LONG:
                map[key] = buffer.readLong();
                break;
            case DATA_TYPE_STRING:
                map[key] = buffer.readUTF8();
                break;
            default:
                // Skip unknown type - read 4 bytes
                buffer.readInt();
                break;
        }
    }
}

void Header::read(WireBuffer& buffer, std::vector<std::unique_ptr<Operation>>& operations) {
    auto header = std::make_unique<Header>();
    int payloadStart = buffer.getIndex();

    header->majorVersion = buffer.readInt();
    header->minorVersion = buffer.readInt();
    header->patchVersion = buffer.readInt();

    if (header->majorVersion < 0x10000) {
        // Legacy header
        header->isModern = false;
        header->width = buffer.readInt();
        header->height = buffer.readInt();
        header->capabilities = buffer.readLong();
    } else {
        // Modern header with MAGIC_NUMBER
        header->isModern = true;
        header->majorVersion &= 0xFFFF;
        int len = buffer.readInt();
        readMap(buffer, len, header->headerMap);

        // Extract width/height from map (keys 5/6), default 256 like Java
        static constexpr int DOC_WIDTH = 5;
        static constexpr int DOC_HEIGHT = 6;
        auto wIt = header->headerMap.find(DOC_WIDTH);
        if (wIt != header->headerMap.end() && std::holds_alternative<int32_t>(wIt->second))
            header->width = std::get<int32_t>(wIt->second);
        else
            header->width = 256;
        auto hIt = header->headerMap.find(DOC_HEIGHT);
        if (hIt != header->headerMap.end() && std::holds_alternative<int32_t>(hIt->second))
            header->height = std::get<int32_t>(hIt->second);
        else
            header->height = 256;
    }

    int payloadEnd = buffer.getIndex();
    header->payload.assign(
        buffer.data() + payloadStart,
        buffer.data() + payloadEnd
    );

    operations.push_back(std::move(header));
}

} // namespace rccore
