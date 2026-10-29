cmake_minimum_required(VERSION 3.20)

file(GLOB_RECURSE RCSKIA_SOURCES src/*.cpp)

add_library(rcskia STATIC ${RCSKIA_SOURCES})

target_include_directories(rcskia PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

# SkShaper (HarfBuzz) + SkUnicode (ICU) for bidi text: libraries shipped next to libskia.a.
set(RCSKIA_SHAPER_LIBS)
foreach(lib skshaper skunicode_icu skunicode_core harfbuzz icu)
    if(EXISTS "${SKIA_LIB_DIR}/lib${lib}.a")
        list(APPEND RCSKIA_SHAPER_LIBS "${SKIA_LIB_DIR}/lib${lib}.a")
    endif()
endforeach()

target_link_libraries(rcskia
    PUBLIC  rccore
    PRIVATE ${RCSKIA_SHAPER_LIBS} skia_lib
)

target_compile_features(rcskia PUBLIC cxx_std_17)
