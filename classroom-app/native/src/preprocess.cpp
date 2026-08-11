#include "preprocess.h"
#include <algorithm>
#include <cmath>

namespace {
uint8_t sampleBilinear(const uint8_t* src, int width, int height, double x, double y, int channel) {
    if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return 0;
    const int x0 = static_cast<int>(std::floor(x));
    const int y0 = static_cast<int>(std::floor(y));
    const int x1 = std::min(width - 1, x0 + 1);
    const int y1 = std::min(height - 1, y0 + 1);
    const double fx = x - x0;
    const double fy = y - y0;
    const double top = src[(y0 * width + x0) * 4 + channel] * (1 - fx)
                     + src[(y0 * width + x1) * 4 + channel] * fx;
    const double bottom = src[(y1 * width + x0) * 4 + channel] * (1 - fx)
                        + src[(y1 * width + x1) * 4 + channel] * fx;
    return static_cast<uint8_t>(std::clamp(std::round(top * (1 - fy) + bottom * fy), 0.0, 255.0));
}
}

// ── bilinear interpolation resize ──────────────────────────────

void bilinearResize(
    const uint8_t* src, int srcW, int srcH, int channels,
    uint8_t* dst, int dstW, int dstH)
{
    float scaleX = static_cast<float>(srcW) / dstW;
    float scaleY = static_cast<float>(srcH) / dstH;

    for (int dy = 0; dy < dstH; ++dy) {
        float sy = (dy + 0.5f) * scaleY - 0.5f;
        int y0 = std::max(0, static_cast<int>(std::floor(sy)));
        int y1 = std::min(srcH - 1, y0 + 1);
        float fy = sy - y0;

        for (int dx = 0; dx < dstW; ++dx) {
            float sx = (dx + 0.5f) * scaleX - 0.5f;
            int x0 = std::max(0, static_cast<int>(std::floor(sx)));
            int x1 = std::min(srcW - 1, x0 + 1);
            float fx = sx - x0;

            for (int c = 0; c < channels; ++c) {
                float v00 = src[(y0 * srcW + x0) * channels + c];
                float v10 = src[(y0 * srcW + x1) * channels + c];
                float v01 = src[(y1 * srcW + x0) * channels + c];
                float v11 = src[(y1 * srcW + x1) * channels + c];

                float top    = v00 * (1.0f - fx) + v10 * fx;
                float bottom = v01 * (1.0f - fx) + v11 * fx;
                float val    = top  * (1.0f - fy) + bottom * fy;

                dst[(dy * dstW + dx) * channels + c] =
                    static_cast<uint8_t>(std::round(std::max(0.0f, std::min(255.0f, val))));
            }
        }
    }
}

// ── preprocess for ONNX (float tensor NCHW) ────────────────────

std::vector<float> preprocessForONNX(
    const uint8_t* srcPixels,
    int srcWidth,
    int srcHeight,
    int channels,
    const PreprocessParams& params)
{
    int iw = params.inputWidth;
    int ih = params.inputHeight;

    // Resize first
    std::vector<uint8_t> resized(iw * ih * channels);
    bilinearResize(srcPixels, srcWidth, srcHeight, channels,
                   resized.data(), iw, ih);

    // Convert to NCHW float tensor, optionally reorder channels
    std::vector<float> tensor(3 * iw * ih, 0.0f);
    int rIdx = params.toBGR ? 2 : 0;
    int gIdx = 1;
    int bIdx = params.toBGR ? 0 : 2;

    for (int y = 0; y < ih; ++y) {
        for (int x = 0; x < iw; ++x) {
            int srcIdx = (y * iw + x) * channels;
            int dstBase = y * iw + x;  // NCHW: pixel offset within H*W

            float r = resized[srcIdx + (channels >= 3 ? 0 : 0)];
            float g = resized[srcIdx + (channels >= 3 ? 1 : 0)];
            float b = resized[srcIdx + (channels >= 3 ? 2 : 0)];

            tensor[0 * iw * ih + dstBase] = (r - params.mean[0]) * params.scale;
            tensor[1 * iw * ih + dstBase] = (g - params.mean[1]) * params.scale;
            tensor[2 * iw * ih + dstBase] = (b - params.mean[2]) * params.scale;

            if (params.toBGR) {
                // Swap R and B channels
                float tmp = tensor[0 * iw * ih + dstBase];
                tensor[0 * iw * ih + dstBase] = tensor[2 * iw * ih + dstBase];
                tensor[2 * iw * ih + dstBase] = tmp;
            }
        }
    }

    return tensor;
}

