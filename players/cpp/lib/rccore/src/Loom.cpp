// Loom expansion. See Loom.h, and remote-core's operations/loom for the reference.

#include "rccore/Loom.h"
#include "rccore/Operations.h"
#include "rccore/operations/AdvancedOperations.h"
#include "rccore/operations/DrawOperations.h"
#include "rccore/operations/LayoutOperations.h"
#include <cstdio>
#include <cstdlib>
#include <string>
#include <unordered_map>
#include <unordered_set>

namespace rccore {

namespace {

constexpr int OP_HEADER = 0;
constexpr int OP_CONTAINER_END = 214;
constexpr int OP_REFERENCED_OPERATIONS = 142;
constexpr int OP_MACRO_FOR_EACH = 244;
constexpr int OP_INCLUDE_REFERENCED = 245;
constexpr int OP_MACRO_DEFINE = 246;
constexpr int OP_MACRO_CALL = 247;
constexpr int OP_MACRO_ARGUMENT = 248;
constexpr int OP_MACRO_BLOCK = 249;
constexpr int MAX_EXPANSION_DEPTH = 64;

// Opcodes whose reference class implements VariableProvider; getId() is the first id the
// reader reads, except ComponentValue (150), whose second (the value) it is. Components are
// VariableProviders too, reporting their component id.
const std::unordered_set<int>& variableProviders() {
    static const std::unordered_set<int> s = {45, 64, 80, 81, 101, 102, 123, 134, 135, 136, 138, 142, 144,
        145, 146, 147, 150, 153, 156, 157, 158, 159, 161, 175, 180, 186, 187, 193, 196, 197, 242};
    return s;
}

std::vector<uint8_t> slice(const WireBuffer& buf, int from, int to) {
    if (from < 0 || to <= from) return {};
    return std::vector<uint8_t>(buf.data() + from, buf.data() + to);
}

} // namespace

bool readOperationTree(WireBuffer& buffer, std::vector<std::unique_ptr<Operation>>& out,
                       int* maxProviderId) {
    struct Open { Operation* op; int bodyStart; };
    std::vector<Open> stack;
    const bool trace = std::getenv("RC_TRACE") != nullptr;
    std::vector<int32_t> idTrace;

    while (buffer.available()) {
        int opStart = buffer.getIndex();
        int opcode = buffer.readByte();
        if (trace) {
            std::fprintf(stderr, "[rc] pos=%-6d op=%-4d %s\n", opStart, opcode,
                         Operations::getName(opcode).c_str());
        }
        if (opcode == OP_CONTAINER_END) {
            if (!stack.empty()) {
                Open closed = stack.back();
                stack.pop_back();
                // Keep the bytes of the bodies Loom re-reads.
                std::vector<uint8_t>* body = nullptr;
                switch (closed.op->opcode()) {
                    case OP_MACRO_DEFINE: body = &static_cast<PatternDefine*>(closed.op)->body; break;
                    case OP_MACRO_FOR_EACH: body = &static_cast<PatternForEach*>(closed.op)->body; break;
                    case OP_REFERENCED_OPERATIONS: body = &static_cast<ReferencedOperations*>(closed.op)->body; break;
                    case OP_MACRO_BLOCK: {
                        auto* block = static_cast<PatternBlock*>(closed.op);
                        body = &block->body;
                        if (buffer.remapContext()) block->readContext = std::make_shared<RemapContext>(*buffer.remapContext());
                        break;
                    }
                    default: break;
                }
                if (body && body->empty()) *body = slice(buffer, closed.bodyStart, opStart);
            }
            continue;
        }
        auto reader = Operations::getReader(opcode);
        if (!reader) return false;

        std::vector<std::unique_ptr<Operation>> temp;
        idTrace.clear();
        buffer.mIdTrace = maxProviderId ? &idTrace : nullptr;
        reader(buffer, temp);
        buffer.mIdTrace = nullptr;

        for (auto& op : temp) {
            if (maxProviderId) {
                int id = op->getOpComponentId();
                bool have = id != -1;
                if (!have && variableProviders().count(opcode) && !idTrace.empty()) {
                    id = opcode == 150 ? idTrace.back() : idTrace.front();
                    have = true;
                }
                // CoreDocument.initFromBuffer: ids below ID_REGION_ARRAY (0x200000) only.
                if (have && id < 0x200000 && id > *maxProviderId) *maxProviderId = id;
            }
            bool isContainer = op->isContainer();
            Operation* raw = op.get();
            if (stack.empty()) out.push_back(std::move(op));
            else stack.back().op->addChild(std::move(op));
            if (isContainer) stack.push_back({raw, buffer.getIndex()});
        }
    }
    return true;
}

namespace {

using OpList = std::vector<std::unique_ptr<Operation>>;
using Blocks = std::unordered_map<int, PatternBlock*>;

class Expander {
public:
    explicit Expander(IdAllocator& ids) : mIds(ids) {}

