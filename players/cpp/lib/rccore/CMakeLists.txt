cmake_minimum_required(VERSION 3.20)

file(GLOB_RECURSE RCCORE_SOURCES src/*.cpp)

add_library(rccore STATIC ${RCCORE_SOURCES})

target_include_directories(rccore PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_compile_features(rccore PUBLIC cxx_std_17)
