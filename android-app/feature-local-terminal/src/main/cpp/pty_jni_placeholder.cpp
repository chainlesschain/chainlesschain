// Phase 0.1 placeholder — validates NDK toolchain + Gradle externalNativeBuild
// wiring across 3 ABIs (arm64-v8a, armeabi-v7a, x86_64). Real pty_jni
// implementation (openPty / spawn / read / write / killpg / waitpid) lands in
// Phase 1.1 per docs/design/Android_Local_Terminal.md §4.1.

#include <jni.h>
#include <android/log.h>

#define LOG_TAG "LocalTerminalNative"

extern "C" JNIEXPORT jstring JNICALL
Java_com_chainlesschain_android_feature_localterminal_LocalTerminalNative_nativeVersion(
    JNIEnv* env, jobject /* this */) {
    __android_log_print(ANDROID_LOG_INFO, LOG_TAG, "pty_jni placeholder loaded");
    return env->NewStringUTF("phase-0.1-skeleton");
}
