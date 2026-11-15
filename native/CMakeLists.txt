cmake_minimum_required(VERSION 3.20)
project(rge C)

# librge: the only drawing code in the engine. It wraps raylib and executes the draw records
# described in include/rge.h. Two libraries are built from the same sources:
#   rge         shared, loaded by the Node host (koffi)
#   rge_static  static, linked into the Rust host
#
# RGE_PLATFORM picks raylib's platform:
#   Desktop  a real window (OpenGL). Needs the X11 and GL development packages on Linux.
#   Memory   raylib's software renderer into a memory buffer: no window, no GPU, no system libraries.
#            For tests and CI. There is no keyboard or mouse input, and audio may be unavailable.
set(RGE_PLATFORM "Desktop" CACHE STRING "raylib platform: Desktop or Memory")
set_property(CACHE RGE_PLATFORM PROPERTY STRINGS Desktop Memory)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(CMAKE_WINDOWS_EXPORT_ALL_SYMBOLS ON)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release)
endif()

include(FetchContent)
set(PLATFORM "${RGE_PLATFORM}" CACHE STRING "" FORCE)
set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
FetchContent_Declare(
  raylib
  GIT_REPOSITORY https://github.com/raysan5/raylib.git
  GIT_TAG 6.0
  GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(raylib)

set(RGE_SOURCES src/rge.c src/assets.c src/keys.c src/overlaps.c src/storage.c)

add_library(rge SHARED ${RGE_SOURCES})
target_include_directories(rge PUBLIC include PRIVATE src)
target_link_libraries(rge PRIVATE raylib)

add_library(rge_static STATIC ${RGE_SOURCES})
target_include_directories(rge_static PUBLIC include PRIVATE src)
target_link_libraries(rge_static PUBLIC raylib)

# raylib's Memory platform does not pull in the system libraries its audio and maths code uses.
if(UNIX AND NOT APPLE)
  target_link_libraries(rge PRIVATE m pthread dl)
  target_link_libraries(rge_static PUBLIC m pthread dl)
endif()

if(MSVC)
  target_compile_options(rge PRIVATE /W4)
  target_compile_options(rge_static PRIVATE /W4)
else()
  target_compile_options(rge PRIVATE -Wall -Wextra)
  target_compile_options(rge_static PRIVATE -Wall -Wextra)
endif()

enable_testing()
add_executable(rge_smoke test/smoke.c)
target_link_libraries(rge_smoke PRIVATE rge_static)
target_include_directories(rge_smoke PRIVATE src)
if(RGE_PLATFORM STREQUAL "Memory")
  target_compile_definitions(rge_smoke PRIVATE RGE_SMOKE_SOFTWARE)
endif()
add_test(NAME smoke COMMAND rge_smoke WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})
