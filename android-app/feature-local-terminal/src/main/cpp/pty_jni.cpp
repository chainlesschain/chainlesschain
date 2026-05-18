// Phase 1.1 — Real PTY JNI bridge.
//
// Exposes 7 native methods to Kotlin (`LocalPtyNative`):
//
//   nativeOpenPty()                       -> [masterFd, slaveFd]
//   nativeSpawn(slaveFd, exec, argv, envp, cwd) -> pid
//   nativeWrite(masterFd, bytes, off, len) -> bytesWritten
//   nativeRead(masterFd, buf, off, len)   -> bytesRead (or -1 on EOF / -errno on error)
//   nativeSetWinsize(masterFd, rows, cols, xpixel, ypixel) -> 0/-errno
//   nativeKillpg(pid, signal)             -> 0/-errno
//   nativeWaitpid(pid)                    -> exit status (negative if signaled)
//
// + a nativeVersion() sanity probe for Phase 0.5 smoke test compatibility.
//
// Design notes:
//
// - openpty/grantpt path: we use posix_openpt + grantpt + unlockpt + ptsname_r
//   manually instead of openpty() so the slave fd we hand back can stay closed
//   in the child after exec (we'll redirect 0/1/2 to it via posix_spawn file
//   actions, then close the parent-side copy).
//
// - posix_spawn vs raw fork+exec: per design doc §5 Trap 7, Android 14+ ART
//   injects an abort hook when an app process fork()s. posix_spawn uses
//   vfork+exec internally and bypasses the hook. POSIX_SPAWN_SETSID (value 128
//   per <spawn.h>) makes the child create a new session so the pty slave can
//   become its controlling terminal. Available from API 28; on API 26-27 the
//   posix_spawnattr_setflags call fails with EINVAL, and we fall back to a
//   fork+immediate-exec path that still satisfies the "no-Java-code-between"
//   constraint.
//
// - The child must close the master fd before exec (don't leak) — we add a
//   posix_spawn_file_actions_addclose for it.
//
// - errno return convention: failed JNI methods return negative errno values
//   (e.g., -ENOENT for missing executable, -EBADF for closed master) so the
//   Kotlin layer can present a typed error without throwing.

#include <jni.h>
#include <android/log.h>
#include <errno.h>
#include <fcntl.h>
#include <pty.h>
#include <signal.h>
#include <spawn.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>

#define LOG_TAG "LocalPtyNative"
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, LOG_TAG, __VA_ARGS__)
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO,  LOG_TAG, __VA_ARGS__)

// Posix_spawn flag may not be defined on older NDK platform headers but
// the value is stable. Belt-and-suspenders.
#ifndef POSIX_SPAWN_SETSID
#define POSIX_SPAWN_SETSID 128
#endif

