cmake_minimum_required(VERSION 3.18)
project(xenonlabs_jni C)

set(LLAMA_LIB_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../jniLibs/${ANDROID_ABI}")

add_library(xenonlabs_jni SHARED
    jni_bridge.c
    xenonlabs.c)

# Prebuilt Android libllama.so from CI does not export ggml_log_set.
# Skip the log-callback registration to avoid undefined-symbol link errors.
target_compile_definitions(xenonlabs_jni PRIVATE XENONLABS_NO_LOG_SET)

target_include_directories(xenonlabs_jni PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/llama_include)

target_link_libraries(xenonlabs_jni
    ${LLAMA_LIB_DIR}/libllama.so
    ${LLAMA_LIB_DIR}/libggml.so
    log
    m)

set_target_properties(xenonlabs_jni PROPERTIES
    C_STANDARD 11
    C_VISIBILITY_PRESET hidden)
