#pragma once

#include <string>
#include <vector>
#include <memory>
#include <cstdint>
#include <onnxruntime_cxx_api.h>

/// Lightweight descriptions of ONNX tensors and inference outputs.
struct OnnxTensorInfo {
    std::string          name;
    std::vector<int64_t> shape;
    int                  elementType;
};

struct OnnxOutput {
    std::string          name;
    std::vector<int64_t> shape;
    std::vector<float>   data;
};

/// Manages a single ONNX Runtime model session.
/// Thread-safe for inference; caller must serialize init/destroy.
class OnnxModel {
public:
    OnnxModel();
    ~OnnxModel();

    // Load an ONNX model from file.  Returns true on success.
    bool load(const std::string& modelPath, int intraOpThreads = 2);

    // Run inference.  inputData should be preprocessed float tensor in NCHW layout,
    // sized [1, channels, inputHeight, inputWidth].
    // Returns the raw float output tensor (flattened row-major).
    // outputSize is set to the number of elements in the output.
    std::vector<float> run(const std::vector<float>& inputData,
                           int64_t inputChannels,
                           int64_t inputHeight,
                           int64_t inputWidth,
                           size_t* outputSize = nullptr);

    std::vector<OnnxOutput> runAll(const std::vector<float>& inputData,
                                   int64_t inputChannels,
                                   int64_t inputHeight,
                                   int64_t inputWidth);

    std::vector<OnnxTensorInfo> getInputInfo() const;
    std::vector<OnnxTensorInfo> getOutputInfo() const;

    bool isLoaded() const { return m_session != nullptr; }
    void close();

private:
    std::unique_ptr<Ort::Env> m_env;
    std::unique_ptr<Ort::Session> m_session;
    std::unique_ptr<Ort::AllocatorWithDefaultOptions> m_allocator;

    std::string    m_modelPath;
    int            m_intraOpThreads = 2;
};
