#pragma once

#include <vector>
#include <cstdint>
#include <cstddef>

// Face box returned by detection
struct FaceBox {
    float x = 0;
    float y = 0;
    float width = 0;
    float height = 0;
    float score = 0;
    float landmarks[10] = {0};
};

// Preprocessing parameters for each model type
struct PreprocessParams {
    float scale;
    float mean[3];
    bool toBGR;
    int inputWidth;
    int inputHeight;
};

// Preprocess raw RGBA pixel data into a float tensor suitable for ONNX inference.
// - srcPixels: RGBA or RGB interleaved pixels (depending on channels param)
// - srcWidth, srcHeight: original frame dimensions
// - channels: 3 (RGB) or 4 (RGBA)
// - params: normalization and resize parameters
// Returns NCHW-ordered float array (size = 3 * inputWidth * inputHeight).
std::vector<float> preprocessForONNX(
    const uint8_t* srcPixels,
    int srcWidth,
    int srcHeight,
    int channels,
    const PreprocessParams& params);

// Crop a face region from source pixels, resize to target size.
// Returns RGBA pixels.
std::vector<uint8_t> cropAndResize(
    const uint8_t* srcPixels,
    int srcWidth,
    int srcHeight,
    const FaceBox& box,
    int targetWidth,
    int targetHeight);

// Align a face to the standard SFace 112x112 landmark template.
std::vector<uint8_t> alignFaceForSFace(
    const uint8_t* srcPixels,
    int srcWidth,
    int srcHeight,
    const FaceBox& box);

// Bilinear interpolation resize for RGB(A) buffers.
void bilinearResize(
    const uint8_t* src, int srcW, int srcH, int channels,
    uint8_t* dst, int dstW, int dstH);
