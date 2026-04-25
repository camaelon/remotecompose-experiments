#include "rccore/Utils.h"
#include "rccore/RemoteContext.h"
#include "rccore/Operation.h"

#include <cmath>

namespace rccore {

float Utils::resolveFloat(float v, RemoteContext& context) {
    if (std::isnan(v)) {
        return context.getFloat(idFromNan(v));
    }
    return v;
}

void Utils::registerFloatVar(float v, RemoteContext& context, Operation* owner) {
    if (std::isnan(v)) {
        context.listensTo(idFromNan(v), owner);
    }
}

} // namespace rccore
