#include "rccore/WireBuffer.h"
#include "rccore/CoreDocument.h"
#include "rccore/RemoteContext.h"
#include "rccore/LayoutSystem.h"
#include "rcskia/SkiaPaintContext.h"
#include "rcskia/RcDocumentHost.h"

#include "include/core/SkSurface.h"
#include "include/core/SkCanvas.h"
#include "include/core/SkData.h"
#include "include/core/SkPixmap.h"
#include "include/encode/SkPngEncoder.h"
#include "include/core/SkStream.h"

#include <array>
#include <algorithm>
#include "rccore/ExpressionEvaluator.h"
#include <ctime>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <vector>
#include <cstring>
#include <cstdlib>
#include "rccore/operations/DrawOperations.h"
#include <chrono>
#include <cmath>
#include <map>
#include <unordered_set>
#include "rccore/Operations.h"
#include <sstream>
#include <string>

// ── --var: host-set variables ─────────────────────────────────────────
// A document exposes a variable to its host with NAMED_VARIABLE (id, type, name). The host
// sets it by name; the type says which store it lives in. Types as RemoteComposeWriter
// writes them (json2rc's Writer.ts mirrors these).
static constexpr int NV_STRING = 0, NV_FLOAT = 1, NV_COLOR = 2, NV_INT = 4, NV_LONG = 5,
                     NV_FLOAT_ARRAY = 6;

struct NamedVar { int id = 0; int type = 0; };

static void collectNamedVars(const std::vector<std::unique_ptr<rccore::Operation>>& ops,
                             std::map<std::string, NamedVar>& out) {
    for (auto& op : ops) {
        if (auto* nv = dynamic_cast<rccore::NamedVariable*>(op.get())) {
            out[nv->varName] = {nv->varId, nv->varType};
        }
        if (!op->mChildren.empty()) collectNamedVars(op->mChildren, out);
    }
}

// #RRGGBB, #AARRGGBB, 0xAARRGGBB or a decimal int. Returns false on anything else.
static bool parseColor(const std::string& s, int& out) {
    std::string h;
    if (!s.empty() && s[0] == '#') h = s.substr(1);
    else if (s.size() > 2 && s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) h = s.substr(2);
    else {
        char* end = nullptr;
        long long v = std::strtoll(s.c_str(), &end, 10);
        if (end == s.c_str() || *end != '\0') return false;
        out = static_cast<int>(v);
        return true;
    }
    if (h.size() != 6 && h.size() != 8) return false;
    char* end = nullptr;
    unsigned long v = std::strtoul(h.c_str(), &end, 16);
    if (*end != '\0') return false;
    if (h.size() == 6) v |= 0xFF000000UL;
    out = static_cast<int>(static_cast<uint32_t>(v));
    return true;
}

static bool parseFloatStrict(const std::string& s, float& out) {
    char* end = nullptr;
    out = std::strtof(s.c_str(), &end);
    return end != s.c_str() && *end == '\0';
}

// ── --events: a scripted touch sequence ───────────────────────────────
// Each event is "T TYPE X Y [VX VY]": T in seconds from the start of the simulation, X/Y in
// document coordinates. TYPE is down, move, up (touchUp + onClick, as the viewer does on
// release) or tap (down + up at once). VX/VY is the release velocity in px/s for an up;
// without it the velocity is measured from the previous event, which is what drives a fling.
struct TouchEvent { float t; std::string type; float x, y; bool hasVel; float vx, vy; };

static bool parseEvents(const std::string& specIn, std::vector<TouchEvent>& out, std::string& err) {
    std::string spec = specIn;
    if (!spec.empty() && spec[0] == '@') {
        std::ifstream f(spec.substr(1));
        if (!f) { err = "cannot open events file " + spec.substr(1); return false; }
        std::stringstream ss; ss << f.rdbuf(); spec = ss.str();
    }
    for (char& c : spec) if (c == ';' || c == ',') c = (c == ';') ? '\n' : ' ';
    std::istringstream lines(spec);
    std::string line;
    while (std::getline(lines, line)) {
        auto hash = line.find('#');
        if (hash != std::string::npos) line = line.substr(0, hash);
        std::istringstream ls(line);
        TouchEvent e{};
        if (!(ls >> e.t)) continue;   // blank line
        if (!(ls >> e.type >> e.x >> e.y)) { err = "bad event: \"" + line + "\""; return false; }
        if (e.type != "down" && e.type != "move" && e.type != "up" && e.type != "tap") {
            err = "unknown event type \"" + e.type + "\" (down, move, up, tap)"; return false;
        }
        e.hasVel = static_cast<bool>(ls >> e.vx >> e.vy);
        out.push_back(e);
    }
    std::stable_sort(out.begin(), out.end(),
                     [](const TouchEvent& a, const TouchEvent& b) { return a.t < b.t; });
    return true;
}

