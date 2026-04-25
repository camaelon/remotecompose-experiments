cmake_minimum_required(VERSION 3.20)

add_executable(rc2json main.cpp)
target_link_libraries(rc2json PRIVATE rccore)
