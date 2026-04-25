add_executable(rcviewer main.cpp MetalRenderBackend.mm WidgetHelper.mm AvfVideoPlayer.mm)

target_link_libraries(rcviewer PRIVATE rcskia rccore skia_lib miniz)

# GLFW — prefer paths from parent CMakeLists (FetchContent), fall back to system
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

target_include_directories(rcviewer PRIVATE ${GLFW_INCLUDE})
target_link_libraries(rcviewer PRIVATE ${GLFW_LIB})

# OpenGL framework (for CPU backend texture upload)
target_link_libraries(rcviewer PRIVATE ${OPENGL_FW})

# Frameworks required by GLFW static linking, Metal backend, AVFoundation
if(APPLE)
    find_library(IOKIT_FW IOKit)
    find_library(COCOA_FW Cocoa)
    find_library(QUARTZCORE_FW QuartzCore)
    find_library(METALKIT_FW MetalKit)
    find_library(AVFOUNDATION_FW AVFoundation)
    find_library(COREMEDIA_FW CoreMedia)
    find_library(COREVIDEO_FW CoreVideo)
    target_link_libraries(rcviewer PRIVATE
        ${IOKIT_FW} ${COCOA_FW} ${QUARTZCORE_FW} ${METALKIT_FW}
        ${AVFOUNDATION_FW} ${COREMEDIA_FW} ${COREVIDEO_FW})
endif()

# Obj-C++ flags (ARC) for all .mm sources
set_source_files_properties(
    MetalRenderBackend.mm
    WidgetHelper.mm
    AvfVideoPlayer.mm
    PROPERTIES COMPILE_FLAGS "-fobjc-arc"
)