    void indexDocument(const OpList& ops) {
        for (auto& op : ops) {
            switch (op->opcode()) {
                case 102: { auto* t = static_cast<TextData*>(op.get()); mTexts[t->textId] = t->text; break; }
                case 146: { auto* d = static_cast<DataListIds*>(op.get()); mArrays[d->id] = d->ids; break; }
                case OP_REFERENCED_OPERATIONS: {
                    auto* r = static_cast<ReferencedOperations*>(op.get());
                    mReferenced.emplace(r->refId, r);
                    break;
                }
                default: break;
            }
            int cid = op->getOpComponentId();
            if (cid != -1) mComponentIds.insert(cid);
            // A referenced group's own components are not in the tree (not laid out where
            // the group is defined), so its first inclusion keeps their ids.
            if (!op->mChildren.empty() && op->opcode() != OP_REFERENCED_OPERATIONS)
                indexDocument(op->mChildren);
        }
    }

    void expand(OpList& in, OpList& out, RemapContext& ctx, const Blocks& blocks, int depth) {
        if (depth > MAX_EXPANSION_DEPTH) {
            std::fprintf(stderr, "[loom] maximum expansion depth exceeded\n");
            return;
        }
        for (auto& op : in) {
            if (!op) continue;
            switch (op->opcode()) {
                case OP_MACRO_DEFINE: {
                    // Register; a definition draws nothing where it is defined.
                    auto* def = static_cast<PatternDefine*>(op.get());
                    mDefines.emplace(def->patternId, def);
                    auto name = mTexts.find(def->patternId);
                    if (name != mTexts.end()) mDefinesByName.emplace(name->second, def);
                    mKeep.push_back(std::move(op));
                    break;
                }
                case OP_MACRO_CALL: expandCall(op, out, ctx, depth); break;
                case OP_MACRO_ARGUMENT: {
                    auto* arg = static_cast<PatternArgument*>(op.get());
                    auto it = blocks.find(arg->paramIndex);
                    if (it == blocks.end()) break;
                    PatternBlock* block = it->second;
                    OpList content;
                    if (!block->consumed) {
                        block->consumed = true;
                        content = std::move(block->mChildren);
                        block->mChildren.clear();
                    } else if (!block->body.empty()) {
                        RemapContext replay = block->readContext ? *block->readContext : RemapContext(&mIds);
                        readBody(block->body, replay, content);
                    }
                    expand(content, out, ctx, blocks, depth);
                    break;
                }
                case OP_MACRO_FOR_EACH: {
                    auto* each = static_cast<PatternForEach*>(op.get());
                    auto arr = mArrays.find(each->collectionId);
                    if (arr == mArrays.end() || each->body.empty()) break;
                    for (int item : arr->second) {
                        RemapContext itemCtx = ctx.fork().withInsideMacro(true);
                        itemCtx.addMapping(each->localItemId, item);
                        OpList body;
                        readBody(each->body, itemCtx, body);
                        dropHeaders(body);
                        expand(body, out, itemCtx, Blocks{}, depth);
                    }
                    break;
                }
                case OP_INCLUDE_REFERENCED: {
                    auto* inc = static_cast<IncludeReferencedOperations*>(op.get());
                    auto ref = mReferenced.find(inc->refId);
                    if (ref == mReferenced.end() || ref->second->body.empty()) { out.push_back(std::move(op)); break; }
                    RemapContext incCtx = ctx.fork().withInsideMacro(true);
                    OpList body;
                    readBody(ref->second->body, incCtx, body);
                    dropHeaders(body);
                    // The reference re-reads the group with its component ids unchanged, so
                    // a second inclusion holds components sharing ids with the first. Its
                    // components are distinct objects there; this player keys measure,
                    // layout and animation state by component id, so a repeated id is
                    // renumbered (outside the document's id counter, which stays the
                    // reference's).
                    renumberRepeatedComponents(body);
                    expand(body, out, incCtx, Blocks{}, depth + 1);
                    break;
                }
                default: {
                    // Any other container (ReferencedOperations included: its definition
                    // site keeps its content, as the reference's materialize emits it)
                    // expands its children in place.
                    if (!op->mChildren.empty()) {
                        OpList children = std::move(op->mChildren);
                        op->mChildren.clear();
                        OpList expanded;
                        expand(children, expanded, ctx, blocks, depth);
                        op->mChildren = std::move(expanded);
                    }
                    out.push_back(std::move(op));
                    break;
                }
            }
        }
    }

private:
    void expandCall(std::unique_ptr<Operation>& op, OpList& out, RemapContext& ctx, int depth) {
        auto* call = static_cast<PatternInflation*>(op.get());
        PatternDefine* def = nullptr;
        if (auto it = mDefines.find(call->patternId); it != mDefines.end()) def = it->second;
        else if (auto t = mTexts.find(call->patternId); t != mTexts.end()) {
            if (auto n = mDefinesByName.find(t->second); n != mDefinesByName.end()) def = n->second;
        }
        if (!def || def->body.empty()) { out.push_back(std::move(op)); return; }

        // PatternInflation.materialize: fork, inside the macro, parameters seeded with the
        // (already translated) argument ids, the call's blocks recorded for its arguments.
        RemapContext callCtx = ctx.fork().withInsideMacro(true);
        for (size_t i = 0; i < std::min(def->paramIds.size(), call->argIds.size()); i++) {
            callCtx.addMapping(def->paramIds[i], call->argIds[i]);
        }
        Blocks blocks;
        for (auto& child : call->mChildren) {
            if (child->opcode() == OP_MACRO_BLOCK) {
                auto* b = static_cast<PatternBlock*>(child.get());
                blocks[b->paramIndex] = b;
            }
        }
        OpList body;
        readBody(def->body, callCtx, body);
        mKeep.push_back(std::move(op));   // the blocks it owns stay alive for its arguments
        expand(body, out, callCtx, blocks, depth + 1);
    }

