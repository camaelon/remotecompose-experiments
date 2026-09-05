cmake_minimum_required(VERSION 3.20)

add_executable(rc2image-native main.mm)

find_library(IIO_FW ImageIO)

target_link_libraries(rc2image-native
    PRIVATE rcnative rccore ${IIO_FW}
)
