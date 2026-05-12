// Android v1.1 issue #19 W4a — minimal JNI stub。
//
// W4a 只暴露 `getWhisperVersion()` 验证 native build 链路绿（CMake / NDK /
// ABI / submodule 路径 / gradle externalNativeBuild 全打通）。
//
// W4b 在本文件加：
//   - Java_..._WhisperNative_initContext  (jlong ctx_ptr)
//   - Java_..._WhisperNative_transcribe   (jstring result)
//   - Java_..._WhisperNative_freeContext  (void)
//
// 真 transcribe 参考 third_party/whisper.cpp/examples/whisper.android。

#include <jni.h>
#include <string>
#include "whisper.h"
#include <android/log.h>

#define LOG_TAG "WhisperJNI"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, LOG_TAG, __VA_ARGS__)

extern "C" JNIEXPORT jstring JNICALL
Java_com_chainlesschain_android_feature_1ai_data_voice_WhisperNative_getWhisperVersion(
    JNIEnv *env, jobject /* thiz */) {
    // whisper.cpp 1.5+ 暴露 whisper_print_system_info — 验证 link 通 + 版本可读
    const char *info = whisper_print_system_info();
    LOGI("whisper system info: %s", info);
    std::string out = "whisper.cpp linked OK. system_info: ";
    out += info;
    return env->NewStringUTF(out.c_str());
}
