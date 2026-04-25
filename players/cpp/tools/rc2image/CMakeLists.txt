cmake_minimum_required(VERSION 3.20)

add_executable(rc2image main.cpp)

target_link_libraries(rc2image
    PRIVATE rcskia rccore skia_lib
)
