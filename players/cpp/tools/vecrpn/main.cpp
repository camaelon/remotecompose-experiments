/* vecrpn — run a VectorRpn program and print the result as raw float bits, matching DumpVec. */
#include "rccore/d3/VectorRpn.h"

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <map>
#include <sstream>
#include <string>
#include <vector>

using namespace rccore::d3;

int main(int argc, char** argv) {
    bool soft = argc > 1 && std::string(argv[1]) == "--soft";
    std::string prog = argv[soft ? 2 : 1];
    static const std::map<std::string, int> OPS = {
        {"+",1},{"-",2},{"*",3},{"/",4},{"%",5},{"min",6},{"max",7},{"pow",8},{"sqrt",9},
        {"abs",10},{"floor",14},{"round",17},{"sin",18},{"cos",19},{"ceil",31},{"square",45},
        {"inv",52},{"nop",55},{"neg",73},{"vec2",100},{"vec3",101},{"vec4",102},{"dot",103},
        {"cross",104},{"len",105},{"lensq",106},{"norm",107},
    };
    std::vector<float> p;
    std::istringstream in(prog);
    std::string tok;
    while (in >> tok) {
        auto it = OPS.find(tok);
        if (it != OPS.end()) {
            int32_t bits = (VEC_OFFSET + it->second) | (int32_t) 0xFF800000;
            float f;
            std::memcpy(&f, &bits, 4);
            p.push_back(f);
        } else {
            p.push_back(std::strtof(tok.c_str(), nullptr));
        }
    }
    VectorRpn rpn;
    rpn.mSoftDomain = soft;
    float out[VEC_MAX_DIM];
    int lanes = rpn.apply(p.data(), (int) p.size(), out);
    printf("%d", lanes);
    for (float v : out) { int32_t b; std::memcpy(&b, &v, 4); printf(" %d", b); }
    printf("\n");
    return 0;
}
