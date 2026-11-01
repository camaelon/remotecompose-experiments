// TextFromFloat against the Java reference. The fixture holds one case per line, from
// TextFromFloat.apply on the JVM (fixtures/TextFromFloatGolden.java):
//   floatBits <TAB> digitsBefore <TAB> digitsAfter <TAB> flags <TAB> [text]
// Note the reference truncates the whole part unless the document sets OPTIONS_ROUNDING (512):
// 102.9996 with 2 decimals is "102.00", and "103.00" with rounding.
//
//   text_from_float_test <fixtures>/text_from_float_java.tsv
#include "rccore/RemoteContext.h"
#include "rccore/operations/AdvancedOperations.h"

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <sstream>
#include <string>

int main(int argc, char** argv) {
    if (argc < 2) { std::fprintf(stderr, "usage: text_from_float_test FILE.tsv\n"); return 2; }
    std::ifstream f(argv[1]);
    if (!f) { std::fprintf(stderr, "cannot read %s\n", argv[1]); return 1; }
    rccore::RemoteContext ctx;
    long cases = 0, bad = 0;
    std::string line;
    while (std::getline(f, line)) {
        std::istringstream in(line);
        std::string bits, before, after, flags, want;
        std::getline(in, bits, '\t'); std::getline(in, before, '\t');
        std::getline(in, after, '\t'); std::getline(in, flags, '\t'); std::getline(in, want);
        uint32_t b = (uint32_t)std::stoul(bits);
        float v;
        std::memcpy(&v, &b, sizeof(v));
        rccore::TextFromFloat op;
        op.textId = 50;
        op.floatId = v;
        op.oValue = v;
        op.digitsBefore = std::stoi(before);
        op.digitsAfter = std::stoi(after);
        op.flags = std::stoi(flags);
        op.apply(ctx);
        std::string got = "[" + ctx.getText(50) + "]";
        cases++;
        if (got != want) {
            if (bad++ < 40) std::printf("FAIL %g before=%s after=%s flags=%s java %s got %s\n", v, before.c_str(), after.c_str(), flags.c_str(), want.c_str(), got.c_str());
        }
    }
    std::printf("%ld cases, %ld differ from Java\n", cases, bad);
    return bad ? 1 : 0;
}
