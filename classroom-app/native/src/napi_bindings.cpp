#include "napi_bindings.h"
#include "face_engine.h"
#include "matcher.h"
#include "onnx_inference.h"
#include <memory>
#include <string>
#include <cstring>
#include <cmath>
#include <limits>

// ── single global engine instance ──────────────────────────────
// Protected by the JS event loop (single-threaded in practice).
// If multi-threaded access is needed, add a mutex.

static std::unique_ptr<FaceEngine> g_engine;

static FaceEngine* getEngine() {
    return g_engine.get();
}

static bool validateRgbaBuffer(Napi::Env env, const Napi::Uint8Array& buffer, int width, int height) {
    constexpr int MAX_DIMENSION = 8192;
    constexpr size_t MAX_PIXELS = 40'000'000;
    if (width <= 0 || height <= 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
        Napi::RangeError::New(env, "Image dimensions are outside the supported range").ThrowAsJavaScriptException();
        return false;
    }
    const size_t pixels = static_cast<size_t>(width) * static_cast<size_t>(height);
    if (pixels > MAX_PIXELS || pixels > std::numeric_limits<size_t>::max() / 4) {
        Napi::RangeError::New(env, "Image is too large").ThrowAsJavaScriptException();
        return false;
    }
    const size_t expected = pixels * 4;
    if (buffer.ByteLength() < expected) {
        Napi::RangeError::New(env, "RGBA buffer is smaller than width * height * 4").ThrowAsJavaScriptException();
        return false;
    }
    return true;
}

// ── InitEngine(modelDir: string, opts?: object) ────────────────

Napi::Value InitEngine(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected modelDir string").ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string modelDir = info[0].As<Napi::String>().Utf8Value();
    int threads = 2;

    if (info.Length() >= 2 && info[1].IsObject()) {
        auto opts = info[1].As<Napi::Object>();
        if (opts.Has("threads")) {
            threads = opts.Get("threads").As<Napi::Number>().Int32Value();
        }
    }

    g_engine = std::make_unique<FaceEngine>();
    bool ok = g_engine->initialize(modelDir, threads);

    auto result = Napi::Object::New(env);
    result.Set("success", Napi::Boolean::New(env, ok));
    return result;
}

// ── DetectFaces(pixels: Uint8Array, width: number, height: number) ──

