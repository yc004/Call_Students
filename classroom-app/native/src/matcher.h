#pragma once

#include <vector>
#include <cstdint>
#include <cstddef>

/// Result of a single gallery match.
struct MatchResult {
    int   index;       // index in the gallery flat array
    float similarity;  // cosine similarity [-1, 1]
};

/// Compute cosine similarity between two same-length float vectors.
float cosineSimilarity(const float* a, const float* b, size_t len);

/// Find the top-K most similar gallery entries for a single query descriptor.
/// galleryFlat: flat array of N gallery descriptors, each of length dim.
/// dim:         descriptor dimension (e.g. 128).
/// numGallery:  number of gallery entries (= galleryFlat.size() / dim).
/// topK:        number of best matches to return.
std::vector<MatchResult> findTopK(
    const float* queryDescriptor,
    const float* galleryFlat,
    size_t dim,
    size_t numGallery,
    int topK);

/// Batch version: match M query descriptors against N gallery entries.
/// Returns M vectors of top-K results.
std::vector<std::vector<MatchResult>> findTopKBatch(
    const float* queryDescriptors,  // M * dim
    const float* galleryFlat,       // N * dim
    size_t dim,
    size_t numQueries,
    size_t numGallery,
    int topK);
