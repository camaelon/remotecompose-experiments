# rcX — top-level desktop build (macOS arm64).
#
# Produces:
#   - lib/rccore/librccore.a            engine
#   - lib/rcskia/librcskia.a            Skia bridge
#   - tools/rc2json/rc2json             binary -> JSON
#   - tools/rc2image/rc2image           headless render -> PNG
#   - apps/viewer/rcviewer              GLFW interactive viewer
#
# Skia, GLFW, and miniz are pulled at configure time via CMake FetchContent —
# nothing is vendored.  Linux + Windows ports are out of scope today; the
# iOS static-lib build lives under `ios/CMakeLists.txt`.

cmake_minimum_required(VERSION 3.20)
project(RcX VERSION 0.1.0 LANGUAGES C CXX OBJCXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

if(NOT APPLE)
    message(FATAL_ERROR
        "Desktop build currently targets macOS arm64 only. "
        "iOS lib build: see ios/CMakeLists.txt.")
endif()

include(FetchContent)

# ── Skia (pre-built m143 macOS arm64) ─────────────────────────────────
set(SKIA_VERSION "m143-da51f0d60e-2")
set(SKIA_PLATFORM "macos")
set(SKIA_BUILD_TYPE "Release")
set(SKIA_ARCH "arm64")
set(SKIA_ZIP "Skia-${SKIA_VERSION}-${SKIA_PLATFORM}-${SKIA_BUILD_TYPE}-${SKIA_ARCH}.zip")

FetchContent_Declare(skia
    URL "https://github.com/HumbleUI/SkiaBuild/releases/download/${SKIA_VERSION}/${SKIA_ZIP}"
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_GetProperties(skia)
if(NOT skia_POPULATED)
    FetchContent_Populate(skia)
endif()
set(SKIA_DIR "${skia_SOURCE_DIR}")
if(EXISTS "${SKIA_DIR}/out/${SKIA_BUILD_TYPE}-${SKIA_ARCH}")
    set(SKIA_LIB_DIR "${SKIA_DIR}/out/${SKIA_BUILD_TYPE}-${SKIA_ARCH}")
elseif(EXISTS "${SKIA_DIR}/out/${SKIA_BUILD_TYPE}")
    set(SKIA_LIB_DIR "${SKIA_DIR}/out/${SKIA_BUILD_TYPE}")
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

find_library(APPKIT_FW       AppKit)
find_library(APPSERVICES_FW  ApplicationServices)
find_library(CF_FW           CoreFoundation)
find_library(CG_FW           CoreGraphics)
find_library(CT_FW           CoreText)
find_library(IMAGEIO_FW      ImageIO)
find_library(METAL_FW        Metal)
find_library(FOUNDATION_FW   Foundation)
find_library(OPENGL_FW       OpenGL)

set_property(TARGET skia_lib APPEND PROPERTY INTERFACE_LINK_LIBRARIES
    ${APPKIT_FW} ${APPSERVICES_FW} ${CF_FW} ${CG_FW} ${CT_FW}
    ${IMAGEIO_FW} ${METAL_FW} ${FOUNDATION_FW} ${OPENGL_FW}
)

# ── GLFW (pre-built macOS arm64, used by the viewer app) ──────────────
set(GLFW_ZIP "glfw-3.4.bin.MACOS.zip")
FetchContent_Declare(glfw
    URL "https://github.com/glfw/glfw/releases/download/3.4/${GLFW_ZIP}"
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_GetProperties(glfw)
if(NOT glfw_POPULATED)
    FetchContent_Populate(glfw)
endif()
set(GLFW_DIR "${glfw_SOURCE_DIR}")
set(GLFW_LIB_PATH     "${GLFW_DIR}/lib-arm64/libglfw3.a")
set(GLFW_INCLUDE_PATH "${GLFW_DIR}/include")
message(STATUS "GLFW dir: ${GLFW_DIR}")

# ── miniz (zip support inside the viewer) ─────────────────────────────
FetchContent_Declare(miniz
    GIT_REPOSITORY https://github.com/richgel999/miniz.git
    GIT_TAG        3.0.2
)
FetchContent_GetProperties(miniz)
if(NOT miniz_POPULATED)
    FetchContent_Populate(miniz)
endif()
set(MINIZ_DIR "${miniz_SOURCE_DIR}")
add_library(miniz STATIC
    "${MINIZ_DIR}/miniz.c"
    "${MINIZ_DIR}/miniz_tdef.c"
    "${MINIZ_DIR}/miniz_tinfl.c"
    "${MINIZ_DIR}/miniz_zip.c"
)
target_include_directories(miniz PUBLIC "${MINIZ_DIR}")
target_compile_definitions(miniz PUBLIC MINIZ_EXPORT=)
file(WRITE "${MINIZ_DIR}/miniz_export.h"
    "#ifndef MINIZ_EXPORT_H\n#define MINIZ_EXPORT_H\n#define MINIZ_EXPORT\n#endif\n")

# ── Sub-projects ───────────────────────────────────────────────────────
add_subdirectory(lib/rccore)
add_subdirectory(lib/rcskia)
add_subdirectory(tools/rc2json)
add_subdirectory(tools/rc2image)
add_subdirectory(apps/viewer)
