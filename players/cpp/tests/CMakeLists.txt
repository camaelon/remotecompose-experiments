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

# Click actions: one click must run the action exactly once (counter fixture).
add_executable(click_action_test click_action_test.cpp)
target_link_libraries(click_action_test PRIVATE rcskia rccore skia_lib)
add_test(NAME click_action
         COMMAND click_action_test "${CMAKE_CURRENT_SOURCE_DIR}/fixtures")

# Diagnostic (not a test): maps click points to the variables they change.
add_executable(click_probe click_probe.cpp)
target_link_libraries(click_probe PRIVATE rcskia rccore skia_lib)

# MODIFIER_VISIBILITY must reach the screen, in both directions.
add_executable(visibility_test visibility_test.cpp)
target_link_libraries(visibility_test PRIVATE rcskia rccore skia_lib)
add_test(NAME visibility
         COMMAND visibility_test "${CMAKE_CURRENT_SOURCE_DIR}/fixtures")
