cmake_minimum_required(VERSION 3.20)
project(tse C)

# libtse: the only drawing code in the engine. It wraps raylib and executes the draw records
# described in include/tse.h. Two libraries are built from the same sources:
#   tse         shared, loaded by the Node host (koffi)
#   tse_static  static, linked into the Rust host
#
# TSE_PLATFORM picks raylib's platform:
#   Desktop  a real window (OpenGL). Needs the X11 and GL development packages on Linux.
#   Memory   raylib's software renderer into a memory buffer: no window, no GPU, no system libraries.
#            For tests and CI. There is no keyboard or mouse input, and audio may be unavailable.
set(TSE_PLATFORM "Desktop" CACHE STRING "raylib platform: Desktop or Memory")
set_property(CACHE TSE_PLATFORM PROPERTY STRINGS Desktop Memory)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(CMAKE_WINDOWS_EXPORT_ALL_SYMBOLS ON)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release)
endif()

include(FetchContent)
set(PLATFORM "${TSE_PLATFORM}" CACHE STRING "" FORCE)
set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
FetchContent_Declare(
  raylib
  GIT_REPOSITORY https://github.com/raysan5/raylib.git
  GIT_TAG 6.0
  GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(raylib)

set(TSE_SOURCES src/tse.c src/assets.c src/fonts.c src/keys.c src/overlaps.c src/storage.c)

add_library(tse SHARED ${TSE_SOURCES})
target_include_directories(tse PUBLIC include PRIVATE src)
target_link_libraries(tse PRIVATE raylib)

add_library(tse_static STATIC ${TSE_SOURCES})
target_include_directories(tse_static PUBLIC include PRIVATE src)
target_link_libraries(tse_static PUBLIC raylib)

# raylib's Memory platform does not pull in the system libraries its audio and maths code uses.
if(UNIX AND NOT APPLE)
  target_link_libraries(tse PRIVATE m pthread dl)
  target_link_libraries(tse_static PUBLIC m pthread dl)
endif()

if(MSVC)
  target_compile_options(tse PRIVATE /W4)
  target_compile_options(tse_static PRIVATE /W4)
else()
  target_compile_options(tse PRIVATE -Wall -Wextra)
  target_compile_options(tse_static PRIVATE -Wall -Wextra)
endif()

enable_testing()
add_executable(tse_smoke test/smoke.c)
target_link_libraries(tse_smoke PRIVATE tse_static)
target_include_directories(tse_smoke PRIVATE src)
if(TSE_PLATFORM STREQUAL "Memory")
  target_compile_definitions(tse_smoke PRIVATE TSE_SMOKE_SOFTWARE)
endif()
add_test(NAME smoke COMMAND tse_smoke WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR})
