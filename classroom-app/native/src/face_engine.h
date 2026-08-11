#pragma once

#include "preprocess.h"
#include "onnx_inference.h"
#include "matcher.h"
#include <string>
#include <vector>
#include <memory>

/// High-level face recognition engine.
/// Orchestrates YuNet detection/landmarks → SFace alignment/embedding → matching.
class FaceEngine {
public:
    FaceEngine();
    ~FaceEngine();

    /// Load the versioned OpenCV Zoo ONNX model pack.
    bool initialize(const std::string& modelDir, int intraOpThreads = 2);

    /// Returns true if all models loaded successfully.
    bool isReady() const;

    /// Run face detection on an RGBA pixel buffer.
    /// Returns list of detected face boxes with confidence scores.
    std::vector<FaceBox> detectFaces(
        const uint8_t* rgbaPixels, int width, int height);

    /// Extract a 128-dim face descriptor from an RGBA pixel buffer
    /// given a face bounding box.
    /// Returns empty vector on failure.
    std::vector<float> extractDescriptor(
        const uint8_t* rgbaPixels, int width, int height,
        const FaceBox& box);

    /// Compare one descriptor against a flat gallery array.
    /// galleryFlat: N * 128 floats.
    std::vector<MatchResult> matchDescriptor(
        const float* descriptor,
        const float* galleryFlat,
        size_t numGallery,
        int topK = 3);

    /// Batch compare M descriptors against N gallery entries.
    std::vector<std::vector<MatchResult>> matchDescriptorBatch(
        const float* descriptors,  // M * 128
        const float* galleryFlat,  // N * 128
        size_t numQueries,
        size_t numGallery,
        int topK = 3);

    /// Release all resources.
    void destroy();

    /// Get status info.
    bool getStatus() const { return m_ready; }
    static constexpr const char* EMBEDDING_MODEL = "opencv-sface-2021dec-v1";

private:
    bool m_ready = false;

    std::unique_ptr<OnnxModel> m_detectorModel;
    std::unique_ptr<OnnxModel> m_recognitionModel;

    static constexpr int DETECTOR_INPUT = 640;
    static constexpr int RECOGNITION_INPUT = 112;

    static constexpr int   DESCRIPTOR_DIM   = 128;
};
