# =====================================================================
# XenonLabs — Android JNI build
#
# This builds libxenonlabs_jni.so, which contains:
#   - jni_bridge.c        (Java <-> C bridge)
#   - the canonical src/xenonlabs.c from the repo root
#
# The C library is NOT duplicated here. The canonical source lives at
# <repo>/src/xenonlabs.c and <repo>/include/xenonlabs.h. Fixes to the
# host library reach Android automatically.
#
# Requires the following prebuilt libs to be present at build time,
# placed there by the CI workflow:
#
#   android/app/src/main/jniLibs/arm64-v8a/
#     libllama.so
#     libggml.so
#     libggml-base.so
#     libggml-cpu.so
#
# And the following headers:
#
#   android/app/src/main/jni/llama_include/
#     llama.h
#     ggml.h
#     ggml-*.h
# =====================================================================

cmake_minimum_required(VERSION 3.18)

project(xenonlabs_jni
    VERSION     1.0.0
    DESCRIPTION "Android JNI wrapper for XenonLabs"
    LANGUAGES   C)

# ---------------------------------------------------------------------
# Language
# ---------------------------------------------------------------------

set(CMAKE_C_STANDARD          11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS        ON)

# ---------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------

# Repo root, walking up from this file's directory.
#   android/app/src/main/jni/CMakeLists.txt   <- this file
#   ^    ^   ^   ^   ^
#   1    2   3   4   5  = repo root
get_filename_component(XENONLABS_ROOT
    "${CMAKE_CURRENT_SOURCE_DIR}/../../../../.." ABSOLUTE)

# Sanity check: the canonical source must exist.
if(NOT EXISTS "${XENONLABS_ROOT}/src/xenonlabs.c")
    message(FATAL_ERROR
        "Cannot find ${XENONLABS_ROOT}/src/xenonlabs.c. "
        "This CMakeLists expects to live at "
        "android/app/src/main/jni/ inside the XenonLabs repo.")
endif()
if(NOT EXISTS "${XENONLABS_ROOT}/include/xenonlabs.h")
    message(FATAL_ERROR
        "Cannot find ${XENONLABS_ROOT}/include/xenonlabs.h.")
endif()

message(STATUS "XenonLabs root : ${XENONLABS_ROOT}")

# Prebuilt llama.cpp shared libraries, per ABI.
set(LLAMA_LIB_DIR
    "${CMAKE_CURRENT_SOURCE_DIR}/../jniLibs/${ANDROID_ABI}")

# Sanity check: the prebuilt llama libs must be present.
foreach(_lib libllama.so libggml.so)
    if(NOT EXISTS "${LLAMA_LIB_DIR}/${_lib}")
        message(FATAL_ERROR
            "Missing ${LLAMA_LIB_DIR}/${_lib}. "
            "The CI must copy prebuilt llama.cpp libraries into "
            "android/app/src/main/jniLibs/${ANDROID_ABI}/ before "
            "Gradle invokes this CMakeLists.")
    endif()
endforeach()

# Prebuilt llama.cpp headers, shipped into llama_include/ by CI.
set(LLAMA_INCLUDE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/llama_include")

if(NOT EXISTS "${LLAMA_INCLUDE_DIR}/llama.h")
    message(FATAL_ERROR
        "Missing ${LLAMA_INCLUDE_DIR}/llama.h. "
        "The CI must copy llama.cpp headers into "
        "android/app/src/main/jni/llama_include/ before Gradle "
        "invokes this CMakeLists.")
endif()

message(STATUS "llama libs     : ${LLAMA_LIB_DIR}")
message(STATUS "llama headers  : ${LLAMA_INCLUDE_DIR}")

# ---------------------------------------------------------------------
# JNI library
# ---------------------------------------------------------------------

add_library(xenonlabs_jni SHARED
    jni_bridge.c
    ${XENONLABS_ROOT}/src/xenonlabs.c)

target_include_directories(xenonlabs_jni PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}                # jni_bridge.c own headers
    ${XENONLABS_ROOT}/include                  # canonical xenonlabs.h
    ${LLAMA_INCLUDE_DIR})                      # llama.h, ggml.h

# Link against the prebuilt llama.cpp shared libraries by absolute path.
# By naming the .so directly (not via -lllama), Gradle/CMake will also
# pull the ELF NEEDED entries at runtime, so libggml-base.so and
# libggml-cpu.so only need to be present in the APK, not linked here.
target_link_libraries(xenonlabs_jni
    PRIVATE
        ${LLAMA_LIB_DIR}/libllama.so
        ${LLAMA_LIB_DIR}/libggml.so
        log      # bionic liblog, Android-only
        m)       # libm, harmless to name on Android

# Some prebuilt llama.cpp .so files do not export ggml_log_set /
# llama_log_set. When this define is set, xenonlabs.c skips
# log-callback registration so linking succeeds.
target_compile_definitions(xenonlabs_jni PRIVATE
    XENONLABS_NO_LOG_SET)

# Force every symbol hidden by default. JNIEXPORT on the bridge
# functions overrides this per-symbol, so only the JNI entry points
# are externally visible.
set_target_properties(xenonlabs_jni PROPERTIES
    C_VISIBILITY_PRESET hidden
    VERSION             ${PROJECT_VERSION}
    SOVERSION           ${PROJECT_VERSION_MAJOR})

# ---------------------------------------------------------------------
# Warnings — strict but not fatal
# ---------------------------------------------------------------------

if(CMAKE_C_COMPILER_ID MATCHES "GNU|Clang")
    target_compile_options(xenonlabs_jni PRIVATE
        -Wall
        -Wextra
        -Wpedantic
        -Wshadow
        -Wpointer-arith
        -Wcast-qual
        -Wstrict-prototypes
        -Wmissing-prototypes
        -Wno-unused-parameter)
endif()
