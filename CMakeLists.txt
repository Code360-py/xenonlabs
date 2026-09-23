# =====================================================================
# XenonLabs — host build
# =====================================================================

cmake_minimum_required(VERSION 3.16)

project(XenonLabs
    VERSION     1.0.0
    DESCRIPTION "C wrapper over llama.cpp"
    LANGUAGES   C)

# ---------------------------------------------------------------------
# Language
# ---------------------------------------------------------------------

set(CMAKE_C_STANDARD          11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS        ON)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
    set_property(CACHE CMAKE_BUILD_TYPE PROPERTY
        STRINGS Debug Release RelWithDebInfo MinSizeRel)
endif()

# ---------------------------------------------------------------------
# Warnings — strict but not fatal
# ---------------------------------------------------------------------

if(CMAKE_C_COMPILER_ID MATCHES "GNU|Clang")
    add_compile_options(
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

# ---------------------------------------------------------------------
# Output directories
# ---------------------------------------------------------------------

set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})
set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR})

# RPATH so the CLI/demo/tests can find libxenonlabs.so next to them
set(CMAKE_BUILD_WITH_INSTALL_RPATH TRUE)
set(CMAKE_INSTALL_RPATH "$ORIGIN")

# ---------------------------------------------------------------------
# Find dependencies
# ---------------------------------------------------------------------

find_package(Threads REQUIRED)

# Search order:
#   1. CMAKE_PREFIX_PATH (user override, e.g. -DCMAKE_PREFIX_PATH=/opt/llama)
#   2. $PREFIX (Termux)
#   3. system default
#
# REQUIRED is not used on find_library/find_path because it requires
# CMake 3.18 and we declare 3.16. Do the check manually.

set(_xenon_hints "")
if(DEFINED ENV{PREFIX} AND NOT "$ENV{PREFIX}" STREQUAL "")
    list(APPEND _xenon_hints "$ENV{PREFIX}")
endif()
if(DEFINED CMAKE_PREFIX_PATH)
    list(APPEND _xenon_hints ${CMAKE_PREFIX_PATH})
endif()

find_library(LLAMA_LIB
    NAMES llama
    HINTS ${_xenon_hints}
    PATH_SUFFIXES lib lib64)
find_path(LLAMA_INCLUDE_DIR
    NAMES llama.h
    HINTS ${_xenon_hints}
    PATH_SUFFIXES include)
find_path(GGML_INCLUDE_DIR
    NAMES ggml.h
    HINTS ${_xenon_hints}
    PATH_SUFFIXES include include/ggml)

if(NOT LLAMA_LIB)
    message(FATAL_ERROR
        "libllama not found. Install llama.cpp, or pass "
        "-DCMAKE_PREFIX_PATH=/path/to/llama. "
        "Looked under: ${_xenon_hints}")
endif()
if(NOT LLAMA_INCLUDE_DIR)
    message(FATAL_ERROR
        "llama.h not found. Looked under: ${_xenon_hints}")
endif()
if(NOT GGML_INCLUDE_DIR)
    message(FATAL_ERROR
        "ggml.h not found. Looked under: ${_xenon_hints}")
endif()

message(STATUS "llama library  : ${LLAMA_LIB}")
message(STATUS "llama headers  : ${LLAMA_INCLUDE_DIR}")
message(STATUS "ggml  headers  : ${GGML_INCLUDE_DIR}")

# ---------------------------------------------------------------------
# Shared library
# ---------------------------------------------------------------------

add_library(xenonlabs SHARED src/xenonlabs.c)

target_include_directories(xenonlabs
    PUBLIC
        $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
        $<INSTALL_INTERFACE:include>
    PRIVATE
        ${LLAMA_INCLUDE_DIR}
        ${GGML_INCLUDE_DIR})

target_link_libraries(xenonlabs
    PRIVATE
        ${LLAMA_LIB}
        Threads::Threads
        m)

# bionic's liblog is Android-only
if(ANDROID)
    target_link_libraries(xenonlabs PRIVATE log)
endif()

set_target_properties(xenonlabs PROPERTIES
    VERSION              ${PROJECT_VERSION}
    SOVERSION            ${PROJECT_VERSION_MAJOR}
    C_VISIBILITY_PRESET  hidden)

# ---------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------

add_executable(xenonlabs-cli src/xenonlabs_cli.c)
target_link_libraries(xenonlabs-cli PRIVATE xenonlabs)
set_target_properties(xenonlabs-cli PROPERTIES
    BUILD_RPATH   "$ORIGIN"
    INSTALL_RPATH "$ORIGIN")

# ---------------------------------------------------------------------
# Demo
# ---------------------------------------------------------------------

add_executable(demo examples/demo.c)
target_link_libraries(demo PRIVATE xenonlabs)
set_target_properties(demo PROPERTIES
    BUILD_RPATH   "$ORIGIN"
    INSTALL_RPATH "$ORIGIN")

# ---------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------

enable_testing()

add_executable(smoke tests/smoke.c)
target_link_libraries(smoke PRIVATE xenonlabs)
set_target_properties(smoke PROPERTIES
    BUILD_RPATH   "$ORIGIN"
    INSTALL_RPATH "$ORIGIN")

add_test(NAME smoke COMMAND smoke)

# Optional end-to-end test if a model is available
set(XENONLABS_TEST_MODEL "" CACHE FILEPATH
    "Path to a .gguf file for the end-to-end smoke test (optional)")
if(XENONLABS_TEST_MODEL)
    set_tests_properties(smoke PROPERTIES
        ENVIRONMENT "XENONLABS_TEST_MODEL=${XENONLABS_TEST_MODEL}")
endif()

# ---------------------------------------------------------------------
# Optional: fetch a tiny model for testing
# ---------------------------------------------------------------------

find_program(CURL_EXECUTABLE curl)
if(CURL_EXECUTABLE AND NOT EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/models/stories15M.gguf")
    add_custom_target(fetch-test-model
        COMMAND ${CMAKE_COMMAND} -E make_directory
                ${CMAKE_CURRENT_SOURCE_DIR}/models
        COMMAND ${CURL_EXECUTABLE} -L --fail
                -o ${CMAKE_CURRENT_SOURCE_DIR}/models/stories15M.gguf
                https://huggingface.co/ggml-org/models/resolve/main/tinyllamas/stories15M-q4_0.gguf
        COMMENT "Downloading stories15M.gguf (test model, ~20 MB)"
        VERBATIM)
endif()

# ---------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------

include(GNUInstallDirs)

install(TARGETS xenonlabs
    LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})

install(TARGETS xenonlabs-cli
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})

install(FILES include/xenonlabs.h
    DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})

# pkg-config file so downstream projects can:
#   pkg-config --cflags --libs xenonlabs
configure_file(
    ${CMAKE_CURRENT_SOURCE_DIR}/cmake/xenonlabs.pc.in
    ${CMAKE_CURRENT_BINARY_DIR}/xenonlabs.pc
    @ONLY)

install(FILES ${CMAKE_CURRENT_BINARY_DIR}/xenonlabs.pc
    DESTINATION ${CMAKE_INSTALL_LIBDIR}/pkgconfig)
