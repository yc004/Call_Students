#include "matcher.h"
#include <cmath>
#include <algorithm>
#include <queue>

// ── cosine similarity ──────────────────────────────────────────

float cosineSimilarity(const float* a, const float* b, size_t len) {
    float dot = 0.0f;
    float normA = 0.0f;
    float normB = 0.0f;

    // Simple loop — compiler auto-vectorization will handle SIMD
    for (size_t i = 0; i < len; ++i) {
        dot   += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    float denom = std::sqrt(normA) * std::sqrt(normB);
    if (denom < 1e-8f) return 0.0f;
    return dot / denom;
}

// ── top-K search ───────────────────────────────────────────────

std::vector<MatchResult> findTopK(
    const float* queryDescriptor,
    const float* galleryFlat,
    size_t dim,
    size_t numGallery,
    int topK)
{
    if (numGallery == 0 || topK <= 0) return {};

    // Use a min-heap keyed by similarity (smallest on top)
    auto cmp = [](const MatchResult& a, const MatchResult& b) {
        return a.similarity > b.similarity; // min-heap
    };
    std::priority_queue<MatchResult, std::vector<MatchResult>, decltype(cmp)> heap(cmp);

    for (size_t i = 0; i < numGallery; ++i) {
        float sim = cosineSimilarity(queryDescriptor, galleryFlat + i * dim, dim);

        if (static_cast<int>(heap.size()) < topK) {
            heap.push({static_cast<int>(i), sim});
        } else if (sim > heap.top().similarity) {
            heap.pop();
            heap.push({static_cast<int>(i), sim});
        }
    }

    // Extract results (from heap — not sorted, so sort descending)
    std::vector<MatchResult> results;
    results.reserve(heap.size());
    while (!heap.empty()) {
        results.push_back(heap.top());
        heap.pop();
    }
    std::reverse(results.begin(), results.end());
    return results;
}

// ── batch top-K search ─────────────────────────────────────────

std::vector<std::vector<MatchResult>> findTopKBatch(
    const float* queryDescriptors,
    const float* galleryFlat,
    size_t dim,
    size_t numQueries,
    size_t numGallery,
    int topK)
{
    std::vector<std::vector<MatchResult>> allResults;
    allResults.reserve(numQueries);

    for (size_t q = 0; q < numQueries; ++q) {
        auto results = findTopK(
            queryDescriptors + q * dim,
            galleryFlat,
            dim,
            numGallery,
            topK);
        allResults.push_back(std::move(results));
    }
    return allResults;
}
