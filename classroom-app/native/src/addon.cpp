#include "napi_bindings.h"

// N-API module registration
Napi::Object InitModule(Napi::Env env, Napi::Object exports) {
    exports.Set("init",              Napi::Function::New(env, InitEngine));
    exports.Set("detectFaces",       Napi::Function::New(env, DetectFaces));
    exports.Set("extractDescriptor", Napi::Function::New(env, ExtractDescriptor));
    exports.Set("matchFace",         Napi::Function::New(env, MatchFace));
    exports.Set("matchFaceBatch",    Napi::Function::New(env, MatchFaceBatch));
    exports.Set("destroy",           Napi::Function::New(env, Destroy));
    exports.Set("getStatus",         Napi::Function::New(env, GetStatus));
    exports.Set("inspectModel",      Napi::Function::New(env, InspectModel));
    return exports;
}

NODE_API_MODULE(face_native_addon, InitModule)
