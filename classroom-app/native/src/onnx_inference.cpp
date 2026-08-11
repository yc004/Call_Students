#include "onnx_inference.h"
#include <onnxruntime_cxx_api.h>
#include <string>
#include <stdexcept>

OnnxModel::OnnxModel() = default;

OnnxModel::~OnnxModel() {
    close();
}

bool OnnxModel::load(const std::string& modelPath, int intraOpThreads) {
    m_modelPath = modelPath;
    m_intraOpThreads = intraOpThreads;

    try {
        // Create environment
        m_env = std::make_unique<Ort::Env>(
            OrtLoggingLevel::ORT_LOGGING_LEVEL_ERROR, "face_native");

        // Session options
        Ort::SessionOptions opts;
        opts.SetIntraOpNumThreads(intraOpThreads);
        opts.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);

        // Load model
        m_session = std::make_unique<Ort::Session>(*m_env, modelPath.c_str(), opts);

        // Allocator
        m_allocator = std::make_unique<Ort::AllocatorWithDefaultOptions>();

        return true;
    } catch (const std::exception& e) {
        close();
        return false;
    }
}

std::vector<float> OnnxModel::run(
    const std::vector<float>& inputData,
    int64_t inputChannels,
    int64_t inputHeight,
    int64_t inputWidth,
    size_t* outputSize)
{
    auto outputs = runAll(inputData, inputChannels, inputHeight, inputWidth);
    if (outputs.empty()) {
        if (outputSize) *outputSize = 0;
        return {};
    }
    if (outputSize) *outputSize = outputs[0].data.size();
    return std::move(outputs[0].data);
}

std::vector<OnnxOutput> OnnxModel::runAll(
    const std::vector<float>& inputData,
    int64_t inputChannels,
    int64_t inputHeight,
    int64_t inputWidth)
{
    if (!m_session || !m_allocator) return {};

    try {
        auto& session = *m_session;
        auto& allocator = *m_allocator;
        std::vector<int64_t> inputShape = {1, inputChannels, inputHeight, inputWidth};
        const size_t inputTensorSize = static_cast<size_t>(inputChannels * inputHeight * inputWidth);
        if (inputData.size() != inputTensorSize) return {};

        Ort::MemoryInfo memInfo = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
        Ort::Value inputTensor = Ort::Value::CreateTensor<float>(
            memInfo, const_cast<float*>(inputData.data()), inputTensorSize,
            inputShape.data(), inputShape.size());

        auto inputName = session.GetInputNameAllocated(0, allocator);
        const char* inputNames[] = {inputName.get()};

        const size_t outputCount = session.GetOutputCount();
        std::vector<Ort::AllocatedStringPtr> ownedOutputNames;
        std::vector<const char*> outputNames;
        ownedOutputNames.reserve(outputCount);
        outputNames.reserve(outputCount);
        for (size_t i = 0; i < outputCount; ++i) {
            ownedOutputNames.push_back(session.GetOutputNameAllocated(i, allocator));
            outputNames.push_back(ownedOutputNames.back().get());
        }

        auto values = session.Run(Ort::RunOptions{nullptr}, inputNames, &inputTensor, 1,
                                  outputNames.data(), outputNames.size());

        std::vector<OnnxOutput> result;
        result.reserve(values.size());
        for (size_t i = 0; i < values.size(); ++i) {
            if (!values[i].IsTensor()) continue;
            auto tensorInfo = values[i].GetTensorTypeAndShapeInfo();
            if (tensorInfo.GetElementType() != ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT) continue;
            auto shape = tensorInfo.GetShape();
            const size_t count = tensorInfo.GetElementCount();
            const float* data = values[i].GetTensorData<float>();
            result.push_back({outputNames[i], std::move(shape), std::vector<float>(data, data + count)});
        }
        return result;
    } catch (const std::exception&) {
        return {};
    }
}

std::vector<OnnxTensorInfo> OnnxModel::getInputInfo() const {
    std::vector<OnnxTensorInfo> result;
    if (!m_session || !m_allocator) return result;
    for (size_t i = 0; i < m_session->GetInputCount(); ++i) {
        auto name = m_session->GetInputNameAllocated(i, *m_allocator);
        auto typeInfo = m_session->GetInputTypeInfo(i);
        auto info = typeInfo.GetTensorTypeAndShapeInfo();
        result.push_back({name.get(), info.GetShape(), static_cast<int>(info.GetElementType())});
    }
    return result;
}

std::vector<OnnxTensorInfo> OnnxModel::getOutputInfo() const {
    std::vector<OnnxTensorInfo> result;
    if (!m_session || !m_allocator) return result;
    for (size_t i = 0; i < m_session->GetOutputCount(); ++i) {
        auto name = m_session->GetOutputNameAllocated(i, *m_allocator);
        auto typeInfo = m_session->GetOutputTypeInfo(i);
        auto info = typeInfo.GetTensorTypeAndShapeInfo();
        result.push_back({name.get(), info.GetShape(), static_cast<int>(info.GetElementType())});
    }
    return result;
}

void OnnxModel::close() {
    m_allocator.reset();
    m_session.reset();
    m_env.reset();
}
