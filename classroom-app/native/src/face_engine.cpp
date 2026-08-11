#include "face_engine.h"
#include <algorithm>
#include <cmath>
#include <unordered_map>

namespace {
float intersectionOverUnion(const FaceBox& a, const FaceBox& b) {
    const float left = std::max(a.x, b.x);
    const float top = std::max(a.y, b.y);
    const float right = std::min(a.x + a.width, b.x + b.width);
    const float bottom = std::min(a.y + a.height, b.y + b.height);
    const float intersection = std::max(0.0f, right - left) * std::max(0.0f, bottom - top);
    const float area = a.width * a.height + b.width * b.height - intersection;
    return area > 0 ? intersection / area : 0;
}

const OnnxOutput* outputNamed(const std::unordered_map<std::string, const OnnxOutput*>& outputs,
                              const std::string& prefix, int stride) {
    auto it = outputs.find(prefix + "_" + std::to_string(stride));
    return it == outputs.end() ? nullptr : it->second;
}
}

FaceEngine::FaceEngine()
    : m_detectorModel(std::make_unique<OnnxModel>())
    , m_recognitionModel(std::make_unique<OnnxModel>())
{}

FaceEngine::~FaceEngine() { destroy(); }

bool FaceEngine::initialize(const std::string& modelDir, int intraOpThreads) {
    const std::string detectorPath = modelDir + "/face_detection_yunet_2023mar.onnx";
    const std::string recognitionPath = modelDir + "/face_recognition_sface_2021dec.onnx";
    m_ready = m_detectorModel->load(detectorPath, intraOpThreads)
           && m_recognitionModel->load(recognitionPath, intraOpThreads);
    return m_ready;
}

bool FaceEngine::isReady() const { return m_ready; }

std::vector<FaceBox> FaceEngine::detectFaces(
    const uint8_t* rgbaPixels, int width, int height)
{
    if (!m_ready || !rgbaPixels || width <= 0 || height <= 0) return {};

    PreprocessParams params;
    params.scale = 1.0f;
    params.mean[0] = params.mean[1] = params.mean[2] = 0.0f;
    params.toBGR = true;
    params.inputWidth = DETECTOR_INPUT;
    params.inputHeight = DETECTOR_INPUT;
    const auto input = preprocessForONNX(rgbaPixels, width, height, 4, params);
    const auto rawOutputs = m_detectorModel->runAll(input, 3, DETECTOR_INPUT, DETECTOR_INPUT);

    std::unordered_map<std::string, const OnnxOutput*> outputs;
    for (const auto& output : rawOutputs) outputs[output.name] = &output;

    constexpr int strides[] = {8, 16, 32};
    constexpr float SCORE_THRESHOLD = 0.75f;
    const float scaleX = static_cast<float>(width) / DETECTOR_INPUT;
    const float scaleY = static_cast<float>(height) / DETECTOR_INPUT;
    std::vector<FaceBox> candidates;

    for (int stride : strides) {
        const auto* cls = outputNamed(outputs, "cls", stride);
        const auto* obj = outputNamed(outputs, "obj", stride);
        const auto* bbox = outputNamed(outputs, "bbox", stride);
        const auto* kps = outputNamed(outputs, "kps", stride);
        if (!cls || !obj || !bbox || !kps) return {};

        const int cols = DETECTOR_INPUT / stride;
        const int rows = DETECTOR_INPUT / stride;
        const size_t cells = static_cast<size_t>(rows * cols);
        if (cls->data.size() < cells || obj->data.size() < cells
            || bbox->data.size() < cells * 4 || kps->data.size() < cells * 10) return {};

        for (int row = 0; row < rows; ++row) {
            for (int col = 0; col < cols; ++col) {
                const size_t index = static_cast<size_t>(row * cols + col);
                const float clsScore = std::clamp(cls->data[index], 0.0f, 1.0f);
                const float objScore = std::clamp(obj->data[index], 0.0f, 1.0f);
                const float score = std::sqrt(clsScore * objScore);
                if (score < SCORE_THRESHOLD) continue;

                const float centerX = (col + bbox->data[index * 4]) * stride;
                const float centerY = (row + bbox->data[index * 4 + 1]) * stride;
                const float boxWidth = std::exp(bbox->data[index * 4 + 2]) * stride;
                const float boxHeight = std::exp(bbox->data[index * 4 + 3]) * stride;

                FaceBox face;
                face.x = std::clamp((centerX - boxWidth / 2) * scaleX, 0.0f, static_cast<float>(width));
                face.y = std::clamp((centerY - boxHeight / 2) * scaleY, 0.0f, static_cast<float>(height));
                face.width = std::min(boxWidth * scaleX, static_cast<float>(width) - face.x);
                face.height = std::min(boxHeight * scaleY, static_cast<float>(height) - face.y);
                face.score = score;
                for (int point = 0; point < 5; ++point) {
                    face.landmarks[point * 2] = (kps->data[index * 10 + point * 2] + col) * stride * scaleX;
                    face.landmarks[point * 2 + 1] = (kps->data[index * 10 + point * 2 + 1] + row) * stride * scaleY;
                }
                if (face.width >= 10 && face.height >= 10) candidates.push_back(face);
            }
        }
    }

    std::sort(candidates.begin(), candidates.end(), [](const FaceBox& a, const FaceBox& b) {
        return a.score > b.score;
    });
    std::vector<FaceBox> result;
    for (const auto& candidate : candidates) {
        bool keep = true;
        for (const auto& selected : result) {
            if (intersectionOverUnion(candidate, selected) > 0.3f) {
                keep = false;
                break;
            }
        }
        if (keep) result.push_back(candidate);
        if (result.size() >= 100) break;
    }
    return result;
}