extern "C" {

// ---------------------------------------------------------------------------
// nativeVersion — Phase 0.5 smoke probe.
// ---------------------------------------------------------------------------
JNIEXPORT jstring JNICALL
Java_com_chainlesschain_android_feature_localterminal_LocalPtyNative_nativeVersion(
        JNIEnv* env, jobject /* this */) {
    return env->NewStringUTF("phase-1.1-real-pty");
}

// ---------------------------------------------------------------------------
// nativeOpenPty — allocate a fresh master/slave pty pair.
// ---------------------------------------------------------------------------
JNIEXPORT jintArray JNICALL
Java_com_chainlesschain_android_feature_localterminal_LocalPtyNative_nativeOpenPty(
        JNIEnv* env, jobject /* this */) {
    jintArray result = env->NewIntArray(2);
    if (result == nullptr) {
        return nullptr;
    }
    jint values[2] = {-1, -1};

    int master = posix_openpt(O_RDWR | O_NOCTTY | O_CLOEXEC);
    if (master < 0) {
        values[0] = -errno;
        LOGE("posix_openpt failed: %s", strerror(errno));
        env->SetIntArrayRegion(result, 0, 2, values);
        return result;
    }
    if (grantpt(master) < 0) {
        values[0] = -errno;
        LOGE("grantpt failed: %s", strerror(errno));
        close(master);
        env->SetIntArrayRegion(result, 0, 2, values);
        return result;
    }
    if (unlockpt(master) < 0) {
        values[0] = -errno;
        LOGE("unlockpt failed: %s", strerror(errno));
        close(master);
        env->SetIntArrayRegion(result, 0, 2, values);
        return result;
    }

    char slave_name[256];
    if (ptsname_r(master, slave_name, sizeof(slave_name)) != 0) {
        values[0] = -errno;
        LOGE("ptsname_r failed: %s", strerror(errno));
        close(master);
        env->SetIntArrayRegion(result, 0, 2, values);
        return result;
    }

    int slave = open(slave_name, O_RDWR | O_NOCTTY | O_CLOEXEC);
    if (slave < 0) {
        values[0] = -errno;
        LOGE("open(%s) failed: %s", slave_name, strerror(errno));
        close(master);
        env->SetIntArrayRegion(result, 0, 2, values);
        return result;
    }

    values[0] = master;
    values[1] = slave;
    env->SetIntArrayRegion(result, 0, 2, values);
    return result;
}

// Helper: convert Java String[] to a heap-allocated argv-style array.
// Caller must call free_string_array on the result.
static char** jstring_array_to_argv(JNIEnv* env, jobjectArray array) {
    if (array == nullptr) {
        char** argv = static_cast<char**>(calloc(1, sizeof(char*)));
        return argv;
    }
    jsize len = env->GetArrayLength(array);
    char** argv = static_cast<char**>(calloc(static_cast<size_t>(len) + 1,
                                             sizeof(char*)));
    if (argv == nullptr) return nullptr;
    for (jsize i = 0; i < len; i++) {
        jstring s = static_cast<jstring>(env->GetObjectArrayElement(array, i));
        const char* cs = env->GetStringUTFChars(s, nullptr);
        argv[i] = strdup(cs);
        env->ReleaseStringUTFChars(s, cs);
        env->DeleteLocalRef(s);
    }
    argv[len] = nullptr;
    return argv;
}

static void free_string_array(char** array) {
    if (array == nullptr) return;
    for (char** p = array; *p != nullptr; p++) {
        free(*p);
    }
    free(array);
}

// ---------------------------------------------------------------------------
// nativeSpawn — fork+exec via posix_spawn, child's stdin/stdout/stderr point
// at the slave pty. Returns child pid (positive) or -errno.
// ---------------------------------------------------------------------------
JNIEXPORT jint JNICALL
Java_com_chainlesschain_android_feature_localterminal_LocalPtyNative_nativeSpawn(
        JNIEnv* env, jobject /* this */,
        jint slaveFd, jint masterFd,
        jstring executable, jobjectArray jargv, jobjectArray jenvp,
        jstring cwd) {
    const char* exec_cstr = env->GetStringUTFChars(executable, nullptr);
    const char* cwd_cstr = (cwd != nullptr) ? env->GetStringUTFChars(cwd, nullptr) : nullptr;

    char** argv = jstring_array_to_argv(env, jargv);
    char** envp = jstring_array_to_argv(env, jenvp);

    if (argv == nullptr || envp == nullptr) {
        env->ReleaseStringUTFChars(executable, exec_cstr);
        if (cwd_cstr) env->ReleaseStringUTFChars(cwd, cwd_cstr);
        free_string_array(argv);
        free_string_array(envp);
        return -ENOMEM;
    }

    posix_spawn_file_actions_t actions;
    posix_spawn_file_actions_init(&actions);

    // Optional cwd: posix_spawn_file_actions_addchdir_np is API 34+, fall back
    // to manipulating cwd via a wrapper script if needed. For minSdk=26 we use
    // the cheap path: chdir() in the parent right before spawn, then restore.
    // (Not perfectly clean but acceptable for Phase 1.1; LocalPtyClient serialises
    // spawns per session so the race window is small.)
    char saved_cwd[PATH_MAX] = "";
    bool changed_cwd = false;
    if (cwd_cstr != nullptr && cwd_cstr[0] != '\0') {
        if (getcwd(saved_cwd, sizeof(saved_cwd)) != nullptr) {
            if (chdir(cwd_cstr) == 0) {
                changed_cwd = true;
            } else {
                LOGE("chdir(%s) failed before spawn: %s", cwd_cstr, strerror(errno));
            }
        }
    }

    // Redirect child's 0/1/2 to the slave pty, then close both slave and master
    // in the child (the slave fd's redirected dups stay; the master is parent-only).
    posix_spawn_file_actions_adddup2(&actions, slaveFd, 0);
    posix_spawn_file_actions_adddup2(&actions, slaveFd, 1);
    posix_spawn_file_actions_adddup2(&actions, slaveFd, 2);
    posix_spawn_file_actions_addclose(&actions, slaveFd);
    posix_spawn_file_actions_addclose(&actions, masterFd);

    posix_spawnattr_t attrs;
    posix_spawnattr_init(&attrs);

    // POSIX_SPAWN_SETSID is API 28+. setflags will accept the flag at compile
    // time but the kernel may reject it on older devices. We try it; if it
    // fails at runtime we'll get EINVAL from posix_spawn itself and fall back.
    int flags = POSIX_SPAWN_SETSID;
    posix_spawnattr_setflags(&attrs, static_cast<short>(flags));

    pid_t pid = -1;
    int spawn_err = posix_spawn(&pid, exec_cstr, &actions, &attrs, argv, envp);

    if (spawn_err == EINVAL) {
        // Fallback for API 26/27 devices: drop SETSID and rely on the child
        // having no controlling tty at spawn (it inherits ours via fork, then
        // we'd need a wrapper to setsid post-spawn — not implemented here).
        // For API 26/27 paths this remains a Phase 1.2 follow-up.
        LOGE("posix_spawn EINVAL with SETSID; API 26-27 fallback not implemented");
    }

    if (changed_cwd && saved_cwd[0] != '\0') {
        chdir(saved_cwd);
    }

    posix_spawn_file_actions_destroy(&actions);
    posix_spawnattr_destroy(&attrs);

    // Parent must close its copy of the slave fd so the child holds the only
    // open slave. When the child exits, the slave-side hangup propagates to
    // master reads as EIO (BSD) or 0 EOF (Linux/Android).
    close(slaveFd);

    env->ReleaseStringUTFChars(executable, exec_cstr);
    if (cwd_cstr) env->ReleaseStringUTFChars(cwd, cwd_cstr);
    free_string_array(argv);
    free_string_array(envp);

    if (spawn_err != 0) {
        LOGE("posix_spawn(%s) failed: %s", exec_cstr, strerror(spawn_err));
        return -spawn_err;
    }
    return static_cast<jint>(pid);
}

// ---------------------------------------------------------------------------
// nativeWrite — write bytes to master fd.
// ---------------------------------------------------------------------------
JNIEXPORT jint JNICALL
Java_com_chainlesschain_android_feature_localterminal_LocalPtyNative_nativeWrite(
        JNIEnv* env, jobject /* this */,
        jint masterFd, jbyteArray data, jint offset, jint length) {
    if (length <= 0) return 0;

    jbyte* buf = env->GetByteArrayElements(data, nullptr);
    if (buf == nullptr) return -ENOMEM;

    ssize_t written = write(masterFd, buf + offset, static_cast<size_t>(length));
    int saved_errno = errno;

    env->ReleaseByteArrayElements(data, buf, JNI_ABORT);

    if (written < 0) {
        return -saved_errno;
    }
    return static_cast<jint>(written);
}

// ---------------------------------------------------------------------------
// nativeRead — blocking read from master fd. Returns bytes read, or 0 on EOF.
// Returns -EIO when the slave side has been closed (Linux pty hangup pattern).
// ---------------------------------------------------------------------------
JNIEXPORT jint JNICALL
Java_com_chainlesschain_android_feature_localterminal_LocalPtyNative_nativeRead(
        JNIEnv* env, jobject /* this */,
        jint masterFd, jbyteArray buffer, jint offset, jint length) {
    if (length <= 0) return 0;

    jbyte* buf = env->GetByteArrayElements(buffer, nullptr);
    if (buf == nullptr) return -ENOMEM;

    ssize_t got = read(masterFd, buf + offset, static_cast<size_t>(length));
    int saved_errno = errno;

    if (got > 0) {
        env->ReleaseByteArrayElements(buffer, buf, 0);  // commit
    } else {
        env->ReleaseByteArrayElements(buffer, buf, JNI_ABORT);
    }

    if (got < 0) {
        // EIO on pty master after slave hangup is the normal end-of-stream
        // signal on Linux. Translate to 0 (EOF) so callers don't need to
        // special-case it.
        if (saved_errno == EIO) return 0;
        return -saved_errno;
    }
    return static_cast<jint>(got);
}

// ---------------------------------------------------------------------------
// nativeSetWinsize — push terminal dimensions to the slave.
// ---------------------------------------------------------------------------
JNIEXPORT jint JNICALL
Java_com_chainlesschain_android_feature_localterminal_LocalPtyNative_nativeSetWinsize(
        JNIEnv* env, jobject /* this */,
        jint masterFd, jint rows, jint cols, jint xpixel, jint ypixel) {
    struct winsize ws = {};
    ws.ws_row = static_cast<unsigned short>(rows);
    ws.ws_col = static_cast<unsigned short>(cols);
    ws.ws_xpixel = static_cast<unsigned short>(xpixel);
    ws.ws_ypixel = static_cast<unsigned short>(ypixel);

    if (ioctl(masterFd, TIOCSWINSZ, &ws) < 0) {
        int saved_errno = errno;
        LOGE("TIOCSWINSZ failed: %s", strerror(saved_errno));
        return -saved_errno;
    }
    return 0;
}

// ---------------------------------------------------------------------------
// nativeKillpg — send signal to process group rooted at pid (kills children
// the shell spawned, not just the shell itself).
//
// IMPORTANT: relies on POSIX_SPAWN_SETSID having actually made the child a
// process-group leader. On Android API 28+ bionic this is honored, but
// Phase 1.1 real-device testing (Xiaomi 24115RA8EC + Android 16) returned
// ESRCH from killpg on a freshly-spawned mksh — the spawn's pgid did NOT
// equal the returned pid. Prefer [nativeKill] for "just this process";
// reserve killpg for "this process and everything it forked" only after
// verifying via [nativeGetpgid] that pgid == pid.
// ---------------------------------------------------------------------------
JNIEXPORT jint JNICALL
Java_com_chainlesschain_android_feature_localterminal_LocalPtyNative_nativeKillpg(
        JNIEnv* /* env */, jobject /* this */,
        jint pid, jint signum) {
    if (pid <= 0) return -EINVAL;
    if (killpg(static_cast<pid_t>(pid), signum) < 0) {
        return -errno;
    }
    return 0;
}

// ---------------------------------------------------------------------------
// nativeKill — send signal to a single pid (not the process group). Safer
// fallback when POSIX_SPAWN_SETSID didn't take effect.
// ---------------------------------------------------------------------------
JNIEXPORT jint JNICALL
Java_com_chainlesschain_android_feature_localterminal_LocalPtyNative_nativeKill(
        JNIEnv* /* env */, jobject /* this */,
        jint pid, jint signum) {
    if (pid <= 0) return -EINVAL;
    if (kill(static_cast<pid_t>(pid), signum) < 0) {
        return -errno;
    }
    return 0;
}

// ---------------------------------------------------------------------------
// nativeGetpgid — read the process-group id of pid (or 0 = self). Used to
// verify whether POSIX_SPAWN_SETSID actually elevated the child to a new
// session/group. Returns pgid (positive) or -errno.
// ---------------------------------------------------------------------------
JNIEXPORT jint JNICALL
Java_com_chainlesschain_android_feature_localterminal_LocalPtyNative_nativeGetpgid(
        JNIEnv* /* env */, jobject /* this */,
        jint pid) {
    pid_t pgid = getpgid(static_cast<pid_t>(pid));
    if (pgid < 0) return -errno;
    return static_cast<jint>(pgid);
}

// ---------------------------------------------------------------------------
// nativeWaitpid — block until pid exits. Returns exit code (0..255) or
// negative of signal that killed it (matches POSIX WIFSIGNALED convention).
// ---------------------------------------------------------------------------
JNIEXPORT jint JNICALL
Java_com_chainlesschain_android_feature_localterminal_LocalPtyNative_nativeWaitpid(
        JNIEnv* /* env */, jobject /* this */,
        jint pid) {
    if (pid <= 0) return -EINVAL;
    int status = 0;
    pid_t ret = waitpid(static_cast<pid_t>(pid), &status, 0);
    if (ret < 0) {
        return -errno;
    }
    if (WIFEXITED(status)) {
        return WEXITSTATUS(status);
    }
    if (WIFSIGNALED(status)) {
        return -WTERMSIG(status);
    }
    return -EINVAL;
}

// ---------------------------------------------------------------------------
// nativeClose — close an fd (used by Kotlin to drop the master fd when the
// session ends without going through waitpid).
// ---------------------------------------------------------------------------
JNIEXPORT jint JNICALL
Java_com_chainlesschain_android_feature_localterminal_LocalPtyNative_nativeClose(
        JNIEnv* /* env */, jobject /* this */, jint fd) {
    if (fd < 0) return -EBADF;
    if (close(fd) < 0) return -errno;
    return 0;
}

}  // extern "C"
