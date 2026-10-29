#pragma once
// Loom (pattern / macro) id remapping. Port of remote-core's
// operations/loom/RemapContext.java.
//
// A pattern body is stored as bytes and re-read once per call site through a WireBuffer that
// carries one of these. Readers ask the buffer to declareId() the ids they define and
// readId() / readNanId() / readLongNanId() the ids they reference; the context decides what
// each becomes:
//   Tier 1, system globals (0..41): never remapped.
//   Tier 2, pattern-local ids (0x4000..0x4FFF): always a fresh id per call site.
//   Any other id declared while inside a macro: a fresh id too, so two inflations of one
//   template never share a component or variable. A reference resolves through the map
//   (parameter ids are seeded with the call's argument ids) and passes through otherwise.
// Fresh ids come from the document's counter (CoreDocument::getNextId), in read order, so the
// ids an inflation produces are the reference's exactly.

#include <cstdint>
#include <memory>
#include <unordered_map>

namespace rccore {

class IdAllocator {
public:
    virtual ~IdAllocator() = default;
    virtual int getNextId() = 0;
};

class RemapContext {
public:
    explicit RemapContext(IdAllocator* allocator)
        : mMap(std::make_shared<std::unordered_map<int, int>>()), mAllocator(allocator) {}

    /** A context sharing this one's mappings until either side adds one (copy on write). */
    RemapContext fork() const {
        RemapContext c(*this);
        return c;
    }
    RemapContext withInsideMacro(bool inside) const {
        RemapContext c(*this);
        c.mInsideMacro = inside;
        return c;
    }
    bool isInsideMacro() const { return mInsideMacro; }

    void addMapping(int originalId, int newId) {
        if (mMap.use_count() > 1) mMap = std::make_shared<std::unordered_map<int, int>>(*mMap);
        (*mMap)[originalId] = newId;
    }

    int resolveId(int id) const {
        auto it = mMap->find(id);
        return it == mMap->end() ? id : it->second;
    }

    /** A float that may be a NaN-boxed id (Utils.asNan / idFromNan: low 22 bits). */
    int32_t resolveNanIdBits(int32_t bits) const {
        if (!isNaNBits(bits)) return bits;
        int id = bits & 0x3FFFFF;
        int mapped = resolveId(id);
        return mapped == id ? bits : asNanBits(mapped);
    }

    /** A long-encoded id (Utils.longIdFromNan: id + 2^32). */
    int64_t resolveLongNanId(int64_t v) const {
        int64_t decoded = v - 0x100000000LL;
        int id = static_cast<int>(decoded);
        if (id != decoded) return v;
        int mapped = resolveId(id);
        return mapped == id ? v : static_cast<int64_t>(mapped) + 0x100000000LL;
    }

    int declareId(int originalId) {
        if (originalId == -1) return -1;
        auto it = mMap->find(originalId);
        if (it != mMap->end()) return it->second;
        if (isMacroLocal(originalId) || (mInsideMacro && !isSystemGlobal(originalId))) {
            int newId = mAllocator ? mAllocator->getNextId() : originalId;
            addMapping(originalId, newId);
            return newId;
        }
        return originalId;
    }

    static bool isSystemGlobal(int id) { return id >= 0 && id <= 41; }
    static bool isMacroLocal(int id) { return id >= 0x4000 && id <= 0x4FFF; }
    static bool isNaNBits(int32_t bits) { return (bits & 0x7F800000) == 0x7F800000 && (bits & 0x7FFFFF) != 0; }
    static int32_t asNanBits(int id) { return static_cast<int32_t>(0xFF800000u | static_cast<uint32_t>(id)); }

private:
    std::shared_ptr<std::unordered_map<int, int>> mMap;
    IdAllocator* mAllocator;
    bool mInsideMacro = false;
};

} // namespace rccore
