package com.chainlesschain.android.pdh.bridge

import com.chainlesschain.android.feature.localterminal.LocalFilesystemBootstrapper
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import java.io.File
import javax.inject.Singleton

/**
 * Hilt wiring for the PDH bridge server (module 101, Phase 0 app integration).
 *
 * CRITICAL — lockDir alignment: the CLI side (packages/cli/src/lib/pdh-bridge.js)
 * scans `os.homedir()/.chainlesschain/pdh-bridge/`. The in-APK cc's HOME is set
 * by PtyEnvironment to `bootstrapper.homeDir.absolutePath`, so the bridge MUST
 * write its lockfile under THAT dir or cc's discovery (`readPdhLocks`) finds
 * nothing. Hence `lockDir = <bootstrapper.homeDir>/.chainlesschain/pdh-bridge`.
 *
 * Phase 0 hosts [StubPdhToolHost] tools (pdh_ping / list_collectors) to weld the
 * connect path; Phase 1 swaps in real collect / query / file / task tools.
 */
@Module
@InstallIn(SingletonComponent::class)
object PdhBridgeModule {

    @Provides
    @Singleton
    fun providePdhBridgeServer(
        bootstrapper: LocalFilesystemBootstrapper,
    ): PdhBridgeServer {
        val lockDir = File(bootstrapper.homeDir, ".chainlesschain/pdh-bridge")
        return PdhBridgeServer(
            lockDir = lockDir,
            tools = StubPdhToolHost.tools(),
            device = "android",
            appUid = android.os.Process.myUid(),
            pid = { android.os.Process.myPid().toLong() },
        )
    }
}
