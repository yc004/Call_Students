/**
 * Integration test for the native face addon.
 * Run with: node test/test_bindings.js
 *
 * NOTE: This test requires ONNX Runtime libraries to be available
 * and ONNX model files to be placed in ../../models/onnx/.
 * A missing addon or model is a failure: CI must never silently pass without
 * exercising the native runtime.
 */

'use strict';

const path = require('path');
let addon;

// Try to load the addon
try {
    addon = require('../build/Release/face_native_addon.node');
    console.log('[test] Native addon loaded successfully');
} catch (e) {
    console.error('[test] Cannot load native addon:', e.message);
    console.error('[test] Build with: npm run build:native');
    process.exit(1);
}

let passed = 0;
let failed = 0;

function assert(condition, msg) {
    if (condition) {
        console.log(`  ✓ ${msg}`);
        passed++;
    } else {
        console.error(`  ✗ ${msg}`);
        failed++;
    }
}

function assertNear(actual, expected, epsilon, msg) {
    const ok = Math.abs(actual - expected) <= epsilon;
    if (ok) {
        console.log(`  ✓ ${msg} (${actual})`);
        passed++;
    } else {
        console.error(`  ✗ ${msg} — expected near ${expected}, got ${actual}`);
        failed++;
    }
}

function assertThrows(fn, pattern, msg) {
    try {
        fn();
        assert(false, msg);
    } catch (error) {
        assert(pattern.test(error.message), msg);
    }
}

// ── Test 1: getStatus before init ──────────────────────────────
console.log('\n── Test 1: getStatus before init ──');
{
    const status = addon.getStatus();
    assert(status.loaded === false, 'status.loaded should be false before init');
    assert(typeof status.modelCount === 'number', 'status.modelCount should be a number');
}

// ── Test 2: Cosine similarity (pure math, no model needed) ─────
console.log('\n── Test 2: Cosine similarity ──');
{
    // This tests the matcher through the matchFace API
    // Create two vectors
    const dim = 128;
    const a = new Float32Array(dim);
    const b = new Float32Array(dim);

    for (let i = 0; i < dim; i++) {
        a[i] = Math.sin(i * 0.1);
        b[i] = Math.sin(i * 0.1); // identical
    }

    // Put b as single gallery entry
    const result = addon.matchFace(a, b, 1);
    assert(result.length === 1, 'should return 1 match');
    assertNear(result[0].similarity, 1.0, 0.001, 'identical vectors should have similarity ~1.0');

    // Orthogonal-ish test
    const c = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
        c[i] = Math.cos(i * 0.1);
    }
    const result2 = addon.matchFace(a, c, 1);
    assert(result2.length === 1, 'should return 1 match for orthogonal-ish');
    assert(result2[0].similarity < 0.99, 'different vectors should not have similarity 1.0');
}

// ── Test 3: Init with ONNX models (if available) ───────────────
console.log('\n── Test 3: Init engine ──');
const modelDir = path.join(__dirname, '..', '..', 'models', 'onnx');
const fs = require('fs');

const requiredModels = [
    'face_detection_yunet_2023mar.onnx',
    'face_recognition_sface_2021dec.onnx',
];
const missingModels = requiredModels.filter((file) => !fs.existsSync(path.join(modelDir, file)));

if (missingModels.length > 0) {
    console.error(`  ✗ Missing required ONNX model(s): ${missingModels.join(', ')}`);
    failed++;
} else {
    const initResult = addon.init(modelDir, { threads: 1 });
    assert(initResult.success === true, 'init should succeed with valid model directory');

    const status = addon.getStatus();
    assert(status.loaded === true, 'status.loaded should be true after successful init');
    assert(status.modelCount === 2, 'status.modelCount should report the two-model pipeline');
    assert(status.embeddingModel === 'opencv-sface-2021dec-v1', 'status should expose the embedding model ID');

    const blankWidth = 320;
    const blankHeight = 240;
    const blankFrame = new Uint8Array(blankWidth * blankHeight * 4);
    const faces = addon.detectFaces(blankFrame, blankWidth, blankHeight);
    assert(Array.isArray(faces), 'detector should execute and return an array for a blank frame');
    assertThrows(
        () => addon.detectFaces(new Uint8Array(4), blankWidth, blankHeight),
        /RGBA buffer/,
        'detector should reject undersized RGBA buffers'
    );
}

// ── Test 4: Batch matching ─────────────────────────────────────
console.log('\n── Test 4: Batch matching ──');
{
    const dim = 128;
    const numQueries = 3;
    const numGallery = 5;

    const queries = new Float32Array(numQueries * dim);
    const gallery = new Float32Array(numGallery * dim);

    for (let i = 0; i < numQueries * dim; i++) queries[i] = Math.random();
    for (let i = 0; i < numGallery * dim; i++) gallery[i] = Math.random();

    const results = addon.matchFaceBatch(queries, gallery, 3);
    assert(results.length === numQueries, `should return ${numQueries} result arrays`);
    for (let i = 0; i < numQueries; i++) {
        assert(results[i].length <= 3, `query ${i} should have <= 3 results`);
        if (results[i].length > 0) {
            assert(typeof results[i][0].index === 'number', 'result should have index');
            assert(typeof results[i][0].similarity === 'number', 'result should have similarity');
        }
    }
}

// ── Cleanup ────────────────────────────────────────────────────
console.log('\n── Cleanup ──');
addon.destroy();
const statusAfter = addon.getStatus();
assert(statusAfter.loaded === false, 'status.loaded should be false after destroy');
console.log('  ✓ destroy() succeeded');

// ── Summary ────────────────────────────────────────────────────
console.log(`\n${'='.repeat(40)}`);
console.log(`Passed: ${passed}, Failed: ${failed}`);
console.log(`${'='.repeat(40)}`);
process.exit(failed > 0 ? 1 : 0);
