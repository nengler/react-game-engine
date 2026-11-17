# Run by FetchContent as raylib's PATCH_COMMAND (cmake -P), in raylib's source directory.
#
# rlsw (raylib's software renderer) blends in floats and stores each channel with `(uint8_t)(v*255.0f)` when it is built without
# SIMD intrinsics, as raylib builds it. A blended channel past 1 (an add past white, or the alpha of anything added over an opaque
# pixel with (SRC_ALPHA, ONE)) is out of range for that conversion and wraps on x86 and ARM: 1.25 is stored as 62, not 255. An add
# layer then darkens what it should brighten, and in a canvas its pixels turn transparent and show the border colour through. The
# GPU clamps to 0..1, so here the stored channel is clamped too.
set(file "src/external/rlsw.h")
file(READ "${file}" text)
set(patched_marker "/* tse: clamped */")
string(FIND "${text}" "${patched_marker}" already)
if(NOT already EQUAL -1)
  return()
endif()
set(scalar "    dst[0] = (uint8_t)(src[0]*255.0f);
    dst[1] = (uint8_t)(src[1]*255.0f);
    dst[2] = (uint8_t)(src[2]*255.0f);
    dst[3] = (uint8_t)(src[3]*255.0f);")
string(FIND "${text}" "${scalar}" at)
if(at EQUAL -1)
  message(FATAL_ERROR "patch-rlsw.cmake: rlsw's sw_color_to_color8 is not what libtse patches; review the patch for this raylib")
endif()
set(clamped "    ${patched_marker}
    for (int i = 0; i < 4; i++) dst[i] = (uint8_t)(src[i] <= 0.0f ? 0.0f : src[i] >= 1.0f ? 255.0f : src[i]*255.0f);")
string(REPLACE "${scalar}" "${clamped}" text "${text}")
file(WRITE "${file}" "${text}")