std::vector<float> FaceEngine::extractDescriptor(
    const uint8_t* rgbaPixels, int width, int height, const FaceBox& box)
{
    if (!m_ready || !rgbaPixels) return {};
    const auto aligned = alignFaceForSFace(rgbaPixels, width, height, box);

    PreprocessParams params;
    params.scale = 1.0f;
    params.mean[0] = params.mean[1] = params.mean[2] = 0.0f;
    params.toBGR = false; // Canvas RGBA is RGB; OpenCV's SFace path swaps BGR to RGB.
    params.inputWidth = RECOGNITION_INPUT;
    params.inputHeight = RECOGNITION_INPUT;

    const auto input = preprocessForONNX(aligned.data(), RECOGNITION_INPUT,
                                         RECOGNITION_INPUT, 4, params);
    size_t outputSize = 0;
    auto output = m_recognitionModel->run(input, 3, RECOGNITION_INPUT,
                                          RECOGNITION_INPUT, &outputSize);
    if (outputSize != DESCRIPTOR_DIM) return {};

    float norm = 0.0f;
    for (float value : output) norm += value * value;
    norm = std::sqrt(norm);
    if (norm < 1e-8f) return {};
    for (float& value : output) value /= norm;
    return output;
}

std::vector<MatchResult> FaceEngine::matchDescriptor(
    const float* descriptor, const float* galleryFlat, size_t numGallery, int topK)
{
    return findTopK(descriptor, galleryFlat, DESCRIPTOR_DIM, numGallery, topK);
}

std::vector<std::vector<MatchResult>> FaceEngine::matchDescriptorBatch(
    const float* descriptors, const float* galleryFlat, size_t numQueries,
    size_t numGallery, int topK)
{
    return findTopKBatch(descriptors, galleryFlat, DESCRIPTOR_DIM,
                         numQueries, numGallery, topK);
}

void FaceEngine::destroy() {
    if (m_detectorModel) m_detectorModel->close();
    if (m_recognitionModel) m_recognitionModel->close();
    m_ready = false;
}