// ── --report: facts about the document and the render, as JSON ───────
// Facts only — what parsed, what is declared, what the pixels look like. Deciding what is
// suspicious is left to the caller (the MCP server turns these into warnings), so the
// thresholds can change without touching the renderer.
static std::string jsonStr(const std::string& s) {
    std::string o = "\"";
    for (unsigned char c : s) {
        switch (c) {
            case '"': o += "\\\""; break;
            case '\\': o += "\\\\"; break;
            case '\n': o += "\\n"; break;
            case '\r': o += "\\r"; break;
            case '\t': o += "\\t"; break;
            default:
                if (c < 0x20) { char b[8]; std::snprintf(b, sizeof b, "\\u%04x", c); o += b; }
                else o += static_cast<char>(c);
        }
    }
    return o + "\"";
}
static std::string jsonNum(double v) {
    if (!std::isfinite(v)) return "null";
    char b[32]; std::snprintf(b, sizeof b, "%.9g", v); return b;
}
static std::string hexColor(uint32_t c) {
    char b[16]; std::snprintf(b, sizeof b, "\"#%08X\"", c); return b;
}

// initFromBuffer only says yes or no. To say WHERE, walk the stream again the same way and
// stop at the first opcode with no reader, or the first one whose reader runs off the end.
struct ParseFailure { int offset = -1; int opcode = -1; std::string kind, message, lastGoodOp; };
static ParseFailure locateParseFailure(const std::vector<uint8_t>& data) {
    ParseFailure f;
    rccore::WireBuffer buf(const_cast<uint8_t*>(data.data()), data.size());
    while (buf.available()) {
        int start = buf.getIndex();
        int opcode = -1;
        try {
            opcode = buf.readByte();
            if (opcode == 214) continue;   // CONTAINER_END
            auto reader = rccore::Operations::getReader(opcode);
            if (!reader) {
                f = {start, opcode, "unknown_opcode",
                     "no reader for opcode " + std::to_string(opcode), f.lastGoodOp};
                return f;
            }
            std::vector<std::unique_ptr<rccore::Operation>> tmp;
            reader(buf, tmp);
            f.lastGoodOp = rccore::Operations::getName(opcode);
        } catch (const std::exception& e) {
            f = {start, opcode, "read_past_end", e.what(), f.lastGoodOp};
            return f;
        }
    }
    f.kind = "unknown";
    f.message = "the engine rejected the document";
    return f;
}

static void countOps(const std::vector<std::unique_ptr<rccore::Operation>>& ops,
                     std::map<std::string, int>& counts, int& total) {
    for (auto& op : ops) {
        counts[op->name()]++;
        total++;
        if (!op->mChildren.empty()) countOps(op->mChildren, counts, total);
    }
}

static const char* nvTypeName(int t) {
    switch (t) {
        case NV_STRING: return "string"; case NV_FLOAT: return "float";
        case NV_COLOR: return "color";   case NV_INT: return "int";
        case NV_LONG: return "long";     case NV_FLOAT_ARRAY: return "float_array";
        default: return "unknown";
    }
}

// Parse a --clock spec into epoch milliseconds, local time. Returns false if it is not a
// spec this understands, so a bad string is reported rather than silently treated as "now".
static bool parseClockSpec(const char* spec, int64_t& outMs) {
    if (spec == nullptr || *spec == '\0') return false;
    if (spec[0] == '@') {                       // raw epoch millis
        char* end = nullptr;
        long long v = std::strtoll(spec + 1, &end, 10);
        if (end == spec + 1 || *end != '\0') return false;
        outMs = static_cast<int64_t>(v);
        return true;
    }
    int Y = 0, M = 0, D = 0, h = 0, m = 0, sec = 0;
    bool haveDate = false, haveTime = false;
    if (std::sscanf(spec, "%d-%d-%dT%d:%d:%d", &Y, &M, &D, &h, &m, &sec) == 6) {
        haveDate = haveTime = true;
    } else if (std::sscanf(spec, "%d-%d-%dT%d:%d", &Y, &M, &D, &h, &m) == 5) {
        haveDate = haveTime = true; sec = 0;
    } else if (std::sscanf(spec, "%d-%d-%d", &Y, &M, &D) == 3) {
        haveDate = true; h = m = sec = 0;
    } else if (std::sscanf(spec, "%d:%d:%d", &h, &m, &sec) == 3) {
        haveTime = true;
    } else if (std::sscanf(spec, "%d:%d", &h, &m) == 2) {
        haveTime = true; sec = 0;
    } else {
        return false;
    }
    std::time_t nowT = std::time(nullptr);
    std::tm tmv{};
#if defined(_WIN32)
    localtime_s(&tmv, &nowT);
#else
    localtime_r(&nowT, &tmv);
#endif
    if (haveDate) { tmv.tm_year = Y - 1900; tmv.tm_mon = M - 1; tmv.tm_mday = D; }
    if (haveTime || haveDate) { tmv.tm_hour = h; tmv.tm_min = m; tmv.tm_sec = sec; }
    tmv.tm_isdst = -1;
    std::time_t t = std::mktime(&tmv);
    if (t == static_cast<std::time_t>(-1)) return false;
    outMs = static_cast<int64_t>(t) * 1000;
    return true;
}

static int run(int argc, char* argv[]);

