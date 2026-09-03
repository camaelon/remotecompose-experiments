# rcplayer — the desktop player runtime shared by rcviewer and any other app that
# wants to play .rc documents in a window: render backends, custom-component hosts
# for embedded video / web pages / sub-documents, zip decks, voice-over, PDF export.
#
# Everything here is window-system-aware (GLFW + OpenGL, Metal on macOS) but does not
# own a window — the host app creates it and drives the loop.
cmake_minimum_required(VERSION 3.20)

set(RCPLAYER_SOURCES
    src/Callbacks.cpp
    src/ImageExport.cpp
    src/PdfExport.cpp
    src/Player.cpp
    src/StillHosts.cpp
    src/VideoCustomHost.cpp
)

if(APPLE)
    list(APPEND RCPLAYER_SOURCES
        src/AvfVideoPlayer.mm
        src/MetalRenderBackend.mm
        src/WebCustomHost.mm
        src/WidgetHelper.mm
    )
else()
    list(APPEND RCPLAYER_SOURCES
        src/AvfVideoPlayerStub.cpp
        src/WebCustomHostStub.cpp
        src/WidgetHelperStub.cpp
    )
endif()

add_library(rcplayer STATIC ${RCPLAYER_SOURCES})

target_include_directories(rcplayer PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_compile_features(rcplayer PUBLIC cxx_std_17)
target_link_libraries(rcplayer PUBLIC rcskia rccore skia_lib miniz)

# ── GLFW ──────────────────────────────────────────────────────────────
# PUBLIC: the callbacks and the window handle are part of the interface, so a host
# app compiles against the same GLFW headers.
if(APPLE)
    # Prefer the paths the top-level CMakeLists fetched, fall back to Homebrew.
    find_library(GLFW_LIB NAMES glfw glfw3
        PATHS ${GLFW_LIB_PATH} /opt/homebrew/lib
        NO_DEFAULT_PATH)
    if(NOT GLFW_LIB AND DEFINED GLFW_LIB_PATH)
        set(GLFW_LIB ${GLFW_LIB_PATH})
    endif()
    find_path(GLFW_INCLUDE GLFW/glfw3.h
        PATHS ${GLFW_INCLUDE_PATH} /opt/homebrew/include
        NO_DEFAULT_PATH)
    if(NOT GLFW_INCLUDE AND DEFINED GLFW_INCLUDE_PATH)
        set(GLFW_INCLUDE ${GLFW_INCLUDE_PATH})
    endif()
    if(NOT GLFW_LIB OR NOT GLFW_INCLUDE)
        message(FATAL_ERROR
            "GLFW not found. Install via 'brew install glfw' or ensure the "
            "top-level CMakeLists downloads it via FetchContent.")
    endif()

    target_include_directories(rcplayer PUBLIC ${GLFW_INCLUDE})
    target_link_libraries(rcplayer PUBLIC ${GLFW_LIB} ${OPENGL_FW})
else()
    find_package(OpenGL REQUIRED)
    target_link_libraries(rcplayer PUBLIC PkgConfig::GLFW OpenGL::GL)
endif()

# ── Frameworks: GLFW static linking, Metal, AVFoundation, WebKit ──────
if(APPLE)
    find_library(IOKIT_FW        IOKit)
    find_library(COCOA_FW        Cocoa)
    find_library(QUARTZCORE_FW   QuartzCore)
    find_library(METALKIT_FW     MetalKit)
    find_library(AVFOUNDATION_FW AVFoundation)
    find_library(COREMEDIA_FW    CoreMedia)
    find_library(COREVIDEO_FW    CoreVideo)
    find_library(WEBKIT_FW       WebKit)
    target_link_libraries(rcplayer PUBLIC
        ${IOKIT_FW} ${COCOA_FW} ${QUARTZCORE_FW} ${METALKIT_FW}
        ${AVFOUNDATION_FW} ${COREMEDIA_FW} ${COREVIDEO_FW} ${WEBKIT_FW})

    # Obj-C++ ARC for the .mm sources.
    set_source_files_properties(
        src/AvfVideoPlayer.mm
        src/MetalRenderBackend.mm
        src/WebCustomHost.mm
        src/WidgetHelper.mm
        PROPERTIES COMPILE_FLAGS "-fobjc-arc"
    )
endif()
