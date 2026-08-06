cmake_minimum_required(VERSION 3.20)

add_executable(rc2layout main.cpp)

target_link_libraries(rc2layout
    PRIVATE rcskia rccore skia_lib
)
