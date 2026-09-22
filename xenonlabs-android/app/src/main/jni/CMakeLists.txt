cmake_minimum_required(VERSION 3.18)
project(xenonlabs_jni C)

add_library(xenonlabs_jni SHARED
    jni_bridge.c
    xenonlabs.c)

target_include_directories(xenonlabs_jni PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/llama_include)

set(LLAMA_LIB_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../jniLibs/${ANDROID_ABI})
target_link_libraries(xenonlabs_jni
    ${LLAMA_LIB_DIR}/libllama.so
    log
    m)

set_target_properties(xenonlabs_jni PROPERTIES
    C_STANDARD 11
    C_VISIBILITY_PRESET hidden)
