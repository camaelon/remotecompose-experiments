# rcnative — a RemoteCompose paint backend built on Core Graphics / Core Text,
# with no Skia.
#
# It implements the same `rccore::PaintContext` interface that `rcskia` does, so it is a
# sibling backend rather than a fork: the engine (`rccore`) is untouched and shared.
#
# The motivation is size. In a Release arm64 build of the IoT sample, Skia is 4.52 MB of a
# 5.61 MB binary — 80.5% — against 0.81 MB for the engine and 0.15 MB for the Skia bridge.
# Core Graphics, Core Text and ImageIO are already in the OS, so replacing that bridge with
# a native one is close to pure subtraction.
#
# Build:  ./build.sh          (device arm64, mirrors ../ios/build.sh)
cmake_minimum_required(VERSION 3.20)
project(rcnative VERSION 0.1.0 LANGUAGES CXX OBJCXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# The engine is shared, not vendored — same source tree the Skia backend builds against.
if(NOT TARGET rccore)
    add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../lib/rccore ${CMAKE_BINARY_DIR}/rccore)
endif()

file(GLOB_RECURSE RCNATIVE_SOURCES src/*.mm src/*.cpp)
add_library(rcnative STATIC ${RCNATIVE_SOURCES})

target_include_directories(rcnative PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)

find_library(CG_FW  CoreGraphics)
find_library(CT_FW  CoreText)
find_library(CF_FW  CoreFoundation)
find_library(IIO_FW ImageIO)

target_link_libraries(rcnative
    PUBLIC  rccore
    PRIVATE ${CG_FW} ${CT_FW} ${CF_FW} ${IIO_FW}
)
target_compile_features(rcnative PUBLIC cxx_std_17)
