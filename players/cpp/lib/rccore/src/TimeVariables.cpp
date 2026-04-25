#include "rccore/TimeVariables.h"
#include "rccore/RemoteContext.h"

#include <chrono>
#include <cmath>
#include <ctime>

namespace rccore {

void TimeVariables::updateTime(RemoteContext& context, double animationTime, double deltaTime) {
    using namespace std::chrono;

    // Wall clock time
    auto now = system_clock::now();
    auto epoch = now.time_since_epoch();
    int64_t epochSec = duration_cast<seconds>(epoch).count();

    // Local time breakdown
    std::time_t t = system_clock::to_time_t(now);
    std::tm local{};
#if defined(_WIN32)
    localtime_s(&local, &t);
#else
    localtime_r(&t, &local);
#endif

    int hours = local.tm_hour;       // 0-23
    int minutes = local.tm_min;      // 0-59
    int seconds_val = local.tm_sec;  // 0-59

    // Fractional seconds from midnight, mod 3600 (cycles every hour)
    auto ms = duration_cast<milliseconds>(epoch).count() % 1000;
    double secFromMidnight = hours * 3600.0 + minutes * 60.0 + seconds_val + ms / 1000.0;
    float continuousSec = static_cast<float>(std::fmod(secFromMidnight, 3600.0));

    // Minutes from midnight (0..1439)
    int minFromMidnight = hours * 60 + minutes;

    // UTC offset in seconds
    // mktime converts tm to time_t in local time; compute difference
    std::tm utc{};
#if defined(_WIN32)
    gmtime_s(&utc, &t);
#else
    gmtime_r(&t, &utc);
#endif
    int offsetToUtc = static_cast<int>(std::difftime(std::mktime(&local), std::mktime(&utc)));

    // Day of week (Java: 1=Sunday..7=Saturday, tm_wday: 0=Sunday..6=Saturday)
    int weekDay = local.tm_wday + 1;

    // Day of year (tm_yday is 0-based; Java expects 1-based)
    int dayOfYear = local.tm_yday + 1;

    // Load all time variables into context
    context.loadFloat(RemoteContext::ID_CONTINUOUS_SEC, continuousSec);
    context.loadInteger(RemoteContext::ID_TIME_IN_SEC, hours * 3600 + minutes * 60 + seconds_val);
    context.loadInteger(RemoteContext::ID_TIME_IN_MIN, minFromMidnight);
    context.loadInteger(RemoteContext::ID_TIME_IN_HR, hours);
    context.loadInteger(RemoteContext::ID_CALENDAR_MONTH, local.tm_mon + 1);
    context.loadInteger(RemoteContext::ID_OFFSET_TO_UTC, offsetToUtc);
    context.loadInteger(RemoteContext::ID_WEEK_DAY, weekDay);
    context.loadInteger(RemoteContext::ID_DAY_OF_MONTH, local.tm_mday);
    context.loadInteger(RemoteContext::ID_DAY_OF_YEAR, dayOfYear);
    context.loadInteger(RemoteContext::ID_YEAR, local.tm_year + 1900);
    context.loadInteger(RemoteContext::ID_EPOCH_SECOND, static_cast<int>(epochSec));

    // Animation variables
    context.loadFloat(RemoteContext::ID_ANIMATION_TIME, static_cast<float>(animationTime));
    context.loadFloat(RemoteContext::ID_ANIMATION_DELTA_TIME, static_cast<float>(deltaTime));

    mLastAnimTime = animationTime;
}

} // namespace rccore