// ── crop + resize face region ──────────────────────────────────

std::vector<uint8_t> cropAndResize(
    const uint8_t* srcPixels,
    int srcWidth,
    int srcHeight,
    const FaceBox& box,
    int targetWidth,
    int targetHeight)
{
    // Expand the box slightly (10% margin)
    float marginX = box.width * 0.1f;
    float marginY = box.height * 0.1f;

    int cx = std::max(0, static_cast<int>(box.x - marginX));
    int cy = std::max(0, static_cast<int>(box.y - marginY));
    int cw = std::min(srcWidth - cx, static_cast<int>(box.width + 2 * marginX));
    int ch = std::min(srcHeight - cy, static_cast<int>(box.height + 2 * marginY));

    // Crop
    std::vector<uint8_t> crop(cw * ch * 4);
    for (int y = 0; y < ch; ++y) {
        for (int x = 0; x < cw; ++x) {
            int srcIdx = ((cy + y) * srcWidth + (cx + x)) * 4;
            int dstIdx = (y * cw + x) * 4;
            crop[dstIdx + 0] = srcPixels[srcIdx + 0];
            crop[dstIdx + 1] = srcPixels[srcIdx + 1];
            crop[dstIdx + 2] = srcPixels[srcIdx + 2];
            crop[dstIdx + 3] = srcPixels[srcIdx + 3];
        }
    }

    // Resize
    std::vector<uint8_t> result(targetWidth * targetHeight * 4);
    bilinearResize(crop.data(), cw, ch, 4, result.data(), targetWidth, targetHeight);
    return result;
}

std::vector<uint8_t> alignFaceForSFace(
    const uint8_t* srcPixels,
    int srcWidth,
    int srcHeight,
    const FaceBox& box)
{
    constexpr int TARGET = 112;
    const double target[5][2] = {
        {38.2946, 51.6963}, {73.5318, 51.5014}, {56.0252, 71.7366},
        {41.5493, 92.3655}, {70.7299, 92.2041}
    };

    double srcMeanX = 0, srcMeanY = 0, dstMeanX = 0, dstMeanY = 0;
    for (int i = 0; i < 5; ++i) {
        srcMeanX += box.landmarks[i * 2];
        srcMeanY += box.landmarks[i * 2 + 1];
        dstMeanX += target[i][0];
        dstMeanY += target[i][1];
    }
    srcMeanX /= 5; srcMeanY /= 5; dstMeanX /= 5; dstMeanY /= 5;

    double denominator = 0, numeratorA = 0, numeratorB = 0;
    for (int i = 0; i < 5; ++i) {
        const double sx = box.landmarks[i * 2] - srcMeanX;
        const double sy = box.landmarks[i * 2 + 1] - srcMeanY;
        const double dx = target[i][0] - dstMeanX;
        const double dy = target[i][1] - dstMeanY;
        denominator += sx * sx + sy * sy;
        numeratorA += sx * dx + sy * dy;
        numeratorB += sx * dy - sy * dx;
    }
    if (denominator < 1e-9) {
        return cropAndResize(srcPixels, srcWidth, srcHeight, box, TARGET, TARGET);
    }
    const double a = numeratorA / denominator;
    const double b = numeratorB / denominator;
    const double translateX = dstMeanX - a * srcMeanX + b * srcMeanY;
    const double translateY = dstMeanY - b * srcMeanX - a * srcMeanY;
    const double det = a * a + b * b;
    if (det < 1e-9) return cropAndResize(srcPixels, srcWidth, srcHeight, box, TARGET, TARGET);

    std::vector<uint8_t> aligned(TARGET * TARGET * 4, 0);
    for (int y = 0; y < TARGET; ++y) {
        for (int x = 0; x < TARGET; ++x) {
            const double ux = x - translateX;
            const double uy = y - translateY;
            const double sx = (a * ux + b * uy) / det;
            const double sy = (-b * ux + a * uy) / det;
            const int dst = (y * TARGET + x) * 4;
            for (int c = 0; c < 3; ++c) aligned[dst + c] = sampleBilinear(srcPixels, srcWidth, srcHeight, sx, sy, c);
            aligned[dst + 3] = 255;
        }
    }
    return aligned;
}
