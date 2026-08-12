cmake_minimum_required(VERSION 3.15)
project(face_native_addon LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# cmake-js supplies the Electron/Node N-API headers and libraries through these
# variables. node-addon-api is header-only, so locate its include directory at
# configure time instead of relying on a developer-specific global path.
execute_process(
    COMMAND node -p "require('node-addon-api').include"
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/.."
    OUTPUT_VARIABLE NODE_ADDON_API_DIR
    OUTPUT_STRIP_TRAILING_WHITESPACE
)
string(REPLACE "\"" "" NODE_ADDON_API_DIR "${NODE_ADDON_API_DIR}")

if(NOT EXISTS "${NODE_ADDON_API_DIR}/napi.h")
    message(FATAL_ERROR "node-addon-api was not found. Run npm ci in classroom-app first.")
endif()

# ── ONNX Runtime ──────────────────────────────────────────────
set(ONNX_RUNTIME_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/deps/onnxruntime")

if(WIN32)
    set(ONNX_LIB "${ONNX_RUNTIME_ROOT}/lib/onnxruntime.lib")
    set(ONNX_DLL "${ONNX_RUNTIME_ROOT}/lib/onnxruntime.dll")
    add_definitions(-DNOMINMAX -DWIN32_LEAN_AND_MEAN)
elseif(APPLE)
    set(ONNX_LIB "${ONNX_RUNTIME_ROOT}/lib/libonnxruntime.dylib")
    set(CMAKE_OSX_DEPLOYMENT_TARGET "10.15")
    set(ONNX_DYLIB "${ONNX_RUNTIME_ROOT}/lib/libonnxruntime.dylib")
else()
    set(ONNX_LIB "${ONNX_RUNTIME_ROOT}/lib/libonnxruntime.so")
    set(ONNX_SO "${ONNX_RUNTIME_ROOT}/lib/libonnxruntime.so")
endif()

include_directories(
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${ONNX_RUNTIME_ROOT}/include
    ${CMAKE_JS_INC}
    ${NODE_ADDON_API_DIR}
)

# ── Sources ───────────────────────────────────────────────────
file(GLOB_RECURSE SOURCES src/*.cpp)

# ── Build shared library (.node) ──────────────────────────────
add_library(${PROJECT_NAME} SHARED ${SOURCES} ${CMAKE_JS_SRC})

target_compile_definitions(${PROJECT_NAME} PRIVATE NAPI_CPP_EXCEPTIONS)
target_link_libraries(${PROJECT_NAME} PRIVATE ${CMAKE_JS_LIB} ${ONNX_LIB})
set_target_properties(${PROJECT_NAME} PROPERTIES
    PREFIX ""
    SUFFIX ".node"
)

# macOS: ensure the ONNX .dylib can be found next to the .node
if(APPLE)
    set_target_properties(${PROJECT_NAME} PROPERTIES
        LINK_FLAGS "-Wl,-rpath,@loader_path/"
    )
    add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            ${ONNX_DYLIB} $<TARGET_FILE_DIR:${PROJECT_NAME}>
    )
endif()

# Windows: copy ONNX DLL next to .node
if(WIN32)
    add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            ${ONNX_DLL} $<TARGET_FILE_DIR:${PROJECT_NAME}>
    )
endif()

# Linux: copy ONNX .so next to .node
if(UNIX AND NOT APPLE)
    set_target_properties(${PROJECT_NAME} PROPERTIES
        BUILD_RPATH "$ORIGIN"
        INSTALL_RPATH "$ORIGIN"
    )
    add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            ${ONNX_SO} $<TARGET_FILE_DIR:${PROJECT_NAME}>
    )
endif()
