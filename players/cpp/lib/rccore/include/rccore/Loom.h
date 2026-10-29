#pragma once
// Loom: RemoteCompose component templates (patterns / macros), expanded at load.
// Port of remote-core's operations/loom (LoomManager, ExpansionContext and the materialize()
// of PatternDefine, PatternInflation, PatternArgument, PatternForEach, ReferencedOperations
// and IncludeReferencedOperations).
//
// Late expansion, as the reference: a template body is kept as bytes and re-read for every
// call site through a WireBuffer carrying a RemapContext (see RemapContext.h), so each
// inflation declares its own ids from the document's counter, in the reference's order.

#include "rccore/Operation.h"
#include "rccore/RemapContext.h"
#include "rccore/WireBuffer.h"
#include <memory>
#include <vector>

namespace rccore {

/**
 * Read a stream of operations into a tree, nesting containers until their ContainerEnd, and
 * capture the bodies Loom re-reads later: MACRO_DEFINE (container form), MACRO_BLOCK,
 * MACRO_FOR_EACH and REFERENCED_OPERATIONS keep the bytes of their children. When
 * `maxProviderId` is given, it is raised to the largest VariableProvider id read (see
 * CoreDocument::initFromBuffer). Returns false on an unknown opcode.
 */
bool readOperationTree(WireBuffer& buffer, std::vector<std::unique_ptr<Operation>>& out,
                       int* maxProviderId = nullptr);

/** Expand every template call, slot, collection loop and include in `ops`, in place. */
void expandLoom(std::vector<std::unique_ptr<Operation>>& ops, IdAllocator& ids);

} // namespace rccore
