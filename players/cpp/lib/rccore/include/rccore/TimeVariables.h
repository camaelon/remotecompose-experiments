#pragma once
#include <chrono>

namespace rccore {

class RemoteContext;

// Computes and loads all system time/date variables into the context.
// Call updateTime() at the start of each frame before painting.
class TimeVariables {
public:
    // Update all time variables. animationTime is seconds since viewer start.
    // deltaTime is seconds since last frame.
    void updateTime(RemoteContext& context, double animationTime, double deltaTime);

private:
    double mLastAnimTime = -1.0;
};

} // namespace rccore
