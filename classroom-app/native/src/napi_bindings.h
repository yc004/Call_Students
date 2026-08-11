#pragma once

#include <napi.h>

// N-API binding wrappers — one free function per exported JS method.
// Each follows the signature: Napi::Value(const Napi::CallbackInfo&)

Napi::Value InitEngine(const Napi::CallbackInfo& info);
Napi::Value DetectFaces(const Napi::CallbackInfo& info);
Napi::Value ExtractDescriptor(const Napi::CallbackInfo& info);
Napi::Value MatchFace(const Napi::CallbackInfo& info);
Napi::Value MatchFaceBatch(const Napi::CallbackInfo& info);
Napi::Value Destroy(const Napi::CallbackInfo& info);
Napi::Value GetStatus(const Napi::CallbackInfo& info);
Napi::Value InspectModel(const Napi::CallbackInfo& info);
