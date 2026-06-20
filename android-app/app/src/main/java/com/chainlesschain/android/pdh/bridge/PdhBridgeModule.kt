package com.chainlesschain.android.pdh.bridge

import com.chainlesschain.android.feature.localterminal.LocalFilesystemBootstrapper
import com.chainlesschain.android.pdh.LocalCcRunner
import com.chainlesschain.android.pdh.LocalSystemDataSnapshotter
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import java.io.File
import javax.inject.Singleton

/**
 * Hilt wiring for the PDH bridge server (module 101).
 *
 * CRITICAL — lockDir alignment: the CLI side (packages/cli/src/lib/pdh-bridge.js)
 * scans `os.homedir()/.chainlesschain/pdh-bridge/`. The in-APK cc's HOME is set
 * by PtyEnvironment to `bootstrapper.homeDir.absolutePath`, so the bridge MUST
 * write its lockfile under THAT dir or cc's discovery (`readPdhLocks`) finds
 * nothing. Hence `lockDir = <bootstrapper.homeDir>/.chainlesschain/pdh-bridge`.
 *
 * Phase 1 — tools come from [PdhToolHost] (real): pdh_ping + collect_system_data
 * (L2) + list_collectors. [StubPdhToolHost] is retained only for the headless
 * protocol tests. Subsequent collectors (L3/L4/L1) register in PdhToolHost.
 */
@Module
@InstallIn(SingletonComponent::class)
object PdhBridgeModule {

    @Provides
    @Singleton
    fun providePdhBridgeServer(
        bootstrapper: LocalFilesystemBootstrapper,
        snapshotter: LocalSystemDataSnapshotter,
        ccRunner: LocalCcRunner,
    ): PdhBridgeServer {
        val lockDir = File(bootstrapper.homeDir, ".chainlesschain/pdh-bridge")
        return PdhBridgeServer(
            lockDir = lockDir,
            tools = PdhToolHost.tools(snapshotter, ccRunner),
            device = "android",
            appUid = android.os.Process.myUid(),
            pid = { android.os.Process.myPid().toLong() },
        )
    }
}
