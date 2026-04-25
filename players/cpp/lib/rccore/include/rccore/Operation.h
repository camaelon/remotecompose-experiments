#pragma once
#include <cstdint>
#include <string>
#include <vector>
#include <memory>
#include <sstream>

namespace rccore {

class WireBuffer;
class RemoteContext;

struct Field {
    std::string name;
    std::string type;
    std::string value;
};

class Operation {
public:
    virtual ~Operation() = default;

    virtual std::string name() const = 0;
    virtual int opcode() const = 0;
    virtual std::vector<Field> fields() const = 0;

    // Execute this operation against a context (data loading or painting)
    virtual void apply(RemoteContext& context) {}

    // ── Dirty tracking ───────────────────────────────────────────────
    bool isDirty() const { return mDirty; }
    void markDirty() { mDirty = true; }
    void markNotDirty() { mDirty = false; }

    // ── Variable support ─────────────────────────────────────────────
    // Override to return true if this operation depends on variables.
    virtual bool isVariableSupport() const { return false; }

    // Called once after parsing. Register variable dependencies via
    // context.listensTo(variableId, this).
    virtual void registerListening(RemoteContext& /*context*/) {}

    // Called when dirty, just before apply() during paint pass.
    // Resolve cached NaN variable references to actual values.
    virtual void updateVariables(RemoteContext& /*context*/) {}

    // ── Paint operation flag ─────────────────────────────────────────
    // Paint operations are always executed in the paint pass (even if not dirty).
    virtual bool isPaintOperation() const { return false; }

    // If the operation has raw payload bytes (for payloadBase64), store them
    std::vector<uint8_t> payload;

    // For container operations that have children
    virtual bool isContainer() const { return false; }
    std::vector<Operation*> children() const {
        std::vector<Operation*> result;
        result.reserve(mChildren.size());
        for (auto& c : mChildren) result.push_back(c.get());
        return result;
    }
    void addChild(std::unique_ptr<Operation> child) {
        mChildren.push_back(std::move(child));
    }

    std::vector<std::unique_ptr<Operation>> mChildren;

private:
    bool mDirty = true;
};

using ReaderFn = void(*)(WireBuffer&, std::vector<std::unique_ptr<Operation>>&);

} // namespace rccore
