cmake_minimum_required(VERSION 3.20)

file(GLOB_RECURSE RCSKIA_SOURCES src/*.cpp)

add_library(rcskia STATIC ${RCSKIA_SOURCES})

target_include_directories(rcskia PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_link_libraries(rcskia
    PUBLIC  rccore
    PRIVATE skia_lib
)

target_compile_features(rcskia PUBLIC cxx_std_17)