int main(int argc, char* argv[]) {
    // The wire reader throws on a truncated buffer; uncaught, that is an abort with no
    // message, which reads as a renderer crash rather than a bad file.
    try {
        return run(argc, argv);
    } catch (const std::exception& e) {
        std::cerr << "Error: " << e.what() << "\n";
        return 1;
    }
}

static int run(int argc, char* argv[]) {
    if (argc < 3) {
        std::cerr << "Usage: rc2image input.rcd output.png [width height]"
                     " [--fit W H] [--clock SPEC] [--time epoch_ms] [--anim seconds]\n"
                     "  --fit W H  render onto a W x H surface with the document kept in its\n"
                     "             own coordinate space and scaled to fit, which is what every\n"
                     "             real player does. Without it the document is painted at its\n"
                     "             native size and the fit transform is never exercised.\n"
                     "  --clock    LOCK THE CLOCK. Without it every date and time variable\n"
                     "             reads the wall clock, so a document using continuousSec(),\n"
                     "             timeInSec(), the hour, the weekday or the month renders\n"
                     "             differently on every run and cannot be pixel-compared.\n"
                     "             SPEC is one of:\n"
                     "               HH:MM[:SS]            today at that local time\n"
                     "               YYYY-MM-DD            that date at midnight\n"
                     "               YYYY-MM-DDTHH:MM[:SS] that date and time\n"
                     "               @MILLIS               raw epoch milliseconds\n"
                     "             It pins the whole set together - continuousSec, seconds,\n"
                     "             minutes, hours, month, weekday, day of year and year all\n"
                     "             derive from the one instant, so they stay consistent.\n"
                     "  --time     the same thing in raw epoch milliseconds. --time 0 now\n"
                     "             pins to the epoch instead of silently not pinning.\n"
                     "  --anim     pins animationTime only, which is a different clock.\n"
                     "  --seed N   pin the random stream. rand() is seeded arbitrarily by\n"
                     "             default (matching the reference's lazy `new Random()`),\n"
                     "             so a document whose particles use rand() in their initial\n"
                     "             values renders differently on every run even with the\n"
                     "             clock pinned. A document that seeds itself still wins.\n"
                     "  --density D  display density (dpi / 160), the DENSITY system variable.\n"
                     "  --theme light|dark   colour theme (default dark).\n"
                     "  --var NAME=VALUE     set a variable the document exposes by name\n"
                     "             (NAMED_VARIABLE). Its declared type decides the parsing:\n"
                     "             float/int/long numbers, colour #RRGGBB or #AARRGGBB,\n"
                     "             string as-is, float array comma-separated. Repeatable.\n"
                     "  --var-id ID=VALUE    override a float by raw id (e.g. a system\n"
                     "             variable such as 38, battery level). Repeatable.\n"
                     "  --events SPEC  simulate a touch sequence. SPEC is \"T TYPE X Y [VX VY]\"\n"
                     "             entries separated by ';' or newlines, or @FILE. TYPE is\n"
                     "             down|move|up|tap, T seconds, X/Y document coordinates.\n"
                     "  --duration S   simulate S seconds frame by frame (default: last\n"
                     "             event time + 0.5 s when --events is given). The clock\n"
                     "             advances with the frames and the LAST frame is at --clock\n"
                     "             (or now), so animationTime ends at S.\n"
                     "  --fps N        frames per simulated second (default 60).\n"
                     "  --report FILE  write a JSON report (parse result, header, op counts,\n"
                     "             named variables and their values, fonts, pixel stats);\n"
                     "             '-' for stdout. Written on a parse failure too.\n"
                     "  --check        parse and run the data pass only: no paint, no PNG\n"
                     "             (output path is ignored). Use with --report.\n";
        return 1;
    }

    const char* inputPath = argv[1];
    // The output is the second positional argument, unless that is already an option: then
    // there is none (fine with --check). Taking `--check` as the output path wrote a PNG
    // named "--check" whenever the flags came right after the input.
    const bool haveOutput = argc > 2 && std::strncmp(argv[2], "--", 2) != 0;
    const char* outputPath = haveOutput ? argv[2] : nullptr;
    int overrideWidth = 0, overrideHeight = 0;
    int fitWidth = 0, fitHeight = 0;   // --fit: surface size, document keeps its own space
    int64_t fixedTimeMs = 0;
    int32_t randSeed = 0;
    bool pinSeed = false;
    bool pinClock = false;   // whether a clock flag was GIVEN, not whether it
                             // was nonzero: --time 0 is a legitimate request
                             // to pin to the epoch, and treating it as 'unset'
                             // silently left the wall clock running.
    float animTimeSec = -1.0f;   // >=0 pins animationTime (seconds since first frame)
    float density = 1.0f;
    int theme = -2;              // THEME_DARK; -3 is LIGHT
    std::vector<std::pair<std::string, std::string>> namedVars;
    std::vector<std::pair<int, float>> idVars;
    std::vector<TouchEvent> events;
    float simDuration = -1.0f;   // >=0 runs the frame-by-frame simulation
    int simFps = 60;
    const char* reportPath = nullptr;
    bool checkOnly = false;

    // Parse remaining args
    int i = haveOutput ? 3 : 2;
    while (i < argc) {
        if (std::strcmp(argv[i], "--report") == 0 && i + 1 < argc) {
            reportPath = argv[i + 1];
            i += 2;
        } else if (std::strcmp(argv[i], "--check") == 0) {
            checkOnly = true;
            i += 1;
        } else if (std::strcmp(argv[i], "--density") == 0 && i + 1 < argc) {
            density = std::atof(argv[i + 1]);
            if (!(density > 0.0f)) { std::cerr << "Error: --density must be > 0\n"; return 1; }
            i += 2;
        } else if (std::strcmp(argv[i], "--theme") == 0 && i + 1 < argc) {
            if (std::strcmp(argv[i + 1], "light") == 0) theme = -3;
            else if (std::strcmp(argv[i + 1], "dark") == 0) theme = -2;
            else { std::cerr << "Error: --theme is light or dark\n"; return 1; }
            i += 2;
        } else if ((std::strcmp(argv[i], "--var") == 0 || std::strcmp(argv[i], "--var-id") == 0)
                   && i + 1 < argc) {
            std::string kv(argv[i + 1]);
            auto eq = kv.find('=');
            if (eq == std::string::npos || eq == 0) {
                std::cerr << "Error: " << argv[i] << " expects NAME=VALUE, got \"" << kv << "\"\n";
                return 1;
            }
            if (argv[i][5] == '-') {   // --var-id
                float v;
                if (!parseFloatStrict(kv.substr(eq + 1), v)) {
                    std::cerr << "Error: --var-id value is not a number: \"" << kv << "\"\n";
                    return 1;
                }
                idVars.push_back({std::atoi(kv.substr(0, eq).c_str()), v});
            } else {
                namedVars.push_back({kv.substr(0, eq), kv.substr(eq + 1)});
            }
            i += 2;
        } else if (std::strcmp(argv[i], "--events") == 0 && i + 1 < argc) {
            std::string err;
            if (!parseEvents(argv[i + 1], events, err)) {
                std::cerr << "Error: --events: " << err << "\n";
                return 1;
            }
            i += 2;
        } else if (std::strcmp(argv[i], "--duration") == 0 && i + 1 < argc) {
            simDuration = std::max(0.0f, (float) std::atof(argv[i + 1]));
            i += 2;
        } else if (std::strcmp(argv[i], "--fps") == 0 && i + 1 < argc) {
            simFps = std::max(1, std::atoi(argv[i + 1]));
            i += 2;
        } else if (std::strcmp(argv[i], "--fit") == 0 && i + 2 < argc) {
            fitWidth = std::atoi(argv[i + 1]);
            fitHeight = std::atoi(argv[i + 2]);
            i += 3;
        } else if (std::strcmp(argv[i], "--time") == 0 && i + 1 < argc) {
            fixedTimeMs = std::atoll(argv[i + 1]);
            pinClock = true;
            i += 2;
        } else if (std::strcmp(argv[i], "--clock") == 0 && i + 1 < argc) {
            if (!parseClockSpec(argv[i + 1], fixedTimeMs)) {
                std::cerr << "Error: --clock does not understand \"" << argv[i + 1]
                          << "\". Use HH:MM[:SS], YYYY-MM-DD, YYYY-MM-DDTHH:MM[:SS] "
                             "or @EPOCHMILLIS.\n";
                return 1;
            }
            pinClock = true;
            i += 2;
        } else if (std::strcmp(argv[i], "--seed") == 0 && i + 1 < argc) {
            randSeed = static_cast<int32_t>(std::atoll(argv[i + 1]));
            pinSeed = true;
            i += 2;
        } else if (std::strcmp(argv[i], "--anim") == 0 && i + 1 < argc) {
            animTimeSec = std::atof(argv[i + 1]);
            i += 2;
        } else if (overrideWidth == 0 && i + 1 < argc && std::atoi(argv[i]) > 0) {
            overrideWidth = std::atoi(argv[i]);
            overrideHeight = std::atoi(argv[i + 1]);
            i += 2;
        } else {
            i++;
        }
    }

    // Read input file
    std::ifstream ifs(inputPath, std::ios::binary);
    if (!ifs) {
        std::cerr << "Error: cannot open " << inputPath << "\n";
        return 1;
    }
    ifs.seekg(0, std::ios::end);
    std::vector<uint8_t> data(static_cast<size_t>(std::max<std::streamoff>(ifs.tellg(), 0)));
    ifs.seekg(0);
    if (!data.empty()) ifs.read(reinterpret_cast<char*>(data.data()), data.size());
    ifs.close();

    if (data.empty()) {
        std::cerr << "Error: empty file\n";
        return 1;
    }

    // Parse document
    // Report sections, filled in as we go and written at whichever exit we reach.
    std::vector<std::pair<std::string, std::string>> report;
    auto writeReport = [&]() {
        if (!reportPath) return;
        std::string out = "{";
        for (size_t k = 0; k < report.size(); k++) {
            out += (k ? "," : "") + jsonStr(report[k].first) + ":" + report[k].second;
        }
        out += "}\n";
        if (std::strcmp(reportPath, "-") == 0) { std::cout << out; return; }
        std::ofstream rf(reportPath);
        rf << out;
    };

    rccore::WireBuffer buffer(data.data(), data.size());
    rccore::CoreDocument doc;
    bool parsed = false;
    std::string parseException;
    try {
        parsed = doc.initFromBuffer(buffer);
    } catch (const std::exception& e) {
        parseException = e.what();
    }
    if (!parsed) {
        ParseFailure pf = locateParseFailure(data);
        report.push_back({"parse", "{\"ok\":false,\"bytes\":" + std::to_string(data.size()) +
            ",\"kind\":" + jsonStr(pf.kind) + ",\"offset\":" + std::to_string(pf.offset) +
            ",\"opcode\":" + std::to_string(pf.opcode) +
            ",\"lastGoodOp\":" + jsonStr(pf.lastGoodOp) +
            ",\"message\":" + jsonStr(parseException.empty() ? pf.message : parseException) + "}"});
        writeReport();
        std::cerr << "Error: failed to parse " << inputPath << " (" << pf.kind << " at byte "
                  << pf.offset << ", opcode " << pf.opcode << ")\n";
        return 1;
    }
    {
        std::map<std::string, int> counts;
        int total = 0;
        countOps(doc.getOperations(), counts, total);
        std::string byName = "{";
        bool first = true;
        for (auto& [n, c] : counts) {
            byName += (first ? "" : ",") + jsonStr(n) + ":" + std::to_string(c);
            first = false;
        }
        byName += "}";
        report.push_back({"parse", "{\"ok\":true,\"bytes\":" + std::to_string(data.size()) + "}"});
        report.push_back({"header", "{\"width\":" + std::to_string(doc.getWidth()) +
                                    ",\"height\":" + std::to_string(doc.getHeight()) + "}"});
        report.push_back({"ops", "{\"total\":" + std::to_string(total) + ",\"byName\":" + byName + "}"});
    }
    // The simulation runs from start to end with the clock advancing per frame; the clock
    // the caller asked for (or now) is the instant of the LAST frame, the one captured.
    if (!events.empty() && simDuration < 0.0f) simDuration = events.back().t + 0.5f;
    const bool simulate = simDuration >= 0.0f;
    if (simulate && !pinClock) {
        fixedTimeMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch()).count();
        pinClock = true;
    }
    const int64_t simStartMs = fixedTimeMs - static_cast<int64_t>(simDuration * 1000.0f + 0.5f);
    if (simulate) {
        doc.setFixedTimeMs(simStartMs);
    } else if (pinClock) {
        doc.setFixedTimeMs(fixedTimeMs);
    }
    // Seed before the first paint: particle initial values are drawn once, when the system
    // is created, so seeding after that would change nothing.
    if (pinSeed) {
        rccore::JavaRandom::seedFromBits(randSeed);
    }

    int width = overrideWidth > 0 ? overrideWidth : doc.getWidth();
    int height = overrideHeight > 0 ? overrideHeight : doc.getHeight();
    // RemoteContext.header: under DENSITY_BEHAVIOR_DP the document size is in dp.
    if (doc.getDensityBehavior() == 2) {
        if (overrideWidth <= 0) width = (int)std::lround(width * density);
        if (overrideHeight <= 0) height = (int)std::lround(height * density);
    }
    if (width <= 0) width = 600;
    if (height <= 0) height = 600;

    // --fit renders onto a surface of a different size than the document, with the document
    // left in its own coordinate space and a translate+scale mapping it in. That is what the
    // iOS/desktop players do, and it is a genuinely different code path for anything that
    // composites a buffer (3D blits at the origin of the DOCUMENT space, under the live CTM).
    int surfW = fitWidth  > 0 ? fitWidth  : width;
    int surfH = fitHeight > 0 ? fitHeight : height;
    float fitScale = 1.0f, fitOx = 0.0f, fitOy = 0.0f;
    if (fitWidth > 0 && fitHeight > 0) {
        fitScale = std::min((float) surfW / (float) width, (float) surfH / (float) height);
        fitOx = ((float) surfW - (float) width  * fitScale) * 0.5f;
        fitOy = ((float) surfH - (float) height * fitScale) * 0.5f;
    }

    // Create Skia surface
    SkImageInfo info = SkImageInfo::MakeN32Premul(surfW, surfH);
    auto surface = SkSurfaces::Raster(info);
    if (!surface) {
        std::cerr << "Error: failed to create Skia surface\n";
        return 1;
    }

    SkCanvas* canvas = surface->getCanvas();
    // White background (matches TS renderer)
    // RC_BG=transparent (or any 0xAARRGGBB hex) picks the clear colour; default stays white.
    SkColor bg = SK_ColorWHITE;
    {
        if (const char* e = std::getenv("RC_BG")) {
            if (std::strcmp(e, "transparent") == 0) bg = SK_ColorTRANSPARENT;
            else bg = static_cast<SkColor>(std::strtoul(e, nullptr, 16));
        }
        canvas->clear(bg);
    }
    if (fitWidth > 0 && fitHeight > 0) {
        canvas->translate(fitOx, fitOy);
        canvas->scale(fitScale, fitScale);
    }

    // Set up context and paint context
    rccore::RemoteContext context;
    rcskia::SkiaPaintContext paintCtx(context, canvas);
    context.setPaintContext(&paintCtx);
    context.setDocument(&doc);

    // Host for embedded "rc:<file>" sub-documents, resolved next to the input file.
    rcskia::RcDocumentHost rcHost;
    {
        std::string in(inputPath);
        auto slash = in.find_last_of("/\\");
        rcHost.setBaseDir(slash == std::string::npos ? "." : in.substr(0, slash));
    }
    context.setCustomHost(&rcHost);

    // Set canvas dimensions before data pass
    context.mWidth = static_cast<float>(width);
    context.mHeight = static_cast<float>(height);
    context.mDensity = density;

    // Register variable listeners
    doc.registerListeners(context);

    // Pin animationTime for deterministic mid-animation captures. overrideFloat makes the
    // per-frame time load a no-op for this id, so the value stays put across paints.
    if (animTimeSec >= 0.0f) {
        context.overrideFloat(rccore::RemoteContext::ID_ANIMATION_TIME, animTimeSec);
    }

    // Execute data operations (loads text, expressions, etc.)
    doc.applyDataOperations(context, theme);

    // Host variables go in after the data pass: NAMED_VARIABLE's own apply installs the
    // system default for a named colour, which would otherwise replace ours. The override*
    // calls make the value stick against the document's later loads.
    if (!namedVars.empty()) {
        std::map<std::string, NamedVar> declared;
        collectNamedVars(doc.getOperations(), declared);
        for (auto& [name, value] : namedVars) {
            auto it = declared.find(name);
            if (it == declared.end()) {
                std::cerr << "Error: --var " << name << ": the document declares no such"
                             " named variable. It declares:";
                for (auto& d : declared) std::cerr << " " << d.first;
                std::cerr << "\n";
                return 1;
            }
            const NamedVar& nv = it->second;
            bool ok = true;
            switch (nv.type) {
                case NV_STRING: context.overrideText(nv.id, value); break;
                case NV_FLOAT: { float f; ok = parseFloatStrict(value, f);
                                 if (ok) context.overrideFloat(nv.id, f); break; }
                case NV_INT: { float f; ok = parseFloatStrict(value, f);
                               if (ok) context.overrideInteger(nv.id, (int) f); break; }
                case NV_LONG: { char* e = nullptr; long long l = std::strtoll(value.c_str(), &e, 10);
                                ok = e != value.c_str() && *e == '\0';
                                if (ok) context.loadLong(nv.id, l); break; }
                case NV_COLOR: { int c; ok = parseColor(value, c);
                                 if (ok) context.overrideColor(nv.id, c); break; }
                case NV_FLOAT_ARRAY: {
                    std::vector<float> list;
                    std::stringstream ss(value);
                    std::string tok;
                    while (ok && std::getline(ss, tok, ',')) {
                        float f; ok = parseFloatStrict(tok, f); list.push_back(f);
                    }
                    if (ok) context.overrideFloatList(nv.id, list);
                    break;
                }
                default:
                    std::cerr << "Error: --var " << name << ": unsupported variable type "
                              << nv.type << "\n";
                    return 1;
            }
            if (!ok) {
                std::cerr << "Error: --var " << name << ": cannot parse \"" << value
                          << "\" for this variable's type (" << nv.type << ")\n";
                return 1;
            }
        }
    }
    for (auto& [id, value] : idVars) context.overrideFloat(id, value);

    {
        std::map<std::string, NamedVar> declared;
        collectNamedVars(doc.getOperations(), declared);
        std::string arr = "[";
        bool first = true;
        for (auto& [name, nv] : declared) {
            std::string value;
            switch (nv.type) {
                case NV_STRING: value = jsonStr(context.getText(nv.id)); break;
                case NV_FLOAT: value = jsonNum(context.getFloat(nv.id)); break;
                case NV_INT: value = std::to_string(context.getInteger(nv.id)); break;
                case NV_LONG: value = std::to_string(context.getLong(nv.id)); break;
                case NV_COLOR: value = hexColor(static_cast<uint32_t>(context.getColor(nv.id))); break;
                case NV_FLOAT_ARRAY: {
                    value = "[";
                    if (auto* l = context.getFloatList(nv.id)) {
                        for (size_t k = 0; k < l->size(); k++) value += (k ? "," : "") + jsonNum((*l)[k]);
                    }
                    value += "]";
                    break;
                }
                default: value = "null";
            }
            arr += std::string(first ? "" : ",") + "{\"name\":" + jsonStr(name) +
                   ",\"id\":" + std::to_string(nv.id) + ",\"type\":" + jsonStr(nvTypeName(nv.type)) +
                   ",\"value\":" + value + "}";
            first = false;
        }
        report.push_back({"namedVariables", arr + "]"});
        report.push_back({"fonts", "{\"families\":" + std::to_string(paintCtx.fontFamilyCount()) + "}"});
    }
    if (checkOnly) {
        writeReport();
        std::cerr << "Checked: " << inputPath << " (" << width << "x" << height << ")\n";
        return 0;
    }

    // Paint (includes DATA re-eval + PAINT).
    // RC_FRAMES paints repeatedly before capturing. One frame is not enough for anything
    // driven by an Impulse: its first pass runs only the initialisation block, and the
    // process block that does the per-frame work (particle loops, and the mesh draws
    // nested inside them) starts on the second. A single-frame capture of a particle
    // document is therefore legitimately empty rather than broken.
    int frames = 1;
    if (const char* f = std::getenv("RC_FRAMES")) {
        frames = std::atoi(f);
        if (frames < 1) frames = 1;
    }
    // RC_ANIM_SWEEP=N: paint N frames advancing animationTime linearly to animTimeSec, so a
    // layout that depends on time is exercised across frames (tests the layout cache doesn't
    // freeze it). The final frame is at animTimeSec, so it should match a single paint there.
    int sweep = 0;
    if (const char* s = std::getenv("RC_ANIM_SWEEP")) sweep = std::max(0, std::atoi(s));
    // RC_CLICKS="t:x,y;t:x,y" (with RC_ANIM_SWEEP): click at document point (x, y) on the first
    // swept frame at or past animation time t — to exercise an interactive document headless.
    std::vector<std::array<float, 3>> clicks;
    if (const char* c = std::getenv("RC_CLICKS")) {
        std::string spec(c);
        for (size_t p0 = 0; p0 < spec.size();) {
            size_t semi = spec.find(';', p0);
            std::string tok = spec.substr(p0, semi == std::string::npos ? std::string::npos : semi - p0);
            float ct, cx, cy;
            if (std::sscanf(tok.c_str(), "%f:%f,%f", &ct, &cx, &cy) == 3) clicks.push_back({ct, cx, cy});
            if (semi == std::string::npos) break;
            p0 = semi + 1;
        }
    }
    size_t nextClick = 0;
    if (simulate) {
        // Frame-by-frame with the clock itself advancing, so animationTime, its delta and
        // the wall clock agree — a fling's easing and an animated value both see real time.
        const int nFrames = std::max(1, (int) std::ceil(simDuration * (float) simFps)) + 1;
        size_t next = 0;
        float lastX = 0, lastY = 0, lastT = 0;      // previous touch sample, for velocity
        float prevX = 0, prevY = 0, prevT = 0;
        bool down = false;
        auto sample = [&](float t, float x, float y) {
            prevX = lastX; prevY = lastY; prevT = lastT;
            lastX = x; lastY = y; lastT = t;
        };
        auto setTouchPos = [&](float x, float y) {
            context.loadFloat(rccore::RemoteContext::ID_TOUCH_POS_X, x);
            context.loadFloat(rccore::RemoteContext::ID_TOUCH_POS_Y, y);
        };
        auto release = [&](const TouchEvent& e) {
            float vx = 0, vy = 0;
            if (e.hasVel) { vx = e.vx; vy = e.vy; }
            else if (e.t - prevT > 1e-4f) { vx = (e.x - prevX) / (e.t - prevT);
                                            vy = (e.y - prevY) / (e.t - prevT); }
            setTouchPos(e.x, e.y);
            doc.touchUp(context, e.x, e.y, vx, vy);
            bool hit = doc.onClick(context, e.x, e.y);
            std::cerr << "up t=" << e.t << " (" << e.x << "," << e.y << ") v=(" << vx << ","
                      << vy << ") click " << (hit ? "hit" : "miss") << "\n";
            down = false;
        };
        for (int f = 0; f < nFrames; f++) {
            float t = (nFrames == 1) ? simDuration
                                     : simDuration * (float) f / (float) (nFrames - 1);
            doc.setFixedTimeMs(simStartMs + static_cast<int64_t>(t * 1000.0f + 0.5f));
            while (next < events.size() && events[next].t <= t + 1e-6f) {
                const TouchEvent& e = events[next++];
                if (e.type == "down" || e.type == "tap") {
                    if (down) std::cerr << "warning: down at t=" << e.t << " while already down\n";
                    setTouchPos(e.x, e.y);
                    doc.touchDown(context, e.x, e.y);
                    down = true;
                    lastX = prevX = e.x; lastY = prevY = e.y; lastT = prevT = e.t;
                    if (e.type == "tap") release(e);
                } else if (e.type == "move") {
                    if (!down) { std::cerr << "warning: move at t=" << e.t << " with no down; ignored\n"; continue; }
                    setTouchPos(e.x, e.y);
                    doc.touchDrag(context, e.x, e.y);
                    sample(e.t, e.x, e.y);
                } else {   // up
                    if (!down) { std::cerr << "warning: up at t=" << e.t << " with no down; ignored\n"; continue; }
                    release(e);
                }
            }
            rccore::resetTextOverflowCounts();
            doc.paint(context, theme);
        }
    } else if (sweep > 1 && animTimeSec >= 0.0f) {
        for (int i = 0; i < sweep; i++) {
            float t = animTimeSec * (float)i / (float)(sweep - 1);
            context.overrideFloat(rccore::RemoteContext::ID_ANIMATION_TIME, t);
            while (nextClick < clicks.size() && clicks[nextClick][0] <= t) {
                // As the viewer does it: press (touch down — where a ripple starts), release, click.
                doc.touchDown(context, clicks[nextClick][1], clicks[nextClick][2]);
                doc.touchUp(context, clicks[nextClick][1], clicks[nextClick][2], 0.0f, 0.0f);
                bool hit = doc.onClick(context, clicks[nextClick][1], clicks[nextClick][2]);
                std::cerr << "click t=" << t << " (" << clicks[nextClick][1] << "," << clicks[nextClick][2] << ") " << (hit ? "hit" : "miss") << "\n";
                nextClick++;
            }
            rccore::resetTextOverflowCounts();
            doc.paint(context, theme);
        }
    } else {
        for (int i = 0; i < frames; i++) {
            rccore::resetTextOverflowCounts();
            doc.paint(context, theme);
        }
    }

    // Encode to PNG
    SkPixmap pixmap;
    if (!surface->peekPixels(&pixmap)) {
        std::cerr << "Error: failed to read pixels\n";
        return 1;
    }

    if (!outputPath) {
        std::cerr << "Error: no output path (give one after the input, or use --check)\n";
        return 1;
    }
    SkFILEWStream stream(outputPath);
    if (!stream.isValid()) {
        std::cerr << "Error: cannot write " << outputPath << "\n";
        return 1;
    }

    SkPngEncoder::Options pngOpts;
    if (!SkPngEncoder::Encode(&stream, pixmap, pngOpts)) {
        std::cerr << "Error: PNG encoding failed\n";
        return 1;
    }

    if (reportPath) {
        // Pixel stats against the clear colour. N32 premul is what the surface was made
        // with, so the cleared value is the premultiplied background.
        const uint32_t bgPM = SkPreMultiplyColor(bg);
        std::unordered_set<uint32_t> colors;
        int64_t changed = 0;
        int minX = surfW, minY = surfH, maxX = -1, maxY = -1;
        for (int y = 0; y < surfH; y++) {
            const uint32_t* row = pixmap.addr32(0, y);
            for (int x = 0; x < surfW; x++) {
                uint32_t px = row[x];
                if (colors.size() <= 4096) colors.insert(px);
                if (px != bgPM) {
                    changed++;
                    minX = std::min(minX, x); maxX = std::max(maxX, x);
                    minY = std::min(minY, y); maxY = std::max(maxY, y);
                }
            }
        }
        std::string bounds = maxX < 0 ? "null"
            : "[" + std::to_string(minX) + "," + std::to_string(minY) + "," +
              std::to_string(maxX + 1) + "," + std::to_string(maxY + 1) + "]";
        auto lo = rccore::layoutOverflowCounts();
        report.push_back({"layout", "{\"overflowing\":" + std::to_string(lo.components) + ",\"examples\":[" +
            [&]() { std::string e; for (size_t k = 0; k < lo.examples.size(); k++) e += (k ? "," : "") + jsonStr(lo.examples[k]); return e; }() +
            "],\"zeroSize\":" + std::to_string(lo.zeroSize) + ",\"zeroSizeExamples\":[" +
            [&]() { std::string e; for (size_t k = 0; k < lo.zeroSizeExamples.size(); k++) e += (k ? "," : "") + jsonStr(lo.zeroSizeExamples[k]); return e; }() + "]}"});
        auto tc = rccore::textOverflowCounts();
        report.push_back({"text", "{\"truncated\":" + std::to_string(tc.truncated) +
            ",\"clipped\":" + std::to_string(tc.clipped) +
            ",\"ellipsized\":" + std::to_string(tc.ellipsized) + ",\"examples\":[" +
            [&]() { std::string e; for (size_t k = 0; k < tc.examples.size(); k++)
                e += (k ? "," : "") + std::string("{\"kind\":") + jsonStr(tc.examples[k].first) + ",\"text\":" + jsonStr(tc.examples[k].second) + "}";
                return e; }() + "]}"});
        report.push_back({"render", "{\"width\":" + std::to_string(surfW) +
            ",\"height\":" + std::to_string(surfH) +
            ",\"background\":" + hexColor(bg) +
            ",\"changedFraction\":" + jsonNum((double) changed / ((double) surfW * surfH)) +
            ",\"distinctColors\":" + std::to_string(colors.size()) +
            ",\"distinctColorsCapped\":" + (colors.size() > 4096 ? "true" : "false") +
            ",\"contentBounds\":" + bounds + "}"});
        writeReport();
    }

    // With the report on stdout, keep stdout pure JSON.
    (reportPath && std::strcmp(reportPath, "-") == 0 ? std::cerr : std::cout)
        << "Success: " << inputPath << " -> " << outputPath
        << " (" << width << "x" << height << ")\n";
    return 0;
}
