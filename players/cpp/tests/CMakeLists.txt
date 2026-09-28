cmake_minimum_required(VERSION 3.20)

# Pointer-routing regression for embedded rc-documents (RcDocumentHost).
add_executable(rcdoc_pointer_test rcdoc_pointer_test.cpp)
target_link_libraries(rcdoc_pointer_test PRIVATE rcskia rccore skia_lib)

# Run from the source tree so it finds tests/fixtures/host.rc + media/nested.rc.
add_test(NAME rcdoc_pointer
         COMMAND rcdoc_pointer_test "${CMAKE_CURRENT_SOURCE_DIR}/fixtures")

# The camera embed's config string.
add_executable(camera_config_test camera_config_test.cpp)
target_link_libraries(camera_config_test PRIVATE rcplayer)
add_test(NAME camera_config COMMAND camera_config_test)
