# rcX — iOS static-library build (arm64 device).
#
# Produces, under `ios/output/`:
#   - lib/librccore.a        engine
#   - lib/librcskia.a        Skia bridge
#   - lib/libskia.a          pre-built Skia (JetBrains skia-pack m144, with Metal)
#   - include/rccore/        public engine headers
#   - include/rcskia/        public bridge headers
#
# These artifacts are what the iOS app under `apps/iosViewer/` links against.
#
# Run via the convenience wrapper:
#       (cd ios && ./build.sh)
# or manually:
#       cmake -S ios -B ios/build -DCMAKE_TOOLCHAIN_FILE=ios/ios.toolchain.cmake
#       cmake --build ios/build -j

cmake_minimum_required(VERSION 3.20)
project(RcXiOS VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)

# JetBrains skia-pack ships an iOS arm64 build with Metal enabled — that's
# what the iOS app's GPU path links against.
set(SKIA_ZIP "Skia-m144-e2e6623374-4-ios-Release-arm64.zip")
FetchContent_Declare(skia
    URL "https://github.com/JetBrains/skia-pack/releases/download/m144-e2e6623374-4/${SKIA_ZIP}"
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_GetProperties(skia)
if(NOT skia_POPULATED)
    FetchContent_Populate(skia)
endif()

set(SKIA_DIR "${skia_SOURCE_DIR}")
if(EXISTS "${SKIA_DIR}/out/Release-ios-arm64")
    set(SKIA_LIB_DIR "${SKIA_DIR}/out/Release-ios-arm64")
elseif(EXISTS "${SKIA_DIR}/out/Release-arm64")
    set(SKIA_LIB_DIR "${SKIA_DIR}/out/Release-arm64")
elseif(EXISTS "${SKIA_DIR}/out/Release")
    set(SKIA_LIB_DIR "${SKIA_DIR}/out/Release")
else()
    set(SKIA_LIB_DIR "${SKIA_DIR}/out")
endif()
message(STATUS "Skia dir: ${SKIA_DIR}")
message(STATUS "Skia lib dir: ${SKIA_LIB_DIR}")

add_library(skia_lib STATIC IMPORTED GLOBAL)
set_target_properties(skia_lib PROPERTIES
    IMPORTED_LOCATION "${SKIA_LIB_DIR}/libskia.a"
)
target_include_directories(skia_lib INTERFACE "${SKIA_DIR}")

find_library(CF_FW           CoreFoundation)
find_library(CG_FW           CoreGraphics)
find_library(CT_FW           CoreText)
find_library(IMAGEIO_FW      ImageIO)
find_library(METAL_FW        Metal)
find_library(FOUNDATION_FW   Foundation)
find_library(UIKIT_FW        UIKit)
find_library(MOBILECS_FW     MobileCoreServices)

set_property(TARGET skia_lib APPEND PROPERTY INTERFACE_LINK_LIBRARIES
    ${CF_FW} ${CG_FW} ${CT_FW} ${IMAGEIO_FW} ${METAL_FW}
    ${FOUNDATION_FW} ${UIKIT_FW} ${MOBILECS_FW}
)

# ── Engine + bridge: source lives at the repo root (one source of truth) ──
add_subdirectory(${CMAKE_SOURCE_DIR}/../lib/rccore  ${CMAKE_BINARY_DIR}/rccore)
add_subdirectory(${CMAKE_SOURCE_DIR}/../lib/rcskia  ${CMAKE_BINARY_DIR}/rcskia)
