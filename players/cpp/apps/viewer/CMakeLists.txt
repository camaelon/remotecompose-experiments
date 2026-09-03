# rcviewer — the command line and event loop around the rcplayer runtime.
add_executable(rcviewer main.cpp)
target_link_libraries(rcviewer PRIVATE rcplayer)