    void renumberRepeatedComponents(OpList& ops) {
        for (auto& op : ops) {
            int cid = op->getOpComponentId();
            if (cid != -1) {
                if (mComponentIds.count(cid)) {
                    cid = mNextRenumberedId--;
                    op->setOpComponentId(cid);
                }
                mComponentIds.insert(cid);
            }
            if (!op->mChildren.empty()) renumberRepeatedComponents(op->mChildren);
        }
    }

    void readBody(const std::vector<uint8_t>& bytes, RemapContext& ctx, OpList& out) {
        WireBuffer buf(bytes.data(), bytes.size());
        buf.setRemapContext(&ctx);
        readOperationTree(buf, out);
    }

    static void dropHeaders(OpList& ops) {
        for (auto it = ops.begin(); it != ops.end();) {
            if ((*it)->opcode() == OP_HEADER) it = ops.erase(it); else ++it;
        }
    }

    IdAllocator& mIds;
    std::unordered_map<int, std::string> mTexts;
    std::unordered_map<int, std::vector<int>> mArrays;
    std::unordered_map<int, ReferencedOperations*> mReferenced;
    std::unordered_set<int> mComponentIds;
    int mNextRenumberedId = -0x100000;
    std::unordered_map<int, PatternDefine*> mDefines;
    std::unordered_map<std::string, PatternDefine*> mDefinesByName;
    OpList mKeep;   // definitions and calls removed from the tree but still referenced
public:
    OpList takeKept() { return std::move(mKeep); }
};

} // namespace

void expandLoom(std::vector<std::unique_ptr<Operation>>& ops, IdAllocator& ids) {
    Expander expander(ids);
    expander.indexDocument(ops);
    RemapContext root(&ids);
    OpList in = std::move(ops);
    ops.clear();
    expander.expand(in, ops, root, {}, 0);
}

} // namespace rccore