Napi::Value DetectFaces(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto* engine = getEngine();
    if (!engine) {
        Napi::Error::New(env, "Engine not initialized").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (info.Length() < 3) {
        Napi::TypeError::New(env, "Expected (pixels, width, height)").ThrowAsJavaScriptException();
        return env.Null();
    }

    if(!info[0].IsTypedArray()||info[0].As<Napi::TypedArray>().TypedArrayType()!=napi_uint8_array||!info[1].IsNumber()||!info[2].IsNumber()){
        Napi::TypeError::New(env,"Expected (Uint8Array, number, number)").ThrowAsJavaScriptException();return env.Null();
    }
    auto buf = info[0].As<Napi::Uint8Array>();
    int width  = info[1].As<Napi::Number>().Int32Value();
    int height = info[2].As<Napi::Number>().Int32Value();
    if (!validateRgbaBuffer(env, buf, width, height)) return env.Null();

    auto faces = engine->detectFaces(
        static_cast<const uint8_t*>(buf.Data()), width, height);

    auto result = Napi::Array::New(env, faces.size());
    for (size_t i = 0; i < faces.size(); ++i) {
        auto obj = Napi::Object::New(env);
        obj.Set("x",      Napi::Number::New(env, faces[i].x));
        obj.Set("y",      Napi::Number::New(env, faces[i].y));
        obj.Set("width",  Napi::Number::New(env, faces[i].width));
        obj.Set("height", Napi::Number::New(env, faces[i].height));
        obj.Set("score",  Napi::Number::New(env, faces[i].score));
        auto landmarks = Napi::Array::New(env, 10);
        for (size_t point = 0; point < 10; ++point) {
            landmarks.Set(point, Napi::Number::New(env, faces[i].landmarks[point]));
        }
        obj.Set("landmarks", landmarks);
        result[i] = obj;
    }
    return result;
}

// ── ExtractDescriptor(pixels, width, height, box) ──────────────

Napi::Value ExtractDescriptor(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto* engine = getEngine();
    if (!engine) {
        Napi::Error::New(env, "Engine not initialized").ThrowAsJavaScriptException();
        return env.Null();
    }

    if (info.Length() < 4) {
        Napi::TypeError::New(env, "Expected (pixels, width, height, box)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    if(!info[0].IsTypedArray()||info[0].As<Napi::TypedArray>().TypedArrayType()!=napi_uint8_array||!info[1].IsNumber()||!info[2].IsNumber()||!info[3].IsObject()){
        Napi::TypeError::New(env,"Expected (Uint8Array, number, number, object)").ThrowAsJavaScriptException();return env.Null();
    }
    auto buf  = info[0].As<Napi::Uint8Array>();
    int width  = info[1].As<Napi::Number>().Int32Value();
    int height = info[2].As<Napi::Number>().Int32Value();
    if (!validateRgbaBuffer(env, buf, width, height)) return env.Null();
    auto boxObj = info[3].As<Napi::Object>();

    FaceBox box;
    box.x      = boxObj.Get("x").As<Napi::Number>().FloatValue();
    box.y      = boxObj.Get("y").As<Napi::Number>().FloatValue();
    box.width  = boxObj.Get("width").As<Napi::Number>().FloatValue();
    box.height = boxObj.Get("height").As<Napi::Number>().FloatValue();
    if(!std::isfinite(box.x)||!std::isfinite(box.y)||!std::isfinite(box.width)||!std::isfinite(box.height)||box.width<=1||box.height<=1||box.x<0||box.y<0||box.x+box.width>width||box.y+box.height>height){
        Napi::RangeError::New(env,"Face box must be finite and inside the image").ThrowAsJavaScriptException();return env.Null();
    }
    if (boxObj.Has("landmarks") && boxObj.Get("landmarks").IsArray()) {
        auto landmarks = boxObj.Get("landmarks").As<Napi::Array>();
        for (uint32_t i = 0; i < 10 && i < landmarks.Length(); ++i) {
            box.landmarks[i] = landmarks.Get(i).As<Napi::Number>().FloatValue();
            if(!std::isfinite(box.landmarks[i])){Napi::RangeError::New(env,"Landmarks must be finite").ThrowAsJavaScriptException();return env.Null();}
        }
    }

    auto desc = engine->extractDescriptor(
        static_cast<const uint8_t*>(buf.Data()), width, height, box);

    auto result = Napi::Float32Array::New(env, desc.size());
    std::memcpy(result.Data(), desc.data(), desc.size() * sizeof(float));
    return result;
}

// ── MatchFace(descriptor, galleryFlat, topK) ───────────────────

Napi::Value MatchFace(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected (descriptor, galleryFlat, topK?)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    if(!info[0].IsTypedArray()||!info[1].IsTypedArray()||info[0].As<Napi::TypedArray>().TypedArrayType()!=napi_float32_array||info[1].As<Napi::TypedArray>().TypedArrayType()!=napi_float32_array){
        Napi::TypeError::New(env,"Descriptor and gallery must be Float32Array").ThrowAsJavaScriptException();return env.Null();
    }

    auto descArr = info[0].As<Napi::Float32Array>();
    auto galleryArr = info[1].As<Napi::Float32Array>();
    int topK = 3;
    if (info.Length() >= 3 && info[2].IsNumber()) {
        topK = info[2].As<Napi::Number>().Int32Value();
    }

    size_t dim = descArr.ElementLength();
    if (dim != 128 || galleryArr.ElementLength() % dim != 0 || galleryArr.ElementLength()/dim>10000 || topK<1 || topK>100) {
        Napi::RangeError::New(env, "Gallery length must be a positive multiple of descriptor length")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    size_t numGallery = galleryArr.ElementLength() / dim;

    auto matches = findTopK(descArr.Data(), galleryArr.Data(), dim, numGallery, topK);

    auto result = Napi::Array::New(env, matches.size());
    for (size_t i = 0; i < matches.size(); ++i) {
        auto obj = Napi::Object::New(env);
        obj.Set("index",      Napi::Number::New(env, matches[i].index));
        obj.Set("similarity", Napi::Number::New(env, matches[i].similarity));
        result[i] = obj;
    }
    return result;
}

// ── MatchFaceBatch(descriptors, galleryFlat, topK) ─────────────

Napi::Value MatchFaceBatch(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Expected (descriptors, galleryFlat, topK?)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    if(!info[0].IsTypedArray()||!info[1].IsTypedArray()||info[0].As<Napi::TypedArray>().TypedArrayType()!=napi_float32_array||info[1].As<Napi::TypedArray>().TypedArrayType()!=napi_float32_array){
        Napi::TypeError::New(env,"Descriptors and gallery must be Float32Array").ThrowAsJavaScriptException();return env.Null();
    }

    auto descsArr   = info[0].As<Napi::Float32Array>();
    auto galleryArr = info[1].As<Napi::Float32Array>();
    int topK = 3;
    if (info.Length() >= 3 && info[2].IsNumber()) {
        topK = info[2].As<Napi::Number>().Int32Value();
    }

    size_t dim = 128;
    if (descsArr.ElementLength() % dim != 0 || galleryArr.ElementLength() % dim != 0 || descsArr.ElementLength()/dim>256 || galleryArr.ElementLength()/dim>10000 || topK<1 || topK>100) {
        Napi::RangeError::New(env, "Descriptor and gallery lengths must be multiples of 128")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    size_t numQueries  = descsArr.ElementLength() / dim;
    size_t numGallery  = galleryArr.ElementLength() / dim;

    auto allMatches = findTopKBatch(
        descsArr.Data(), galleryArr.Data(), dim, numQueries, numGallery, topK);

    auto result = Napi::Array::New(env, allMatches.size());
    for (size_t q = 0; q < allMatches.size(); ++q) {
        auto queryResults = Napi::Array::New(env, allMatches[q].size());
        for (size_t i = 0; i < allMatches[q].size(); ++i) {
            auto obj = Napi::Object::New(env);
            obj.Set("index",      Napi::Number::New(env, allMatches[q][i].index));
            obj.Set("similarity", Napi::Number::New(env, allMatches[q][i].similarity));
            queryResults[i] = obj;
        }
        result[q] = queryResults;
    }
    return result;
}

// ── Destroy() ──────────────────────────────────────────────────

Napi::Value Destroy(const Napi::CallbackInfo& info) {
    if (g_engine) {
        g_engine->destroy();
        g_engine.reset();
    }
    return info.Env().Undefined();
}

// ── GetStatus() ────────────────────────────────────────────────

Napi::Value GetStatus(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto result = Napi::Object::New(env);
    result.Set("loaded", Napi::Boolean::New(env, g_engine && g_engine->isReady()));
    result.Set("modelCount", Napi::Number::New(env, 2));
    result.Set("embeddingModel", FaceEngine::EMBEDDING_MODEL);
    return result;
}

Napi::Value InspectModel(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "Expected model path string").ThrowAsJavaScriptException();
        return env.Null();
    }

    OnnxModel model;
    const std::string modelPath = info[0].As<Napi::String>().Utf8Value();
    if (!model.load(modelPath, 1)) {
        Napi::Error::New(env, "Unable to load ONNX model").ThrowAsJavaScriptException();
        return env.Null();
    }

    auto toJs = [&](const std::vector<OnnxTensorInfo>& tensors) {
        Napi::Array array = Napi::Array::New(env, tensors.size());
        for (size_t i = 0; i < tensors.size(); ++i) {
            Napi::Object item = Napi::Object::New(env);
            item.Set("name", tensors[i].name);
            item.Set("elementType", tensors[i].elementType);
            Napi::Array shape = Napi::Array::New(env, tensors[i].shape.size());
            for (size_t j = 0; j < tensors[i].shape.size(); ++j) {
                shape.Set(j, Napi::Number::New(env, static_cast<double>(tensors[i].shape[j])));
            }
            item.Set("shape", shape);
            array.Set(i, item);
        }
        return array;
    };

    Napi::Object result = Napi::Object::New(env);
    result.Set("inputs", toJs(model.getInputInfo()));
    result.Set("outputs", toJs(model.getOutputInfo()));
    return result;
}
