cmake_minimum_required(VERSION 3.20)

file(GLOB_RECURSE RCCORE_SOURCES src/*.cpp)

add_library(rccore STATIC ${RCCORE_SOURCES})

target_include_directories(rccore PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_compile_features(rccore PUBLIC cxx_std_17)

# The 3D software renderer must reproduce the Java reference bit for bit, and Java forbids
# fused multiply-add contraction. Clang contracts a*b+c into an FMA by default, which rounds
# once instead of twice — that alone put 36 of 40 parity scenes wrong. This is a correctness
# flag, not an optimisation preference: do not remove it.
target_compile_options(rccore PRIVATE -ffp-contract=off)

# The scene harness used by players/3d-parity.sh.
find_package(ZLIB REQUIRED)
add_executable(d3scene ${CMAKE_CURRENT_SOURCE_DIR}/../../tools/d3scene/main.cpp)
target_link_libraries(d3scene PRIVATE rccore ZLIB::ZLIB)
target_compile_options(d3scene PRIVATE -ffp-contract=off)
